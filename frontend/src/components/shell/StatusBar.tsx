import { useRemoteDriver } from '../../hooks/useRemoteDriver'
import { cn } from '../../lib/cn'
import { formatClock } from '../../lib/format'
import { toneColor, voltageTone } from '../../lib/robotThresholds'
import { useTelemetryMode } from '../../telemetry-mode/useTelemetryMode'
import type { AlertItem, RemoteDriverMode, TelemetrySnapshot, UiTone } from '../../types/telemetry'
import { StatusDot } from '../viz/viz'

const driverModeMeta: Record<RemoteDriverMode, { label: string; tone: UiTone }> = {
  disabled: { label: 'Disabled', tone: 'neutral' },
  teleop: { label: 'Teleop', tone: 'good' },
  autonomous: { label: 'Autonomous', tone: 'warning' },
}

function HotloopMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M12 3.5a8.5 8.5 0 1 1-7.36 4.25"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M4.2 3.6v4.6h4.6" fill="none" stroke="var(--primary)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.6" fill="var(--text)" />
    </svg>
  )
}

function Divider() {
  return <span className="h-5 w-px shrink-0 bg-[var(--border)]" aria-hidden="true" />
}

function LinkIndicator({ label, ok, warnWhenDown = false }: { label: string; ok: boolean; warnWhenDown?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]" title={`${label}: ${ok ? 'connected' : 'down'}`}>
      <StatusDot tone={ok ? 'good' : warnWhenDown ? 'warning' : 'critical'} />
      {label}
    </span>
  )
}

interface StatusBarProps {
  snapshot: TelemetrySnapshot
  alerts: AlertItem[]
  onOpenAlerts: () => void
}

export function StatusBar({ snapshot, alerts, onOpenAlerts }: StatusBarProps) {
  const { remoteDriver, bridgeStatus, dispatchAction } = useRemoteDriver()
  const { mode, setMode } = useTelemetryMode()
  const driver = driverModeMeta[remoteDriver.mode]
  const batteryTone = voltageTone(snapshot.battery.voltageV)
  const criticalCount = alerts.filter((alert) => alert.severity === 'critical').length
  const warningCount = alerts.length - criticalCount
  const robotLink = bridgeStatus.robotLinkConnected ?? snapshot.connection.online
  const active = remoteDriver.mode !== 'disabled'

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--background)] px-3">
      <div className="flex items-center gap-2 pr-1">
        <HotloopMark />
        <span className="text-[14px] font-semibold tracking-[-0.01em]">Hotloop</span>
      </div>

      <Divider />

      <div
        className={cn(
          'inline-flex h-8 items-center gap-2 rounded-[8px] border px-3 text-[12.5px] font-semibold tracking-[0.02em] uppercase',
          `tone-${driver.tone}`,
        )}
        style={{
          borderColor: active ? 'color-mix(in srgb, var(--tone) 45%, transparent)' : 'var(--border)',
          background: active ? 'color-mix(in srgb, var(--tone) 14%, transparent)' : 'var(--surface)',
          color: active ? 'color-mix(in srgb, var(--tone) 55%, white 45%)' : 'var(--text-muted)',
        }}
        aria-live="polite"
      >
        <StatusDot tone={driver.tone} pulse={active} />
        {driver.label}
      </div>

      <div className="hidden items-center gap-3 md:flex">
        <LinkIndicator label="Bridge" ok={bridgeStatus.connected} />
        <LinkIndicator label="Robot" ok={robotLink} warnWhenDown={bridgeStatus.connected} />
      </div>

      <Divider />

      <div className="flex items-baseline gap-1" title="Pack voltage">
        <span className="hl-value text-[14px] font-medium" style={{ color: batteryTone === 'good' || batteryTone === 'neutral' ? undefined : toneColor(batteryTone) }}>
          {snapshot.battery.voltageV > 0 ? snapshot.battery.voltageV.toFixed(2) : '--'}
        </span>
        <span className="text-[11px] text-[var(--text-muted)]">V</span>
      </div>

      <button
        type="button"
        onClick={onOpenAlerts}
        className="hl-btn hl-btn-ghost h-7 px-2"
        title="Open Health"
      >
        {alerts.length === 0 ? (
          <>
            <StatusDot tone="good" />
            <span className="text-[12px]">No alerts</span>
          </>
        ) : (
          <>
            <StatusDot tone={criticalCount ? 'critical' : 'warning'} />
            <span className="text-[12px]">
              {criticalCount ? `${criticalCount} critical` : ''}
              {criticalCount && warningCount ? ' · ' : ''}
              {warningCount ? `${warningCount} warning` : ''}
            </span>
          </>
        )}
      </button>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right leading-tight lg:block">
          <div className="hl-value text-[12px] text-[var(--text-secondary)]">{snapshot.connection.online ? formatClock(snapshot.timestamp) : '--:--:--'}</div>
          <div className="text-[10.5px] text-[var(--text-faint)]">
            {snapshot.connection.team ? `team ${snapshot.connection.team}` : 'no team'} · {snapshot.connection.hostSeen || '—'}
          </div>
        </div>

        <div className="hl-seg" role="group" aria-label="Data source">
          <button type="button" className="hl-seg-item" aria-pressed={mode === 'online'} onClick={() => setMode('online')}>
            <span className="hl-dot !h-1.5 !w-1.5" style={{ background: mode === 'online' ? 'var(--success)' : undefined }} />
            Live
          </button>
          <button type="button" className="hl-seg-item" aria-pressed={mode === 'offline'} onClick={() => setMode('offline')}>
            <span className="hl-dot !h-1.5 !w-1.5" style={{ background: mode === 'offline' ? 'var(--warning)' : undefined }} />
            Sim
          </button>
        </div>

        <button
          type="button"
          onClick={() => void dispatchAction('estop')}
          className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[color-mix(in_srgb,var(--danger)_70%,transparent)] bg-[var(--danger)] px-3.5 text-[12.5px] font-bold tracking-[0.06em] text-white uppercase shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_18%,transparent)] transition-[filter] hover:brightness-110 active:brightness-95"
          title="Emergency stop"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M8 2.5h8l5.5 5.5v8L16 21.5H8L2.5 16V8z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          </svg>
          E-Stop
        </button>
      </div>
    </header>
  )
}
