import { createPlanarPoseData } from '../data/mockTelemetry'
import type {
  PlanarPoseData,
  PlanarPoseSource,
  PoseSourceOverride,
  SpatialLidarScan,
  SpatialSnapshot,
  TelemetryPoseSourceKey,
} from '../types/telemetry'

const MANUAL_SOURCE_BY_OVERRIDE: Record<Exclude<PoseSourceOverride, 'auto'>, TelemetryPoseSourceKey> = {
  odometry: 'odometry',
  reactive: 'reactive',
  mapeamento: 'mapeamento',
  simulation: 'simulation',
}

export const SPATIAL_POSE_SOURCE_LABELS: Record<PlanarPoseSource, string> = {
  odometry: 'Odometry',
  reactive: 'Reactive',
  mapeamento: 'Mapeamento',
  simulation: 'Simulation',
  none: 'None',
}

export const SPATIAL_POSE_OVERRIDE_OPTIONS: Array<{
  id: PoseSourceOverride
  label: string
  description: string
}> = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Prefer odometry first, then reactive, then mapeamento. Offline auto resolves to simulation.',
  },
  {
    id: 'odometry',
    label: 'Odometry',
    description: 'Session-local drivetrain odometry, independent from robot-side mapping.',
  },
  {
    id: 'reactive',
    label: 'Reactive',
    description: 'Pose emitted by reactive navigation when that stack is actively publishing.',
  },
  {
    id: 'mapeamento',
    label: 'Mapeamento',
    description: 'Optional debug pose from the mapping path. Not the default source for V1.',
  },
  {
    id: 'simulation',
    label: 'Simulation',
    description: 'Offline planar pose generated inside quente for replay-friendly testing.',
  },
]

export interface ResolvedSpatialPose {
  override: PoseSourceOverride
  pose: PlanarPoseData
  selectedSourceKey: TelemetryPoseSourceKey | null
  selectedSourceLabel: string
  isRenderable: boolean
  isLive: boolean
  ageMs: number | null
}

export type SpatialLidarRenderState =
  | 'ready'
  | 'unavailable'
  | 'pose-unavailable'
  | 'frame-mismatch'

export interface ResolvedSpatialLidar {
  scan: SpatialLidarScan
  renderState: SpatialLidarRenderState
  isRenderable: boolean
  isLive: boolean
  ageMs: number | null
  message: string
}

export interface SpatialLidarLocalPoint {
  angleDeg: number
  distanceMm: number
  xMm: number
  yMm: number
}

export interface SpatialLidarDiagnostics {
  renderState: SpatialLidarRenderState
  frameAligned: boolean
  selectedPoseFrame: string
  poseFrame: string
  sensorFrame: string
  sensorOffsetXMm: number
  sensorOffsetYMm: number
  sensorYawDeg: number
  pointCount: number
  validPointCount: number
  validRatio: number
  coverageStartDeg: number | null
  coverageEndDeg: number | null
  coverageSpanDeg: number
  assumedForwardAngleDeg: number | null
  frontDistanceMm: number | null
  leftNearestMm: number | null
  rightNearestMm: number | null
  nearestDistanceMm: number | null
}

export interface SpatialBufferedLidarSampleLike {
  timestampMs: number
  sequence: number
  frame: string
  poseFrame: string
  freshness: PlanarPoseData['freshness']
  pose: Pick<PlanarPoseData, 'xMm' | 'yMm' | 'yawDeg' | 'frame' | 'source'>
  points: SpatialLidarLocalPoint[]
}

export type SpatialRegistrationQuality = 'good' | 'fair' | 'poor' | 'insufficient'

export interface SpatialScanRegistration {
  available: boolean
  quality: SpatialRegistrationQuality
  message: string
  currentSequence: number | null
  referenceSequence: number | null
  currentTimestampMs: number | null
  referenceTimestampMs: number | null
  matchedPoints: number
  overlapRatio: number
  meanResidualMm: number | null
  odometryResidualMm: number | null
  improvementMm: number | null
  odometryDeltaXMm: number | null
  odometryDeltaYMm: number | null
  odometryDeltaYawDeg: number | null
  correctionXMm: number | null
  correctionYMm: number | null
  correctionYawDeg: number | null
  alignedReferencePoints: SpatialLidarLocalPoint[]
}

