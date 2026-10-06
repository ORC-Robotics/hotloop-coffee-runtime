/* eslint-disable react-refresh/only-export-components */

import { useMemo } from 'react'
import { formatCurrent, formatDurationMinutes, formatPower } from '../../lib/format'
import { BATTERY_CRITICAL_V, BATTERY_WARNING_V, toneColor, voltageTone } from '../../lib/robotThresholds'
import type { BatteryData, BatteryHistoryPoint, UiTone } from '../../types/telemetry'
import { FillBar, StatRow, TimePlot } from '../viz/viz'
import { DashboardCard } from './DashboardCard'
import { StatusBadge } from './StatusBadge'

export { voltageTone }

interface BatteryPanelProps {
  battery: BatteryData
  history: BatteryHistoryPoint[]
}

function voltageSwing(points: BatteryHistoryPoint[]) {
  if (points.length < 4) {
    return null
  }

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const point of points) {
    min = Math.min(min, point.voltageV)
    max = Math.max(max, point.voltageV)
  }
  return max - min
}

function swingTone(swing: number | null): UiTone {
  if (swing === null) return 'neutral'
  if (swing > 0.45) return 'critical'
  if (swing > 0.2) return 'warning'
  return 'good'
}

export function BatteryPanel({ battery, history }: BatteryPanelProps) {
  const tone = voltageTone(battery.voltageV)
  return (
    <DashboardCard
      title="Battery"
      headerSlot={
        <StatusBadge tone={tone} label={tone === 'good' ? 'healthy' : tone === 'warning' ? 'low' : tone === 'critical' ? 'critical' : 'no pack'} />
      }
    >
      <BatteryPanelBody battery={battery} history={history} />
    </DashboardCard>
  )
}

export function BatteryPanelBody({ battery, history }: BatteryPanelProps) {
  const tone = voltageTone(battery.voltageV)
  const voltages = useMemo(() => history.map((point) => point.voltageV), [history])
  const swing = voltageSwing(history)
  const soc = Math.max(0, Math.min(1, battery.stateOfCharge))

  return (
    <div className="flex h-full min-h-0 flex-col justify-center-safe gap-3 h-lt-120:gap-1.5">
      <div className="flex items-end justify-between gap-x-4 gap-y-1.5 w-lt-260:flex-col w-lt-260:items-stretch h-lt-90:!flex-row h-lt-90:!items-end">
        <div className="min-w-0">
          <div className="hl-label h-lt-90:hidden">Pack voltage</div>
          <div
            className="hl-value mt-0.5 font-medium whitespace-nowrap leading-[1.05] text-[clamp(16px,min(13cqw,26cqh),36px)]"
            style={tone === 'warning' || tone === 'critical' ? { color: toneColor(tone) } : undefined}
            title="Pack voltage"
          >
            {battery.voltageV > 0 ? battery.voltageV.toFixed(2) : '--'}
            <span className="hl-unit">V</span>
          </div>
        </div>
        <div className="w-[38%] min-w-[72px] pb-1.5 w-lt-260:w-full w-lt-260:pb-0 h-lt-90:!w-[40%] h-lt-90:!pb-1 h-lt-90:w-lt-200:hidden">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="hl-label">Charge</span>
            <span className="hl-value text-[12.5px]">{Math.round(soc * 100)}%</span>
          </div>
          <FillBar ratio={soc} color={toneColor(tone === 'neutral' ? 'good' : tone)} />
        </div>
      </div>

      <div className="hl-well min-h-[56px] flex-1 px-2 py-1.5 h-lt-220:hidden">
        <TimePlot
          values={voltages}
          color={toneColor(tone === 'neutral' ? 'info' : tone)}
          decimals={1}
          minSpan={0.6}
          thresholds={[
            { value: BATTERY_WARNING_V, tone: 'warning' },
            { value: BATTERY_CRITICAL_V, tone: 'critical' },
          ]}
          emptyLabel="Waiting for battery samples"
        />
      </div>

      <div className="grid grid-cols-2 gap-x-5 w-lt-260:gap-x-3 h-lt-120:hidden">
        <StatRow label="Current" value={battery.currentA > 0 ? formatCurrent(battery.currentA, 1) : '--'} />
        <StatRow label="Power" value={battery.powerW > 0 ? formatPower(battery.powerW, 0) : '--'} />
        <StatRow label="Runtime" value={formatDurationMinutes(battery.estimatedRuntimeMin)} />
        <StatRow label="Swing" value={swing === null ? '--' : `${swing.toFixed(2)} V`} tone={swingTone(swing)} />
      </div>
    </div>
  )
}
