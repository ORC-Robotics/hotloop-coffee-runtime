import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clamp } from '../lib/format'
import {
  isRenderablePlanarPose,
  type ResolvedSpatialPose,
  type SpatialLidarDiagnostics,
} from '../lib/spatialTelemetry'
import { useRemoteDriver } from './useRemoteDriver'
import type { SpatialGoalPreview, SpatialPathPreviewPoint } from './useSpatialViewModel'

const GUIDED_NAV_TICK_MS = 80
const GUIDED_NAV_MAX_LINEAR_COMMAND = 1.0
const GUIDED_NAV_MIN_LINEAR_COMMAND = 0.12
const GUIDED_NAV_SLOWDOWN_DISTANCE_MM = 620
const GUIDED_NAV_LOOKAHEAD_MM = 260
const GUIDED_NAV_MIN_LOOKAHEAD_MM = 150
const GUIDED_NAV_HEADING_LOOKAHEAD_MM = 220
const GUIDED_NAV_FINAL_TARGET_YAW_CAPTURE_DISTANCE_MM = 320
const GUIDED_NAV_GOAL_TOLERANCE_MM = 120
const GUIDED_NAV_FINAL_HEADING_TOLERANCE_DEG = 8
const GUIDED_NAV_TRACKING_WARNING_CROSS_TRACK_MM = 420
const GUIDED_NAV_MAX_CROSS_TRACK_MM = 680
const GUIDED_NAV_START_CROSS_TRACK_MM = 780
const GUIDED_NAV_START_GRACE_MS = 1200
const GUIDED_NAV_BACKTRACK_TOLERANCE_MM = 180
const GUIDED_NAV_POSE_TIMESTAMP_LIMIT_MS = 3000
const GUIDED_NAV_POSE_NO_CHANGE_LIMIT_MS = 2600
const GUIDED_NAV_CLOSE_RANGE_POSE_TIMESTAMP_LIMIT_MS = 10000
const GUIDED_NAV_CLOSE_RANGE_POSE_NO_CHANGE_LIMIT_MS = 9000
const GUIDED_NAV_CLOSE_RANGE_STALL_DISTANCE_MM = 520
const GUIDED_NAV_STALL_RECOVERY_AFTER_MS = 2200
const GUIDED_NAV_STALL_RECOVERY_MIN_LINEAR_COMMAND = 0.20
const GUIDED_NAV_RAMP_BASE_CYCLE_MS = 20
const GUIDED_NAV_RAMP_UP_PER_CYCLE = 0.018
const GUIDED_NAV_RAMP_DOWN_PER_CYCLE = 0.030
const GUIDED_NAV_LIDAR_MIN_RELIABLE_DISTANCE_MM = 300
const GUIDED_NAV_LIDAR_STOP_DISTANCE_MM = 340
const GUIDED_NAV_LIDAR_SLOWDOWN_DISTANCE_MM = 620
const GUIDED_NAV_LIDAR_CRITICAL_NEAREST_MM = 330
const GUIDED_NAV_LIDAR_MIN_LIMITED_SCALE = 0.58
const GUIDED_NAV_DIRECTION_DEADBAND = 0.04
const GUIDED_NAV_MAX_ANGULAR_COMMAND = 0.42
const GUIDED_NAV_HEADING_DEADBAND_DEG = 4
const GUIDED_NAV_HEADING_FULL_SCALE_DEG = 55
const GUIDED_NAV_HEADING_LINEAR_SLOWDOWN_START_DEG = 18
const GUIDED_NAV_HEADING_LINEAR_SLOWDOWN_FULL_DEG = 72
const GUIDED_INPUT_SOURCE = 'guided-nav'

type GuidedLidarSafetyState = 'clear' | 'limited' | 'unavailable'

export type GuidedNavigationStatus =
  | 'idle'
  | 'ready'
  | 'running'
  | 'completed'
  | 'aborted'
  | 'unavailable'

export interface GuidedNavigationState {
  status: GuidedNavigationStatus
  active: boolean
  canStart: boolean
  startBlockedReasons: string[]
  message: string
  currentWaypointIndex: number
  totalWaypoints: number
  distanceToWaypointMm: number | null
  distanceToGoalMm: number | null
  pathProgressMm: number
  pathProgressRatio: number
  crossTrackErrorMm: number | null
  targetYawDeg: number | null
  yawErrorDeg: number | null
  commandX: number
  commandY: number
  commandZ: number
  remoteMode: string
  remoteInputSource: string
  poseFreshness: string
  goalStatus: string
  goalPathPoints: number
  lidarSafetyState: GuidedLidarSafetyState
  lidarSafetyScale: number
  lidarSafetyDistanceMm: number | null
  lastStopMessage: string | null
  startGuidedNavigation: () => void
  stopGuidedNavigation: () => void
}

interface GuidedNavigationTelemetry {
  currentWaypointIndex: number
  totalWaypoints: number
  distanceToWaypointMm: number | null
  distanceToGoalMm: number | null
  pathProgressMm: number
  pathProgressRatio: number
  crossTrackErrorMm: number | null
  targetYawDeg: number | null
  yawErrorDeg: number | null
  commandX: number
  commandY: number
  commandZ: number
  lidarSafetyState: GuidedLidarSafetyState
  lidarSafetyScale: number
  lidarSafetyDistanceMm: number | null
}

interface GuidedCommandResult {
  completed: boolean
  commandX: number
  commandY: number
  commandZ: number
  currentWaypointIndex: number
  totalWaypoints: number
  distanceToWaypointMm: number
  distanceToGoalMm: number
  pathProgressMm: number
  pathProgressRatio: number
  totalPathLengthMm: number
  crossTrackErrorMm: number
  targetYawDeg: number
  yawErrorDeg: number
}

interface GuidedCommandVector {
  commandX: number
  commandY: number
  commandZ: number
}

interface GuidedLidarSafetyResult {
  state: GuidedLidarSafetyState
  scale: number
  axisScaleX: number
  axisScaleY: number
  distanceMm: number | null
  message: string
}

