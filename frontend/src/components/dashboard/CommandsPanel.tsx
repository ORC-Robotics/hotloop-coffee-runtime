import { formatCommand } from '../../lib/format'
import type { CommandData, TelemetryDerivedState } from '../../types/telemetry'
import { CenterBar } from '../viz/viz'
import { DashboardCard } from './DashboardCard'

interface CommandsPanelProps {
  data: CommandData
  derived: TelemetryDerivedState
}

const commandMeta = [
  { key: 'forward', label: 'Forward', color: 'var(--series-1)', neg: 'rev', pos: 'fwd' },
  { key: 'center', label: 'Strafe', color: 'var(--series-3)', neg: 'left', pos: 'right' },
  { key: 'rotation', label: 'Rotation', color: 'var(--series-4)', neg: 'ccw', pos: 'cw' },
] as const

export function CommandsPanel({ data, derived }: CommandsPanelProps) {
  return (
    <DashboardCard title="Drive commands" subtitle="controller output">
      <CommandsPanelBody data={data} derived={derived} />
    </DashboardCard>
  )
}

export function CommandsPanelBody({ data, derived }: CommandsPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col justify-between gap-3 h-lt-150:justify-center-safe">
      <div className="grid gap-3 h-lt-180:gap-2 h-lt-120:gap-1.5 h-lt-90:gap-1">
        {commandMeta.map((item) => {
          const value = data[item.key]
          return (
            <div key={item.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 h-lt-120:mb-1 h-lt-90:mb-0.5 h-lt-90:leading-4">
                <span className="hl-label">{item.label}</span>
                <span className="hl-value text-[13px]">{formatCommand(value)}</span>
              </div>
              <CenterBar value={value} color={item.color} />
              <div className="mt-1 flex justify-between text-[10.5px] text-[var(--text-faint)] h-lt-220:hidden">
                <span>{item.neg}</span>
                <span>{item.pos}</span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="truncate text-[11.5px] text-[var(--text-muted)] h-lt-180:hidden" title={derived.commandNarrative}>
        {derived.commandNarrative}
      </p>
    </div>
  )
}
