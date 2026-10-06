import { useSpatialTelemetry } from '../../../hooks/useSpatialTelemetry'
import { useSpatialViewModel } from '../../../hooks/useSpatialViewModel'
import { useGuidedNavigation } from '../../../hooks/useGuidedNavigation'
import type { HomeWorkspacePresetWidget } from '../../../home-workspace/homeWorkspaceStore'
import { PlanarViewerCanvas } from '../../spatial/PlanarViewerCanvas'

export function HomeWorkspaceSpatialViewWidget({
  widget,
}: {
  widget: HomeWorkspacePresetWidget
  onUpdateWidget: (widgetId: string, patch: { presetConfig?: { spatialTargetYawDeg?: number | null } }) => void
}) {
  const snapshot = useSpatialTelemetry()
  const viewModel = useSpatialViewModel(snapshot, {
    goalTargetYawDeg: widget.config.spatialTargetYawDeg,
    followRobotByDefault: true,
  })
  const guidedNavigation = useGuidedNavigation({
    goalPreview: viewModel.goalPreview,
    selectedPose: viewModel.selectedPose,
    lidarDiagnostics: viewModel.lidarDiagnostics,
  })

  return (
    <PlanarViewerCanvas
      poseSelection={viewModel.selectedPose}
      lidarSelection={viewModel.selectedLidar}
      scanRegistration={viewModel.scanRegistration}
      poseTransition={viewModel.poseTransition}
      trail={viewModel.displayTrail}
      lidarHistory={viewModel.displayLidarHistory}
      observedMapScans={viewModel.displayObservedMapScans}
      observedMapFadeOlderScans={viewModel.observedMapFadeOlderScans}
      observedMapFrozen={viewModel.observedMapFrozen}
      occupancyLayer={viewModel.occupancyLayer}
      showOccupancyLayer={viewModel.showOccupancyLayer}
      occupancyDisplayMode={viewModel.occupancyDisplayMode}
      mazeOverlay={viewModel.mazeOverlay}
      goalPreview={viewModel.goalPreview}
      guidedNavigation={guidedNavigation}
      replaySelection={viewModel.replaySelection}
      viewport={viewModel.viewport}
      followRobot={viewModel.followRobot}
      onPanViewport={viewModel.panViewport}
      onZoomViewport={viewModel.zoomViewport}
      onRotateViewport={viewModel.rotateViewport}
      onToggleFollowRobot={viewModel.toggleFollowRobot}
      onCenterRobot={viewModel.centerOnRobot}
      onResetView={viewModel.resetView}
      onClearTrail={viewModel.clearTrail}
      onClearLidarHistory={viewModel.clearLidarHistory}
      onClearObservedMap={viewModel.clearObservedMap}
      onToggleObservedMapFrozen={viewModel.toggleObservedMapFrozen}
      onToggleOccupancyLayer={viewModel.toggleOccupancyLayer}
      onSelectGoalAtWorldPoint={viewModel.selectGoalAtWorldPoint}
      onArmGoalPreview={viewModel.armGoalPreview}
      onDisarmGoalPreview={viewModel.disarmGoalPreview}
      onClearGoalPreview={viewModel.clearGoalPreview}
      variant="widget"
      requireCtrlForInteraction
    />
  )
}
