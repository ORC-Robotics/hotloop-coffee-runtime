import type { EncoderData } from '../../types/telemetry'
import { FillBar, Readout } from '../viz/viz'
import { DashboardCard } from './DashboardCard'

interface EncodersPanelProps {
  data: EncoderData
}

export function EncodersPanel({ data }: EncodersPanelProps) {
  const delta = data.leftMm - data.rightMm
  const scale = Math.max(Math.abs(data.leftMm), Math.abs(data.rightMm), 1)

  return (
    <DashboardCard title="Encoders" subtitle="wheel odometry">
      <div className="grid h-full content-start gap-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Readout label="Left" value={data.leftMm.toFixed(0)} unit="mm" size="sm" />
          <Readout label="Right" value={data.rightMm.toFixed(0)} unit="mm" size="sm" />
          <Readout label="Back" value={data.backMm.toFixed(0)} unit="mm" size="sm" />
          <Readout label="Forward" value={data.forwardDistanceCm.toFixed(1)} unit="cm" size="sm" />
        </div>
        <div className="grid gap-2">
          {[
            ['Left', data.leftMm, 'var(--series-1)'],
            ['Right', data.rightMm, 'var(--series-2)'],
          ].map(([label, value, color]) => (
            <div key={label as string} className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-2">
              <span className="hl-label">{label}</span>
              <FillBar ratio={Math.abs(Number(value)) / scale} color={String(color)} />
            </div>
          ))}
          <div className="flex items-baseline justify-between">
            <span className="hl-label">Left − right</span>
            <span className="hl-value text-[12.5px]">
              {delta >= 0 ? '+' : ''}
              {delta.toFixed(0)} mm
            </span>
          </div>
        </div>
      </div>
    </DashboardCard>
  )
}
