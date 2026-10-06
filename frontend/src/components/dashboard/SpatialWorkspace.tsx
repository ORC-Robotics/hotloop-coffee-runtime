import { cn } from '../../lib/cn'
import { formatDegrees, formatMeters } from '../../lib/format'
import {
  formatPoseAgeLabel,
  poseSourceLabel,
  SPATIAL_POSE_OVERRIDE_OPTIONS,
} from '../../lib/spatialTelemetry'
import { useGuidedNavigation, type GuidedNavigationStatus } from '../../hooks/useGuidedNavigation'
import { useSpatialTelemetry } from '../../hooks/useSpatialTelemetry'
import { useSpatialViewModel } from '../../hooks/useSpatialViewModel'
import type {
  PlanarPoseData,
  PlanarPoseFreshness,
  PoseSourceOverride,
} from '../../types/telemetry'
import { StatRow, StatusDot } from '../viz/viz'
import { DashboardCard } from './DashboardCard'
import { StatusBadge } from './StatusBadge'
import { PlanarViewerCanvas } from '../spatial/PlanarViewerCanvas'

function freshnessTone(freshness: PlanarPoseFreshness) {
  if (freshness === 'live') return 'good'
  if (freshness === 'stale') return 'warning'
  return 'critical'
}

function availabilityTone(pose: PlanarPoseData) {
  if (pose.available && pose.freshness === 'live') return 'good'
  if (pose.available && pose.freshness === 'stale') return 'warning'
  return 'critical'
}

function registrationTone(quality: 'good' | 'fair' | 'poor' | 'insufficient') {
  if (quality === 'good') return 'good'
  if (quality === 'fair') return 'info'
  if (quality === 'poor') return 'warning'
  return 'critical'
}

function goalPreviewTone(status: ReturnType<typeof useSpatialViewModel>['goalPreview']['status']) {
  if (status === 'armed') return 'good'
  if (status === 'ready') return 'info'
  if (status === 'blocked' || status === 'unreachable') return 'warning'
  if (status === 'unavailable') return 'critical'
  return 'neutral'
}

function guidedNavigationTone(status: GuidedNavigationStatus) {
  if (status === 'running' || status === 'completed') return 'good'
  if (status === 'ready') return 'info'
  if (status === 'aborted') return 'warning'
  if (status === 'unavailable') return 'critical'
  return 'neutral'
}

function formatPoseTimestamp(timestampMs: number) {
  if (timestampMs <= 0) {
    return '--'
  }

  return new Date(timestampMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function MetricTile({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="hl-well min-w-0 px-2.5 py-2">
      <div className="hl-label truncate">{label}</div>
      <div className="hl-value mt-0.5 truncate text-[14px]">{value}</div>
    </div>
  )
}

function MetadataRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return <StatRow label={label} value={value} />
}

function ReplayControlButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="hl-btn h-7 px-2.5 text-[12px]">
      {label}
    </button>
  )
}

function ControlChipButton({
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} className="hl-btn h-7 px-2.5 text-[12px]">
      {label}
    </button>
  )
}

function SourceInventoryRow({
  sourceId,
  pose,
  activeOverride,
}: {
  sourceId: Exclude<PoseSourceOverride, 'auto'>
  pose: PlanarPoseData
  activeOverride: PoseSourceOverride
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-[var(--border)] py-1.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot tone={availabilityTone(pose)} />
        <span className={cn('truncate text-[12.5px]', activeOverride === sourceId ? 'text-[var(--primary)]' : 'text-[var(--text-secondary)]')}>
          {poseSourceLabel(sourceId)}
        </span>
        <span className="truncate font-mono text-[10.5px] text-[var(--text-faint)]">{pose.frame}</span>
      </div>
      <span className="hl-value text-[11.5px] text-[var(--text-muted)]">
        {pose.available
          ? `${(pose.xMm / 1000).toFixed(2)}, ${(pose.yMm / 1000).toFixed(2)}, ${pose.yawDeg.toFixed(0)}°`
          : pose.freshness}
      </span>
    </div>
  )
}

const POSE_SOURCE_SHORT_LABELS: Partial<Record<PoseSourceOverride, string>> = {
  auto: 'Auto',
  odometry: 'Odom',
  reactive: 'Reactive',
  mapeamento: 'Mapping',
  simulation: 'Sim',
}