const REGISTRATION_X_OFFSETS_MM = [-120, -80, -40, 0, 40, 80, 120] as const
const REGISTRATION_Y_OFFSETS_MM = [-120, -80, -40, 0, 40, 80, 120] as const
const REGISTRATION_YAW_OFFSETS_DEG = [-10, -6, -3, 0, 3, 6, 10] as const
const REGISTRATION_MATCH_ANGLE_TOLERANCE_DEG = 8
const REGISTRATION_POINT_RESIDUAL_LIMIT_MM = 320
const REGISTRATION_MIN_MATCHES = 6
export const SPATIAL_LIDAR_SENSOR_OFFSET_X_MM = 0
export const SPATIAL_LIDAR_SENSOR_OFFSET_Y_MM = 91.84
export const SPATIAL_LIDAR_SENSOR_YAW_DEG = 0

export function resolvePoseSourceKey(override: PoseSourceOverride): TelemetryPoseSourceKey | null {
  if (override === 'auto') {
    return null
  }

  return MANUAL_SOURCE_BY_OVERRIDE[override]
}

export function poseSourceLabel(source: PlanarPoseSource) {
  return SPATIAL_POSE_SOURCE_LABELS[source] ?? source
}

export function isRenderablePlanarPose(pose: PlanarPoseData) {
  return pose.available && pose.freshness !== 'invalid'
}

export function isRenderableSpatialLidar(scan: SpatialLidarScan) {
  return (
    scan.available &&
    scan.freshness !== 'invalid' &&
    scan.pointCount > 0 &&
    scan.validPointCount > 0
  )
}

export function resolveSpatialPose(
  snapshot: SpatialSnapshot,
  override: PoseSourceOverride,
  nowMs = Date.now(),
): ResolvedSpatialPose {
  const selectedSourceKey = resolvePoseSourceKey(override)
  const fallbackPose = createPlanarPoseData(selectedSourceKey ?? 'none', {
    available: false,
    freshness: 'invalid',
  })
  const pose =
    override === 'auto'
      ? snapshot.pose ?? fallbackPose
      : snapshot.poseSources[MANUAL_SOURCE_BY_OVERRIDE[override]] ?? fallbackPose
  const ageMs = pose.timestampMs > 0 ? Math.max(0, nowMs - pose.timestampMs) : null

  return {
    override,
    pose,
    selectedSourceKey,
    selectedSourceLabel:
      override === 'auto'
        ? `Auto (${poseSourceLabel(pose.source)})`
        : poseSourceLabel(pose.source),
    isRenderable: isRenderablePlanarPose(pose),
    isLive: pose.available && pose.freshness === 'live',
    ageMs,
  }
}

export function decodeSpatialLidarPoints(scan: SpatialLidarScan): SpatialLidarLocalPoint[] {
  return scan.distancesMm.flatMap((rawDistanceMm, index) => {
    const distanceMm = Number(rawDistanceMm)
    if (!Number.isFinite(distanceMm) || distanceMm <= 0) {
      return []
    }

    const angleDeg = scan.angleStartDeg + index * scan.angleStepDeg

    // Atlas keeps 180 deg as forward, but the raw lateral handedness is mirrored
    // relative to the viewer body frame. We remap it here once so physical left
    // stays on the left side of the robot in every desktop spatial layer, then
    // shift the sample from the LiDAR origin into the robot frame.
    const relativeAngleRad = ((angleDeg - 180) * Math.PI) / 180
    const sensorLocalPoint = {
      xMm: Math.sin(relativeAngleRad) * distanceMm,
      yMm: Math.cos(relativeAngleRad) * distanceMm,
    }
    const rotatedPoint = rotateLocalPoint(sensorLocalPoint, SPATIAL_LIDAR_SENSOR_YAW_DEG)
    const robotLocalPoint = {
      xMm: rotatedPoint.xMm + SPATIAL_LIDAR_SENSOR_OFFSET_X_MM,
      yMm: rotatedPoint.yMm + SPATIAL_LIDAR_SENSOR_OFFSET_Y_MM,
    }
    const robotFrameDistanceMm = Math.hypot(robotLocalPoint.xMm, robotLocalPoint.yMm)

    return [
      {
        angleDeg: pointAngleDeg(robotLocalPoint),
        distanceMm: robotFrameDistanceMm,
        xMm: robotLocalPoint.xMm,
        yMm: robotLocalPoint.yMm,
      },
    ]
  })
}