function createIdleTelemetry(): GuidedNavigationTelemetry {
  return {
    currentWaypointIndex: 0,
    totalWaypoints: 0,
    distanceToWaypointMm: null,
    distanceToGoalMm: null,
    pathProgressMm: 0,
    pathProgressRatio: 0,
    crossTrackErrorMm: null,
    targetYawDeg: null,
    yawErrorDeg: null,
    commandX: 0,
    commandY: 0,
    commandZ: 0,
    lidarSafetyState: 'unavailable',
    lidarSafetyScale: 1,
    lidarSafetyDistanceMm: null,
  }
}

function commandTone(status: GuidedNavigationStatus) {
  if (status === 'running') {
    return 'Guided Navigation V0 running.'
  }

  if (status === 'completed') {
    return 'Guided Navigation V0 reached the preview target.'
  }

  if (status === 'ready') {
    return 'Guided Navigation V0 ready. Start only when the arena is clear and you are ready to stop manually.'
  }

  return 'Guided Navigation V0 idle.'
}

function commandRunningMessage(
  crossTrackErrorMm: number,
  stallRecoveryActive = false,
  distanceToGoalMm: number | null = null,
  yawErrorDeg: number | null = null,
  lidarSafety?: GuidedLidarSafetyResult,
) {
  if (lidarSafety?.state === 'limited') {
    return lidarSafety.message
  }

  if (stallRecoveryActive) {
    return `Guided Navigation V0 applying close-range recovery; ${Math.round(
      distanceToGoalMm ?? 0,
    )} mm remaining.`
  }

  if (
    distanceToGoalMm !== null &&
    distanceToGoalMm <= GUIDED_NAV_GOAL_TOLERANCE_MM &&
    yawErrorDeg !== null &&
    Math.abs(yawErrorDeg) > GUIDED_NAV_FINAL_HEADING_TOLERANCE_DEG
  ) {
    return `Guided Navigation V0 aligning final heading; yaw error ${Math.round(yawErrorDeg)} deg.`
  }

  if (crossTrackErrorMm > GUIDED_NAV_TRACKING_WARNING_CROSS_TRACK_MM) {
    return `Guided Navigation V0 recovering to route; cross-track ${Math.round(crossTrackErrorMm)} mm.`
  }

  if (yawErrorDeg !== null && Math.abs(yawErrorDeg) > GUIDED_NAV_HEADING_LINEAR_SLOWDOWN_START_DEG) {
    return `Guided Navigation V0 aligning to path heading; yaw error ${Math.round(yawErrorDeg)} deg.`
  }

  return commandTone('running')
}

function normalizeAngleDelta(value: number) {
  let next = value

  while (next > 180) {
    next -= 360
  }

  while (next < -180) {
    next += 360
  }

  return next
}

function worldVectorToYawDeg(deltaXMm: number, deltaYMm: number) {
  return (Math.atan2(deltaXMm, deltaYMm) * 180) / Math.PI
}

function worldDeltaToRobotLocal(
  pose: { xMm: number; yMm: number; yawDeg: number },
  target: SpatialPathPreviewPoint,
) {
  const headingRad = (pose.yawDeg * Math.PI) / 180
  const dxMm = target.xMm - pose.xMm
  const dyMm = target.yMm - pose.yMm
  const cos = Math.cos(headingRad)
  const sin = Math.sin(headingRad)

  return {
    xMm: dxMm * cos - dyMm * sin,
    yMm: dxMm * sin + dyMm * cos,
  }
}

interface PathProjection {
  segmentIndex: number
  progressMm: number
  totalLengthMm: number
  distanceToPathMm: number
  closestPoint: SpatialPathPreviewPoint
}

function pointAlongSegment(
  start: SpatialPathPreviewPoint,
  end: SpatialPathPreviewPoint,
  ratio: number,
) {
  return {
    xMm: start.xMm + (end.xMm - start.xMm) * ratio,
    yMm: start.yMm + (end.yMm - start.yMm) * ratio,
  }
}

function projectPoseOntoPath(
  pose: { xMm: number; yMm: number },
  path: SpatialPathPreviewPoint[],
  minProgressMm = 0,
): PathProjection | null {
  if (path.length < 2) {
    return null
  }

  let accumulatedMm = 0
  let totalLengthMm = 0
  let bestProjection: PathProjection | null = null

  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1]
    const end = path[index]
    const segmentXMm = end.xMm - start.xMm
    const segmentYMm = end.yMm - start.yMm
    const segmentLengthMm = Math.hypot(segmentXMm, segmentYMm)

    if (segmentLengthMm <= 1) {
      continue
    }

    const rawRatio =
      ((pose.xMm - start.xMm) * segmentXMm + (pose.yMm - start.yMm) * segmentYMm) /
      (segmentLengthMm * segmentLengthMm)
    const ratio = clamp(rawRatio, 0, 1)
    const closestPoint = pointAlongSegment(start, end, ratio)
    const distanceToPathMm = Math.hypot(
      pose.xMm - closestPoint.xMm,
      pose.yMm - closestPoint.yMm,
    )
    const progressMm = accumulatedMm + segmentLengthMm * ratio

    totalLengthMm += segmentLengthMm

    if (progressMm < minProgressMm - GUIDED_NAV_BACKTRACK_TOLERANCE_MM) {
      accumulatedMm += segmentLengthMm
      continue
    }

    if (!bestProjection || distanceToPathMm < bestProjection.distanceToPathMm) {
      bestProjection = {
        segmentIndex: index - 1,
        progressMm,
        totalLengthMm,
        distanceToPathMm,
        closestPoint,
      }
    }

    accumulatedMm += segmentLengthMm
  }

  if (!bestProjection) {
    return null
  }

  return {
    ...bestProjection,
    totalLengthMm,
  }
}

function selectPathPointAtProgress(path: SpatialPathPreviewPoint[], targetProgressMm: number) {
  let accumulatedMm = 0

  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1]
    const end = path[index]
    const segmentLengthMm = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm)

    if (segmentLengthMm <= 1) {
      continue
    }

    if (accumulatedMm + segmentLengthMm >= targetProgressMm) {
      return {
        point: pointAlongSegment(
          start,
          end,
          clamp((targetProgressMm - accumulatedMm) / segmentLengthMm, 0, 1),
        ),
        segmentIndex: index - 1,
      }
    }

    accumulatedMm += segmentLengthMm
  }

  return path[path.length - 1]
}

function pathPointFromSelection(
  selection:
    | SpatialPathPreviewPoint
    | {
        point: SpatialPathPreviewPoint
        segmentIndex: number
      },
) {
  return 'point' in selection ? selection.point : selection
}

