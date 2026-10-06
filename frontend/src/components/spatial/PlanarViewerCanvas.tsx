import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { clamp } from '../../lib/format'
import { cn } from '../../lib/cn'
import {
  decodeSpatialLidarPoints,
  type SpatialScanRegistration,
  type ResolvedSpatialLidar,
  type ResolvedSpatialPose,
} from '../../lib/spatialTelemetry'
import type {
  SpatialGoalPreview,
  SpatialOccupancyDisplayMode,
  SpatialOccupancyLayer,
  SpatialBufferedLidarScan,
  SpatialObservedMapScan,
  SpatialPoseTransitionState,
  SpatialReplaySelection,
  SpatialTrailPoint,
  SpatialViewportState,
} from '../../hooks/useSpatialViewModel'
import type { SpatialMazeOverlay } from '../../types/telemetry'
import type { GuidedNavigationState } from '../../hooks/useGuidedNavigation'
import {
  type PlanarSceneBufferedLidar,
  drawPlanarScene,
  type PlanarSceneGoalPreview,
  type PlanarSceneLidar,
  type PlanarSceneMazeOverlay,
  type PlanarSceneOccupancyLayer,
  type PlanarSceneObservedMap,
  type PlanarScenePalette,
  type PlanarScenePose,
  type PlanarSceneRegistration,
} from './planarSceneRenderer'

interface PlanarViewerCanvasProps {
  poseSelection: ResolvedSpatialPose
  lidarSelection: ResolvedSpatialLidar
  scanRegistration: SpatialScanRegistration
  poseTransition: SpatialPoseTransitionState
  trail: SpatialTrailPoint[]
  lidarHistory: SpatialBufferedLidarScan[]
  observedMapScans: SpatialObservedMapScan[]
  observedMapFadeOlderScans: boolean
  observedMapFrozen: boolean
  occupancyLayer: SpatialOccupancyLayer | null
  showOccupancyLayer: boolean
  occupancyDisplayMode: SpatialOccupancyDisplayMode
  mazeOverlay: SpatialMazeOverlay | null
  goalPreview: SpatialGoalPreview
  guidedNavigation?: GuidedNavigationState
  replaySelection: SpatialReplaySelection | null
  viewport: SpatialViewportState
  followRobot: boolean
  onPanViewport: (deltaXPx: number, deltaYPx: number) => void
  onZoomViewport: (
    factor: number,
    anchor: { x: number; y: number },
    viewportSize: { width: number; height: number },
  ) => void
  onRotateViewport: (deltaDeg: number) => void
  onToggleFollowRobot: () => void
  onCenterRobot: () => void
  onResetView: () => void
  onClearTrail: () => void
  onClearLidarHistory: () => void
  onClearObservedMap: () => void
  onToggleObservedMapFrozen: () => void
  onToggleOccupancyLayer: () => void
  onSelectGoalAtWorldPoint: (point: { xMm: number; yMm: number }) => void
  onArmGoalPreview: () => void
  onDisarmGoalPreview: () => void
  onClearGoalPreview: () => void
  variant?: 'workspace' | 'widget'
  requireCtrlForInteraction?: boolean
}

interface PointerDragState {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  moved: boolean
}

function normalizeAngleDelta(value: number) {
  let next = value

  while (next > 180) {
    next -= 360
  }

  while (next < -180) {
    next += 360
  }

  return next
}