export function resolveSpatialLidar(
  snapshot: SpatialSnapshot,
  selectedPose: ResolvedSpatialPose,
  nowMs = Date.now(),
): ResolvedSpatialLidar {
  const scan = snapshot.lidar
  const ageMs = scan.timestampMs > 0 ? Math.max(0, nowMs - scan.timestampMs) : null

  if (!isRenderableSpatialLidar(scan)) {
    return {
      scan,
      renderState: 'unavailable',
      isRenderable: false,
      isLive: false,
      ageMs,
      message: 'Compact lidar packet unavailable on the current spatial stream.',
    }
  }

  if (!selectedPose.isRenderable) {
    return {
      scan,
      renderState: 'pose-unavailable',
      isRenderable: false,
      isLive: scan.freshness === 'live',
      ageMs,
      message: 'Compact lidar packet available, but the selected pose cannot anchor it yet.',
    }
  }

  if (scan.poseFrame !== selectedPose.pose.frame) {
    return {
      scan,
      renderState: 'frame-mismatch',
      isRenderable: false,
      isLive: scan.freshness === 'live',
      ageMs,
      message: `Compact lidar is tied to ${scan.poseFrame}, while the selected pose is ${selectedPose.pose.frame}.`,
    }
  }

  return {
    scan,
    renderState: 'ready',
    isRenderable: true,
    isLive: scan.freshness === 'live',
    ageMs,
    message: `Compact lidar aligned to ${scan.poseFrame} and ready for the 2D scene.`,
  }
}

export function inspectSpatialLidar(
  selectedLidar: ResolvedSpatialLidar,
  selectedPose: ResolvedSpatialPose,
): SpatialLidarDiagnostics {
  const scan = selectedLidar.scan
  const points = decodeSpatialLidarPoints(scan)
  const pointCount = scan.pointCount || scan.distancesMm.length
  const validPointCount = scan.validPointCount || points.length
  const validRatio = pointCount > 0 ? validPointCount / pointCount : 0
  const coverageStartDeg = pointCount > 0 ? scan.angleStartDeg : null
  const coverageEndDeg =
    pointCount > 0 ? scan.angleStartDeg + scan.angleStepDeg * Math.max(0, pointCount - 1) : null
  const selectedPoseFrame = selectedPose.isRenderable ? selectedPose.pose.frame : 'none'
  const centerAngleDeg = 180
  const frontPoint = points.reduce<SpatialLidarLocalPoint | null>((best, point) => {
    if (!best) {
      return point
    }

    return Math.abs(point.angleDeg - centerAngleDeg) < Math.abs(best.angleDeg - centerAngleDeg)
      ? point
      : best
  }, null)
  const nearestPoint = points.reduce<SpatialLidarLocalPoint | null>((best, point) => {
    if (!best || point.distanceMm < best.distanceMm) {
      return point
    }

    return best
  }, null)
  const leftNearest = points.reduce<SpatialLidarLocalPoint | null>((best, point) => {
    if (point.angleDeg > centerAngleDeg) {
      return best
    }

    if (!best || point.distanceMm < best.distanceMm) {
      return point
    }

    return best
  }, null)
  const rightNearest = points.reduce<SpatialLidarLocalPoint | null>((best, point) => {
    if (point.angleDeg < centerAngleDeg) {
      return best
    }

    if (!best || point.distanceMm < best.distanceMm) {
      return point
    }

    return best
  }, null)

  return {
    renderState: selectedLidar.renderState,
    frameAligned: selectedLidar.renderState === 'ready',
    selectedPoseFrame,
    poseFrame: scan.poseFrame,
    sensorFrame: scan.frame,
    sensorOffsetXMm: SPATIAL_LIDAR_SENSOR_OFFSET_X_MM,
    sensorOffsetYMm: SPATIAL_LIDAR_SENSOR_OFFSET_Y_MM,
    sensorYawDeg: SPATIAL_LIDAR_SENSOR_YAW_DEG,
    pointCount,
    validPointCount,
    validRatio,
    coverageStartDeg,
    coverageEndDeg,
    coverageSpanDeg:
      coverageStartDeg !== null && coverageEndDeg !== null ? coverageEndDeg - coverageStartDeg : 0,
    assumedForwardAngleDeg: points.length > 0 ? centerAngleDeg : null,
    frontDistanceMm: frontPoint?.distanceMm ?? null,
    leftNearestMm: leftNearest?.distanceMm ?? null,
    rightNearestMm: rightNearest?.distanceMm ?? null,
    nearestDistanceMm: nearestPoint?.distanceMm ?? null,
  }
}