function resolveTargetYawDeg(
  path: SpatialPathPreviewPoint[],
  progressMm: number,
  totalLengthMm: number,
  pose: { xMm: number; yMm: number; yawDeg: number },
  distanceToGoalMm: number,
  goalTargetYawDeg: number | null,
) {
  if (
    goalTargetYawDeg !== null &&
    distanceToGoalMm <= GUIDED_NAV_FINAL_TARGET_YAW_CAPTURE_DISTANCE_MM
  ) {
    return goalTargetYawDeg
  }

  const startSelection = selectPathPointAtProgress(path, clamp(progressMm, 0, totalLengthMm))
  const endSelection = selectPathPointAtProgress(
    path,
    Math.min(totalLengthMm, progressMm + GUIDED_NAV_HEADING_LOOKAHEAD_MM),
  )
  const startPoint = pathPointFromSelection(startSelection)
  const endPoint = pathPointFromSelection(endSelection)
  const headingDeltaXMm = endPoint.xMm - startPoint.xMm
  const headingDeltaYMm = endPoint.yMm - startPoint.yMm

  if (Math.hypot(headingDeltaXMm, headingDeltaYMm) <= 10) {
    const finalTarget = path[path.length - 1]
    if (!finalTarget) {
      return pose.yawDeg
    }

    const finalDeltaXMm = finalTarget.xMm - pose.xMm
    const finalDeltaYMm = finalTarget.yMm - pose.yMm
    if (Math.hypot(finalDeltaXMm, finalDeltaYMm) <= 10) {
      return pose.yawDeg
    }

    return worldVectorToYawDeg(finalDeltaXMm, finalDeltaYMm)
  }

  return worldVectorToYawDeg(headingDeltaXMm, headingDeltaYMm)
}

function computeHeadingCommand(yawErrorDeg: number) {
  const absoluteYawErrorDeg = Math.abs(yawErrorDeg)
  if (absoluteYawErrorDeg <= GUIDED_NAV_HEADING_DEADBAND_DEG) {
    return 0
  }

  const normalizedError =
    clamp(yawErrorDeg / GUIDED_NAV_HEADING_FULL_SCALE_DEG, -1, 1) *
    GUIDED_NAV_MAX_ANGULAR_COMMAND

  return clamp(
    normalizedError,
    -GUIDED_NAV_MAX_ANGULAR_COMMAND,
    GUIDED_NAV_MAX_ANGULAR_COMMAND,
  )
}

function computeHeadingLinearScale(yawErrorDeg: number) {
  const absoluteYawErrorDeg = Math.abs(yawErrorDeg)
  if (absoluteYawErrorDeg <= GUIDED_NAV_HEADING_LINEAR_SLOWDOWN_START_DEG) {
    return 1
  }

  const ratio = clamp(
    (absoluteYawErrorDeg - GUIDED_NAV_HEADING_LINEAR_SLOWDOWN_START_DEG) /
      Math.max(
        1,
        GUIDED_NAV_HEADING_LINEAR_SLOWDOWN_FULL_DEG - GUIDED_NAV_HEADING_LINEAR_SLOWDOWN_START_DEG,
      ),
    0,
    1,
  )

  return clamp(1 - ratio * 0.55, 0.45, 1)
}

function distanceToFinalPathTargetMm(
  pose: { xMm: number; yMm: number },
  path: SpatialPathPreviewPoint[],
) {
  const finalTarget = path[path.length - 1]
  if (!finalTarget) {
    return null
  }

  return Math.hypot(finalTarget.xMm - pose.xMm, finalTarget.yMm - pose.yMm)
}

function poseMotionSignature(pose: { xMm: number; yMm: number; yawDeg: number; sequence: number }) {
  return `${Math.round(pose.xMm)}:${Math.round(pose.yMm)}:${pose.yawDeg.toFixed(1)}:${pose.sequence}`
}

function createZeroCommandVector(): GuidedCommandVector {
  return {
    commandX: 0,
    commandY: 0,
    commandZ: 0,
  }
}

function moveTowards(current: number, desired: number, maxDelta: number) {
  if (current < desired) {
    return Math.min(current + maxDelta, desired)
  }

  return Math.max(current - maxDelta, desired)
}

function rampCommandVector(
  current: GuidedCommandVector,
  desired: GuidedCommandVector,
  elapsedMs: number,
): GuidedCommandVector {
  const cycleScale = Math.max(1, elapsedMs / GUIDED_NAV_RAMP_BASE_CYCLE_MS)

  const rampAxis = (currentAxis: number, desiredAxis: number) => {
    const increasingMagnitude = Math.abs(desiredAxis) > Math.abs(currentAxis)
    const maxDelta =
      (increasingMagnitude ? GUIDED_NAV_RAMP_UP_PER_CYCLE : GUIDED_NAV_RAMP_DOWN_PER_CYCLE) *
      cycleScale

    return moveTowards(currentAxis, desiredAxis, maxDelta)
  }

  return {
    commandX: rampAxis(current.commandX, desired.commandX),
    commandY: rampAxis(current.commandY, desired.commandY),
    commandZ: rampAxis(current.commandZ, desired.commandZ),
  }
}

function formatLidarDistance(distanceMm: number | null) {
  return distanceMm === null ? 'unknown clearance' : `${Math.round(distanceMm)} mm clearance`
}

function lidarAxisScale(distanceMm: number | null) {
  if (distanceMm === null || distanceMm >= GUIDED_NAV_LIDAR_SLOWDOWN_DISTANCE_MM) {
    return 1
  }

  return clamp(
    (distanceMm - GUIDED_NAV_LIDAR_STOP_DISTANCE_MM) /
      Math.max(1, GUIDED_NAV_LIDAR_SLOWDOWN_DISTANCE_MM - GUIDED_NAV_LIDAR_STOP_DISTANCE_MM),
    GUIDED_NAV_LIDAR_MIN_LIMITED_SCALE,
    1,
  )
}

function applyDirectionalLidarLimit(
  command: GuidedCommandVector,
  lidarSafety: GuidedLidarSafetyResult,
): GuidedCommandVector {
  return {
    commandX: command.commandX * lidarSafety.axisScaleX,
    commandY: command.commandY * lidarSafety.axisScaleY,
    commandZ: command.commandZ,
  }
}