function buildPalette(target: HTMLElement): PlanarScenePalette {
  const styles = getComputedStyle(target)
  const resolve = (variableName: string, fallback: string) => {
    const resolved = styles.getPropertyValue(variableName).trim()
    return resolved || fallback
  }

  return {
    background: resolve('--surface', '#0b1320'),
    surface: resolve('--surface-alt', '#101b2b'),
    gridMinor: resolve('--grid-line', '#263245'),
    gridMajor: resolve('--border-strong', '#6b7a90'),
    axisX: resolve('--warning', '#f59e0b'),
    axisY: resolve('--info', '#38bdf8'),
    axisOrigin: resolve('--text', '#f8fafc'),
    trail: resolve('--accent', '#2dd4bf'),
    robotFill: resolve('--surface-alt', '#152334'),
    robotStroke: resolve('--text', '#e5eef7'),
    heading: resolve('--primary', '#7dd3fc'),
    lidarSweep: resolve('--info', '#38bdf8'),
    lidarPoint: resolve('--accent', '#2dd4bf'),
    lidarGhost: resolve('--text-muted', '#6b7a90'),
    observedMapPoint: resolve('--text-muted', '#6b7a90'),
    observedMapRecent: resolve('--accent', '#2dd4bf'),
    occupancyFree: resolve('--info', '#38bdf8'),
    occupancyOccupied: resolve('--warning', '#f59e0b'),
    occupancyMixed: resolve('--accent', '#2dd4bf'),
    mazeRoute: resolve('--primary', '#60a5fa'),
    mazeTarget: resolve('--accent', '#34d399'),
    mazeCandidate: resolve('--warning', '#fbbf24'),
    goalReady: resolve('--primary', '#7dd3fc'),
    goalArmed: resolve('--accent', '#2dd4bf'),
    goalBlocked: resolve('--warning', '#f59e0b'),
    registrationSweep: resolve('--warning', '#f59e0b'),
    registrationPoint: resolve('--warning', '#f59e0b'),
  }
}

function matchesEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function screenToWorld(
  point: { x: number; y: number },
  viewport: SpatialViewportState,
  canvasSize: { width: number; height: number },
) {
  const rotationRad = (viewport.rotationDeg * Math.PI) / 180
  const cosRotation = Math.cos(rotationRad)
  const sinRotation = Math.sin(rotationRad)
  const viewXMm = (point.x - canvasSize.width / 2) / viewport.zoomPxPerMm
  const viewYMm = -(point.y - canvasSize.height / 2) / viewport.zoomPxPerMm

  return {
    xMm: viewport.centerXMm + viewXMm * cosRotation - viewYMm * sinRotation,
    yMm: viewport.centerYMm + viewXMm * sinRotation + viewYMm * cosRotation,
  }
}

function formatViewportRotation(rotationDeg: number) {
  const normalizedRotation = ((Math.round(rotationDeg) % 360) + 360) % 360
  return normalizedRotation === 0 ? 'N Up' : `View ${normalizedRotation} deg`
}

function interpolatePose(
  poseTransition: SpatialPoseTransitionState,
  startedAtMs: number,
  nowMs: number,
): PlanarScenePose | null {
  const latest = poseTransition.latest
  if (!latest || !latest.available || latest.freshness === 'invalid') {
    return null
  }

  const previous = poseTransition.previous
  if (
    !previous ||
    poseTransition.transitionMs <= 0 ||
    previous.frame !== latest.frame ||
    previous.source !== latest.source ||
    previous.freshness !== 'live' ||
    latest.freshness !== 'live'
  ) {
    return latest
  }

  const progress = clamp((nowMs - startedAtMs) / poseTransition.transitionMs, 0, 1)

  return {
    xMm: previous.xMm + (latest.xMm - previous.xMm) * progress,
    yMm: previous.yMm + (latest.yMm - previous.yMm) * progress,
    yawDeg: previous.yawDeg + normalizeAngleDelta(latest.yawDeg - previous.yawDeg) * progress,
    freshness: latest.freshness,
    frame: latest.frame,
    source: latest.source,
  }
}

function buildSceneLidar(
  lidarSelection: ResolvedSpatialLidar,
  pose: PlanarScenePose | null,
): PlanarSceneLidar | null {
  if (!pose || !lidarSelection.isRenderable) {
    return null
  }

  const points = decodeSpatialLidarPoints(lidarSelection.scan)

  if (points.length === 0) {
    return null
  }

  return {
    freshness: lidarSelection.scan.freshness,
    frame: lidarSelection.scan.frame,
    poseFrame: lidarSelection.scan.poseFrame,
    points,
  }
}