function localPointToWorld(
  point: Pick<SpatialLidarLocalPoint, 'xMm' | 'yMm'>,
  pose: Pick<PlanarPoseData, 'xMm' | 'yMm' | 'yawDeg'>,
) {
  const headingRad = (pose.yawDeg * Math.PI) / 180

  return {
    xMm: pose.xMm + point.xMm * Math.cos(headingRad) + point.yMm * Math.sin(headingRad),
    yMm: pose.yMm + point.yMm * Math.cos(headingRad) - point.xMm * Math.sin(headingRad),
  }
}

function worldPointToLocal(
  point: { xMm: number; yMm: number },
  pose: Pick<PlanarPoseData, 'xMm' | 'yMm' | 'yawDeg'>,
) {
  const headingRad = (pose.yawDeg * Math.PI) / 180
  const deltaXMm = point.xMm - pose.xMm
  const deltaYMm = point.yMm - pose.yMm

  return {
    xMm: deltaXMm * Math.cos(headingRad) - deltaYMm * Math.sin(headingRad),
    yMm: deltaXMm * Math.sin(headingRad) + deltaYMm * Math.cos(headingRad),
  }
}

function rotateLocalPoint(
  point: Pick<SpatialLidarLocalPoint, 'xMm' | 'yMm'>,
  yawDeg: number,
) {
  const headingRad = (yawDeg * Math.PI) / 180

  return {
    xMm: point.xMm * Math.cos(headingRad) + point.yMm * Math.sin(headingRad),
    yMm: point.yMm * Math.cos(headingRad) - point.xMm * Math.sin(headingRad),
  }
}