export function SpatialWorkspace() {
  const snapshot = useSpatialTelemetry()
  const viewModel = useSpatialViewModel(snapshot, { followRobotByDefault: true })
  const pose = viewModel.selectedPose.pose
  const poseUnavailable = !viewModel.selectedPose.isRenderable
  const lidarSelection = viewModel.selectedLidar
  const lidarDiagnostics = viewModel.lidarDiagnostics
  const lidarUnavailable = !snapshot.lidar.available
  const streamEndpoint = snapshot.bridgeStatus?.spatialEndpoint ?? snapshot.stream.endpoint
  const replayBufferCount = viewModel.lidarHistory.length
  const replaySelection = viewModel.replaySelection
  const replaySliderMax = Math.max(0, replayBufferCount - 1)
  const replaySliderValue = replaySelection?.index ?? replaySliderMax
  const replayControlsDisabled = replayBufferCount === 0
  const scanRegistration = viewModel.scanRegistration
  const goalPreview = viewModel.goalPreview
  const guidedNavigation = useGuidedNavigation({
    goalPreview,
    selectedPose: viewModel.selectedPose,
    lidarDiagnostics: viewModel.lidarDiagnostics,
  })
  const observedMapPointCount = viewModel.observedMapScans.reduce(
    (total, scan) => total + scan.pointCount,
    0,
  )
  const displayedObservedMapPointCount = viewModel.displayObservedMapScans.reduce(
    (total, scan) => total + scan.pointCount,
    0,
  )
  const occupancyLayer = viewModel.occupancyLayer

  const formatDistanceMm = (distanceMm: number | null) =>
    distanceMm === null ? '--' : formatMeters(distanceMm / 1000, 3)
  const formatMillimeters = (valueMm: number | null) =>
    valueMm === null ? '--' : `${Math.round(valueMm)} mm`

  return (
    <div className="grid h-full min-h-0 gap-2.5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-h-[420px]">
        <PlanarViewerCanvas
          poseSelection={viewModel.selectedPose}
          lidarSelection={lidarSelection}
          scanRegistration={scanRegistration}
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
        />
      </div>

      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-0.5 [&>section]:!h-auto [&>section]:shrink-0">
        <DashboardCard
          title="Pose source"
          headerSlot={<StatusBadge tone={freshnessTone(pose.freshness)} label={pose.freshness} />}
        >
          <div className="hl-seg grid w-full grid-cols-5" role="group" aria-label="Pose source">
            {SPATIAL_POSE_OVERRIDE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className="hl-seg-item px-1 text-[11.5px]"
                aria-pressed={viewModel.sourceOverride === option.id}
                onClick={() => viewModel.setSourceOverride(option.id)}
                title={option.description}
              >
                {POSE_SOURCE_SHORT_LABELS[option.id] ?? option.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] leading-[1.45] text-[var(--text-faint)]">
            {SPATIAL_POSE_OVERRIDE_OPTIONS.find((option) => option.id === viewModel.sourceOverride)?.description}
          </p>
          <div className="mt-2 text-[12px] text-[var(--text-secondary)]">Using {viewModel.selectedPose.selectedSourceLabel}</div>
        </DashboardCard>

        <DashboardCard collapsible defaultOpen={false} title="Spatial Stream" subtitle="dedicated pose and lidar path" accent="accent">
          <div className="grid gap-2">
            <MetadataRow label="Transport" value={snapshot.stream.transport} />
            <MetadataRow label="Endpoint" value={streamEndpoint} />
            <MetadataRow label="Message" value={snapshot.stream.message} />
            <MetadataRow
              label="LiDAR Packet"
              value={
                lidarUnavailable
                  ? 'unavailable'
                  : `${snapshot.lidar.format} | ${snapshot.lidar.validPointCount}/${snapshot.lidar.pointCount} points`
              }
            />
            <MetadataRow
              label="LiDAR Freshness"
              value={snapshot.lidar.available ? snapshot.lidar.freshness : '--'}
            />
            <MetadataRow
              label="LiDAR Sequence"
              value={snapshot.lidar.available ? String(snapshot.lidar.sequence) : '--'}
            />
            <MetadataRow
              label="LiDAR Pose Frame"
              value={snapshot.lidar.available ? snapshot.lidar.poseFrame : '--'}
            />
            <MetadataRow label="LiDAR Render" value={lidarSelection.renderState} />
            <MetadataRow label="LiDAR Age" value={formatPoseAgeLabel(lidarSelection.ageMs)} />
          </div>

          <div className="mt-2.5 text-[11.5px] leading-[1.5] text-[var(--text-faint)]">
            {lidarUnavailable
              ? 'Pose validation keeps working even when the compact lidar packet is not published yet. The dedicated stream is already isolated so we can add desktop-side SLAM inputs without touching the viewer contract again.'
              : lidarSelection.message}
          </div>
        </DashboardCard>

        <DashboardCard collapsible title="LiDAR Diagnostics" subtitle="desktop-side scan validation" accent="info">
          <div className="grid gap-2">
            <MetadataRow label="Render State" value={lidarDiagnostics.renderState} />
            <MetadataRow
              label="Frame Match"
              value={lidarDiagnostics.frameAligned ? 'aligned' : 'not aligned'}
            />
            <MetadataRow label="Selected Pose Frame" value={lidarDiagnostics.selectedPoseFrame} />
            <MetadataRow label="LiDAR Pose Frame" value={lidarDiagnostics.poseFrame} />
            <MetadataRow label="Sensor Frame" value={lidarDiagnostics.sensorFrame} />
            <MetadataRow
              label="Sensor Offset"
              value={`${formatMeters(lidarDiagnostics.sensorOffsetXMm / 1000, 3)} x | ${formatMeters(lidarDiagnostics.sensorOffsetYMm / 1000, 3)} y | ${formatDegrees(lidarDiagnostics.sensorYawDeg, 1)}`}
            />
            <MetadataRow
              label="Coverage"
              value={
                lidarDiagnostics.coverageStartDeg === null || lidarDiagnostics.coverageEndDeg === null
                  ? '--'
                  : `${Math.round(lidarDiagnostics.coverageStartDeg)} deg to ${Math.round(lidarDiagnostics.coverageEndDeg)} deg`
              }
            />
            <MetadataRow
              label="Forward Angle"
              value={
                lidarDiagnostics.assumedForwardAngleDeg === null
                  ? '--'
                  : `${Math.round(lidarDiagnostics.assumedForwardAngleDeg)} deg`
              }
            />
            <MetadataRow
              label="Valid Points"
              value={`${lidarDiagnostics.validPointCount}/${lidarDiagnostics.pointCount}`}
            />
            <MetadataRow
              label="Packet Fill"
              value={`${Math.round(lidarDiagnostics.validRatio * 100)}%`}
            />
            <MetadataRow label="Front Distance" value={formatDistanceMm(lidarDiagnostics.frontDistanceMm)} />
            <MetadataRow label="Left Nearest" value={formatDistanceMm(lidarDiagnostics.leftNearestMm)} />
            <MetadataRow label="Right Nearest" value={formatDistanceMm(lidarDiagnostics.rightNearestMm)} />
            <MetadataRow label="Nearest Point" value={formatDistanceMm(lidarDiagnostics.nearestDistanceMm)} />
            <MetadataRow label="Buffered Scans" value={String(viewModel.lidarHistory.length)} />
          </div>

          <div className="mt-2.5 text-[11.5px] leading-[1.5] text-[var(--text-faint)]">
            The desktop renderer keeps <span className="font-medium text-[var(--text-secondary)]">180 deg as forward</span> in <span className="font-medium text-[var(--text-secondary)]">{lidarDiagnostics.sensorFrame}</span>, remaps Atlas lateral handedness, and now places the sensor <span className="font-medium text-[var(--text-secondary)]">91.84 mm forward</span> of the robot center. This keeps V1 scan-to-pose validation coherent and prepares the next desktop-side observed map layer.
          </div>
        </DashboardCard>

        <DashboardCard collapsible defaultOpen={false} title="Observed Map" subtitle="desktop-side local scan accumulation" accent="accent">
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge tone={viewModel.observedMapFrozen ? 'warning' : 'good'} label={viewModel.observedMapFrozen ? 'frozen' : 'live'} />
            <StatusBadge tone={viewModel.observedMapFadeOlderScans ? 'info' : 'warning'} label={viewModel.observedMapFadeOlderScans ? 'fade old scans' : 'uniform intensity'} />
          </div>

          <div className="mt-3 grid">
            <MetadataRow label="Frame" value={pose.available ? pose.frame : '--'} />
            <MetadataRow label="Stored Scans" value={String(viewModel.observedMapScans.length)} />
            <MetadataRow label="Displayed Scans" value={String(viewModel.displayObservedMapScans.length)} />
            <MetadataRow label="Stored Points" value={String(observedMapPointCount)} />
            <MetadataRow label="Displayed Points" value={String(displayedObservedMapPointCount)} />
            <MetadataRow label="History Limit" value={`${viewModel.observedMapHistoryLimit} scans`} />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <ControlChipButton
              label={viewModel.observedMapFrozen ? 'Resume Map' : 'Freeze Map'}
              active={viewModel.observedMapFrozen}
              onClick={viewModel.toggleObservedMapFrozen}
            />
            <ControlChipButton
              label={viewModel.observedMapFadeOlderScans ? 'Fade Enabled' : 'Fade Disabled'}
              active={viewModel.observedMapFadeOlderScans}
              onClick={viewModel.toggleObservedMapFadeOlderScans}
            />
            <ControlChipButton label="Clear Map" onClick={viewModel.clearObservedMap} />
          </div>

          <div className="mt-4">
            <div className="hl-label mb-1.5">
              Max History
            </div>
            <div className="flex flex-wrap gap-1.5">
              {viewModel.observedMapHistoryLimitOptions.map((limit) => (
                <ControlChipButton
                  key={limit}
                  label={String(limit)}
                  active={viewModel.observedMapHistoryLimit === limit}
                  onClick={() => viewModel.setObservedMapHistoryLimit(limit)}
                />
              ))}
            </div>
          </div>

          <div className="mt-2.5 text-[11.5px] leading-[1.5] text-[var(--text-faint)]">
            This layer accumulates recent compact LiDAR scans directly on the desktop in <span className="font-medium text-[var(--text-secondary)]">odometry_local</span>. It stays intentionally short-horizon as the raw spatial evidence layer, while the occupancy layer now carries the longer-lived session map.
          </div>
        </DashboardCard>

        <DashboardCard collapsible defaultOpen={false} title="Occupancy Layer" subtitle="desktop-side free and occupied cells" accent="warning">
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge
              tone={viewModel.showOccupancyLayer ? 'good' : 'warning'}
              label={viewModel.showOccupancyLayer ? 'visible' : 'hidden'}
            />
            <StatusBadge
              tone={viewModel.occupancyDisplayMode === 'free-and-occupied' ? 'info' : 'warning'}
              label={viewModel.occupancyDisplayMode === 'free-and-occupied' ? 'free + occupied' : 'occupied only'}
            />
          </div>

          <div className="mt-3 grid">
            <MetadataRow label="Cell Size" value={`${viewModel.occupancyCellSizeMm} mm`} />
            <MetadataRow label="Session Scans" value={String(viewModel.occupancySessionScanCount)} />
            <MetadataRow label="Rendered Cells" value={occupancyLayer ? String(occupancyLayer.cells.length) : '--'} />
            <MetadataRow label="Occupied Cells" value={occupancyLayer ? String(occupancyLayer.occupiedCellCount) : '--'} />
            <MetadataRow label="Free Cells" value={occupancyLayer ? String(occupancyLayer.freeCellCount) : '--'} />
            <MetadataRow label="Mixed Cells" value={occupancyLayer ? String(occupancyLayer.mixedCellCount) : '--'} />
            <MetadataRow label="Frame" value={occupancyLayer?.frame ?? '--'} />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <ControlChipButton
              label={viewModel.showOccupancyLayer ? 'Hide Occupancy' : 'Show Occupancy'}
              active={viewModel.showOccupancyLayer}
              onClick={viewModel.toggleOccupancyLayer}
            />
            <ControlChipButton
              label={viewModel.occupancyDisplayMode === 'free-and-occupied' ? 'Free + Occupied' : 'Occupied Only'}
              active={viewModel.occupancyDisplayMode === 'free-and-occupied'}
              onClick={viewModel.toggleOccupancyDisplayMode}
            />
          </div>

          <div className="mt-4">
            <div className="hl-label mb-1.5">
              Cell Resolution
            </div>
            <div className="flex flex-wrap gap-1.5">
              {viewModel.occupancyCellSizeOptionsMm.map((cellSizeMm) => (
                <ControlChipButton
                  key={cellSizeMm}
                  label={String(cellSizeMm)}
                  active={viewModel.occupancyCellSizeMm === cellSizeMm}
                  onClick={() => viewModel.setOccupancyCellSizeMm(cellSizeMm)}
                />
              ))}
            </div>
          </div>

          <div className="mt-2.5 text-[11.5px] leading-[1.5] text-[var(--text-faint)]">
            The occupancy layer rasterizes each compact LiDAR ray on the desktop, marking traversed cells as free and impact cells as occupied. It now persists across the whole live session instead of depending on the short recent-scan window used by the raw observed map, so large-arena coverage does not fade out while you keep exploring.
          </div>
        </DashboardCard>

        <DashboardCard collapsible title="Goal Preview" subtitle="desktop-side target selection and route preview" accent="accent">
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge tone={goalPreviewTone(goalPreview.status)} label={goalPreview.status} />
            <StatusBadge
              tone={goalPreview.target?.cellState === 'mixed' ? 'warning' : 'info'}
              label={goalPreview.target?.cellState ?? 'no target'}
            />
          </div>

          <div className="mt-3 grid">
            <MetadataRow
              label="Requested X"
              value={
                goalPreview.requestedXMm === null
                  ? '--'
                  : formatMeters(goalPreview.requestedXMm / 1000, 3)
              }
            />
            <MetadataRow
              label="Requested Y"
              value={
                goalPreview.requestedYMm === null
                  ? '--'
                  : formatMeters(goalPreview.requestedYMm / 1000, 3)
              }
            />
            <MetadataRow
              label="Target X"
              value={
                goalPreview.target
                  ? formatMeters(goalPreview.target.snappedXMm / 1000, 3)
                  : '--'
              }
            />
            <MetadataRow
              label="Target Y"
              value={
                goalPreview.target
                  ? formatMeters(goalPreview.target.snappedYMm / 1000, 3)
                  : '--'
              }
            />
            <MetadataRow label="Frame" value={goalPreview.frame || '--'} />
            <MetadataRow
              label="Snap Distance"
              value={
                goalPreview.target
                  ? `${Math.round(goalPreview.target.snapDistanceMm)} mm`
                  : '--'
              }
            />
            <MetadataRow
              label="Waypoints"
              value={goalPreview.target ? String(goalPreview.waypointCount) : '--'}
            />
            <MetadataRow
              label="Path Length"
              value={
                goalPreview.pathLengthMm === null
                  ? '--'
                  : formatMeters(goalPreview.pathLengthMm / 1000, 3)
              }
            />
            <MetadataRow
              label="Direct Distance"
              value={
                goalPreview.directDistanceMm === null
                  ? '--'
                  : formatMeters(goalPreview.directDistanceMm / 1000, 3)
              }
            />
            <MetadataRow label="Safety Buffer" value={`${goalPreview.safetyBufferMm} mm`} />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <ControlChipButton
              label={goalPreview.status === 'armed' ? 'Disarm Goal' : 'Arm Goal (N)'}
              active={goalPreview.status === 'armed'}
              disabled={goalPreview.status !== 'ready' && goalPreview.status !== 'armed'}
              onClick={
                goalPreview.status === 'armed'
                  ? viewModel.disarmGoalPreview
                  : viewModel.armGoalPreview
              }
            />
            <ControlChipButton
              label="Clear Goal"
              disabled={goalPreview.status === 'idle'}
              onClick={viewModel.clearGoalPreview}
            />
          </div>

          <div className="mt-2.5 text-[11.5px] leading-[1.5] text-[var(--text-faint)]">
            {goalPreview.message}{' '}
            <span className="font-medium text-[var(--text-secondary)]">
              Arming is still local:
            </span>{' '}
            this card selects and validates the route; execution is handled only by the supervised Guided Navigation V0 controls below.
          </div>
        </DashboardCard>

        <DashboardCard collapsible defaultOpen={false} title="Maze Planner" subtitle="robot-side onboard exploration intent" accent="primary">
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge
              tone={viewModel.mazeOverlay?.available ? 'good' : 'warning'}
              label={viewModel.mazeOverlay?.available ? viewModel.mazeOverlay.state : 'unavailable'}
            />
            <StatusBadge
              tone={viewModel.mazeOverlay?.routeActive ? 'info' : 'neutral'}
              label={viewModel.mazeOverlay?.subphase ?? 'IDLE'}
            />
          </div>

          <div className="mt-3 grid">
            <MetadataRow label="Status" value={viewModel.mazeOverlay?.status ?? '--'} />
            <MetadataRow
              label="Coverage"
              value={
                viewModel.mazeOverlay
                  ? `${(viewModel.mazeOverlay.coverageRatio * 100).toFixed(1)}%`
                  : '--'
              }
            />
            <MetadataRow
              label="Integrated Scans"
              value={viewModel.mazeOverlay ? String(viewModel.mazeOverlay.integratedScanCount) : '--'}
            />
            <MetadataRow
              label="Route Length"
              value={
                viewModel.mazeOverlay
                  ? formatMeters(viewModel.mazeOverlay.routeLengthMm / 1000, 3)
                  : '--'
              }
            />
            <MetadataRow
              label="Route Points"
              value={viewModel.mazeOverlay ? String(viewModel.mazeOverlay.route.length) : '--'}
            />
            <MetadataRow
              label="Candidates"
              value={viewModel.mazeOverlay ? String(viewModel.mazeOverlay.candidates.length) : '--'}
            />
            <MetadataRow
              label="Replans"
              value={viewModel.mazeOverlay ? String(viewModel.mazeOverlay.replans) : '--'}
            />
            <MetadataRow
              label="Recoveries"
              value={viewModel.mazeOverlay ? String(viewModel.mazeOverlay.recoveryCount) : '--'}
            />
            <MetadataRow
              label="Stalls"
              value={viewModel.mazeOverlay ? String(viewModel.mazeOverlay.stallCount) : '--'}
            />
            <MetadataRow
              label="Target"
              value={
                viewModel.mazeOverlay?.target
                  ? `${formatMeters(viewModel.mazeOverlay.target.xMm / 1000, 3)} x | ${formatMeters(viewModel.mazeOverlay.target.yMm / 1000, 3)} y`
                  : '--'
              }
            />
          </div>

          <div className="mt-2.5 text-[11.5px] leading-[1.5] text-[var(--text-faint)]">
            This overlay is the robot’s own onboard maze planner, not a desktop guess. The walls still come from the desktop occupancy layer, while the route, active frontier target, and top candidate frontiers come from the Atlas autonomous runtime over a compact overlay packet.
          </div>
        </DashboardCard>

        <DashboardCard collapsible defaultOpen={false} title="Guided navigation" subtitle="supervised desktop-side waypoint follower" accent="warning">
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge
              tone={guidedNavigationTone(guidedNavigation.status)}
              label={guidedNavigation.status}
            />
            <StatusBadge
              tone={guidedNavigation.remoteMode === 'teleop' ? 'good' : 'warning'}
              label={guidedNavigation.remoteMode}
            />
          </div>

          <div className="mt-3 grid">
            <MetadataRow
              label="Lookahead"
              value={
                guidedNavigation.totalWaypoints > 0
                  ? `${guidedNavigation.currentWaypointIndex}/${guidedNavigation.totalWaypoints}`
                  : '--'
              }
            />
            <MetadataRow
              label="Waypoint Dist"
              value={
                guidedNavigation.distanceToWaypointMm === null
                  ? '--'
                  : formatMeters(guidedNavigation.distanceToWaypointMm / 1000, 3)
              }
            />
            <MetadataRow
              label="Goal Dist"
              value={
                guidedNavigation.distanceToGoalMm === null
                  ? '--'
                  : formatMeters(guidedNavigation.distanceToGoalMm / 1000, 3)
              }
            />
            <MetadataRow
              label="Path Progress"
              value={`${(guidedNavigation.pathProgressRatio * 100).toFixed(1)}%`}
            />
            <MetadataRow
              label="Progress Dist"
              value={formatMeters(guidedNavigation.pathProgressMm / 1000, 3)}
            />
            <MetadataRow
              label="Cross Track"
              value={
                guidedNavigation.crossTrackErrorMm === null
                  ? '--'
                  : formatMeters(guidedNavigation.crossTrackErrorMm / 1000, 3)
              }
            />
            <MetadataRow
              label="Target Yaw"
              value={
                guidedNavigation.targetYawDeg === null
                  ? '--'
                  : formatDegrees(guidedNavigation.targetYawDeg, 1)
              }
            />
            <MetadataRow
              label="Yaw Error"
              value={
                guidedNavigation.yawErrorDeg === null
                  ? '--'
                  : formatDegrees(guidedNavigation.yawErrorDeg, 1)
              }
            />
            <MetadataRow label="Command X" value={guidedNavigation.commandX.toFixed(2)} />
            <MetadataRow label="Command Y" value={guidedNavigation.commandY.toFixed(2)} />
            <MetadataRow label="Command Z" value={guidedNavigation.commandZ.toFixed(2)} />
            <MetadataRow label="LiDAR Gate" value={guidedNavigation.lidarSafetyState} />
            <MetadataRow
              label="LiDAR Dist"
              value={formatDistanceMm(guidedNavigation.lidarSafetyDistanceMm)}
            />
            <MetadataRow
              label="Speed Scale"
              value={`${Math.round(guidedNavigation.lidarSafetyScale * 100)}%`}
            />
            <MetadataRow label="Goal Gate" value={guidedNavigation.goalStatus} />
            <MetadataRow label="Path Points" value={String(guidedNavigation.goalPathPoints)} />
            <MetadataRow label="Pose Gate" value={guidedNavigation.poseFreshness} />
            <MetadataRow label="Input Gate" value={guidedNavigation.remoteInputSource} />
            <MetadataRow
              label="Start Gate"
              value={
                guidedNavigation.canStart
                  ? 'ready'
                  : guidedNavigation.startBlockedReasons.join(', ') || 'blocked'
              }
            />
            <MetadataRow
              label="Last Stop"
              value={guidedNavigation.lastStopMessage ?? '--'}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <ControlChipButton
              label={guidedNavigation.canStart ? 'Start Guided V0' : 'Check Start Gate'}
              active={guidedNavigation.active}
              disabled={guidedNavigation.active}
              onClick={guidedNavigation.startGuidedNavigation}
            />
            <ControlChipButton
              label="Stop Guided"
              active={guidedNavigation.active}
              disabled={!guidedNavigation.active}
              onClick={guidedNavigation.stopGuidedNavigation}
            />
          </div>

          <div className="mt-2.5 text-[11.5px] leading-[1.5] text-[var(--text-faint)]">
            {guidedNavigation.message}{' '}
            <span className="font-medium text-[var(--text-secondary)]">Safety rule:</span>{' '}
            this V0 only runs in teleop, replans from the latest desktop occupancy route, applies a short close-range recovery when odometry stalls near the target, and manual keyboard or joystick input interrupts it.
          </div>
        </DashboardCard>

        <DashboardCard collapsible defaultOpen={false} title="Replay Buffer" subtitle="short scan history scrubber" accent="warning">
          <div className="grid gap-2">
            <MetadataRow label="Mode" value={viewModel.replayMode} />
            <MetadataRow label="Buffered Samples" value={String(replayBufferCount)} />
            <MetadataRow
              label="Selected Sample"
              value={
                replaySelection
                  ? `${replaySelection.index + 1}/${replaySelection.total}`
                  : replayBufferCount > 0
                    ? `latest (${replayBufferCount}/${replayBufferCount})`
                    : '--'
              }
            />
            <MetadataRow
              label="Selected Sequence"
              value={replaySelection ? String(replaySelection.scan.sequence) : '--'}
            />
            <MetadataRow
              label="Selected Timestamp"
              value={replaySelection ? formatPoseTimestamp(replaySelection.scan.timestampMs) : '--'}
            />
            <MetadataRow
              label="Selected Age"
              value={replaySelection ? formatPoseAgeLabel(replaySelection.ageMs) : '--'}
            />
            <MetadataRow label="Replay Trail Points" value={String(viewModel.displayTrail.length)} />
            <MetadataRow
              label="Replay Ghost Scans"
              value={String(viewModel.displayLidarHistory.length)}
            />
          </div>

          <div className="mt-4">
            <input
              type="range"
              min={0}
              max={replaySliderMax}
              step={1}
              value={replaySliderValue}
              disabled={replayControlsDisabled}
              onChange={(event) => viewModel.enterReplayAtIndex(Number(event.target.value))}
              className="w-full accent-[var(--primary)]"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <ReplayControlButton
              label="Oldest"
              onClick={() => viewModel.enterReplayAtIndex(0)}
              disabled={replayControlsDisabled}
            />
            <ReplayControlButton
              label="Prev"
              onClick={() => viewModel.stepReplay(-1)}
              disabled={replayControlsDisabled}
            />
            <ReplayControlButton
              label="Next"
              onClick={() => viewModel.stepReplay(1)}
              disabled={replayControlsDisabled}
            />
            <ReplayControlButton
              label="Newest"
              onClick={() => viewModel.enterReplayAtIndex(replayBufferCount - 1)}
              disabled={replayControlsDisabled}
            />
            <ReplayControlButton
              label="Live"
              onClick={viewModel.returnToLive}
              disabled={replayControlsDisabled || viewModel.replayMode === 'live'}
            />
          </div>

          <div className="mt-2.5 text-[11.5px] leading-[1.5] text-[var(--text-faint)]">
            Moving the scrubber freezes the viewer on the selected buffered sample. The robot body, trail, and primary LiDAR overlay all switch to that captured instant so we can inspect scan-to-pose coherence without extrapolation.
          </div>
        </DashboardCard>

        <DashboardCard collapsible defaultOpen={false} title="Scan Registration" subtitle="lightweight desktop-side fit check" accent="accent">
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge tone={registrationTone(scanRegistration.quality)} label={scanRegistration.quality} />
            <StatusBadge tone="info" label={viewModel.replayMode} />
          </div>

          <div className="mt-3 grid">
            <MetadataRow
              label="Current Seq"
              value={scanRegistration.currentSequence === null ? '--' : String(scanRegistration.currentSequence)}
            />
            <MetadataRow
              label="Reference Seq"
              value={scanRegistration.referenceSequence === null ? '--' : String(scanRegistration.referenceSequence)}
            />
            <MetadataRow
              label="Overlap"
              value={`${Math.round(scanRegistration.overlapRatio * 100)}%`}
            />
            <MetadataRow label="Matched Points" value={String(scanRegistration.matchedPoints)} />
            <MetadataRow
              label="Mean Residual"
              value={formatMillimeters(scanRegistration.meanResidualMm)}
            />
            <MetadataRow
              label="Odom Residual"
              value={formatMillimeters(scanRegistration.odometryResidualMm)}
            />
            <MetadataRow
              label="Improvement"
              value={formatMillimeters(scanRegistration.improvementMm)}
            />
            <MetadataRow
              label="Odom Delta X"
              value={scanRegistration.odometryDeltaXMm === null ? '--' : formatMeters(scanRegistration.odometryDeltaXMm / 1000, 3)}
            />
            <MetadataRow
              label="Odom Delta Y"
              value={scanRegistration.odometryDeltaYMm === null ? '--' : formatMeters(scanRegistration.odometryDeltaYMm / 1000, 3)}
            />
            <MetadataRow
              label="Odom Delta Yaw"
              value={scanRegistration.odometryDeltaYawDeg === null ? '--' : formatDegrees(scanRegistration.odometryDeltaYawDeg, 1)}
            />
            <MetadataRow
              label="Correction X"
              value={formatMillimeters(scanRegistration.correctionXMm)}
            />
            <MetadataRow
              label="Correction Y"
              value={formatMillimeters(scanRegistration.correctionYMm)}
            />
            <MetadataRow
              label="Correction Yaw"
              value={scanRegistration.correctionYawDeg === null ? '--' : formatDegrees(scanRegistration.correctionYawDeg, 1)}
            />
          </div>

          <div className="mt-2.5 text-[11.5px] leading-[1.5] text-[var(--text-faint)]">
            {scanRegistration.message}
          </div>
        </DashboardCard>

        <DashboardCard collapsible title="Pose Readout" subtitle="selected source metadata" accent="primary">
          {poseUnavailable ? (
            <div className="hl-well px-3 py-2.5 text-[12px] text-[var(--text-faint)]">
              No valid pose is available from the selected source. Use Auto or switch to a source that is currently publishing planar SE(2) data.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                <MetricTile label="X" value={formatMeters(pose.xMm / 1000, 3)} />
                <MetricTile label="Y" value={formatMeters(pose.yMm / 1000, 3)} />
                <MetricTile label="Yaw" value={formatDegrees(pose.yawDeg, 1)} />
              </div>

              <div className="mt-3 grid">
                <MetadataRow label="Source" value={poseSourceLabel(pose.source)} />
                <MetadataRow label="Frame" value={pose.frame} />
                <MetadataRow label="Freshness" value={pose.freshness} />
                <MetadataRow label="Sequence" value={String(pose.sequence)} />
                <MetadataRow label="Sample Age" value={formatPoseAgeLabel(viewModel.selectedPose.ageMs)} />
                <MetadataRow label="Timestamp" value={formatPoseTimestamp(pose.timestampMs)} />
              </div>
            </>
          )}
        </DashboardCard>

        <DashboardCard collapsible defaultOpen={false} title="Source Inventory" subtitle="candidate pose feeds" accent="warning">
          <div className="grid gap-2.5">
            {(['odometry', 'reactive', 'mapeamento', 'simulation'] as const).map((sourceId) => (
              <SourceInventoryRow
                key={sourceId}
                sourceId={sourceId}
                pose={viewModel.sourceStates[sourceId]}
                activeOverride={viewModel.sourceOverride}
              />
            ))}
          </div>
        </DashboardCard>
      </div>
    </div>
  )
}