function buildSceneLidarHistory(history: SpatialBufferedLidarScan[]): PlanarSceneBufferedLidar[] {
  return history.map((scan) => ({
    freshness: scan.freshness,
    frame: scan.frame,
    poseFrame: scan.poseFrame,
    pose: {
      xMm: scan.pose.xMm,
      yMm: scan.pose.yMm,
      yawDeg: scan.pose.yawDeg,
      freshness: scan.freshness,
      frame: scan.pose.frame,
      source: scan.pose.source,
    },
    points: scan.points,
  }))
}

function buildObservedMap(
  observedMapScans: SpatialObservedMapScan[],
  fadeOlderScans: boolean,
): PlanarSceneObservedMap | null {
  if (observedMapScans.length === 0) {
    return null
  }

  return {
    frame: observedMapScans[observedMapScans.length - 1]?.frame ?? 'none',
    fadeOlderScans,
    scans: observedMapScans.map((scan) => ({
      timestampMs: scan.timestampMs,
      sequence: scan.sequence,
      frame: scan.frame,
      pointCount: scan.pointCount,
      points: scan.points,
    })),
  }
}

function buildOccupancyLayer(
  occupancyLayer: SpatialOccupancyLayer | null,
): PlanarSceneOccupancyLayer | null {
  if (!occupancyLayer || occupancyLayer.cells.length === 0) {
    return null
  }

  return {
    frame: occupancyLayer.frame,
    cellSizeMm: occupancyLayer.cellSizeMm,
    cells: occupancyLayer.cells.map((cell) => ({
      centerXMm: cell.centerXMm,
      centerYMm: cell.centerYMm,
      freeCount: cell.freeCount,
      occupiedCount: cell.occupiedCount,
      state: cell.state,
      confidence: cell.confidence,
    })),
  }
}

function buildReplayPose(replaySelection: SpatialReplaySelection | null): PlanarScenePose | null {
  if (!replaySelection) {
    return null
  }

  return {
    xMm: replaySelection.scan.pose.xMm,
    yMm: replaySelection.scan.pose.yMm,
    yawDeg: replaySelection.scan.pose.yawDeg,
    freshness: replaySelection.scan.freshness === 'invalid' ? 'stale' : replaySelection.scan.freshness,
    frame: replaySelection.scan.pose.frame,
    source: replaySelection.scan.pose.source,
  }
}

function buildReplayLidar(replaySelection: SpatialReplaySelection | null): PlanarSceneLidar | null {
  if (!replaySelection) {
    return null
  }

  return {
    freshness: replaySelection.scan.freshness,
    frame: replaySelection.scan.frame,
    poseFrame: replaySelection.scan.poseFrame,
    points: replaySelection.scan.points,
  }
}

function buildRegistrationOverlay(
  scanRegistration: SpatialScanRegistration,
): PlanarSceneRegistration | null {
  if (!scanRegistration.available || scanRegistration.alignedReferencePoints.length === 0) {
    return null
  }

  return {
    quality: scanRegistration.quality,
    points: scanRegistration.alignedReferencePoints,
  }
}

function buildGoalPreviewSceneModel(goalPreview: SpatialGoalPreview): PlanarSceneGoalPreview | null {
  if (goalPreview.status === 'idle' || goalPreview.requestedXMm === null || goalPreview.requestedYMm === null) {
    return null
  }

  if (goalPreview.status === 'unavailable') {
    return null
  }

  return {
    status:
      goalPreview.status === 'ready' || goalPreview.status === 'armed'
        ? goalPreview.status
        : goalPreview.target
          ? 'unreachable'
          : 'blocked',
    requestedXMm: goalPreview.requestedXMm,
    requestedYMm: goalPreview.requestedYMm,
    targetXMm: goalPreview.target?.snappedXMm ?? null,
    targetYMm: goalPreview.target?.snappedYMm ?? null,
    targetYawDeg: goalPreview.targetYawDeg,
    path: goalPreview.path,
  }
}