function computeDirectionalLidarSafety(
  command: GuidedCommandVector,
  lidarDiagnostics: SpatialLidarDiagnostics,
): GuidedLidarSafetyResult {
  const commandMagnitude = Math.hypot(command.commandX, command.commandY)

  if (
    lidarDiagnostics.renderState !== 'ready' ||
    !lidarDiagnostics.frameAligned ||
    lidarDiagnostics.validRatio < 0.12
  ) {
    return {
      state: 'unavailable',
      scale: 1,
      axisScaleX: 1,
      axisScaleY: 1,
      distanceMm: null,
      message: 'Guided Navigation V0 running; reactive LiDAR safety is unavailable.',
    }
  }

  if (commandMagnitude <= GUIDED_NAV_DIRECTION_DEADBAND) {
    return {
      state: 'clear',
      scale: 1,
      axisScaleX: 1,
      axisScaleY: 1,
      distanceMm: null,
      message: commandTone('running'),
    }
  }

  const directionalDistances: number[] = []
  let axisScaleX = 1
  let axisScaleY = 1

  if (command.commandY > GUIDED_NAV_DIRECTION_DEADBAND && lidarDiagnostics.frontDistanceMm !== null) {
    directionalDistances.push(lidarDiagnostics.frontDistanceMm)
    axisScaleY = Math.min(axisScaleY, lidarAxisScale(lidarDiagnostics.frontDistanceMm))
  }
  if (command.commandX < -GUIDED_NAV_DIRECTION_DEADBAND && lidarDiagnostics.leftNearestMm !== null) {
    directionalDistances.push(lidarDiagnostics.leftNearestMm)
    axisScaleX = Math.min(axisScaleX, lidarAxisScale(lidarDiagnostics.leftNearestMm))
  }
  if (command.commandX > GUIDED_NAV_DIRECTION_DEADBAND && lidarDiagnostics.rightNearestMm !== null) {
    directionalDistances.push(lidarDiagnostics.rightNearestMm)
    axisScaleX = Math.min(axisScaleX, lidarAxisScale(lidarDiagnostics.rightNearestMm))
  }

  if (directionalDistances.length === 0) {
    return {
      state: 'clear',
      scale: 1,
      axisScaleX: 1,
      axisScaleY: 1,
      distanceMm: null,
      message: commandTone('running'),
    }
  }

  const clearanceMm = Math.min(...directionalDistances)
  const scale = Math.min(axisScaleX, axisScaleY)
  if (scale < 1) {
    const sensorFloorNote =
      clearanceMm <= GUIDED_NAV_LIDAR_CRITICAL_NEAREST_MM
        ? ` near the ${GUIDED_NAV_LIDAR_MIN_RELIABLE_DISTANCE_MM} mm sensor floor`
        : ''

    return {
      state: 'limited',
      scale,
      axisScaleX,
      axisScaleY,
      distanceMm: clearanceMm,
      message: `Guided Navigation V0 LiDAR directional limit ${Math.round(
        scale * 100,
      )}%${sensorFloorNote}; ${formatLidarDistance(clearanceMm)}.`,
    }
  }

  return {
    state: 'clear',
    scale: 1,
    axisScaleX: 1,
    axisScaleY: 1,
    distanceMm: clearanceMm,
    message: commandTone('running'),
  }
}

function computeGuidedCommand(
  pose: { xMm: number; yMm: number; yawDeg: number },
  goalPreview: SpatialGoalPreview,
  minProgressMm = 0,
  crossTrackLimitMm = GUIDED_NAV_MAX_CROSS_TRACK_MM,
): GuidedCommandResult | null {
  const path = goalPreview.path
  const finalTarget = path[path.length - 1] ?? null
  const projection = projectPoseOntoPath(pose, path, minProgressMm)

  if (!finalTarget || !projection) {
    return null
  }

  const distanceToGoalMm = Math.hypot(finalTarget.xMm - pose.xMm, finalTarget.yMm - pose.yMm)
  const pathProgressMm = Math.max(minProgressMm, projection.progressMm)
  const lookaheadDistanceMm = clamp(
    GUIDED_NAV_LOOKAHEAD_MM - projection.distanceToPathMm * 0.28,
    GUIDED_NAV_MIN_LOOKAHEAD_MM,
    GUIDED_NAV_LOOKAHEAD_MM,
  )
  const targetProgressMm = Math.min(
    projection.totalLengthMm,
    pathProgressMm + lookaheadDistanceMm,
  )
  const lookaheadSelection = selectPathPointAtProgress(path, targetProgressMm)
  const lookaheadTarget = pathPointFromSelection(lookaheadSelection)
  const lookaheadSegmentIndex =
    'segmentIndex' in lookaheadSelection
      ? lookaheadSelection.segmentIndex
      : Math.max(0, path.length - 2)
  const distanceToWaypointMm = Math.hypot(
    lookaheadTarget.xMm - pose.xMm,
    lookaheadTarget.yMm - pose.yMm,
  )
  const pathProgressRatio =
    projection.totalLengthMm <= 1 ? 0 : clamp(pathProgressMm / projection.totalLengthMm, 0, 1)
  const targetYawDeg = resolveTargetYawDeg(
    path,
    pathProgressMm,
    projection.totalLengthMm,
    pose,
    distanceToGoalMm,
    goalPreview.targetYawDeg,
  )
  const yawErrorDeg = normalizeAngleDelta(targetYawDeg - pose.yawDeg)
  const commandZ = computeHeadingCommand(yawErrorDeg)

  if (
    distanceToGoalMm <= GUIDED_NAV_GOAL_TOLERANCE_MM &&
    Math.abs(yawErrorDeg) <= GUIDED_NAV_FINAL_HEADING_TOLERANCE_DEG
  ) {
    return {
      completed: true,
      commandX: 0,
      commandY: 0,
      commandZ: 0,
      currentWaypointIndex: Math.max(0, path.length - 1),
      totalWaypoints: Math.max(0, path.length - 1),
      distanceToWaypointMm,
      distanceToGoalMm,
      pathProgressMm: projection.totalLengthMm,
      pathProgressRatio: 1,
      totalPathLengthMm: projection.totalLengthMm,
      crossTrackErrorMm: projection.distanceToPathMm,
      targetYawDeg,
      yawErrorDeg,
    }
  }

  if (distanceToWaypointMm <= 1 || projection.distanceToPathMm > crossTrackLimitMm) {
    return null
  }

  if (distanceToGoalMm <= GUIDED_NAV_GOAL_TOLERANCE_MM) {
    return {
      completed: false,
      commandX: 0,
      commandY: 0,
      commandZ,
      currentWaypointIndex: Math.max(0, path.length - 1),
      totalWaypoints: Math.max(0, path.length - 1),
      distanceToWaypointMm,
      distanceToGoalMm,
      pathProgressMm,
      pathProgressRatio,
      totalPathLengthMm: projection.totalLengthMm,
      crossTrackErrorMm: projection.distanceToPathMm,
      targetYawDeg,
      yawErrorDeg,
    }
  }

  const localTarget = worldDeltaToRobotLocal(pose, lookaheadTarget)
  const slowdownRatio = clamp(
    distanceToGoalMm / GUIDED_NAV_SLOWDOWN_DISTANCE_MM,
    GUIDED_NAV_MIN_LINEAR_COMMAND / GUIDED_NAV_MAX_LINEAR_COMMAND,
    1,
  )
  const commandMagnitude =
    GUIDED_NAV_MAX_LINEAR_COMMAND * slowdownRatio * computeHeadingLinearScale(yawErrorDeg)
  const commandX = clamp(
    (localTarget.xMm / distanceToWaypointMm) * commandMagnitude,
    -GUIDED_NAV_MAX_LINEAR_COMMAND,
    GUIDED_NAV_MAX_LINEAR_COMMAND,
  )
  const commandY = clamp(
    (localTarget.yMm / distanceToWaypointMm) * commandMagnitude,
    -GUIDED_NAV_MAX_LINEAR_COMMAND,
    GUIDED_NAV_MAX_LINEAR_COMMAND,
  )

  return {
    completed: false,
    commandX,
    commandY,
    commandZ,
    currentWaypointIndex: Math.min(path.length - 1, lookaheadSegmentIndex + 1),
    totalWaypoints: Math.max(0, path.length - 1),
    distanceToWaypointMm,
    distanceToGoalMm,
    pathProgressMm,
    pathProgressRatio,
    totalPathLengthMm: projection.totalLengthMm,
    crossTrackErrorMm: projection.distanceToPathMm,
    targetYawDeg,
    yawErrorDeg,
  }
}

