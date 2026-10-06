import { clamp } from '../../lib/format'
import { toneColor } from '../../lib/robotThresholds'
import type { HeadingData, UiTone } from '../../types/telemetry'
import { Compass, FillBar, Readout, StatRow } from '../viz/viz'
import { DashboardCard } from './DashboardCard'
import { StatusBadge } from './StatusBadge'

interface HeadingPanelProps {
  data: HeadingData
  tone: UiTone
}

function angularTone(error: number): UiTone {
  const magnitude = Math.abs(error)
  if (magnitude > 18) return 'critical'
  if (magnitude > 6) return 'warning'
  return 'good'
}

export function HeadingPanel({ data, tone }: HeadingPanelProps) {
  return (
    <DashboardCard
      title="Heading"
      subtitle="gyro / navX"
      headerSlot={<StatusBadge tone={tone} label={tone === 'good' ? 'aligned' : tone === 'warning' ? 'correcting' : 'off target'} />}
    >
      <HeadingPanelBody data={data} />
    </DashboardCard>
  )
}

export function HeadingPanelBody({
  data,
}: Pick<HeadingPanelProps, 'data'> & { variant?: 'panel' | 'widget' }) {
  const errorTone = angularTone(data.angularErrorDeg)

  return (
    <div className="flex h-full min-h-0 items-center gap-4 [container-type:inline-size]">
      <Compass
        yawDeg={data.yawDeg}
        targetDeg={data.targetYawDeg}
        className="h-full max-h-[150px] min-h-[72px] w-auto shrink-0"
      />
      <div className="grid min-w-0 flex-1 gap-2.5">
        <Readout label="Yaw" value={data.yawDeg.toFixed(1)} unit="°" size="lg" />
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="hl-label">Error</span>
            <span className="hl-value text-[12.5px]" style={{ color: errorTone === 'good' ? undefined : toneColor(errorTone) }}>
              {data.angularErrorDeg >= 0 ? '+' : ''}
              {data.angularErrorDeg.toFixed(1)}°
            </span>
          </div>
          <FillBar ratio={clamp(Math.abs(data.angularErrorDeg) / 30, 0.02, 1)} color={toneColor(errorTone)} />
        </div>
        <div>
          <StatRow
            label={
              <span className="inline-flex items-center gap-1.5">
                <span className="hl-dot !h-1.5 !w-1.5" style={{ background: 'var(--primary)' }} />
                Target
              </span>
            }
            value={`${data.targetYawDeg.toFixed(1)}°`}
          />
          <StatRow label="Lateral" value={`${data.lateralErrorM.toFixed(2)} m`} />
        </div>
      </div>
    </div>
  )
}
