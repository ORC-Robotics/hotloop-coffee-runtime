import {
  createContext,
  createElement,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import {
  getRemoteDriverStatus,
  sendControlInputState,
  sendRemoteDriverAction,
  sendRemoteDriverState,
} from '../data/telemetryGateway'
import { useTelemetryMode } from '../telemetry-mode/useTelemetryMode'
import type {
  BridgeStatus,
  ControlInputButtonState,
  ControlInputSnapshot,
  RemoteDriverAction,
  RemoteDriverSessionMode,
  RemoteDriverStatus,
} from '../types/telemetry'

const STATUS_POLL_MS = 320
const PREVIEW_POLL_MS = 80
const GUIDED_COMMAND_TTL_MS = 260
const DRIVER_SOURCE = 'Hotloop Desktop'
const INPUT_DEADBAND = 0.08
const GUIDED_INPUT_SOURCE = 'guided-nav'

type DriverPreview = {
  gamepadConnected: boolean
  gamepadLabel: string
  inputSource: string
  x: number
  y: number
  z: number
}

type CommandState = {
  tone: 'neutral' | 'warning' | 'good' | 'critical' | 'info'
  message: string
}

export type GuidedDriverCommand = {
  x: number
  y: number
  z: number
  message?: string
}

type GuidedDriverCommandInternal = GuidedDriverCommand & {
  message: string
  expiresAtMs: number
}

type GuidedDriverCommandState = {
  active: boolean
  inputSource: string
  x: number
  y: number
  z: number
  message: string
}

type KeyboardState = {
  left: boolean
  right: boolean
  forward: boolean
  reverse: boolean
  rotateLeft: boolean
  rotateRight: boolean
}

type InputSample = DriverPreview

const GAMEPAD_NAMED_AXIS_INDEX: Record<string, number> = {
  leftX: 0,
  leftY: 1,
  rightX: 2,
  rightY: 3,
}

const GAMEPAD_NAMED_BUTTON_INDEX: Record<string, number> = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  leftBumper: 4,
  rightBumper: 5,
  leftTrigger: 6,
  rightTrigger: 7,
  back: 8,
  start: 9,
  leftStick: 10,
  rightStick: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
  guide: 16,
}

function clampUnit(value: number) {
  return Math.max(-1, Math.min(1, value))
}

function applyDeadband(value: number) {
  const clamped = clampUnit(value)
  return Math.abs(clamped) < INPUT_DEADBAND ? 0 : clamped
}

function createFallbackRemoteDriver(): RemoteDriverStatus {
  return {
    active: false,
    mode: 'disabled',
    heartbeatFresh: false,
    heartbeatAgeSec: null,
    source: 'Hotloop',
    inputSource: 'idle',
    lastAction: 'none',
    driveX: 0,
    driveY: 0,
    driveZ: 0,
    gyroAssist: true,
    robotEnabled: false,
    status: 'Remote driver unavailable.',
  }
}

function createFallbackBridgeStatus(): BridgeStatus {
  return {
    transport: 'networktables',
    chooserPath: 'SmartDashboard/Auto mode',
    telemetryEndpoint: '/api/telemetry',
    controlModeEndpoint: '/api/control-mode',
    topicCatalogEndpoint: '/api/topics',
    topicWriteEndpoint: '/api/topics/write',
    remoteDriverEndpoint: '/api/remote-driver',
    controlInputEndpoint: '/api/control-input/state',
    connected: false,
    robotLinkConnected: false,
    teamNumber: 0,
    manualHost: null,
    connectionPreference: 'team-auto',
    discoveredCameraFeeds: [],
    message: 'Waiting for bridge backend.',
  }
}

function createIdlePreview(): DriverPreview {
  return {
    gamepadConnected: false,
    gamepadLabel: 'No controller detected',
    inputSource: 'idle',
    x: 0,
    y: 0,
    z: 0,
  }
}

function createEmptyKeyboardState(): KeyboardState {
  return {
    left: false,
    right: false,
    forward: false,
    reverse: false,
    rotateLeft: false,
    rotateRight: false,
  }
}

function createDefaultMessage(): CommandState {
  return {
    tone: 'neutral',
    message: 'Select Teleoperado or Autonomo, then press Start.',
  }
}

function createIdleGuidedCommandState(): GuidedDriverCommandState {
  return {
    active: false,
    inputSource: GUIDED_INPUT_SOURCE,
    x: 0,
    y: 0,
    z: 0,
    message: 'Guided navigation idle.',
  }
}

function matchesEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function readKeyboardAxes(state: KeyboardState) {
  const x = (state.right ? 0.72 : 0) - (state.left ? 0.72 : 0)
  const y = (state.forward ? 0.72 : 0) - (state.reverse ? 0.72 : 0)
  const z = (state.rotateRight ? 0.56 : 0) - (state.rotateLeft ? 0.56 : 0)

  return {
    x: applyDeadband(x),
    y: applyDeadband(y),
    z: applyDeadband(z),
    active: Boolean(state.left || state.right || state.forward || state.reverse || state.rotateLeft || state.rotateRight),
  }
}

function selectGamepad(preferredIndex: number | null) {
  if (!navigator.getGamepads) {
    return null
  }

  const pads = navigator.getGamepads()
  if (!pads) {
    return null
  }

  if (preferredIndex !== null) {
    const preferred = pads[preferredIndex]
    if (preferred?.connected) {
      return preferred
    }
  }

  for (const pad of pads) {
    if (pad?.connected) {
      return pad
    }
  }

  return null
}

function normalizeButton(button: GamepadButton | undefined): ControlInputButtonState {
  return {
    pressed: Boolean(button?.pressed),
    touched: Boolean(button?.touched),
    value: clampUnit(Number(button?.value ?? 0)),
  }
}

function readGamepadState(gamepad: Gamepad | null) {
  if (!gamepad) {
    return {
      x: 0,
      y: 0,
      z: 0,
      active: false,
      connected: false,
      label: 'No controller detected',
      mapping: '',
      index: null as number | null,
      axes: [] as number[],
      buttons: [] as ControlInputButtonState[],
      namedAxes: Object.fromEntries(Object.keys(GAMEPAD_NAMED_AXIS_INDEX).map((key) => [key, 0])) as Record<string, number>,
      namedButtons: Object.fromEntries(
        Object.keys(GAMEPAD_NAMED_BUTTON_INDEX).map((key) => [key, normalizeButton(undefined)]),
      ) as Record<string, ControlInputButtonState>,
    }
  }

  const axes = Array.from(gamepad.axes ?? [], (value) => applyDeadband(Number(value ?? 0)))
  const buttons = Array.from(gamepad.buttons ?? [], (button) => normalizeButton(button))
  const namedAxes = Object.fromEntries(
    Object.entries(GAMEPAD_NAMED_AXIS_INDEX).map(([key, axisIndex]) => [key, axes[axisIndex] ?? 0]),
  ) as Record<string, number>
  const namedButtons = Object.fromEntries(
    Object.entries(GAMEPAD_NAMED_BUTTON_INDEX).map(([key, buttonIndex]) => [key, buttons[buttonIndex] ?? normalizeButton(undefined)]),
  ) as Record<string, ControlInputButtonState>

  const x = axes[0] ?? 0
  const y = applyDeadband(-(gamepad.axes[1] ?? 0))
  const z = axes[2] ?? 0
  const active =
    Math.abs(x) > 0 ||
    Math.abs(y) > 0 ||
    Math.abs(z) > 0 ||
    buttons.some((button) => button.pressed || Math.abs(button.value) > 0)

  return {
    x,
    y,
    z,
    active,
    connected: true,
    label: gamepad.id || `Gamepad ${gamepad.index + 1}`,
    mapping: gamepad.mapping || '',
    index: gamepad.index,
    axes,
    buttons,
    namedAxes,
    namedButtons,
  }
}

function buildControlInputSnapshot(
  gamepadState: ReturnType<typeof readGamepadState>,
  keyboardState: KeyboardState,
  inputSample: InputSample,
  windowActive: boolean,
): ControlInputSnapshot {
  return {
    timestampMs: Date.now(),
    source: DRIVER_SOURCE,
    inputSource: inputSample.inputSource,
    windowActive,
    combined: {
      x: inputSample.x,
      y: inputSample.y,
      z: inputSample.z,
    },
    keyboard: { ...keyboardState },
    gamepad: {
      connected: gamepadState.connected,
      label: gamepadState.label,
      mapping: gamepadState.mapping,
      index: gamepadState.index,
      axes: [...gamepadState.axes],
      buttons: gamepadState.buttons.map((button) => ({ ...button })),
      namedAxes: { ...gamepadState.namedAxes },
      namedButtons: Object.fromEntries(
        Object.entries(gamepadState.namedButtons).map(([key, button]) => [key, { ...button }]),
      ),
    },
  }
}