function boostLinearCommand(command: GuidedCommandResult, minMagnitude: number): GuidedCommandResult {
  const magnitude = Math.hypot(command.commandX, command.commandY)

  if (magnitude < 0.001 || magnitude >= minMagnitude) {
    return command
  }

  const scale = minMagnitude / magnitude

  return {
    ...command,
    commandX: clamp(
      command.commandX * scale,
      -GUIDED_NAV_MAX_LINEAR_COMMAND,
      GUIDED_NAV_MAX_LINEAR_COMMAND,
    ),
    commandY: clamp(
      command.commandY * scale,
      -GUIDED_NAV_MAX_LINEAR_COMMAND,
      GUIDED_NAV_MAX_LINEAR_COMMAND,
    ),
  }
}

function describeGuidedCommandBlock(
  pose: { xMm: number; yMm: number; yawDeg: number },
  goalPreview: SpatialGoalPreview,
  minProgressMm = 0,
  crossTrackLimitMm = GUIDED_NAV_MAX_CROSS_TRACK_MM,
) {
  const path = goalPreview.path
  const finalTarget = path[path.length - 1] ?? null

  if (!finalTarget || path.length < 2) {
    return 'Guided Navigation V0 could not start because the armed route has no usable path points.'
  }

  const projection = projectPoseOntoPath(pose, path, minProgressMm)
  if (!projection) {
    return 'Guided Navigation V0 could not find a usable segment in the current replanned route. Clear and reselect the goal if this repeats.'
  }

  const distanceToGoalMm = Math.hypot(finalTarget.xMm - pose.xMm, finalTarget.yMm - pose.yMm)
  if (distanceToGoalMm <= GUIDED_NAV_GOAL_TOLERANCE_MM) {
    return 'Guided Navigation V0 target is already inside the goal tolerance.'
  }

  if (projection.distanceToPathMm > crossTrackLimitMm) {
    return `Guided Navigation V0 refused the route because cross-track error is ${Math.round(
      projection.distanceToPathMm,
    )} mm, above the ${Math.round(crossTrackLimitMm)} mm safety gate. Re-arm the goal from the current pose.`
  }

  const pathProgressMm = Math.max(minProgressMm, projection.progressMm)
  const targetProgressMm = Math.min(
    projection.totalLengthMm,
    pathProgressMm + GUIDED_NAV_LOOKAHEAD_MM,
  )
  const lookaheadSelection = selectPathPointAtProgress(path, targetProgressMm)
  const lookaheadTarget = 'point' in lookaheadSelection ? lookaheadSelection.point : lookaheadSelection
  const distanceToWaypointMm = Math.hypot(
    lookaheadTarget.xMm - pose.xMm,
    lookaheadTarget.yMm - pose.yMm,
  )

  if (distanceToWaypointMm <= 1) {
    return 'Guided Navigation V0 could not select a forward lookahead point. Re-arm the goal from the current pose.'
  }

  return 'Guided Navigation V0 could not compute a safe command from the current route.'
}

