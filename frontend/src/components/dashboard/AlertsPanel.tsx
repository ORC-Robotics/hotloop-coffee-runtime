import { toneColor } from '../../lib/robotThresholds'
import type { AlertItem, UiTone } from '../../types/telemetry'
import { EmptyHint } from '../viz/viz'
import { DashboardCard } from './DashboardCard'
import { StatusBadge } from './StatusBadge'

interface AlertsPanelProps {
  alerts: AlertItem[]
}

function severityTone(severity: AlertItem['severity']): UiTone {
  if (severity === 'critical') return 'critical'
  if (severity === 'warning') return 'warning'
  return 'info'
}

export function AlertsPanel({ alerts }: AlertsPanelProps) {
  const dominant = alerts[0]?.severity ?? null

  return (
    <DashboardCard
      title="Alerts"
      headerSlot={
        dominant ? (
          <StatusBadge tone={severityTone(dominant)} label={`${alerts.length} active`} />
        ) : (
          <StatusBadge tone="good" label="clear" />
        )
      }
    >
      <AlertsPanelBody alerts={alerts} />
    </DashboardCard>
  )
}

export function AlertsPanelBody({ alerts }: AlertsPanelProps) {
  if (alerts.length === 0) {
    return <EmptyHint title="No active alerts" />
  }

  return (
    <ul className="grid h-full min-h-0 content-start gap-1.5 overflow-auto">
      {alerts.map((alert) => {
        const color = toneColor(severityTone(alert.severity))
        return (
          <li
            key={alert.id}
            className="hl-well grid grid-cols-[3px_minmax(0,1fr)] gap-x-2.5 overflow-hidden py-2 pr-2.5"
          >
            <span className="row-span-2 -my-2 rounded-r-sm" style={{ background: color }} />
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[12.5px] font-medium text-[var(--text)]">{alert.title}</span>
              <span className="shrink-0 text-[10.5px] font-medium uppercase tracking-[0.06em]" style={{ color }}>
                {alert.severity}
              </span>
            </div>
            <p className="text-[11.5px] leading-[1.45] text-[var(--text-muted)]">{alert.message}</p>
          </li>
        )
      })}
    </ul>
  )
}