function pointAngleDeg(point: Pick<SpatialLidarLocalPoint, 'xMm' | 'yMm'>) {
  return 180 + (Math.atan2(point.xMm, point.yMm) * 180) / Math.PI
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

function transformReferencePointToCurrentLocal(
  point: SpatialLidarLocalPoint,
  reference: SpatialBufferedLidarSampleLike,
  current: SpatialBufferedLidarSampleLike,
) {
  const world = localPointToWorld(point, reference.pose)
  return worldPointToLocal(world, current.pose)
}

function correctedPoint(
  point: Pick<SpatialLidarLocalPoint, 'xMm' | 'yMm'>,
  correctionXMm: number,
  correctionYMm: number,
  correctionYawDeg: number,
) {
  const rotated = rotateLocalPoint(point, correctionYawDeg)

  return {
    xMm: rotated.xMm + correctionXMm,
    yMm: rotated.yMm + correctionYMm,
  }
}

function findNearestPointByAngle(
  targetAngleDeg: number,
  points: SpatialLidarLocalPoint[],
): {
  point: SpatialLidarLocalPoint | null
  angleDeltaDeg: number
} {
  let nearest: SpatialLidarLocalPoint | null = null
  let nearestAngleDelta = Number.POSITIVE_INFINITY

  points.forEach((point) => {
    const angleDeltaDeg = Math.abs(normalizeAngleDelta(point.angleDeg - targetAngleDeg))
    if (angleDeltaDeg < nearestAngleDelta) {
      nearest = point
      nearestAngleDelta = angleDeltaDeg
    }
  })

  return {
    point: nearest,
    angleDeltaDeg: nearestAngleDelta,
  }
}

function createUnavailableRegistration(message: string): SpatialScanRegistration {
  return {
    available: false,
    quality: 'insufficient',
    message,
    currentSequence: null,
    referenceSequence: null,
    currentTimestampMs: null,
    referenceTimestampMs: null,
    matchedPoints: 0,
    overlapRatio: 0,
    meanResidualMm: null,
    odometryResidualMm: null,
    improvementMm: null,
    odometryDeltaXMm: null,
    odometryDeltaYMm: null,
    odometryDeltaYawDeg: null,
    correctionXMm: null,
    correctionYMm: null,
    correctionYawDeg: null,
    alignedReferencePoints: [],
  }
}

function classifyRegistrationQuality(
  overlapRatio: number,
  meanResidualMm: number,
): SpatialRegistrationQuality {
  if (overlapRatio >= 0.58 && meanResidualMm <= 70) {
    return 'good'
  }

  if (overlapRatio >= 0.4 && meanResidualMm <= 130) {
    return 'fair'
  }

  return 'poor'
}

export function computeSpatialScanRegistration(
  current: SpatialBufferedLidarSampleLike | null,
  reference: SpatialBufferedLidarSampleLike | null,
): SpatialScanRegistration {
  if (!current || !reference) {
    return createUnavailableRegistration(
      'Need at least two aligned compact lidar samples before scan registration can run.',
    )
  }

  if (current.poseFrame !== reference.poseFrame || current.frame !== reference.frame) {
    return createUnavailableRegistration(
      'Current and reference lidar samples do not share the same pose or sensor frame.',
    )
  }

  if (current.points.length < REGISTRATION_MIN_MATCHES || reference.points.length < REGISTRATION_MIN_MATCHES) {
    return createUnavailableRegistration(
      'Current and reference lidar samples do not contain enough valid points for registration.',
    )
  }

  const odometryAlignedReferencePoints = reference.points.map((point) =>
    transformReferencePointToCurrentLocal(point, reference, current),
  )

  let bestScore = Number.POSITIVE_INFINITY
  let bestMatchedPoints = 0
  let bestOverlapRatio = 0
  let bestMeanResidualMm = Number.POSITIVE_INFINITY
  let bestCorrectionXMm = 0
  let bestCorrectionYMm = 0
  let bestCorrectionYawDeg = 0
  let bestAlignedReferencePoints: SpatialLidarLocalPoint[] = []
  let odometryResidualMm = Number.POSITIVE_INFINITY

  REGISTRATION_YAW_OFFSETS_DEG.forEach((correctionYawDeg) => {
    REGISTRATION_X_OFFSETS_MM.forEach((correctionXMm) => {
      REGISTRATION_Y_OFFSETS_MM.forEach((correctionYMm) => {
        let matchedPoints = 0
        let residualSumMm = 0
        const alignedReferencePoints: SpatialLidarLocalPoint[] = []

        odometryAlignedReferencePoints.forEach((point) => {
          const corrected = correctedPoint(point, correctionXMm, correctionYMm, correctionYawDeg)
          const correctedAngleDeg = pointAngleDeg(corrected)
          const nearest = findNearestPointByAngle(correctedAngleDeg, current.points)

          if (
            !nearest.point ||
            nearest.angleDeltaDeg > REGISTRATION_MATCH_ANGLE_TOLERANCE_DEG
          ) {
            return
          }

          const nearestPoint = nearest.point

          const residualMm = Math.hypot(
            nearestPoint.xMm - corrected.xMm,
            nearestPoint.yMm - corrected.yMm,
          )

          if (residualMm > REGISTRATION_POINT_RESIDUAL_LIMIT_MM) {
            return
          }

          matchedPoints += 1
          residualSumMm += residualMm
          alignedReferencePoints.push({
            angleDeg: correctedAngleDeg,
            distanceMm: Math.hypot(corrected.xMm, corrected.yMm),
            xMm: corrected.xMm,
            yMm: corrected.yMm,
          })
        })

        if (matchedPoints < REGISTRATION_MIN_MATCHES) {
          return
        }

        const overlapRatio =
          matchedPoints / Math.max(1, Math.min(reference.points.length, current.points.length))
        const meanResidualMm = residualSumMm / matchedPoints
        const score = meanResidualMm + (1 - overlapRatio) * 140

        if (correctionXMm === 0 && correctionYMm === 0 && correctionYawDeg === 0) {
          odometryResidualMm = meanResidualMm
        }

        if (score < bestScore) {
          bestScore = score
          bestMatchedPoints = matchedPoints
          bestOverlapRatio = overlapRatio
          bestMeanResidualMm = meanResidualMm
          bestCorrectionXMm = correctionXMm
          bestCorrectionYMm = correctionYMm
          bestCorrectionYawDeg = correctionYawDeg
          bestAlignedReferencePoints = alignedReferencePoints
        }
      })
    })
  })

  if (!Number.isFinite(bestMeanResidualMm) || bestMatchedPoints < REGISTRATION_MIN_MATCHES) {
    return createUnavailableRegistration(
      'Scan registration could not find a stable overlap between the current and reference samples.',
    )
  }

  const quality = classifyRegistrationQuality(bestOverlapRatio, bestMeanResidualMm)
  const improvementMm =
    Number.isFinite(odometryResidualMm) ? odometryResidualMm - bestMeanResidualMm : null
  const odometryDeltaXMm = current.pose.xMm - reference.pose.xMm
  const odometryDeltaYMm = current.pose.yMm - reference.pose.yMm
  const odometryDeltaYawDeg = normalizeAngleDelta(current.pose.yawDeg - reference.pose.yawDeg)
  const correctionMagnitudeMm = Math.hypot(bestCorrectionXMm, bestCorrectionYMm)
  const correctionMessage =
    Math.abs(bestCorrectionYawDeg) >= 3 || correctionMagnitudeMm >= 40
      ? ` Best fit suggests a correction of ${Math.round(bestCorrectionXMm)} mm, ${Math.round(bestCorrectionYMm)} mm and ${bestCorrectionYawDeg.toFixed(1)} deg.`
      : ''

  return {
    available: true,
    quality,
    message:
      quality === 'good'
        ? `Reference scan tracks the current sample coherently.${correctionMessage}`
        : quality === 'fair'
          ? `Reference scan still overlaps the current sample, but with moderate residual.${correctionMessage}`
          : `Reference scan fit is weak. Check sensor angle offset, odometry drift, or low-feature geometry.${correctionMessage}`,
    currentSequence: current.sequence,
    referenceSequence: reference.sequence,
    currentTimestampMs: current.timestampMs,
    referenceTimestampMs: reference.timestampMs,
    matchedPoints: bestMatchedPoints,
    overlapRatio: bestOverlapRatio,
    meanResidualMm: bestMeanResidualMm,
    odometryResidualMm: Number.isFinite(odometryResidualMm) ? odometryResidualMm : null,
    improvementMm,
    odometryDeltaXMm,
    odometryDeltaYMm,
    odometryDeltaYawDeg,
    correctionXMm: bestCorrectionXMm,
    correctionYMm: bestCorrectionYMm,
    correctionYawDeg: bestCorrectionYawDeg,
    alignedReferencePoints: bestAlignedReferencePoints,
  }
}

export function formatPoseAgeLabel(ageMs: number | null) {
  if (ageMs === null) {
    return '--'
  }

  if (ageMs < 1000) {
    return `${Math.round(ageMs)} ms`
  }

  return `${(ageMs / 1000).toFixed(ageMs >= 10_000 ? 0 : 1)} s`
}
