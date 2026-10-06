import { useState, type ReactNode } from 'react'
import { useRemoteDriver } from '../../hooks/useRemoteDriver'
import { cn } from '../../lib/cn'
import { toneColor } from '../../lib/robotThresholds'
import type { ControlModeState, RemoteDriverSessionMode, UiTone } from '../../types/telemetry'
import { GamepadIcon, KeyboardIcon } from '../shell/icons'
import { CenterBar, StatRow, StatusDot, Toggle } from '../viz/viz'

interface ControlDockProps {
  controlMode: ControlModeState
  selectedModeId: string | null
  onSelectMode: (modeId: string | null) => void
  onApplyMode: (modeId?: string | null) => Promise<void> | void
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-[var(--border)] px-3.5 py-3 last:border-b-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="hl-eyebrow">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

function inputSourceLabel(source: string) {
  if (source === 'keyboard') return 'Keyboard'
  if (source === 'gamepad') return 'Gamepad'
  if (source === 'hybrid') return 'Keyboard + gamepad'
  if (source === 'auto') return 'Autonomous routine'
  if (source === 'guided-nav') return 'Guided navigation'
  return 'Idle'
}

export function ControlDock({ controlMode, selectedModeId, onSelectMode, onApplyMode }: ControlDockProps) {
  const { remoteDriver, bridgeStatus, gyroAssist, setGyroAssist, preview, commandState, dispatchAction, teleopStreaming } =
    useRemoteDriver()
  const [sessionMode, setSessionMode] = useState<RemoteDriverSessionMode>('teleop')
  const [pending, setPending] = useState(false)

  const active = remoteDriver.mode !== 'disabled'
  const bridgeOnline = bridgeStatus.connected
  const robotOnline = bridgeStatus.robotLinkConnected ?? false
  const needsAutoMode = sessionMode === 'autonomous' && !selectedModeId
  const blockedReason = !bridgeOnline
    ? 'Bridge offline'
    : !robotOnline
      ? 'Waiting for robot link'
      : needsAutoMode
        ? 'Pick an auto routine'
        : null
  const canStart = !active && !blockedReason && !pending
  const inputSource = preview.inputSource === 'idle' ? remoteDriver.inputSource : preview.inputSource
  const streaming = teleopStreaming && preview.inputSource !== 'idle'
  const heartbeatTone: UiTone = remoteDriver.mode !== 'teleop' ? 'neutral' : remoteDriver.heartbeatFresh ? 'good' : 'warning'

  const start = async () => {
    setPending(true)
    try {
      if (sessionMode === 'autonomous' && selectedModeId) {
        await onApplyMode(selectedModeId)
      }
      await dispatchAction('start', sessionMode)
    } finally {
      setPending(false)
    }
  }

  const primaryTone = sessionMode === 'teleop' ? 'var(--success)' : 'var(--primary)'

  return (
    <aside className="hl-panel h-full w-full overflow-y-auto">
      <Section
        title="Session"
        aside={
          <span className="hl-value text-[11px] text-[var(--text-faint)]" title="Last driver action">
            {remoteDriver.lastAction || '—'}
          </span>
        }
      >
        <div className="hl-seg grid w-full grid-cols-2" role="group" aria-label="Session mode">
          <button
            type="button"
            className="hl-seg-item"
            aria-pressed={sessionMode === 'teleop'}
            onClick={() => setSessionMode('teleop')}
          >
            Teleop
          </button>
          <button
            type="button"
            className="hl-seg-item"
            aria-pressed={sessionMode === 'autonomous'}
            onClick={() => setSessionMode('autonomous')}
          >
            Auto
          </button>
        </div>

        {sessionMode === 'autonomous' ? (
          <div className="mt-2.5">
            {controlMode.availableModes.length === 0 ? (
              <div className="hl-well px-3 py-2.5 text-[12px] text-[var(--text-faint)]">No auto routines published by the robot.</div>
            ) : (
              <ul className="grid min-w-0 grid-cols-1 gap-1" role="radiogroup" aria-label="Auto routine">
                {controlMode.availableModes.map((mode) => {
                  const selected = mode.id === selectedModeId
                  const running = mode.id === controlMode.currentModeId
                  return (
                    <li key={mode.id} className="min-w-0">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={!mode.isAvailable}
                        onClick={() => {
                          onSelectMode(mode.id)
                          void onApplyMode(mode.id)
                        }}
                        className={cn(
                          'flex w-full items-start gap-2.5 rounded-[8px] border px-2.5 py-2 text-left transition-colors disabled:opacity-40',
                          selected
                            ? 'border-[color-mix(in_srgb,var(--primary)_50%,transparent)] bg-[var(--primary-soft)]'
                            : 'border-[var(--border)] bg-[var(--surface-alt)] hover:border-[var(--border-strong)]',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                            selected ? 'border-[var(--primary)]' : 'border-[var(--border-strong)]',
                          )}
                        >
                          {selected ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[12.5px] font-medium text-[var(--text)]">{mode.label}</span>
                            {running ? (
                              <span className="text-[10.5px] font-medium text-[var(--success)]">on robot</span>
                            ) : null}
                          </span>
                          {mode.description ? (
                            <span className="block truncate text-[11px] text-[var(--text-faint)]">{mode.description}</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : null}

        <div className="mt-3 grid gap-1.5">
          {active ? (
            <button
              type="button"
              onClick={() => void dispatchAction('disable')}
              className="flex h-11 items-center justify-center gap-2 rounded-[9px] border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[13.5px] font-semibold text-[var(--text)] transition-colors hover:bg-[color-mix(in_srgb,var(--text)_10%,var(--surface-raised))]"
            >
              <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--text)]" />
              Disable
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start()}
              disabled={!canStart}
              className="flex h-11 items-center justify-center gap-2 rounded-[9px] border text-[13.5px] font-semibold transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
              style={{ background: primaryTone, borderColor: primaryTone, color: '#0d1410' }}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
              </svg>
              {pending ? 'Sending…' : sessionMode === 'teleop' ? 'Enable teleop' : 'Run auto'}
            </button>
          )}

          <div className="flex items-center justify-between gap-2 text-[11.5px]">
            <span className="truncate" style={{ color: blockedReason && !active ? toneColor('warning') : 'var(--text-faint)' }}>
              {active ? remoteDriver.status : blockedReason ?? 'Ready'}
            </span>
            <button type="button" onClick={() => void dispatchAction('reset')} className="shrink-0 text-[var(--text-faint)] underline-offset-2 hover:text-[var(--text-secondary)] hover:underline">
              Reset session
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="Driver input"
        aside={
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <StatusDot tone={streaming ? 'good' : remoteDriver.mode === 'teleop' ? 'warning' : 'neutral'} pulse={streaming} />
            {streaming ? 'streaming' : remoteDriver.mode === 'teleop' ? 'ready' : 'standby'}
          </span>
        }
      >
        <div className="mb-3 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          {preview.gamepadConnected ? <GamepadIcon /> : <KeyboardIcon />}
          <span className="truncate">{preview.gamepadConnected ? preview.gamepadLabel : inputSourceLabel(inputSource)}</span>
        </div>

        <div className="grid gap-2.5">
          {[
            { label: 'Forward', value: preview.y, color: 'var(--series-1)' },
            { label: 'Strafe', value: preview.x, color: 'var(--series-3)' },
            { label: 'Rotate', value: preview.z, color: 'var(--series-4)' },
          ].map((axis) => (
            <div key={axis.label} className="grid grid-cols-[52px_minmax(0,1fr)_42px] items-center gap-2">
              <span className="hl-label">{axis.label}</span>
              <CenterBar value={axis.value} color={axis.color} />
              <span className="hl-value text-right text-[12px]">
                {axis.value >= 0 ? '+' : ''}
                {axis.value.toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[var(--text-faint)]">
          <span className="inline-flex items-center gap-1">
            <kbd className="hl-kbd">W</kbd>
            <kbd className="hl-kbd">A</kbd>
            <kbd className="hl-kbd">S</kbd>
            <kbd className="hl-kbd">D</kbd>
            move
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="hl-kbd">Q</kbd>
            <kbd className="hl-kbd">E</kbd>
            rotate
          </span>
        </div>

        <div className="mt-3 border-t border-[var(--border)] pt-2">
          <Toggle
            checked={gyroAssist}
            onChange={setGyroAssist}
            label="Gyro assist"
            description="Hold heading while rotation is neutral"
          />
        </div>
      </Section>

      <Section title="Link">
        <StatRow
          label={
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={bridgeOnline ? 'good' : 'critical'} /> Bridge
            </span>
          }
          value={bridgeOnline ? bridgeStatus.transport : 'offline'}
        />
        <StatRow
          label={
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={robotOnline ? 'good' : 'warning'} /> Robot
            </span>
          }
          value={robotOnline ? 'connected' : 'waiting'}
        />
        <StatRow
          label={
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={heartbeatTone} /> Heartbeat
            </span>
          }
          value={remoteDriver.heartbeatAgeSec === null ? '—' : `${(remoteDriver.heartbeatAgeSec * 1000).toFixed(0)} ms`}
        />
        <p className="mt-2 text-[11px] leading-[1.45] text-[var(--text-faint)]" style={{ color: commandState.tone === 'critical' ? toneColor('critical') : undefined }}>
          {commandState.message}
        </p>
      </Section>
    </aside>
  )
}
