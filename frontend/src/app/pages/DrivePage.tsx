import { ControlDock } from '../../components/drive/ControlDock'
import { HomeWorkspaceShell } from '../../components/dashboard/HomeWorkspaceShell'
import type {
  AlertItem,
  BatteryHistoryPoint,
  ControlModeState,
  TelemetryDerivedState,
  TelemetrySnapshot,
} from '../../types/telemetry'

interface DrivePageProps {
  snapshot: TelemetrySnapshot
  alerts: AlertItem[]
  derived: TelemetryDerivedState
  batteryHistory: BatteryHistoryPoint[]
  controlMode: ControlModeState
  selectedModeId: string | null
  onSelectMode: (modeId: string | null) => void
  onApplyMode: (modeId?: string | null) => Promise<void> | void
}

/** Control on the left, the operator's own panel layout on the right. */
export function DrivePage({
  snapshot,
  alerts,
  derived,
  batteryHistory,
  controlMode,
  selectedModeId,
  onSelectMode,
  onApplyMode,
}: DrivePageProps) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[288px_minmax(0,1fr)] gap-2.5 2xl:grid-cols-[312px_minmax(0,1fr)]">
      <ControlDock
        controlMode={controlMode}
        selectedModeId={selectedModeId}
        onSelectMode={onSelectMode}
        onApplyMode={onApplyMode}
      />
      <HomeWorkspaceShell snapshot={snapshot} derived={derived} alerts={alerts} batteryHistory={batteryHistory} />
    </div>
  )
}
