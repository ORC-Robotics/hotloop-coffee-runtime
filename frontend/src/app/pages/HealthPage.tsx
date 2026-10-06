import { AlertsPanel } from '../../components/dashboard/AlertsPanel'
import { BatteryPanel } from '../../components/dashboard/BatteryPanel'
import { CommandsPanel } from '../../components/dashboard/CommandsPanel'
import { DashboardCard } from '../../components/dashboard/DashboardCard'
import { EncodersPanel } from '../../components/dashboard/EncodersPanel'
import { HeadingPanel } from '../../components/dashboard/HeadingPanel'
import { NetworkPanel } from '../../components/dashboard/NetworkPanel'
import { SystemsHealthPanel } from '../../components/dashboard/SystemsHealthPanel'
import { StatRow } from '../../components/viz/viz'
import type {
  AlertItem,
  BatteryHistoryPoint,
  BridgeStatus,
  ControlModeState,
  TelemetryDerivedState,
  TelemetrySnapshot,
} from '../../types/telemetry'

interface HealthPageProps {
  snapshot: TelemetrySnapshot
  alerts: AlertItem[]
  derived: TelemetryDerivedState
  batteryHistory: BatteryHistoryPoint[]
  controlMode: ControlModeState
  bridgeStatus: BridgeStatus
}

function modeLabel(controlMode: ControlModeState, modeId: string | null) {
  if (!modeId) return '—'
  return controlMode.availableModes.find((mode) => mode.id === modeId)?.label ?? modeId
}

/** Everything about the robot's condition on one scrollable page. */
export function HealthPage({ snapshot, alerts, derived, batteryHistory, controlMode, bridgeStatus }: HealthPageProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="grid auto-rows-min gap-2.5 lg:grid-cols-2 2xl:grid-cols-3">
        <AlertsPanel alerts={alerts} />
        <SystemsHealthPanel data={snapshot.systems} overallTone={derived.robotHealthTone} />
        <DashboardCard title="Session">
          <div className="grid gap-x-5 sm:grid-cols-2">
            <StatRow label="Auto on robot" value={modeLabel(controlMode, controlMode.currentModeId)} />
            <StatRow label="Requested" value={modeLabel(controlMode, controlMode.requestedModeId)} />
            <StatRow label="Auto sync" value={controlMode.syncStatus} />
            <StatRow label="Scenario" value={snapshot.scenarioLabel} />
            <StatRow label="Lateral error" value={`${snapshot.heading.lateralErrorM.toFixed(2)} m`} />
            <StatRow label="Updated" value={derived.lastUpdatedLabel} />
          </div>
        </DashboardCard>
        <div className="min-h-[300px]">
          <BatteryPanel battery={snapshot.battery} history={batteryHistory} />
        </div>
        <div className="min-h-[200px]">
          <HeadingPanel data={snapshot.heading} tone={derived.alignmentTone} />
        </div>
        <CommandsPanel data={snapshot.commands} derived={derived} />
        <EncodersPanel data={snapshot.encoders} />
        <NetworkPanel
          data={snapshot.connection}
          tone={derived.connectionTone}
          bridgeStatus={bridgeStatus}
          controlMode={controlMode}
        />
      </div>
    </div>
  )
}