function buildMazeOverlaySceneModel(
  mazeOverlay: PlanarViewerCanvasProps['mazeOverlay'],
): PlanarSceneMazeOverlay | null {
  if (!mazeOverlay || !mazeOverlay.available) {
    return null
  }

  return {
    frame: mazeOverlay.frame,
    state: mazeOverlay.state,
    subphase: mazeOverlay.subphase,
    status: mazeOverlay.status,
    routeActive: mazeOverlay.routeActive,
    routeLengthMm: mazeOverlay.routeLengthMm,
    target: mazeOverlay.target
      ? {
          xMm: mazeOverlay.target.xMm,
          yMm: mazeOverlay.target.yMm,
          clearanceMm: mazeOverlay.target.clearanceMm,
          score: mazeOverlay.target.score,
        }
      : null,
    route: mazeOverlay.route.map((point: SpatialMazeOverlay['route'][number]) => ({
      xMm: point.xMm,
      yMm: point.yMm,
    })),
    candidates: mazeOverlay.candidates.map((candidate: SpatialMazeOverlay['candidates'][number]) => ({
      xMm: candidate.xMm,
      yMm: candidate.yMm,
      clearanceMm: candidate.clearanceMm,
      score: candidate.score,
    })),
  }
}

function OverlayButton({
  label,
  onClick,
  title,
  active = false,
}: {
  label: string
  onClick: () => void
  compact?: boolean
  title?: string
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-pressed={active}
      className={cn(
        'pointer-events-auto inline-flex h-6 min-w-6 items-center justify-center rounded-[5px] px-1.5 text-[11.5px] font-medium whitespace-nowrap transition-colors',
        active ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]',
      )}
    >
      {label}
    </button>
  )
}

function OverlayGroup({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-[7px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] p-0.5 backdrop-blur-sm">
      {children}
    </div>
  )
}

function OverlayInfoChip({
  label,
}: {
  label: string
}) {
  return <span className="whitespace-nowrap">{label}</span>
}

