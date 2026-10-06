/* eslint-disable react-refresh/only-export-components */

import { useMemo } from 'react'
import { formatCurrent, formatDurationMinutes, formatPower } from '../../lib/format'
import { BATTERY_CRITICAL_V, BATTERY_WARNING_V, toneColor, voltageTone } from '../../lib/robotThresholds'
import type { BatteryData, BatteryHistoryPoint, UiTone } from '../../types/telemetry'
import { FillBar, Readout, StatRow, TimePlot } from '../viz/viz'
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
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <Readout
          label="Pack voltage"
          value={battery.voltageV > 0 ? battery.voltageV.toFixed(2) : '--'}
          unit="V"
          tone={tone}
          size="lg"
        />
        <div className="w-[38%] min-w-[90px] pb-1.5">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="hl-label">Charge</span>
            <span className="hl-value text-[12.5px]">{Math.round(soc * 100)}%</span>
          </div>
          <FillBar ratio={soc} color={toneColor(tone === 'neutral' ? 'good' : tone)} />
        </div>
      </div>

      <div className="hl-well min-h-[64px] flex-1 px-2 py-1.5">
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

      <div className="grid grid-cols-2 gap-x-5">
        <StatRow label="Current" value={battery.currentA > 0 ? formatCurrent(battery.currentA, 1) : '--'} />
        <StatRow label="Power" value={battery.powerW > 0 ? formatPower(battery.powerW, 0) : '--'} />
        <StatRow label="Runtime" value={formatDurationMinutes(battery.estimatedRuntimeMin)} />
        <StatRow label="Swing" value={swing === null ? '--' : `${swing.toFixed(2)} V`} tone={swingTone(swing)} />
      </div>
    </div>
  )
}