function combineInputs(
  gamepadState: ReturnType<typeof readGamepadState>,
  keyboardState: ReturnType<typeof readKeyboardAxes>,
): InputSample {
  const activeSources: string[] = []

  if (gamepadState.active) {
    activeSources.push('gamepad')
  }
  if (keyboardState.active) {
    activeSources.push('keyboard')
  }

  const inputSource =
    activeSources.length === 0 ? 'idle' : activeSources.length === 1 ? activeSources[0] : 'hybrid'

  return {
    gamepadConnected: gamepadState.connected,
    gamepadLabel: gamepadState.label,
    inputSource,
    x: clampUnit(gamepadState.x + keyboardState.x),
    y: clampUnit(gamepadState.y + keyboardState.y),
    z: clampUnit(gamepadState.z + keyboardState.z),
  }
}

function createZeroPacket(gyroAssist: boolean) {
  return {
    x: 0,
    y: 0,
    z: 0,
    gyroAssist,
    source: DRIVER_SOURCE,
    inputSource: 'idle',
  }
}

function useRemoteDriverController() {
  const { mode } = useTelemetryMode()
  const [remoteDriver, setRemoteDriver] = useState<RemoteDriverStatus>(createFallbackRemoteDriver())
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>(createFallbackBridgeStatus())
  const [gyroAssist, setGyroAssist] = useState(true)
  const [preview, setPreview] = useState<DriverPreview>(createIdlePreview())
  const [commandState, setCommandState] = useState<CommandState>(createDefaultMessage())
  const [windowActive, setWindowActive] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden && document.hasFocus(),
  )
  const keyboardStateRef = useRef<KeyboardState>(createEmptyKeyboardState())
  const preferredGamepadIndexRef = useRef<number | null>(null)
  const gyroAssistRef = useRef(gyroAssist)
  const guidedCommandRef = useRef<GuidedDriverCommandInternal | null>(null)
  const wasTransmittingRef = useRef(false)
  const [guidedCommandState, setGuidedCommandState] =
    useState<GuidedDriverCommandState>(createIdleGuidedCommandState)

  useEffect(() => {
    gyroAssistRef.current = gyroAssist
  }, [gyroAssist])

  const clearGuidedCommand = useCallback((message = 'Guided navigation idle.') => {
    guidedCommandRef.current = null
    startTransition(() => {
      setGuidedCommandState({
        ...createIdleGuidedCommandState(),
        message,
      })
    })
  }, [])

  const setGuidedCommand = useCallback((command: GuidedDriverCommand | null) => {
    if (!command) {
      clearGuidedCommand()
      return
    }

    const nextCommand: GuidedDriverCommandInternal = {
      x: clampUnit(command.x),
      y: clampUnit(command.y),
      z: clampUnit(command.z),
      message: command.message ?? 'Guided navigation command active.',
      expiresAtMs: Date.now() + GUIDED_COMMAND_TTL_MS,
    }

    guidedCommandRef.current = nextCommand
    startTransition(() => {
      setGuidedCommandState({
        active: true,
        inputSource: GUIDED_INPUT_SOURCE,
        x: nextCommand.x,
        y: nextCommand.y,
        z: nextCommand.z,
        message: nextCommand.message,
      })
    })
  }, [clearGuidedCommand])

  const flushZeroPacket = useEffectEvent(async (nextState?: CommandState) => {
    keyboardStateRef.current = createEmptyKeyboardState()
    clearGuidedCommand()
    startTransition(() => {
      setPreview((current) => ({
        ...current,
        inputSource: 'idle',
        x: 0,
        y: 0,
        z: 0,
      }))
    })

    if (!wasTransmittingRef.current) {
      if (nextState) {
        setCommandState(nextState)
      }
      return
    }

    try {
      const response = await sendRemoteDriverState(createZeroPacket(gyroAssistRef.current))
      if (response.remoteDriver) {
        setRemoteDriver(response.remoteDriver)
      }
      if (response.bridgeStatus) {
        setBridgeStatus(response.bridgeStatus)
      }
    } catch {
      // Keep shutdown paths quiet. The robot-side timeout remains the safety net.
    } finally {
      wasTransmittingRef.current = false
      if (nextState) {
        setCommandState(nextState)
      }
    }
  })

  useEffect(() => {
    let cancelled = false

    const syncStatus = async () => {
      try {
        const response = await getRemoteDriverStatus()
        if (cancelled) {
          return
        }

        setRemoteDriver(response.remoteDriver)
        if (response.bridgeStatus) {
          setBridgeStatus(response.bridgeStatus)
        }
        if (response.remoteDriver.mode !== 'teleop' || !windowActive) {
          setGyroAssist(response.remoteDriver.gyroAssist)
        }
      } catch {
        if (cancelled) {
          return
        }

        setBridgeStatus((previous) => ({
          ...previous,
          connected: false,
          robotLinkConnected: false,
          message: 'Bridge backend unavailable. Check the local service or use reconnect in Network.',
        }))
        setRemoteDriver((previous) => ({
          ...previous,
          status: 'Unable to reach the remote driver bridge.',
        }))
      }
    }

    void syncStatus()
    const interval = window.setInterval(() => {
      void syncStatus()
    }, STATUS_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [mode, windowActive])

  useEffect(() => {
    const handleKeyChange = (event: KeyboardEvent, pressed: boolean) => {
      if (matchesEditableTarget(event.target)) {
        return
      }

      let handled = true
      const nextState = keyboardStateRef.current

      switch (event.code) {
        case 'KeyA':
        case 'ArrowLeft':
          nextState.left = pressed
          break
        case 'KeyD':
        case 'ArrowRight':
          nextState.right = pressed
          break
        case 'KeyW':
        case 'ArrowUp':
          nextState.forward = pressed
          break
        case 'KeyS':
        case 'ArrowDown':
          nextState.reverse = pressed
          break
        case 'KeyQ':
          nextState.rotateLeft = pressed
          break
        case 'KeyE':
          nextState.rotateRight = pressed
          break
        default:
          handled = false
          break
      }

      if (handled) {
        event.preventDefault()
      }
    }

    const updateWindowActivity = () => {
      setWindowActive(!document.hidden && document.hasFocus())
    }

    const handleBlur = () => {
      setWindowActive(false)
      void flushZeroPacket({
        tone: 'warning',
        message: 'Teleop heartbeat paused because the Hotloop window lost focus.',
      })
    }

    const handleFocus = () => {
      updateWindowActivity()
    }

    const handleGamepadChange = () => {
      const selected = selectGamepad(preferredGamepadIndexRef.current)
      preferredGamepadIndexRef.current = selected?.index ?? null
    }

    const handleVisibility = () => {
      if (document.hidden) {
        handleBlur()
        return
      }

      updateWindowActivity()
    }

    const keyDown = (event: KeyboardEvent) => handleKeyChange(event, true)
    const keyUp = (event: KeyboardEvent) => handleKeyChange(event, false)

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('gamepadconnected', handleGamepadChange)
    window.addEventListener('gamepaddisconnected', handleGamepadChange)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('gamepadconnected', handleGamepadChange)
      window.removeEventListener('gamepaddisconnected', handleGamepadChange)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [mode, remoteDriver.mode])

  useEffect(() => {
    let cancelled = false

    const tick = async () => {
      const selectedGamepad = selectGamepad(preferredGamepadIndexRef.current)
      const gamepadState = readGamepadState(selectedGamepad)
      preferredGamepadIndexRef.current = gamepadState.index
      const keyboardAxes = readKeyboardAxes(keyboardStateRef.current)
      const operatorInputSample = combineInputs(
        gamepadState,
        keyboardAxes,
      )
      const guidedCommand = guidedCommandRef.current
      const guidedCommandActive =
        guidedCommand !== null && guidedCommand.expiresAtMs >= Date.now()
      let inputSample = operatorInputSample

      if (guidedCommandActive && operatorInputSample.inputSource === 'idle' && guidedCommand) {
        inputSample = {
          gamepadConnected: gamepadState.connected,
          gamepadLabel: gamepadState.label,
          inputSource: GUIDED_INPUT_SOURCE,
          x: guidedCommand.x,
          y: guidedCommand.y,
          z: guidedCommand.z,
        }
      } else if (guidedCommandActive && operatorInputSample.inputSource !== 'idle') {
        clearGuidedCommand('Guided navigation interrupted by manual operator input.')
        setCommandState({
          tone: 'warning',
          message: 'Guided navigation interrupted by manual operator input.',
        })
      } else if (guidedCommand !== null && !guidedCommandActive) {
        clearGuidedCommand('Guided navigation command expired; robot heartbeat returned to idle.')
      }

      startTransition(() => {
        setPreview(inputSample)
      })

      const controlSnapshot = buildControlInputSnapshot(
        gamepadState,
        keyboardStateRef.current,
        inputSample,
        windowActive,
      )
      const controlResponse = await sendControlInputState(controlSnapshot)
      if (!cancelled) {
        if (controlResponse.bridgeStatus) {
          setBridgeStatus(controlResponse.bridgeStatus)
        } else if (!controlResponse.ok) {
          setBridgeStatus((previous) => ({
            ...previous,
            robotLinkConnected: false,
            message: 'Control input stream degraded.',
          }))
        }
      }

      if (!windowActive || remoteDriver.mode !== 'teleop') {
        return
      }

      try {
        const response = await sendRemoteDriverState({
          x: inputSample.x,
          y: inputSample.y,
          z: inputSample.z,
          gyroAssist: gyroAssistRef.current,
          source: DRIVER_SOURCE,
          inputSource: inputSample.inputSource,
        })

        if (cancelled) {
          return
        }

        if (response.remoteDriver) {
          setRemoteDriver(response.remoteDriver)
        }
        if (response.bridgeStatus) {
          setBridgeStatus(response.bridgeStatus)
        }
        wasTransmittingRef.current = true
      } catch {
        if (!cancelled) {
          setCommandState({
            tone: 'critical',
            message: 'Failed to stream teleop heartbeat packets to the bridge.',
          })
        }
      }
    }

    void tick()
    const interval = window.setInterval(() => {
      void tick()
    }, PREVIEW_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [clearGuidedCommand, mode, remoteDriver.mode, windowActive])

  useEffect(() => {
    if (remoteDriver.mode === 'teleop') {
      setCommandState(
        windowActive
          ? {
              tone: 'good',
              message: 'Teleop session active. Keyboard and joystick input are being streamed automatically.',
            }
          : {
              tone: 'warning',
              message: 'Teleop heartbeat paused because the Hotloop window lost focus.',
            },
      )
      return
    }

    if (remoteDriver.mode === 'autonomous') {
      setCommandState({
        tone: 'info',
        message: 'Autonomous session active. Disable before changing mode or automode.',
      })
      return
    }

    void flushZeroPacket(createDefaultMessage())
  }, [remoteDriver.mode, windowActive])

  const dispatchAction = async (
    action: RemoteDriverAction,
    sessionMode?: RemoteDriverSessionMode,
  ) => {
    if (action === 'start' && !sessionMode) {
      setCommandState({
        tone: 'critical',
        message: 'Start requires a target session mode.',
      })
      return
    }

    const actionLabel =
      action === 'start' ? `start ${sessionMode === 'autonomous' ? 'autonomous' : 'teleop'}` : action

    setCommandState({
      tone: 'warning',
      message: `Sending ${actionLabel} to the robot.`,
    })

    try {
      const response = await sendRemoteDriverAction(action, DRIVER_SOURCE, sessionMode)
      if (response.remoteDriver) {
        setRemoteDriver(response.remoteDriver)
      }
      if (response.bridgeStatus) {
        setBridgeStatus(response.bridgeStatus)
      }

      if (action !== 'start') {
        keyboardStateRef.current = createEmptyKeyboardState()
        startTransition(() => {
          setPreview((current) => ({
            ...current,
            inputSource: 'idle',
            x: 0,
            y: 0,
            z: 0,
          }))
        })
      }

      if (action === 'disable' || action === 'reset' || action === 'estop') {
        wasTransmittingRef.current = false
        clearGuidedCommand()
      }

      setCommandState({
        tone: response.error ? 'critical' : 'good',
        message: response.error ?? response.message ?? 'Robot action applied.',
      })
    } catch {
      setCommandState({
        tone: 'critical',
        message: 'The remote driver action did not reach the bridge.',
      })
    }
  }

  return {
    remoteDriver,
    bridgeStatus,
    gyroAssist,
    setGyroAssist,
    preview,
    guidedCommandState,
    setGuidedCommand,
    clearGuidedCommand,
    commandState,
    dispatchAction,
    teleopStreaming: windowActive && remoteDriver.mode === 'teleop',
  }
}

type RemoteDriverControllerValue = ReturnType<typeof useRemoteDriverController>

const RemoteDriverContext = createContext<RemoteDriverControllerValue | null>(null)

export function RemoteDriverProvider({ children }: PropsWithChildren) {
  const value = useRemoteDriverController()
  return createElement(RemoteDriverContext.Provider, { value }, children)
}

export function useRemoteDriver() {
  const value = useContext(RemoteDriverContext)
  if (!value) {
    throw new Error('useRemoteDriver must be used within a RemoteDriverProvider.')
  }

  return value
}