export function PlanarViewerCanvas({
  poseSelection,
  lidarSelection,
  scanRegistration,
  poseTransition,
  trail,
  lidarHistory,
  observedMapScans,
  observedMapFadeOlderScans,
  observedMapFrozen,
  occupancyLayer,
  showOccupancyLayer,
  occupancyDisplayMode,
  mazeOverlay,
  goalPreview,
  guidedNavigation,
  replaySelection,
  viewport,
  followRobot,
  onPanViewport,
  onZoomViewport,
  onRotateViewport,
  onToggleFollowRobot,
  onCenterRobot,
  onResetView,
  onClearTrail,
  onClearLidarHistory,
  onClearObservedMap,
  onToggleObservedMapFrozen,
  onToggleOccupancyLayer,
  onSelectGoalAtWorldPoint,
  onArmGoalPreview,
  onDisarmGoalPreview,
  onClearGoalPreview,
  variant = 'workspace',
  requireCtrlForInteraction = false,
}: PlanarViewerCanvasProps) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragStateRef = useRef<PointerDragState | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 })
  const [isDragging, setIsDragging] = useState(false)
  const [modifierActive, setModifierActive] = useState(false)
  const widgetVariant = variant === 'widget'
  const interactionModifierActive = !requireCtrlForInteraction || modifierActive
  const cursorClassName = isDragging
    ? 'cursor-grabbing'
    : requireCtrlForInteraction
      ? interactionModifierActive
        ? 'cursor-grab'
        : 'cursor-default'
      : 'cursor-grab'
  const goalActionLabel =
    goalPreview.status === 'armed'
      ? widgetVariant
        ? 'Disarm Goal'
        : 'Disarm Goal'
      : goalPreview.status === 'ready'
        ? widgetVariant
          ? 'Arm Goal'
          : 'Arm Goal'
        : widgetVariant
          ? 'Clear Goal'
          : 'Clear Goal'
  const navStatusLabel = guidedNavigation
    ? guidedNavigation.active
      ? 'Nav Running'
      : guidedNavigation.canStart
        ? 'Nav Ready'
        : guidedNavigation.status === 'idle'
          ? 'Nav Idle'
          : `Nav ${guidedNavigation.status}`
    : null
  const navActionLabel = guidedNavigation
    ? guidedNavigation.active
      ? widgetVariant
        ? 'Stop Nav'
        : 'Stop Guided'
      : guidedNavigation.canStart
        ? widgetVariant
          ? 'Start Nav'
          : 'Start Guided'
        : widgetVariant
          ? 'Check Nav'
          : 'Check Guided'
    : null
  const handleGuidedNavigationAction = () => {
    if (!guidedNavigation) {
      return
    }

    if (guidedNavigation.active) {
      guidedNavigation.stopGuidedNavigation()
      return
    }

    guidedNavigation.startGuidedNavigation()
  }
  const sceneSnapshot = useMemo(
    () => ({
      trail,
      viewport,
      poseTransition,
      poseSelection,
      lidarSelection,
      scanRegistration,
      lidarHistory,
      observedMapScans,
      observedMapFadeOlderScans,
      observedMapFrozen,
      occupancyLayer,
      showOccupancyLayer,
      occupancyDisplayMode,
      mazeOverlay,
      goalPreview,
      replaySelection,
    }),
    [
      lidarHistory,
      lidarSelection,
      occupancyDisplayMode,
      mazeOverlay,
      goalPreview,
      occupancyLayer,
      observedMapFadeOlderScans,
      observedMapFrozen,
      observedMapScans,
      poseSelection,
      poseTransition,
      replaySelection,
      scanRegistration,
      showOccupancyLayer,
      trail,
      viewport,
    ],
  )

  useEffect(() => {
    const element = shellRef.current
    if (!element) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      setCanvasSize({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      })
    })

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!requireCtrlForInteraction) {
      return
    }

    const handleKeyState = (event: KeyboardEvent) => {
      setModifierActive(event.ctrlKey)
    }

    const resetModifier = () => {
      setModifierActive(false)
    }

    window.addEventListener('keydown', handleKeyState)
    window.addEventListener('keyup', handleKeyState)
    window.addEventListener('blur', resetModifier)

    return () => {
      window.removeEventListener('keydown', handleKeyState)
      window.removeEventListener('keyup', handleKeyState)
      window.removeEventListener('blur', resetModifier)
    }
  }, [requireCtrlForInteraction])

  const poseTransitionStartRef = useRef<{
    transition: SpatialPoseTransitionState | null
    startedAtMs: number
  }>({ transition: null, startedAtMs: 0 })

  const renderFrame = useEffectEvent((timestampMs: number) => {
    const canvas = canvasRef.current
    const shell = shellRef.current
    if (!canvas || !shell) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const { width, height } = canvasSize
    const dpr = window.devicePixelRatio || 1
    const deviceWidth = Math.max(1, Math.round(width * dpr))
    const deviceHeight = Math.max(1, Math.round(height * dpr))

    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
      canvas.width = deviceWidth
      canvas.height = deviceHeight
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (poseTransitionStartRef.current.transition !== sceneSnapshot.poseTransition) {
      poseTransitionStartRef.current = {
        transition: sceneSnapshot.poseTransition,
        startedAtMs: timestampMs,
      }
    }

    const livePose = interpolatePose(
      sceneSnapshot.poseTransition,
      poseTransitionStartRef.current.startedAtMs,
      timestampMs,
    )
    const pose = buildReplayPose(sceneSnapshot.replaySelection) ?? livePose

    drawPlanarScene(context, {
      widthPx: width,
      heightPx: height,
      viewport: sceneSnapshot.viewport,
      palette: buildPalette(shell),
      trail: sceneSnapshot.trail,
      pose,
      observedMap: buildObservedMap(
        sceneSnapshot.observedMapScans,
        sceneSnapshot.observedMapFadeOlderScans,
      ),
      occupancy: buildOccupancyLayer(sceneSnapshot.occupancyLayer),
      mazeOverlay: buildMazeOverlaySceneModel(sceneSnapshot.mazeOverlay),
      goalPreview: buildGoalPreviewSceneModel(sceneSnapshot.goalPreview),
      lidarHistory: buildSceneLidarHistory(sceneSnapshot.lidarHistory),
      registration: buildRegistrationOverlay(sceneSnapshot.scanRegistration),
      lidar:
        buildReplayLidar(sceneSnapshot.replaySelection) ??
        buildSceneLidar(sceneSnapshot.lidarSelection, pose),
    })
  })

  useEffect(() => {
    let animationFrameId = 0

    const tick = (timestampMs: number) => {
      renderFrame(timestampMs)
      animationFrameId = window.requestAnimationFrame(tick)
    }

    animationFrameId = window.requestAnimationFrame(tick)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (matchesEditableTarget(event.target)) {
        return
      }

      if (event.code === 'KeyN') {
        if (goalPreview.status === 'ready') {
          event.preventDefault()
          onArmGoalPreview()
        } else if (goalPreview.status === 'armed') {
          event.preventDefault()
          onDisarmGoalPreview()
        }
      }

      if (event.code === 'Escape') {
        if (goalPreview.status !== 'idle') {
          event.preventDefault()
          onClearGoalPreview()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    goalPreview.status,
    onArmGoalPreview,
    onClearGoalPreview,
    onDisarmGoalPreview,
  ])

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    if (requireCtrlForInteraction && !event.ctrlKey) {
      return
    }

    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1

    onZoomViewport(
      factor,
      {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      },
      canvasSize,
    )
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return
    }

    if (requireCtrlForInteraction && !event.ctrlKey) {
      return
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    }

    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    const moved =
      dragState.moved ||
      Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) >= 5

    if (moved) {
      onPanViewport(event.clientX - dragState.lastX, event.clientY - dragState.lastY)
      if (!dragState.moved) {
        setIsDragging(true)
      }
    }

    dragStateRef.current = {
      ...dragState,
      lastX: event.clientX,
      lastY: event.clientY,
      moved,
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current
    if (dragState?.pointerId === event.pointerId) {
      if (!dragState.moved && (!requireCtrlForInteraction || event.ctrlKey)) {
        const rect = event.currentTarget.getBoundingClientRect()
        onSelectGoalAtWorldPoint(
          screenToWorld(
            {
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
            },
            viewport,
            canvasSize,
          ),
        )
      }

      dragStateRef.current = null
      setIsDragging(false)
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      ref={shellRef}
      className={cn(
        'relative h-full overflow-hidden bg-[var(--background)]',
        widgetVariant ? 'min-h-0' : 'min-h-[420px] rounded-[10px] border border-[var(--border)]',
      )}
    >
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={cn('h-full w-full touch-none', cursorClassName)}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-[7px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] px-2 py-1 text-[11px] text-[var(--text-muted)] backdrop-blur-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: replaySelection ? 'var(--warning)' : poseSelection.isRenderable ? 'var(--success)' : 'var(--text-faint)' }}
            />
            {replaySelection ? `Replay ${replaySelection.index + 1}/${replaySelection.total}` : 'Live'}
          </span>
          <span className="text-[var(--text-faint)]">{poseSelection.selectedSourceLabel}</span>
          {goalPreview.status !== 'idle' ? <OverlayInfoChip label={`goal ${goalPreview.status}`} /> : null}
          {mazeOverlay?.available ? <OverlayInfoChip label={`maze ${mazeOverlay.state}`} /> : null}
          {navStatusLabel ? <OverlayInfoChip label={navStatusLabel} /> : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <OverlayGroup>
            <OverlayButton label="Follow" active={followRobot} onClick={onToggleFollowRobot} title="Keep the robot centred" />
            <OverlayButton label="Center" onClick={onCenterRobot} title="Center on robot" />
            <OverlayButton label="Reset" onClick={onResetView} title="Reset zoom and rotation" />
            <span className="mx-0.5 h-3.5 w-px bg-[var(--border)]" />
            <OverlayButton label={'\u21b6'} title="Rotate view left" onClick={() => onRotateViewport(-90)} />
            <OverlayButton label={'\u21b7'} title="Rotate view right" onClick={() => onRotateViewport(90)} />
            <span className="mx-0.5 h-3.5 w-px bg-[var(--border)]" />
            <OverlayButton label="Occupancy" active={showOccupancyLayer} onClick={onToggleOccupancyLayer} title="Show occupancy grid" />
          </OverlayGroup>
          {!widgetVariant ? (
            <OverlayGroup>
              <OverlayButton label={observedMapFrozen ? 'Resume map' : 'Freeze map'} active={observedMapFrozen} onClick={onToggleObservedMapFrozen} />
              <OverlayButton label="Clear trail" onClick={onClearTrail} />
              <OverlayButton label="Clear map" onClick={onClearObservedMap} />
              <OverlayButton label="Clear scans" onClick={onClearLidarHistory} />
            </OverlayGroup>
          ) : null}
          {goalPreview.status !== 'idle' || (guidedNavigation && navActionLabel) ? (
            <OverlayGroup>
              {goalPreview.status !== 'idle' ? (
                <OverlayButton
                  label={goalActionLabel}
                  active={goalPreview.status === 'armed'}
                  onClick={
                    goalPreview.status === 'armed'
                      ? onDisarmGoalPreview
                      : goalPreview.status === 'ready'
                        ? onArmGoalPreview
                        : onClearGoalPreview
                  }
                />
              ) : null}
              {guidedNavigation && navActionLabel ? (
                <OverlayButton label={navActionLabel} onClick={handleGuidedNavigationAction} />
              ) : null}
            </OverlayGroup>
          ) : null}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-[6px] bg-[color-mix(in_srgb,var(--surface)_80%,transparent)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--text-faint)] backdrop-blur-sm">
          <OverlayInfoChip label={`${Math.round(viewport.zoomPxPerMm * 1000)} px/m`} />
          <OverlayInfoChip label={formatViewportRotation(viewport.rotationDeg)} />
          <OverlayInfoChip label={`trail ${trail.length}`} />
          <OverlayInfoChip label={`scans ${observedMapScans.length}`} />
          <OverlayInfoChip
            label={
              lidarSelection.isRenderable
                ? `lidar ${lidarSelection.scan.validPointCount}/${lidarSelection.scan.pointCount}`
                : `lidar ${lidarSelection.renderState}`
            }
          />
          <OverlayInfoChip
            label={
              scanRegistration.available && scanRegistration.meanResidualMm !== null
                ? `reg ${scanRegistration.quality} ${Math.round(scanRegistration.meanResidualMm)}mm`
                : 'reg —'
            }
          />
          {!widgetVariant && showOccupancyLayer ? (
            <OverlayInfoChip label={occupancyLayer ? `occ ${occupancyLayer.cells.length} ${occupancyDisplayMode}` : 'occ building'} />
          ) : null}
          {!widgetVariant && lidarHistory.length ? <OverlayInfoChip label={`buffer ${lidarHistory.length}`} /> : null}
          {!widgetVariant && observedMapFadeOlderScans ? null : null}
        </div>
        <div className="shrink-0 rounded-[6px] bg-[color-mix(in_srgb,var(--surface)_80%,transparent)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-faint)] backdrop-blur-sm">
          {requireCtrlForInteraction
            ? interactionModifierActive
              ? 'drag to pan · wheel to zoom · click to set goal'
              : 'hold Ctrl to pan / zoom'
            : 'drag to pan · wheel to zoom · click free space for a goal · N arms · Esc clears'}
        </div>
      </div>

      {!poseSelection.isRenderable ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
          <div className="rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] px-3 py-2 text-center text-[12px] text-[var(--text-muted)] backdrop-blur-sm">
            No pose from the selected source
          </div>
        </div>
      ) : null}
    </div>
  )
}