export function useGuidedNavigation({
  goalPreview,
  selectedPose,
  lidarDiagnostics,
}: {
  goalPreview: SpatialGoalPreview
  selectedPose: ResolvedSpatialPose
  lidarDiagnostics: SpatialLidarDiagnostics
}): GuidedNavigationState {
  const remoteDriverController = useRemoteDriver()
  const {
    remoteDriver,
    preview,
    setGuidedCommand,
    clearGuidedCommand,
  } = remoteDriverController
  const [active, setActive] = useState(false)
  const [status, setStatus] = useState<GuidedNavigationStatus>('idle')
  const [message, setMessage] = useState(commandTone('idle'))
  const [lastStopMessage, setLastStopMessage] = useState<string | null>(null)
  const [syncedStatusInputs, setSyncedStatusInputs] = useState<readonly unknown[] | null>(null)
  const [telemetry, setTelemetry] = useState<GuidedNavigationTelemetry>(createIdleTelemetry)
  const activeStartedAtMsRef = useRef<number | null>(null)
  const pathProgressMmRef = useRef(0)
  const initialGoalDistanceMmRef = useRef<number | null>(null)
  const bestGoalDistanceMmRef = useRef<number | null>(null)
  const lastPoseMotionSignatureRef = useRef<string | null>(null)
  // Seeded by startGuidedNavigation before the control loop ever reads it.
  const lastPoseMotionAtMsRef = useRef(0)
  const appliedCommandRef = useRef<GuidedCommandVector>(createZeroCommandVector())
  const lastRampAtMsRef = useRef<number | null>(null)
  const latestRef = useRef({
    goalPreview,
    selectedPose,
    lidarDiagnostics,
    remoteMode: remoteDriver.mode,
    inputSource: preview.inputSource,
  })

  const startBlockedReasons = useMemo(() => {
    const reasons: string[] = []

    if (goalPreview.status !== 'armed') {
      reasons.push('goal not armed')
    }
    if (goalPreview.path.length < 2) {
      reasons.push('preview path missing')
    }
    if (!selectedPose.isRenderable || selectedPose.pose.freshness === 'invalid') {
      reasons.push('pose unavailable')
    }
    if (remoteDriver.mode !== 'teleop') {
      reasons.push('remote teleop inactive')
    }
    if (preview.inputSource !== 'idle' && preview.inputSource !== GUIDED_INPUT_SOURCE) {
      reasons.push('manual input active')
    }

    return reasons
  }, [
    goalPreview.path.length,
    goalPreview.status,
    preview.inputSource,
    remoteDriver.mode,
    selectedPose.isRenderable,
    selectedPose.pose.freshness,
  ])
  const canStart = useMemo(() => {
    return startBlockedReasons.length === 0
  }, [startBlockedReasons])

  useEffect(() => {
    latestRef.current = {
      goalPreview,
      selectedPose,
      lidarDiagnostics,
      remoteMode: remoteDriver.mode,
      inputSource: preview.inputSource,
    }
  }, [goalPreview, lidarDiagnostics, preview.inputSource, remoteDriver.mode, selectedPose])

  const stopGuidedNavigation = useCallback(() => {
    setActive(false)
    activeStartedAtMsRef.current = null
    pathProgressMmRef.current = 0
    initialGoalDistanceMmRef.current = null
    bestGoalDistanceMmRef.current = null
    lastPoseMotionSignatureRef.current = null
    lastPoseMotionAtMsRef.current = Date.now()
    appliedCommandRef.current = createZeroCommandVector()
    lastRampAtMsRef.current = null
    setStatus('aborted')
    setLastStopMessage('Guided Navigation V0 stopped by operator.')
    setMessage('Guided Navigation V0 stopped by operator.')
    setTelemetry((current) => ({
      ...current,
      distanceToWaypointMm: null,
      distanceToGoalMm: null,
      pathProgressMm: 0,
      pathProgressRatio: 0,
      crossTrackErrorMm: null,
      targetYawDeg: null,
      yawErrorDeg: null,
      commandX: 0,
      commandY: 0,
      commandZ: 0,
    }))
    clearGuidedCommand('Guided Navigation V0 stopped by operator.')
  }, [clearGuidedCommand])

  const startGuidedNavigation = useCallback(() => {
    if (!canStart) {
      setStatus('unavailable')
      const blockedMessage = `Guided Navigation V0 cannot start yet: ${startBlockedReasons.join(', ') || 'unknown gate'}.`
      setLastStopMessage(blockedMessage)
      setMessage(blockedMessage)
      return
    }

    const nowMs = Date.now()
    activeStartedAtMsRef.current = nowMs
    pathProgressMmRef.current = 0
    appliedCommandRef.current = createZeroCommandVector()
    lastRampAtMsRef.current = nowMs
    setLastStopMessage(null)
    const latest = latestRef.current
    const initialCommand = computeGuidedCommand(
      latest.selectedPose.pose,
      latest.goalPreview,
      0,
      GUIDED_NAV_START_CROSS_TRACK_MM,
    )
    if (!initialCommand) {
      const blockedMessage = describeGuidedCommandBlock(
        latest.selectedPose.pose,
        latest.goalPreview,
        0,
        GUIDED_NAV_START_CROSS_TRACK_MM,
      )
      activeStartedAtMsRef.current = null
      setActive(false)
      setStatus('unavailable')
      setLastStopMessage(blockedMessage)
      setMessage(blockedMessage)
      setTelemetry((current) => ({
        ...current,
        targetYawDeg: null,
        yawErrorDeg: null,
        commandX: 0,
        commandY: 0,
        commandZ: 0,
      }))
      clearGuidedCommand(blockedMessage)
      return
    }

    const initialDistanceToGoalMm = distanceToFinalPathTargetMm(
      latest.selectedPose.pose,
      latest.goalPreview.path,
    )
    initialGoalDistanceMmRef.current = initialDistanceToGoalMm
    bestGoalDistanceMmRef.current = initialDistanceToGoalMm
    lastPoseMotionSignatureRef.current = poseMotionSignature(latest.selectedPose.pose)
    lastPoseMotionAtMsRef.current = nowMs
    pathProgressMmRef.current = initialCommand.pathProgressMm
    const initialSafety = computeDirectionalLidarSafety(initialCommand, latest.lidarDiagnostics)
    const initialProtectedCommand = applyDirectionalLidarLimit(initialCommand, initialSafety)
    const initialStreamCommand = rampCommandVector(
      appliedCommandRef.current,
      initialProtectedCommand,
      GUIDED_NAV_TICK_MS,
    )
    appliedCommandRef.current = initialStreamCommand
    setTelemetry({
      currentWaypointIndex: initialCommand.currentWaypointIndex,
      totalWaypoints: initialCommand.totalWaypoints,
      distanceToWaypointMm: initialCommand.distanceToWaypointMm,
      distanceToGoalMm: initialCommand.distanceToGoalMm,
      pathProgressMm: initialCommand.pathProgressMm,
      pathProgressRatio: initialCommand.pathProgressRatio,
      crossTrackErrorMm: initialCommand.crossTrackErrorMm,
      targetYawDeg: initialCommand.targetYawDeg,
      yawErrorDeg: initialCommand.yawErrorDeg,
      commandX: initialStreamCommand.commandX,
      commandY: initialStreamCommand.commandY,
      commandZ: initialStreamCommand.commandZ,
      lidarSafetyState: initialSafety.state,
      lidarSafetyScale: initialSafety.scale,
      lidarSafetyDistanceMm: initialSafety.distanceMm,
    })

    if (initialCommand.completed) {
      activeStartedAtMsRef.current = null
      setActive(false)
      setStatus('completed')
      setLastStopMessage('Guided Navigation V0 target is already inside the goal tolerance.')
      setMessage('Guided Navigation V0 target is already inside the goal tolerance.')
      clearGuidedCommand('Guided Navigation V0 target is already inside the goal tolerance.')
      return
    }

    const initialRunningMessage = commandRunningMessage(
      initialCommand.crossTrackErrorMm,
      false,
      initialCommand.distanceToGoalMm,
      initialCommand.yawErrorDeg,
      initialSafety,
    )
    setGuidedCommand({
      x: initialStreamCommand.commandX,
      y: initialStreamCommand.commandY,
      z: initialStreamCommand.commandZ,
      message: initialRunningMessage,
    })
    setActive(true)
    setStatus('running')
    setMessage(initialRunningMessage)
  }, [canStart, clearGuidedCommand, setGuidedCommand, startBlockedReasons])

  // While stopped, re-derive the idle status whenever its inputs change. This is
  // adjusted during render rather than in an effect; statuses set by the
  // start/stop handlers stand until one of these inputs changes.
  const statusInputs = [active, canStart, goalPreview.status, lastStopMessage, startBlockedReasons]
  if (
    syncedStatusInputs === null ||
    statusInputs.some((input, index) => !Object.is(input, syncedStatusInputs[index]))
  ) {
    setSyncedStatusInputs(statusInputs)

    if (!active) {
      const nextStatus =
        canStart ? 'ready' : goalPreview.status === 'armed' ? 'unavailable' : 'idle'
      setStatus(nextStatus)
      if (nextStatus === 'ready') {
        setMessage(
          lastStopMessage
            ? `${commandTone('ready')} Last stop: ${lastStopMessage}`
            : commandTone('ready'),
        )
      } else if (nextStatus === 'unavailable') {
        setMessage(
          `Guided Navigation V0 cannot start yet: ${startBlockedReasons.join(', ') || 'unknown gate'}.`,
        )
      } else {
        setMessage(commandTone(nextStatus))
      }
    }
  }

  useEffect(() => {
    if (!active) {
      return
    }

    let cancelled = false

    const stopWithReason = (nextStatus: GuidedNavigationStatus, nextMessage: string) => {
      if (cancelled) {
        return
      }

      setActive(false)
      activeStartedAtMsRef.current = null
      if (nextStatus !== 'completed') {
        pathProgressMmRef.current = 0
      }
      initialGoalDistanceMmRef.current = null
      bestGoalDistanceMmRef.current = null
      if (nextStatus !== 'completed') {
        lastPoseMotionSignatureRef.current = null
      }
      appliedCommandRef.current = createZeroCommandVector()
      lastRampAtMsRef.current = null
      setStatus(nextStatus)
      setLastStopMessage(nextMessage)
      setMessage(nextMessage)
      setTelemetry((current) => ({
        ...current,
        pathProgressMm: current.pathProgressMm,
        pathProgressRatio: nextStatus === 'completed' ? 1 : current.pathProgressRatio,
        crossTrackErrorMm: current.crossTrackErrorMm,
        targetYawDeg: current.targetYawDeg,
        yawErrorDeg: current.yawErrorDeg,
        commandX: 0,
        commandY: 0,
        commandZ: 0,
      }))
      clearGuidedCommand(nextMessage)
    }

    const tick = () => {
      const latest = latestRef.current
      const pose = latest.selectedPose.pose
      const nowMs = Date.now()
      const startedAtMs = activeStartedAtMsRef.current ?? nowMs
      const withinStartGrace = nowMs - startedAtMs <= GUIDED_NAV_START_GRACE_MS

      if (latest.remoteMode !== 'teleop') {
        stopWithReason('unavailable', 'Guided Navigation V0 stopped because teleop is not active.')
        return
      }

      if (
        latest.inputSource !== 'idle' &&
        latest.inputSource !== GUIDED_INPUT_SOURCE
      ) {
        stopWithReason('aborted', 'Guided Navigation V0 interrupted by manual operator input.')
        return
      }

      if (latest.goalPreview.status !== 'armed') {
        stopWithReason('unavailable', 'Guided Navigation V0 stopped because the goal is no longer armed.')
        return
      }

      if (!isRenderablePlanarPose(pose) || pose.freshness === 'invalid') {
        stopWithReason('unavailable', 'Guided Navigation V0 stopped because the selected pose is unavailable.')
        return
      }

      const poseSignature = poseMotionSignature(pose)
      if (poseSignature !== lastPoseMotionSignatureRef.current) {
        lastPoseMotionSignatureRef.current = poseSignature
        lastPoseMotionAtMsRef.current = nowMs
      }

      if (pose.frame !== latest.goalPreview.frame) {
        stopWithReason('unavailable', 'Guided Navigation V0 stopped because the pose frame changed.')
        return
      }

      const crossTrackLimitMm = withinStartGrace
        ? GUIDED_NAV_START_CROSS_TRACK_MM
        : GUIDED_NAV_MAX_CROSS_TRACK_MM
      const command = computeGuidedCommand(
        pose,
        latest.goalPreview,
        0,
        crossTrackLimitMm,
      )
      if (!command) {
        stopWithReason(
          'unavailable',
          describeGuidedCommandBlock(
            pose,
            latest.goalPreview,
            0,
            crossTrackLimitMm,
          ),
        )
        return
      }

      const lidarSafety = computeDirectionalLidarSafety(command, latest.lidarDiagnostics)
      const poseAgeMs = pose.timestampMs > 0 ? nowMs - pose.timestampMs : 0
      const poseTimestampLimitMs =
        command.distanceToGoalMm <= GUIDED_NAV_CLOSE_RANGE_STALL_DISTANCE_MM
          ? GUIDED_NAV_CLOSE_RANGE_POSE_TIMESTAMP_LIMIT_MS
          : GUIDED_NAV_POSE_TIMESTAMP_LIMIT_MS

      if (
        pose.timestampMs > 0 &&
        poseAgeMs > poseTimestampLimitMs &&
        !withinStartGrace
      ) {
        stopWithReason(
          'unavailable',
          `Guided Navigation V0 stopped because the pose stream age reached ${(
            poseAgeMs / 1000
          ).toFixed(1)}s while still ${Math.round(command.distanceToGoalMm)} mm short of the target.`,
        )
        return
      }

      const noPoseChangeMs = nowMs - lastPoseMotionAtMsRef.current
      const closeRange = command.distanceToGoalMm <= GUIDED_NAV_CLOSE_RANGE_STALL_DISTANCE_MM
      const stallRecoveryActive =
        closeRange &&
        noPoseChangeMs > GUIDED_NAV_STALL_RECOVERY_AFTER_MS &&
        !withinStartGrace
      const poseNoChangeLimitMs =
        closeRange
          ? GUIDED_NAV_CLOSE_RANGE_POSE_NO_CHANGE_LIMIT_MS
          : GUIDED_NAV_POSE_NO_CHANGE_LIMIT_MS

      if (
        pose.freshness !== 'live' &&
        noPoseChangeMs > poseNoChangeLimitMs &&
        !withinStartGrace
      ) {
        stopWithReason(
          'unavailable',
          `Guided Navigation V0 stopped because pose values stopped changing for ${(
            noPoseChangeMs / 1000
          ).toFixed(1)}s while still ${Math.round(command.distanceToGoalMm)} mm short of the target.`,
        )
        return
      }

      const streamCommand = stallRecoveryActive
        ? boostLinearCommand(command, GUIDED_NAV_STALL_RECOVERY_MIN_LINEAR_COMMAND)
        : command
      const protectedStreamCommand = applyDirectionalLidarLimit(streamCommand, lidarSafety)
      const elapsedRampMs =
        lastRampAtMsRef.current === null
          ? GUIDED_NAV_TICK_MS
          : Math.max(0, nowMs - lastRampAtMsRef.current)
      const rampedStreamCommand = rampCommandVector(
        appliedCommandRef.current,
        protectedStreamCommand,
        elapsedRampMs,
      )
      appliedCommandRef.current = rampedStreamCommand
      lastRampAtMsRef.current = nowMs

      const initialGoalDistanceMm =
        initialGoalDistanceMmRef.current ?? command.distanceToGoalMm
      const previousBestGoalDistanceMm =
        bestGoalDistanceMmRef.current ?? initialGoalDistanceMm
      const bestGoalDistanceMm = Math.min(previousBestGoalDistanceMm, command.distanceToGoalMm)
      const distanceProgressRatio =
        initialGoalDistanceMm <= GUIDED_NAV_GOAL_TOLERANCE_MM
          ? command.pathProgressRatio
          : clamp(
              (initialGoalDistanceMm - bestGoalDistanceMm) /
                Math.max(1, initialGoalDistanceMm - GUIDED_NAV_GOAL_TOLERANCE_MM),
              0,
              1,
            )
      const fusedProgressRatio = Math.max(command.pathProgressRatio, distanceProgressRatio)
      const fusedProgressMm = Math.max(
        command.pathProgressMm,
        command.totalPathLengthMm * fusedProgressRatio,
      )

      bestGoalDistanceMmRef.current = bestGoalDistanceMm
      pathProgressMmRef.current = fusedProgressMm

      setTelemetry({
        currentWaypointIndex: command.currentWaypointIndex,
        totalWaypoints: command.totalWaypoints,
        distanceToWaypointMm: command.distanceToWaypointMm,
        distanceToGoalMm: command.distanceToGoalMm,
        pathProgressMm: fusedProgressMm,
        pathProgressRatio: fusedProgressRatio,
        crossTrackErrorMm: command.crossTrackErrorMm,
        targetYawDeg: command.targetYawDeg,
        yawErrorDeg: command.yawErrorDeg,
        commandX: rampedStreamCommand.commandX,
        commandY: rampedStreamCommand.commandY,
        commandZ: rampedStreamCommand.commandZ,
        lidarSafetyState: lidarSafety.state,
        lidarSafetyScale: lidarSafety.scale,
        lidarSafetyDistanceMm: lidarSafety.distanceMm,
      })

      if (command.completed) {
        stopWithReason('completed', 'Guided Navigation V0 reached the preview target.')
        return
      }

      const runningMessage = commandRunningMessage(
        command.crossTrackErrorMm,
        stallRecoveryActive,
        command.distanceToGoalMm,
        command.yawErrorDeg,
        lidarSafety,
      )
      setMessage(runningMessage)
      setGuidedCommand({
        x: rampedStreamCommand.commandX,
        y: rampedStreamCommand.commandY,
        z: rampedStreamCommand.commandZ,
        message: runningMessage,
      })
    }

    tick()
    const interval = window.setInterval(tick, GUIDED_NAV_TICK_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      clearGuidedCommand()
    }
  }, [active, clearGuidedCommand, setGuidedCommand])

  return {
    status,
    active,
    canStart,
    startBlockedReasons,
    message,
    currentWaypointIndex: telemetry.currentWaypointIndex,
    totalWaypoints: telemetry.totalWaypoints,
    distanceToWaypointMm: telemetry.distanceToWaypointMm,
    distanceToGoalMm: telemetry.distanceToGoalMm,
    pathProgressMm: telemetry.pathProgressMm,
    pathProgressRatio: telemetry.pathProgressRatio,
    crossTrackErrorMm: telemetry.crossTrackErrorMm,
    targetYawDeg: telemetry.targetYawDeg,
    yawErrorDeg: telemetry.yawErrorDeg,
    commandX: telemetry.commandX,
    commandY: telemetry.commandY,
    commandZ: telemetry.commandZ,
    remoteMode: remoteDriver.mode,
    remoteInputSource: preview.inputSource,
    poseFreshness: selectedPose.pose.freshness,
    goalStatus: goalPreview.status,
    goalPathPoints: goalPreview.path.length,
    lidarSafetyState: telemetry.lidarSafetyState,
    lidarSafetyScale: telemetry.lidarSafetyScale,
    lidarSafetyDistanceMm: telemetry.lidarSafetyDistanceMm,
    lastStopMessage,
    startGuidedNavigation,
    stopGuidedNavigation,
  }
}
