import type { SystemHealthData, UiTone } from '../../types/telemetry'
import { BoolIndicator } from '../viz/viz'
import { DashboardCard } from './DashboardCard'
import { StatusBadge } from './StatusBadge'

interface SystemsHealthPanelProps {
  data: SystemHealthData
  overallTone: UiTone
}

const healthItems = [
  { label: 'LiDAR', key: 'lidarHealthy', on: 'ok', off: 'offline' },
  { label: 'NavX', key: 'navxConnected', on: 'ok', off: 'offline' },
  { label: 'Valid scan', key: 'validScan', on: 'ok', off: 'none' },
  { label: 'Gyro hold', key: 'gyroHold', on: 'holding', off: 'idle' },
] as const

export function SystemsHealthPanel({ data, overallTone }: SystemsHealthPanelProps) {
  return (
    <DashboardCard
      title="Sensors"
      headerSlot={<StatusBadge tone={overallTone} label={overallTone === 'good' ? 'healthy' : 'degraded'} />}
    >
      <SystemsHealthPanelBody data={data} />
    </DashboardCard>
  )
}

export function SystemsHealthPanelBody({ data }: Pick<SystemsHealthPanelProps, 'data'>) {
  return (
    <div className="grid content-start gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(min(120px,100%),1fr))] h-lt-120:gap-1">
      {healthItems.map((item) => (
        <BoolIndicator
          key={item.key}
          label={item.label}
          value={data[item.key]}
          onLabel={item.on}
          offLabel={item.off}
          offTone={item.key === 'gyroHold' ? 'neutral' : 'critical'}
        />
      ))}
    </div>
  )
}
