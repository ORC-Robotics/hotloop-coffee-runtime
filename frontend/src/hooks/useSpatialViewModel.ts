import { useEffect, useMemo, useRef, useState } from 'react'
import { clamp } from '../lib/format'
import {
  computeSpatialScanRegistration,
  decodeSpatialLidarPoints,
  inspectSpatialLidar,
  isRenderablePlanarPose,
  SPATIAL_LIDAR_SENSOR_OFFSET_X_MM,
  SPATIAL_LIDAR_SENSOR_OFFSET_Y_MM,
  type SpatialBufferedLidarSampleLike,
  type SpatialLidarDiagnostics,
  type SpatialLidarLocalPoint,
  type SpatialScanRegistration,
  resolveSpatialLidar,
  resolveSpatialPose,
  type ResolvedSpatialLidar,
  type ResolvedSpatialPose,
} from '../lib/spatialTelemetry'
import type {
  PlanarPoseData,
  PlanarPoseFreshness,
  PoseSourceOverride,
  SpatialSnapshot,
} from '../types/telemetry'

const DEFAULT_VIEWPORT = {
  centerXMm: 0,
  centerYMm: 0,
  zoomPxPerMm: 0.12,
  rotationDeg: 0,
}

const MIN_ZOOM_PX_PER_MM = 0.035
const MAX_ZOOM_PX_PER_MM = 0.72
const TRAIL_MAX_POINTS = 720
const TRAIL_APPEND_DISTANCE_MM = 24
const TRAIL_APPEND_YAW_DEG = 3
const LIDAR_HISTORY_MAX_SCANS = 12
const OBSERVED_MAP_HISTORY_LIMIT_DEFAULT = 48
const OBSERVED_MAP_HISTORY_LIMIT_OPTIONS = [24, 48, 96] as const
const OCCUPANCY_CELL_SIZE_DEFAULT_MM = 80
const OCCUPANCY_CELL_SIZE_OPTIONS_MM = [60, 80, 120, 160] as const
const GOAL_PREVIEW_TARGET_SNAP_RADIUS_CELLS = 5
const GOAL_PREVIEW_START_SNAP_RADIUS_CELLS = 5
const GOAL_PREVIEW_CLEARANCE_MM = 240
const GOAL_PREVIEW_PREFERRED_CLEARANCE_MM = 420
const GOAL_PREVIEW_MAX_SEARCH_EXPANSIONS = 18_000
const GOAL_PREVIEW_MIXED_CELL_COST = 1.8
const GOAL_PREVIEW_WALL_PROXIMITY_COST = 2.4
const GOAL_PREVIEW_SMOOTHING_SAMPLE_STEP_MM = 24
const GOAL_PREVIEW_SMOOTHING_MAX_PROXIMITY_COST = 0.45
const GOAL_PREVIEW_SMOOTHING_MAX_TRIM_MM = 54

export interface SpatialTrailPoint {
  xMm: number
  yMm: number
  yawDeg: number
  timestampMs: number
  source: PlanarPoseData['source']
  frame: string
}

export interface SpatialViewportState {
  centerXMm: number
  centerYMm: number
  zoomPxPerMm: number
  rotationDeg: number
}

export interface SpatialViewportSize {
  width: number
  height: number
}

export interface SpatialAnchorPoint {
  x: number
  y: number
}

export interface SpatialPoseTransitionState {
  previous: PlanarPoseData | null
  latest: PlanarPoseData | null
  receivedAtMs: number
  transitionMs: number
}

export interface SpatialBufferedLidarScan {
  timestampMs: number
  sequence: number
  frame: string
  poseFrame: string
  freshness: PlanarPoseFreshness
  pose: Pick<PlanarPoseData, 'xMm' | 'yMm' | 'yawDeg' | 'frame' | 'source'>
  points: SpatialLidarLocalPoint[]
}

export interface SpatialObservedMapPoint {
  xMm: number
  yMm: number
}

export interface SpatialObservedMapScan {
  timestampMs: number
  sequence: number
  frame: string
  poseFrame: string
  source: PlanarPoseData['source']
  originXMm: number
  originYMm: number
  pointCount: number
  points: SpatialObservedMapPoint[]
}

export type SpatialOccupancyDisplayMode = 'occupied-only' | 'free-and-occupied'

export interface SpatialOccupancyCell {
  gridX: number
  gridY: number
  centerXMm: number
  centerYMm: number
  freeCount: number
  occupiedCount: number
  state: 'free' | 'occupied' | 'mixed'
  confidence: number
}

export interface SpatialOccupancyLayer {
  frame: string
  cellSizeMm: number
  cells: SpatialOccupancyCell[]
  freeCellCount: number
  occupiedCellCount: number
  mixedCellCount: number
}

export type SpatialReplayMode = 'live' | 'history'

export interface SpatialReplaySelection {
  key: string
  index: number
  total: number
  ageMs: number | null
  scan: SpatialBufferedLidarScan
}

export interface SpatialPathPreviewPoint {
  xMm: number
  yMm: number
}

export type SpatialGoalPreviewStatus =
  | 'idle'
  | 'ready'
  | 'armed'
  | 'blocked'
  | 'unreachable'
  | 'unavailable'

export interface SpatialGoalPreviewTarget {
  requestedXMm: number
  requestedYMm: number
  snappedXMm: number
  snappedYMm: number
  gridX: number
  gridY: number
  cellState: 'free' | 'mixed'
  confidence: number
  snapDistanceMm: number
}

export interface SpatialGoalPreview {
  status: SpatialGoalPreviewStatus
  message: string
  frame: string
  requestedXMm: number | null
  requestedYMm: number | null
  targetYawDeg: number | null
  target: SpatialGoalPreviewTarget | null
  path: SpatialPathPreviewPoint[]
  waypointCount: number
  directDistanceMm: number | null
  pathLengthMm: number | null
  safetyBufferMm: number
}

interface SpatialGoalRequest {
  xMm: number
  yMm: number
}

interface UseSpatialViewModelOptions {
  goalTargetYawDeg?: number | null
  /** Start with the camera following the robot (embedded map panels). */
  followRobotByDefault?: boolean
}

interface SpatialGoalPlannerGrid {
  frame: string
  cellSizeMm: number
  cellsByKey: Map<string, SpatialOccupancyCell>
  blockedKeys: Set<string>
  proximityCostByKey: Map<string, number>
}

export interface SpatialViewModel {
  sourceOverride: PoseSourceOverride
  setSourceOverride: (override: PoseSourceOverride) => void
  selectedPose: ResolvedSpatialPose
  selectedLidar: ResolvedSpatialLidar
  lidarDiagnostics: SpatialLidarDiagnostics
  scanRegistration: SpatialScanRegistration
  sourceStates: SpatialSnapshot['poseSources']
  trail: SpatialTrailPoint[]
  displayTrail: SpatialTrailPoint[]
  lidarHistory: SpatialBufferedLidarScan[]
  displayLidarHistory: SpatialBufferedLidarScan[]
  observedMapScans: SpatialObservedMapScan[]
  displayObservedMapScans: SpatialObservedMapScan[]
  occupancySessionScanCount: number
  observedMapFrozen: boolean
  observedMapFadeOlderScans: boolean
  observedMapHistoryLimit: number
  observedMapHistoryLimitOptions: readonly number[]
  showOccupancyLayer: boolean
  toggleOccupancyLayer: () => void
  occupancyCellSizeMm: number
  occupancyCellSizeOptionsMm: readonly number[]
  setOccupancyCellSizeMm: (cellSizeMm: number) => void
  occupancyDisplayMode: SpatialOccupancyDisplayMode
  toggleOccupancyDisplayMode: () => void
  occupancyLayer: SpatialOccupancyLayer | null
  mazeOverlay: SpatialSnapshot['maze']
  goalPreview: SpatialGoalPreview
  selectGoalAtWorldPoint: (point: SpatialPathPreviewPoint) => void
  armGoalPreview: () => void
  disarmGoalPreview: () => void
  clearGoalPreview: () => void
  replayMode: SpatialReplayMode
  replaySelection: SpatialReplaySelection | null
  viewport: SpatialViewportState
  poseTransition: SpatialPoseTransitionState
  followRobot: boolean
  setFollowRobot: (follow: boolean) => void
  toggleFollowRobot: () => void
  centerOnRobot: () => void
  resetView: () => void
  clearTrail: () => void
  clearLidarHistory: () => void
  clearObservedMap: () => void
  toggleObservedMapFrozen: () => void
  toggleObservedMapFadeOlderScans: () => void
  setObservedMapHistoryLimit: (limit: number) => void
  enterReplayAtIndex: (index: number) => void
  stepReplay: (delta: number) => void
  returnToLive: () => void
  panViewport: (deltaXPx: number, deltaYPx: number) => void
  zoomViewport: (factor: number, anchor: SpatialAnchorPoint, viewportSize: SpatialViewportSize) => void
  rotateViewport: (deltaDeg: number) => void
  resetViewportRotation: () => void
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

function normalizeViewportRotation(value: number) {
  let next = value % 360

  if (next < 0) {
    next += 360
  }

  return next
}

function rotateViewVectorToWorld(
  xMm: number,
  yMm: number,
  rotationDeg: number,
) {
  const rotationRad = (rotationDeg * Math.PI) / 180
  const cosRotation = Math.cos(rotationRad)
  const sinRotation = Math.sin(rotationRad)

  return {
    xMm: xMm * cosRotation - yMm * sinRotation,
    yMm: xMm * sinRotation + yMm * cosRotation,
  }
}

function toTrailPoint(pose: PlanarPoseData): SpatialTrailPoint {
  return {
    xMm: pose.xMm,
    yMm: pose.yMm,
    yawDeg: pose.yawDeg,
    timestampMs: pose.timestampMs,
    source: pose.source,
    frame: pose.frame,
  }
}

function shouldAppendTrail(previous: SpatialTrailPoint | undefined, next: SpatialTrailPoint) {
  if (!previous) {
    return true
  }

  const distanceMm = Math.hypot(next.xMm - previous.xMm, next.yMm - previous.yMm)
  const headingDeltaDeg = Math.abs(normalizeAngleDelta(next.yawDeg - previous.yawDeg))

  return distanceMm >= TRAIL_APPEND_DISTANCE_MM || headingDeltaDeg >= TRAIL_APPEND_YAW_DEG
}

function poseTransitionChanged(previous: PlanarPoseData | null, next: PlanarPoseData) {
  if (!previous) {
    return true
  }

  return (
    previous.timestampMs !== next.timestampMs ||
    previous.sequence !== next.sequence ||
    previous.xMm !== next.xMm ||
    previous.yMm !== next.yMm ||
    previous.yawDeg !== next.yawDeg ||
    previous.freshness !== next.freshness ||
    previous.frame !== next.frame ||
    previous.source !== next.source
  )
}

function bufferedLidarKey(scan: SpatialBufferedLidarScan) {
  return `${scan.sequence}:${scan.timestampMs}:${scan.poseFrame}:${scan.frame}`
}

function replayPoseFromScan(scan: SpatialBufferedLidarScan): PlanarPoseData {
  return {
    available: true,
    source: scan.pose.source,
    xMm: scan.pose.xMm,
    yMm: scan.pose.yMm,
    yawDeg: scan.pose.yawDeg,
    timestampMs: scan.timestampMs,
    sequence: scan.sequence,
    freshness: scan.freshness === 'invalid' ? 'stale' : scan.freshness,
    frame: scan.pose.frame,
  }
}

function liveScanFromSelection(
  selectedLidar: ResolvedSpatialLidar,
  selectedPose: ResolvedSpatialPose,
): SpatialBufferedLidarScan | null {
  if (!selectedLidar.isRenderable || !selectedPose.isRenderable) {
    return null
  }

  const points = decodeSpatialLidarPoints(selectedLidar.scan)
  if (points.length === 0) {
    return null
  }

  return {
    timestampMs: selectedLidar.scan.timestampMs,
    sequence: selectedLidar.scan.sequence,
    frame: selectedLidar.scan.frame,
    poseFrame: selectedLidar.scan.poseFrame,
    freshness: selectedLidar.scan.freshness,
    pose: {
      xMm: selectedPose.pose.xMm,
      yMm: selectedPose.pose.yMm,
      yawDeg: selectedPose.pose.yawDeg,
      frame: selectedPose.pose.frame,
      source: selectedPose.pose.source,
    },
    points,
  }
}

function robotLocalPointToWorld(
  point: Pick<SpatialLidarLocalPoint, 'xMm' | 'yMm'>,
  pose: Pick<PlanarPoseData, 'xMm' | 'yMm' | 'yawDeg'>,
) {
  const headingRad = (pose.yawDeg * Math.PI) / 180

  return {
    xMm: pose.xMm + point.xMm * Math.cos(headingRad) + point.yMm * Math.sin(headingRad),
    yMm: pose.yMm + point.yMm * Math.cos(headingRad) - point.xMm * Math.sin(headingRad),
  }
}

function occupancyCellKey(gridX: number, gridY: number) {
  return `${gridX}:${gridY}`
}

function occupancyCellIndices(xMm: number, yMm: number, cellSizeMm: number) {
  return {
    gridX: Math.floor(xMm / cellSizeMm),
    gridY: Math.floor(yMm / cellSizeMm),
  }
}

function occupancyCellCenterMm(gridX: number, gridY: number, cellSizeMm: number) {
  return {
    centerXMm: (gridX + 0.5) * cellSizeMm,
    centerYMm: (gridY + 0.5) * cellSizeMm,
  }
}

function computeOccupancyLayer(
  scans: SpatialObservedMapScan[],
  cellSizeMm: number,
  displayMode: SpatialOccupancyDisplayMode,
): SpatialOccupancyLayer | null {
  if (scans.length === 0) {
    return null
  }

  const cells = new Map<string, { gridX: number; gridY: number; freeCount: number; occupiedCount: number }>()
  const stepLengthMm = Math.max(20, cellSizeMm * 0.45)

  scans.forEach((scan) => {
    scan.points.forEach((point) => {
      const dxMm = point.xMm - scan.originXMm
      const dyMm = point.yMm - scan.originYMm
      const distanceMm = Math.hypot(dxMm, dyMm)
      const freeVisited = new Set<string>()

      if (distanceMm > 1) {
        const steps = Math.max(1, Math.ceil(distanceMm / stepLengthMm))
        for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
          const t = stepIndex / steps
          const sampleXMm = scan.originXMm + dxMm * t
          const sampleYMm = scan.originYMm + dyMm * t
          const { gridX, gridY } = occupancyCellIndices(sampleXMm, sampleYMm, cellSizeMm)
          const key = occupancyCellKey(gridX, gridY)
          if (freeVisited.has(key)) {
            continue
          }

          freeVisited.add(key)
          const current = cells.get(key) ?? { gridX, gridY, freeCount: 0, occupiedCount: 0 }
          current.freeCount += 1
          cells.set(key, current)
        }
      }

      const occupiedIndices = occupancyCellIndices(point.xMm, point.yMm, cellSizeMm)
      const occupiedKey = occupancyCellKey(occupiedIndices.gridX, occupiedIndices.gridY)
      const occupiedCell =
        cells.get(occupiedKey) ??
        {
          gridX: occupiedIndices.gridX,
          gridY: occupiedIndices.gridY,
          freeCount: 0,
          occupiedCount: 0,
        }
      occupiedCell.occupiedCount += 3
      cells.set(occupiedKey, occupiedCell)
    })
  })

  const layerCells: SpatialOccupancyCell[] = []
  let freeCellCount = 0
  let occupiedCellCount = 0
  let mixedCellCount = 0

  cells.forEach((cell) => {
    const total = cell.freeCount + cell.occupiedCount
    if (total <= 0) {
      return
    }

    const occupiedRatio = cell.occupiedCount / total
    const freeRatio = cell.freeCount / total
    const state =
      occupiedRatio >= 0.58
        ? 'occupied'
        : freeRatio >= 0.72
          ? 'free'
          : 'mixed'

    if (displayMode === 'occupied-only' && state === 'free') {
      return
    }

    if (state === 'occupied') {
      occupiedCellCount += 1
    } else if (state === 'free') {
      freeCellCount += 1
    } else {
      mixedCellCount += 1
    }

    const center = occupancyCellCenterMm(cell.gridX, cell.gridY, cellSizeMm)
    layerCells.push({
      gridX: cell.gridX,
      gridY: cell.gridY,
      centerXMm: center.centerXMm,
      centerYMm: center.centerYMm,
      freeCount: cell.freeCount,
      occupiedCount: cell.occupiedCount,
      state,
      confidence: Math.min(1, total / 10),
    })
  })

  if (layerCells.length === 0) {
    return null
  }

  return {
    frame: scans[scans.length - 1]?.frame ?? 'none',
    cellSizeMm,
    cells: layerCells,
    freeCellCount,
    occupiedCellCount,
    mixedCellCount,
  }
}

function buildGoalPlannerGrid(layer: SpatialOccupancyLayer | null): SpatialGoalPlannerGrid | null {
  if (!layer || layer.cells.length === 0) {
    return null
  }

  const cellsByKey = new Map<string, SpatialOccupancyCell>()
  layer.cells.forEach((cell) => {
    cellsByKey.set(occupancyCellKey(cell.gridX, cell.gridY), cell)
  })

  const blockedKeys = new Set<string>()
  const proximityCostByKey = new Map<string, number>()
  const hardInflationRadiusCells = Math.max(
    1,
    Math.ceil(GOAL_PREVIEW_CLEARANCE_MM / layer.cellSizeMm),
  )
  const preferredInflationRadiusCells = Math.max(
    hardInflationRadiusCells,
    Math.ceil(GOAL_PREVIEW_PREFERRED_CLEARANCE_MM / layer.cellSizeMm),
  )

  layer.cells.forEach((cell) => {
    if (cell.state !== 'occupied') {
      return
    }

    for (
      let deltaX = -preferredInflationRadiusCells;
      deltaX <= preferredInflationRadiusCells;
      deltaX += 1
    ) {
      for (
        let deltaY = -preferredInflationRadiusCells;
        deltaY <= preferredInflationRadiusCells;
        deltaY += 1
      ) {
        const distanceCells = Math.hypot(deltaX, deltaY)
        if (distanceCells > preferredInflationRadiusCells) {
          continue
        }

        const key = occupancyCellKey(cell.gridX + deltaX, cell.gridY + deltaY)
        if (distanceCells <= hardInflationRadiusCells) {
          blockedKeys.add(key)
          continue
        }

        const clearanceRatio =
          (preferredInflationRadiusCells - distanceCells) /
          Math.max(1, preferredInflationRadiusCells - hardInflationRadiusCells)
        const cost = clamp(clearanceRatio, 0, 1) * GOAL_PREVIEW_WALL_PROXIMITY_COST
        proximityCostByKey.set(key, Math.max(proximityCostByKey.get(key) ?? 0, cost))
      }
    }
  })

  return {
    frame: layer.frame,
    cellSizeMm: layer.cellSizeMm,
    cellsByKey,
    blockedKeys,
    proximityCostByKey,
  }
}

function plannerCellTraversable(grid: SpatialGoalPlannerGrid, key: string) {
  const cell = grid.cellsByKey.get(key)
  if (!cell) {
    return false
  }

  if (cell.state === 'occupied') {
    return false
  }

  return !grid.blockedKeys.has(key)
}

function findNearestPlannerCell(
  grid: SpatialGoalPlannerGrid,
  xMm: number,
  yMm: number,
  maxRadiusCells: number,
) {
  const baseIndices = occupancyCellIndices(xMm, yMm, grid.cellSizeMm)

  for (let radius = 0; radius <= maxRadiusCells; radius += 1) {
    let bestCell: SpatialOccupancyCell | null = null
    let bestScore = Number.POSITIVE_INFINITY

    for (let deltaX = -radius; deltaX <= radius; deltaX += 1) {
      for (let deltaY = -radius; deltaY <= radius; deltaY += 1) {
        const key = occupancyCellKey(baseIndices.gridX + deltaX, baseIndices.gridY + deltaY)
        if (!plannerCellTraversable(grid, key)) {
          continue
        }

        const candidate = grid.cellsByKey.get(key)
        if (!candidate) {
          continue
        }

        const distanceMm = Math.hypot(candidate.centerXMm - xMm, candidate.centerYMm - yMm)
        const score =
          distanceMm + (candidate.state === 'mixed' ? grid.cellSizeMm * 0.8 : 0)

        if (score < bestScore) {
          bestCell = candidate
          bestScore = score
        }
      }
    }

    if (bestCell) {
      return bestCell
    }
  }

  return null
}

function simplifyPlannerCellPath(path: SpatialOccupancyCell[]) {
  if (path.length <= 2) {
    return path
  }

  const simplified = [path[0]]

  for (let index = 1; index < path.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1]
    const current = path[index]
    const next = path[index + 1]

    const previousDirection = {
      x: Math.sign(current.gridX - previous.gridX),
      y: Math.sign(current.gridY - previous.gridY),
    }
    const nextDirection = {
      x: Math.sign(next.gridX - current.gridX),
      y: Math.sign(next.gridY - current.gridY),
    }

    if (previousDirection.x === nextDirection.x && previousDirection.y === nextDirection.y) {
      continue
    }

    simplified.push(current)
  }

  simplified.push(path[path.length - 1])
  return simplified
}

function optimizePlannerCellPath(
  path: SpatialOccupancyCell[],
  _grid: SpatialGoalPlannerGrid,
) {
  // Keep V1 conservative: we preserve the A* cell corridor and only allow
  // local corner smoothing when the buffered segment stays inside safe space.
  return path
}

function plannerWorldSegmentSafe(
  grid: SpatialGoalPlannerGrid,
  start: SpatialPathPreviewPoint,
  end: SpatialPathPreviewPoint,
  maxProximityCost = GOAL_PREVIEW_SMOOTHING_MAX_PROXIMITY_COST,
) {
  const segmentLengthMm = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm)
  const steps = Math.max(
    1,
    Math.ceil(segmentLengthMm / Math.max(1, GOAL_PREVIEW_SMOOTHING_SAMPLE_STEP_MM)),
  )
  const visitedKeys = new Set<string>()

  for (let stepIndex = 0; stepIndex <= steps; stepIndex += 1) {
    const ratio = stepIndex / steps
    const sampleXMm = start.xMm + (end.xMm - start.xMm) * ratio
    const sampleYMm = start.yMm + (end.yMm - start.yMm) * ratio
    const sampleIndices = occupancyCellIndices(sampleXMm, sampleYMm, grid.cellSizeMm)
    const key = occupancyCellKey(sampleIndices.gridX, sampleIndices.gridY)

    if (visitedKeys.has(key)) {
      continue
    }

    visitedKeys.add(key)
    if (!plannerCellTraversable(grid, key)) {
      return false
    }

    if ((grid.proximityCostByKey.get(key) ?? 0) > maxProximityCost) {
      return false
    }
  }

  return true
}

function appendUniquePathPoint(
  points: SpatialPathPreviewPoint[],
  point: SpatialPathPreviewPoint,
  minimumDistanceMm = 6,
) {
  const previous = points[points.length - 1]
  if (
    previous &&
    Math.hypot(previous.xMm - point.xMm, previous.yMm - point.yMm) < minimumDistanceMm
  ) {
    return
  }

  points.push(point)
}

function smoothPathPreviewPoints(
  points: SpatialPathPreviewPoint[],
  cellSizeMm: number,
  grid: SpatialGoalPlannerGrid,
) {
  if (points.length <= 2) {
    return points
  }

  const smoothed: SpatialPathPreviewPoint[] = [points[0]]
  const trimBaseMm = Math.max(24, Math.min(cellSizeMm * 0.3, GOAL_PREVIEW_SMOOTHING_MAX_TRIM_MM))

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const next = points[index + 1]
    const previousDeltaXMm = current.xMm - previous.xMm
    const previousDeltaYMm = current.yMm - previous.yMm
    const nextDeltaXMm = next.xMm - current.xMm
    const nextDeltaYMm = next.yMm - current.yMm
    const previousLengthMm = Math.hypot(previousDeltaXMm, previousDeltaYMm)
    const nextLengthMm = Math.hypot(nextDeltaXMm, nextDeltaYMm)

    if (previousLengthMm <= 1 || nextLengthMm <= 1) {
      appendUniquePathPoint(smoothed, current)
      continue
    }

    const previousDirectionX = previousDeltaXMm / previousLengthMm
    const previousDirectionY = previousDeltaYMm / previousLengthMm
    const nextDirectionX = nextDeltaXMm / nextLengthMm
    const nextDirectionY = nextDeltaYMm / nextLengthMm
    const directionAlignment =
      previousDirectionX * nextDirectionX + previousDirectionY * nextDirectionY

    if (directionAlignment >= 0.985) {
      appendUniquePathPoint(smoothed, current)
      continue
    }

    const trimMm = Math.min(
      trimBaseMm,
      previousLengthMm * 0.35,
      nextLengthMm * 0.35,
    )

    if (trimMm < 12) {
      appendUniquePathPoint(smoothed, current)
      continue
    }

    const entryPoint = {
      xMm: current.xMm - previousDirectionX * trimMm,
      yMm: current.yMm - previousDirectionY * trimMm,
    }
    const exitPoint = {
      xMm: current.xMm + nextDirectionX * trimMm,
      yMm: current.yMm + nextDirectionY * trimMm,
    }

    if (!plannerWorldSegmentSafe(grid, entryPoint, exitPoint)) {
      appendUniquePathPoint(smoothed, current)
      continue
    }

    appendUniquePathPoint(smoothed, entryPoint)
    appendUniquePathPoint(smoothed, exitPoint)
  }

  appendUniquePathPoint(smoothed, points[points.length - 1])
  return smoothed
}

function computePathLengthMm(points: SpatialPathPreviewPoint[]) {
  if (points.length < 2) {
    return 0
  }

  let totalMm = 0
  for (let index = 1; index < points.length; index += 1) {
    totalMm += Math.hypot(
      points[index].xMm - points[index - 1].xMm,
      points[index].yMm - points[index - 1].yMm,
    )
  }

  return totalMm
}

function buildGoalPreviewUnavailable(
  status: Extract<SpatialGoalPreviewStatus, 'idle' | 'blocked' | 'unreachable' | 'unavailable'>,
  message: string,
  request: SpatialGoalRequest | null,
  targetYawDeg: number | null,
  frame = 'none',
): SpatialGoalPreview {
  return {
    status,
    message,
    frame,
    requestedXMm: request?.xMm ?? null,
    requestedYMm: request?.yMm ?? null,
    targetYawDeg,
    target: null,
    path: [],
    waypointCount: 0,
    directDistanceMm: null,
    pathLengthMm: null,
    safetyBufferMm: GOAL_PREVIEW_CLEARANCE_MM,
  }
}

function computeGoalPreview(
  request: SpatialGoalRequest | null,
  armed: boolean,
  pose: PlanarPoseData,
  grid: SpatialGoalPlannerGrid | null,
  targetYawDeg: number | null,
): SpatialGoalPreview {
  if (!request) {
    return buildGoalPreviewUnavailable(
      'idle',
      'Click a visited free area to preview a desktop-side route through the current occupancy layer.',
      null,
      targetYawDeg,
      grid?.frame ?? pose.frame,
    )
  }

  if (!isRenderablePlanarPose(pose)) {
    return buildGoalPreviewUnavailable(
      'unavailable',
      'Need a valid planar pose before the goal preview can resolve a start cell.',
      request,
      targetYawDeg,
    )
  }

  if (!grid) {
    return buildGoalPreviewUnavailable(
      'unavailable',
      'Need occupancy coverage before the goal preview can evaluate a reachable target.',
      request,
      targetYawDeg,
      pose.frame,
    )
  }

  if (pose.frame !== grid.frame) {
    return buildGoalPreviewUnavailable(
      'unavailable',
      'The selected pose frame no longer matches the active occupancy frame.',
      request,
      targetYawDeg,
      grid.frame,
    )
  }

  const startCell = findNearestPlannerCell(
    grid,
    pose.xMm,
    pose.yMm,
    GOAL_PREVIEW_START_SNAP_RADIUS_CELLS,
  )

  if (!startCell) {
    return buildGoalPreviewUnavailable(
      'unavailable',
      'The robot is not currently sitting inside a traversable free-space island in the desktop occupancy layer.',
      request,
      targetYawDeg,
      grid.frame,
    )
  }

  const targetCell = findNearestPlannerCell(
    grid,
    request.xMm,
    request.yMm,
    GOAL_PREVIEW_TARGET_SNAP_RADIUS_CELLS,
  )

  if (!targetCell) {
    return buildGoalPreviewUnavailable(
      'blocked',
      'The clicked point is outside the mapped free space or too close to an occupied safety buffer.',
      request,
      targetYawDeg,
      grid.frame,
    )
  }

  const startKey = occupancyCellKey(startCell.gridX, startCell.gridY)
  const goalKey = occupancyCellKey(targetCell.gridX, targetCell.gridY)
  const heuristic = (cell: SpatialOccupancyCell) =>
    Math.hypot(targetCell.gridX - cell.gridX, targetCell.gridY - cell.gridY) * grid.cellSizeMm

  const openKeys = new Set<string>([startKey])
  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>([[startKey, 0]])
  const fScore = new Map<string, number>([[startKey, heuristic(startCell)]])
  let expandedNodes = 0

  while (openKeys.size > 0 && expandedNodes < GOAL_PREVIEW_MAX_SEARCH_EXPANSIONS) {
    let currentKey: string | null = null
    let currentScore = Number.POSITIVE_INFINITY

    openKeys.forEach((key) => {
      const score = fScore.get(key) ?? Number.POSITIVE_INFINITY
      if (score < currentScore) {
        currentScore = score
        currentKey = key
      }
    })

    if (!currentKey) {
      break
    }

    const activeKey = currentKey

    if (activeKey === goalKey) {
      const pathCells: SpatialOccupancyCell[] = []
      let cursor: string | null = activeKey

      while (cursor) {
        const cell = grid.cellsByKey.get(cursor)
        if (!cell) {
          break
        }

        pathCells.unshift(cell)
        cursor = cameFrom.get(cursor) ?? null
      }

      const simplifiedPath = simplifyPlannerCellPath(pathCells)
      const optimizedPath = optimizePlannerCellPath(simplifiedPath, grid)
      const rawPath: SpatialPathPreviewPoint[] = [{ xMm: pose.xMm, yMm: pose.yMm }]

      optimizedPath.slice(1).forEach((cell) => {
        rawPath.push({
          xMm: cell.centerXMm,
          yMm: cell.centerYMm,
        })
      })

      const lastRawPathPoint = rawPath[rawPath.length - 1]
      if (
        !lastRawPathPoint ||
        Math.hypot(lastRawPathPoint.xMm - targetCell.centerXMm, lastRawPathPoint.yMm - targetCell.centerYMm) > 1
      ) {
        rawPath.push({
          xMm: targetCell.centerXMm,
          yMm: targetCell.centerYMm,
        })
      }

      const path = smoothPathPreviewPoints(rawPath, grid.cellSizeMm, grid)

      const lastPathPoint = path[path.length - 1]
      if (
        !lastPathPoint ||
        Math.hypot(lastPathPoint.xMm - targetCell.centerXMm, lastPathPoint.yMm - targetCell.centerYMm) > 1
      ) {
        path.push({
          xMm: targetCell.centerXMm,
          yMm: targetCell.centerYMm,
        })
      }

      const target = {
        requestedXMm: request.xMm,
        requestedYMm: request.yMm,
        snappedXMm: targetCell.centerXMm,
        snappedYMm: targetCell.centerYMm,
        gridX: targetCell.gridX,
        gridY: targetCell.gridY,
        cellState: targetCell.state === 'mixed' ? 'mixed' : 'free',
        confidence: targetCell.confidence,
        snapDistanceMm: Math.hypot(
          targetCell.centerXMm - request.xMm,
          targetCell.centerYMm - request.yMm,
        ),
      } satisfies SpatialGoalPreviewTarget

      return {
        status: armed ? 'armed' : 'ready',
        message: `${
          armed
            ? 'Goal preview armed locally. No robot command is sent yet; this is ready for the guided-navigation execution phase.'
            : target.snapDistanceMm > grid.cellSizeMm * 0.4
              ? `Preview path computed. The click was snapped ${Math.round(target.snapDistanceMm)} mm to the nearest traversable cell. Press N to arm it.`
              : 'Preview path computed. Press N to arm this target locally or Esc to clear it.'
        }${targetYawDeg === null ? '' : ` Final heading locked to ${Math.round(targetYawDeg)} deg.`}`,
        frame: grid.frame,
        requestedXMm: request.xMm,
        requestedYMm: request.yMm,
        targetYawDeg,
        target,
        path,
        waypointCount: Math.max(0, path.length - 1),
        directDistanceMm: Math.hypot(target.snappedXMm - pose.xMm, target.snappedYMm - pose.yMm),
        pathLengthMm: computePathLengthMm(path),
        safetyBufferMm: GOAL_PREVIEW_CLEARANCE_MM,
      }
    }

    openKeys.delete(activeKey)
    expandedNodes += 1

    const currentCell = grid.cellsByKey.get(activeKey)
    if (!currentCell) {
      continue
    }

    const currentCost = gScore.get(activeKey) ?? Number.POSITIVE_INFINITY
    const neighborOffsets = [
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: -1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]

    neighborOffsets.forEach((offset) => {
      const neighborKey = occupancyCellKey(currentCell.gridX + offset.x, currentCell.gridY + offset.y)
      if (!plannerCellTraversable(grid, neighborKey)) {
        return
      }

      if (offset.x !== 0 && offset.y !== 0) {
        const horizontalKey = occupancyCellKey(currentCell.gridX + offset.x, currentCell.gridY)
        const verticalKey = occupancyCellKey(currentCell.gridX, currentCell.gridY + offset.y)
        if (
          !plannerCellTraversable(grid, horizontalKey) ||
          !plannerCellTraversable(grid, verticalKey)
        ) {
          return
        }
      }

      const neighborCell = grid.cellsByKey.get(neighborKey)
      if (!neighborCell) {
        return
      }

      const stepDistanceMm = Math.hypot(offset.x, offset.y) * grid.cellSizeMm
      const proximityCost = grid.proximityCostByKey.get(neighborKey) ?? 0
      const stepCost =
        stepDistanceMm *
        (neighborCell.state === 'mixed' ? GOAL_PREVIEW_MIXED_CELL_COST : 1) *
        (1 + proximityCost)
      const tentativeCost = currentCost + stepCost

      if (tentativeCost >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        return
      }

      cameFrom.set(neighborKey, activeKey)
      gScore.set(neighborKey, tentativeCost)
      fScore.set(neighborKey, tentativeCost + heuristic(neighborCell))
      openKeys.add(neighborKey)
    })
  }

  return buildGoalPreviewUnavailable(
    'unreachable',
    'A clean route through the currently mapped free-space cells could not be found for this target yet.',
    request,
    targetYawDeg,
    grid.frame,
  )
}

function observedMapScanFromSelection(
  selectedLidar: ResolvedSpatialLidar,
  selectedPose: ResolvedSpatialPose,
): SpatialObservedMapScan | null {
  if (!selectedLidar.isRenderable || !selectedPose.isRenderable) {
    return null
  }

  const robotLocalPoints = decodeSpatialLidarPoints(selectedLidar.scan)
  if (robotLocalPoints.length === 0) {
    return null
  }

  const sensorOrigin = robotLocalPointToWorld(
    {
      xMm: SPATIAL_LIDAR_SENSOR_OFFSET_X_MM,
      yMm: SPATIAL_LIDAR_SENSOR_OFFSET_Y_MM,
    },
    selectedPose.pose,
  )

  return {
    timestampMs: selectedLidar.scan.timestampMs,
    sequence: selectedLidar.scan.sequence,
    frame: selectedPose.pose.frame,
    poseFrame: selectedLidar.scan.poseFrame,
    source: selectedPose.pose.source,
    originXMm: sensorOrigin.xMm,
    originYMm: sensorOrigin.yMm,
    pointCount: robotLocalPoints.length,
    points: robotLocalPoints.map((point) => robotLocalPointToWorld(point, selectedPose.pose)),
  }
}

export function useSpatialViewModel(
  snapshot: SpatialSnapshot,
  options: UseSpatialViewModelOptions = {},
): SpatialViewModel {
  const [sourceOverride, setSourceOverride] = useState<PoseSourceOverride>('auto')
  const [viewport, setViewport] = useState<SpatialViewportState>(DEFAULT_VIEWPORT)
  const [followRobot, setFollowRobotState] = useState(options.followRobotByDefault ?? false)
  const [trail, setTrail] = useState<SpatialTrailPoint[]>([])
  const [lidarHistory, setLidarHistory] = useState<SpatialBufferedLidarScan[]>([])
  const [observedMapScans, setObservedMapScans] = useState<SpatialObservedMapScan[]>([])
  const [occupancySessionScans, setOccupancySessionScans] = useState<SpatialObservedMapScan[]>([])
  const [observedMapFrozen, setObservedMapFrozen] = useState(false)
  const [observedMapFadeOlderScans, setObservedMapFadeOlderScans] = useState(true)
  const [observedMapHistoryLimit, setObservedMapHistoryLimitState] = useState(
    OBSERVED_MAP_HISTORY_LIMIT_DEFAULT,
  )
  const [showOccupancyLayer, setShowOccupancyLayer] = useState(true)
  const [occupancyCellSizeMm, setOccupancyCellSizeMmState] = useState(
    OCCUPANCY_CELL_SIZE_DEFAULT_MM,
  )
  const [occupancyDisplayMode, setOccupancyDisplayMode] =
    useState<SpatialOccupancyDisplayMode>('free-and-occupied')
  const [goalRequest, setGoalRequest] = useState<SpatialGoalRequest | null>(null)
  const [goalPreviewArmed, setGoalPreviewArmed] = useState(false)
  const [replayKey, setReplayKey] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [poseTransition, setPoseTransition] = useState<SpatialPoseTransitionState>(() => ({
    previous: null,
    latest: null,
    receivedAtMs: performance.now(),
    transitionMs: 0,
  }))
  const trailContextRef = useRef<string | null>(null)
  const lidarContextRef = useRef<string | null>(null)
  const observedMapContextRef = useRef<string | null>(null)
  const goalContextRef = useRef<string | null>(null)
  const lastLidarKeyRef = useRef<string | null>(null)
  const lastObservedMapKeyRef = useRef<string | null>(null)
  const hasAutoCenteredRef = useRef(false)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now())
    }, 250)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  const selectedPose = useMemo(
    () => resolveSpatialPose(snapshot, sourceOverride, nowMs),
    [nowMs, snapshot, sourceOverride],
  )
  const selectedLidar = useMemo(
    () => resolveSpatialLidar(snapshot, selectedPose, nowMs),
    [nowMs, selectedPose, snapshot],
  )
  const lidarDiagnostics = useMemo(
    () => inspectSpatialLidar(selectedLidar, selectedPose),
    [selectedLidar, selectedPose],
  )
  const replaySelection = useMemo<SpatialReplaySelection | null>(() => {
    if (!replayKey || lidarHistory.length === 0) {
      return null
    }

    const index = lidarHistory.findIndex((scan) => bufferedLidarKey(scan) === replayKey)
    if (index < 0) {
      return null
    }

    const scan = lidarHistory[index]
    return {
      key: replayKey,
      index,
      total: lidarHistory.length,
      ageMs: scan.timestampMs > 0 ? Math.max(0, nowMs - scan.timestampMs) : null,
      scan,
    }
  }, [lidarHistory, nowMs, replayKey])
  const replayMode: SpatialReplayMode = replaySelection ? 'history' : 'live'
  const activePose = replaySelection ? replayPoseFromScan(replaySelection.scan) : selectedPose.pose
  const goalTargetYawDeg =
    typeof options.goalTargetYawDeg === 'number' && Number.isFinite(options.goalTargetYawDeg)
      ? normalizeAngleDelta(options.goalTargetYawDeg)
      : null
  const displayTrail = useMemo(() => {
    if (!replaySelection) {
      return trail
    }

    return trail.filter((point) => point.timestampMs <= replaySelection.scan.timestampMs)
  }, [replaySelection, trail])
  const displayLidarHistory = useMemo(() => {
    if (replaySelection) {
      return lidarHistory.slice(0, replaySelection.index)
    }

    if (lidarHistory.length === 0) {
      return []
    }

    const currentLiveKey = selectedLidar.isRenderable
      ? `${selectedLidar.scan.sequence}:${selectedLidar.scan.timestampMs}:${selectedLidar.scan.poseFrame}:${selectedLidar.scan.frame}`
      : null
    const latestBufferedKey = bufferedLidarKey(lidarHistory[lidarHistory.length - 1])

    return currentLiveKey !== null && latestBufferedKey === currentLiveKey
      ? lidarHistory.slice(0, -1)
      : lidarHistory
  }, [lidarHistory, replaySelection, selectedLidar])
  const displayObservedMapScans = useMemo(() => {
    if (!replaySelection) {
      return observedMapScans
    }

    return observedMapScans.filter((scan) => scan.timestampMs <= replaySelection.scan.timestampMs)
  }, [observedMapScans, replaySelection])
  const occupancySourceScans = useMemo(() => {
    if (replaySelection) {
      return displayObservedMapScans
    }

    return occupancySessionScans
  }, [displayObservedMapScans, occupancySessionScans, replaySelection])
  const plannerOccupancyLayer = useMemo(() => {
    return computeOccupancyLayer(
      occupancySourceScans,
      occupancyCellSizeMm,
      'free-and-occupied',
    )
  }, [occupancySourceScans, occupancyCellSizeMm])
  const occupancyLayer = useMemo(() => {
    if (!showOccupancyLayer) {
      return null
    }

    if (occupancyDisplayMode === 'free-and-occupied') {
      return plannerOccupancyLayer
    }

    return computeOccupancyLayer(
      occupancySourceScans,
      occupancyCellSizeMm,
      occupancyDisplayMode,
    )
  }, [
    occupancyDisplayMode,
    occupancySourceScans,
    occupancyCellSizeMm,
    plannerOccupancyLayer,
    showOccupancyLayer,
  ])
  const goalPlannerGrid = useMemo(
    () => buildGoalPlannerGrid(plannerOccupancyLayer),
    [plannerOccupancyLayer],
  )
  const currentRegistrationSample = useMemo<SpatialBufferedLidarSampleLike | null>(() => {
    if (replaySelection) {
      return replaySelection.scan
    }

    return liveScanFromSelection(selectedLidar, selectedPose)
  }, [replaySelection, selectedLidar, selectedPose])
  const referenceRegistrationSample = useMemo<SpatialBufferedLidarSampleLike | null>(() => {
    if (replaySelection) {
      return replaySelection.index > 0 ? lidarHistory[replaySelection.index - 1] : null
    }

    return displayLidarHistory.length > 0
      ? displayLidarHistory[displayLidarHistory.length - 1]
      : null
  }, [displayLidarHistory, lidarHistory, replaySelection])
  const scanRegistration = useMemo(
    () => computeSpatialScanRegistration(currentRegistrationSample, referenceRegistrationSample),
    [currentRegistrationSample, referenceRegistrationSample],
  )
  const goalPreview = useMemo(
    () => computeGoalPreview(goalRequest, goalPreviewArmed, activePose, goalPlannerGrid, goalTargetYawDeg),
    [activePose, goalPlannerGrid, goalPreviewArmed, goalRequest, goalTargetYawDeg],
  )
  const mazeOverlay = useMemo(() => snapshot.maze ?? null, [snapshot.maze])

  useEffect(() => {
    setObservedMapScans((current) => current.slice(-observedMapHistoryLimit))
  }, [observedMapHistoryLimit])

  useEffect(() => {
    if (!selectedPose.isRenderable || hasAutoCenteredRef.current) {
      return
    }

    setViewport((current) => ({
      ...current,
      centerXMm: selectedPose.pose.xMm,
      centerYMm: selectedPose.pose.yMm,
    }))
    hasAutoCenteredRef.current = true
  }, [selectedPose.isRenderable, selectedPose.pose.xMm, selectedPose.pose.yMm])

  useEffect(() => {
    if (
      !followRobot ||
      replayMode !== 'live' ||
      !activePose.available ||
      activePose.freshness === 'invalid'
    ) {
      return
    }

    setViewport((current) => {
      if (current.centerXMm === activePose.xMm && current.centerYMm === activePose.yMm) {
        return current
      }

      return {
        ...current,
        centerXMm: activePose.xMm,
        centerYMm: activePose.yMm,
      }
    })
  }, [
    activePose.available,
    activePose.freshness,
    activePose.xMm,
    activePose.yMm,
    followRobot,
    replayMode,
  ])

  useEffect(() => {
    const pose = selectedPose.pose

    if (!isRenderablePlanarPose(pose)) {
      setPoseTransition({
        previous: null,
        latest: null,
        receivedAtMs: performance.now(),
        transitionMs: 0,
      })
      return
    }

    setPoseTransition((current) => {
      if (!poseTransitionChanged(current.latest, pose)) {
        return current
      }

      const canInterpolate =
        current.latest !== null &&
        current.latest.frame === pose.frame &&
        current.latest.source === pose.source &&
        current.latest.freshness === 'live' &&
        pose.freshness === 'live'
      const transitionMs =
        canInterpolate && current.latest !== null
          ? Math.max(60, Math.min(180, pose.timestampMs - current.latest.timestampMs || 120))
          : 0

      return {
        previous: canInterpolate ? current.latest : pose,
        latest: pose,
        receivedAtMs: performance.now(),
        transitionMs,
      }
    })
  }, [
    selectedPose.pose.available,
    selectedPose.pose.frame,
    selectedPose.pose.freshness,
    selectedPose.pose.sequence,
    selectedPose.pose.source,
    selectedPose.pose.timestampMs,
    selectedPose.pose.xMm,
    selectedPose.pose.yMm,
    selectedPose.pose.yawDeg,
  ])

  useEffect(() => {
    const pose = selectedPose.pose
    const nextContext =
      selectedPose.isRenderable && pose.frame
        ? `${sourceOverride}:${pose.source}:${pose.frame}`
        : null
    const contextChanged = trailContextRef.current !== nextContext

    if (!selectedPose.isRenderable) {
      trailContextRef.current = nextContext
      setTrail([])
      return
    }

    if (contextChanged) {
      trailContextRef.current = nextContext
      setTrail(pose.freshness === 'live' ? [toTrailPoint(pose)] : [])
      return
    }

    if (pose.freshness !== 'live') {
      trailContextRef.current = nextContext
      return
    }

    setTrail((current) => {
      const nextPoint = toTrailPoint(pose)
      const lastPoint = current[current.length - 1]

      if (!shouldAppendTrail(lastPoint, nextPoint)) {
        return current
      }

      return [...current, nextPoint].slice(-TRAIL_MAX_POINTS)
    })
  }, [
    selectedPose.isRenderable,
    selectedPose.pose.available,
    selectedPose.pose.frame,
    selectedPose.pose.freshness,
    selectedPose.pose.sequence,
    selectedPose.pose.source,
    selectedPose.pose.timestampMs,
    selectedPose.pose.xMm,
    selectedPose.pose.yMm,
    selectedPose.pose.yawDeg,
    sourceOverride,
  ])

  useEffect(() => {
    const nextContext =
      selectedLidar.isRenderable && selectedPose.isRenderable
        ? `${sourceOverride}:${selectedPose.pose.source}:${selectedPose.pose.frame}:${selectedLidar.scan.poseFrame}:${selectedLidar.scan.frame}`
        : null
    const contextChanged = lidarContextRef.current !== nextContext

    if (!selectedLidar.isRenderable || !selectedPose.isRenderable) {
      lidarContextRef.current = nextContext
      lastLidarKeyRef.current = null
      setLidarHistory([])
      return
    }

    if (contextChanged) {
      lidarContextRef.current = nextContext
      lastLidarKeyRef.current = null
      setLidarHistory([])
    }

    if (selectedLidar.scan.freshness !== 'live') {
      return
    }

    const sampleKey = `${selectedLidar.scan.sequence}:${selectedLidar.scan.timestampMs}`
    if (lastLidarKeyRef.current === sampleKey) {
      return
    }

    lastLidarKeyRef.current = sampleKey

    const points = decodeSpatialLidarPoints(selectedLidar.scan)
    if (points.length === 0) {
      return
    }

    const sample: SpatialBufferedLidarScan = {
      timestampMs: selectedLidar.scan.timestampMs,
      sequence: selectedLidar.scan.sequence,
      frame: selectedLidar.scan.frame,
      poseFrame: selectedLidar.scan.poseFrame,
      freshness: selectedLidar.scan.freshness,
      pose: {
        xMm: selectedPose.pose.xMm,
        yMm: selectedPose.pose.yMm,
        yawDeg: selectedPose.pose.yawDeg,
        frame: selectedPose.pose.frame,
        source: selectedPose.pose.source,
      },
      points,
    }

    setLidarHistory((current) => [...current, sample].slice(-LIDAR_HISTORY_MAX_SCANS))
  }, [
    selectedLidar.isRenderable,
    selectedLidar.scan.frame,
    selectedLidar.scan.freshness,
    selectedLidar.scan.poseFrame,
    selectedLidar.scan.sequence,
    selectedLidar.scan.timestampMs,
    selectedPose.isRenderable,
    selectedPose.pose.frame,
    selectedPose.pose.source,
    selectedPose.pose.timestampMs,
    selectedPose.pose.xMm,
    selectedPose.pose.yMm,
    selectedPose.pose.yawDeg,
    sourceOverride,
  ])

  useEffect(() => {
    const nextContext =
      selectedLidar.isRenderable && selectedPose.isRenderable
        ? `${sourceOverride}:${selectedPose.pose.source}:${selectedPose.pose.frame}:${selectedLidar.scan.poseFrame}:${selectedLidar.scan.frame}`
        : null
    const contextChanged = observedMapContextRef.current !== nextContext

    if (!selectedLidar.isRenderable || !selectedPose.isRenderable) {
      observedMapContextRef.current = nextContext
      lastObservedMapKeyRef.current = null
      setObservedMapScans([])
      setOccupancySessionScans([])
      return
    }

    if (contextChanged) {
      observedMapContextRef.current = nextContext
      lastObservedMapKeyRef.current = null
      setObservedMapScans([])
      setOccupancySessionScans([])
    }

    if (observedMapFrozen || selectedLidar.scan.freshness !== 'live') {
      return
    }

    const sampleKey = `${selectedLidar.scan.sequence}:${selectedLidar.scan.timestampMs}`
    if (lastObservedMapKeyRef.current === sampleKey) {
      return
    }

    lastObservedMapKeyRef.current = sampleKey

    const sample = observedMapScanFromSelection(selectedLidar, selectedPose)
    if (!sample || sample.points.length === 0) {
      return
    }

    setObservedMapScans((current) => {
      const next = [...current, sample]
      return next.slice(-observedMapHistoryLimit)
    })
    setOccupancySessionScans((current) => [...current, sample])
  }, [
    observedMapFrozen,
    observedMapHistoryLimit,
    selectedLidar.isRenderable,
    selectedLidar.scan.frame,
    selectedLidar.scan.freshness,
    selectedLidar.scan.poseFrame,
    selectedLidar.scan.sequence,
    selectedLidar.scan.timestampMs,
    selectedPose.isRenderable,
    selectedPose.pose.frame,
    selectedPose.pose.source,
    selectedPose.pose.timestampMs,
    selectedPose.pose.xMm,
    selectedPose.pose.yMm,
    selectedPose.pose.yawDeg,
    sourceOverride,
  ])

  useEffect(() => {
    if (replayKey && replaySelection === null) {
      setReplayKey(null)
    }
  }, [replayKey, replaySelection])

  useEffect(() => {
    const nextContext =
      activePose.available && activePose.frame
        ? `${sourceOverride}:${activePose.source}:${activePose.frame}:${replayMode}`
        : null
    const contextChanged = goalContextRef.current !== nextContext

    if (!activePose.available || activePose.freshness === 'invalid') {
      goalContextRef.current = nextContext
      setGoalRequest(null)
      setGoalPreviewArmed(false)
      return
    }

    if (contextChanged) {
      goalContextRef.current = nextContext
      setGoalRequest(null)
      setGoalPreviewArmed(false)
    }
  }, [
    activePose.available,
    activePose.frame,
    activePose.freshness,
    activePose.source,
    replayMode,
    sourceOverride,
  ])

  useEffect(() => {
    if (goalPreviewArmed && goalPreview.status !== 'armed' && goalPreview.status !== 'ready') {
      setGoalPreviewArmed(false)
    }
  }, [goalPreview.status, goalPreviewArmed])

  const centerOnRobot = () => {
    if (!activePose.available || activePose.freshness === 'invalid') {
      return
    }

    setViewport((current) => ({
      ...current,
      centerXMm: activePose.xMm,
      centerYMm: activePose.yMm,
    }))
  }

  const resetView = () => {
    setViewport({
      centerXMm: activePose.available ? activePose.xMm : 0,
      centerYMm: activePose.available ? activePose.yMm : 0,
      zoomPxPerMm: DEFAULT_VIEWPORT.zoomPxPerMm,
      rotationDeg: DEFAULT_VIEWPORT.rotationDeg,
    })
  }

  const clearTrail = () => {
    if (!activePose.available || activePose.freshness !== 'live') {
      setTrail([])
      return
    }

    setTrail([toTrailPoint(activePose)])
  }

  const clearLidarHistory = () => {
    setLidarHistory([])
    lastLidarKeyRef.current = null
    setReplayKey(null)
  }

  const clearObservedMap = () => {
    setObservedMapScans([])
    setOccupancySessionScans([])
    lastObservedMapKeyRef.current = null
  }

  const toggleObservedMapFrozen = () => {
    setObservedMapFrozen((current) => !current)
  }

  const toggleObservedMapFadeOlderScans = () => {
    setObservedMapFadeOlderScans((current) => !current)
  }

  const setObservedMapHistoryLimit = (limit: number) => {
    const nextLimit = OBSERVED_MAP_HISTORY_LIMIT_OPTIONS.reduce((nearest, candidate) => {
      return Math.abs(candidate - limit) < Math.abs(nearest - limit) ? candidate : nearest
    }, OBSERVED_MAP_HISTORY_LIMIT_OPTIONS[0])

    setObservedMapHistoryLimitState(nextLimit)
  }

  const toggleOccupancyLayer = () => {
    setShowOccupancyLayer((current) => !current)
  }

  const setOccupancyCellSizeMm = (cellSizeMm: number) => {
    const nextCellSizeMm = OCCUPANCY_CELL_SIZE_OPTIONS_MM.reduce((nearest, candidate) => {
      return Math.abs(candidate - cellSizeMm) < Math.abs(nearest - cellSizeMm)
        ? candidate
        : nearest
    }, OCCUPANCY_CELL_SIZE_OPTIONS_MM[0])

    setOccupancyCellSizeMmState(nextCellSizeMm)
  }

  const toggleOccupancyDisplayMode = () => {
    setOccupancyDisplayMode((current) =>
      current === 'free-and-occupied' ? 'occupied-only' : 'free-and-occupied',
    )
  }

  const selectGoalAtWorldPoint = (point: SpatialPathPreviewPoint) => {
    setFollowRobotState(false)
    setGoalRequest({
      xMm: point.xMm,
      yMm: point.yMm,
    })
    setGoalPreviewArmed(false)
  }

  const armGoalPreview = () => {
    if (goalPreview.status === 'ready' || goalPreview.status === 'armed') {
      setGoalPreviewArmed(true)
    }
  }

  const disarmGoalPreview = () => {
    setGoalPreviewArmed(false)
  }

  const clearGoalPreview = () => {
    setGoalRequest(null)
    setGoalPreviewArmed(false)
  }

  const enterReplayAtIndex = (index: number) => {
    if (lidarHistory.length === 0) {
      return
    }

    setFollowRobotState(false)
    const nextIndex = Math.round(clamp(index, 0, lidarHistory.length - 1))
    setReplayKey(bufferedLidarKey(lidarHistory[nextIndex]))
  }

  const stepReplay = (delta: number) => {
    if (lidarHistory.length === 0) {
      return
    }

    const baseIndex = replaySelection?.index ?? (lidarHistory.length - 1)
    enterReplayAtIndex(baseIndex + delta)
  }

  const returnToLive = () => {
    setReplayKey(null)
  }

  const panViewport = (deltaXPx: number, deltaYPx: number) => {
    setFollowRobotState(false)
    setViewport((current) => {
      const dragViewDelta = {
        xMm: deltaXPx / current.zoomPxPerMm,
        yMm: -deltaYPx / current.zoomPxPerMm,
      }
      const dragWorldDelta = rotateViewVectorToWorld(
        dragViewDelta.xMm,
        dragViewDelta.yMm,
        current.rotationDeg,
      )

      return {
        ...current,
        centerXMm: current.centerXMm - dragWorldDelta.xMm,
        centerYMm: current.centerYMm - dragWorldDelta.yMm,
      }
    })
  }

  const zoomViewport = (
    factor: number,
    anchor: SpatialAnchorPoint,
    viewportSize: SpatialViewportSize,
  ) => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0 || factor === 1) {
      return
    }

    setFollowRobotState(false)
    setViewport((current) => {
      const nextZoom = clamp(current.zoomPxPerMm * factor, MIN_ZOOM_PX_PER_MM, MAX_ZOOM_PX_PER_MM)
      if (nextZoom === current.zoomPxPerMm) {
        return current
      }

      const anchorViewOffset = {
        xMm: (anchor.x - viewportSize.width / 2) / current.zoomPxPerMm,
        yMm: -(anchor.y - viewportSize.height / 2) / current.zoomPxPerMm,
      }
      const worldAnchorOffset = rotateViewVectorToWorld(
        anchorViewOffset.xMm,
        anchorViewOffset.yMm,
        current.rotationDeg,
      )
      const worldAnchorXMm = current.centerXMm + worldAnchorOffset.xMm
      const worldAnchorYMm = current.centerYMm + worldAnchorOffset.yMm
      const nextAnchorViewOffset = {
        xMm: (anchor.x - viewportSize.width / 2) / nextZoom,
        yMm: -(anchor.y - viewportSize.height / 2) / nextZoom,
      }
      const nextWorldAnchorOffset = rotateViewVectorToWorld(
        nextAnchorViewOffset.xMm,
        nextAnchorViewOffset.yMm,
        current.rotationDeg,
      )

      return {
        centerXMm: worldAnchorXMm - nextWorldAnchorOffset.xMm,
        centerYMm: worldAnchorYMm - nextWorldAnchorOffset.yMm,
        zoomPxPerMm: nextZoom,
        rotationDeg: current.rotationDeg,
      }
    })
  }

  const rotateViewport = (deltaDeg: number) => {
    if (deltaDeg === 0) {
      return
    }

    setViewport((current) => ({
      ...current,
      rotationDeg: normalizeViewportRotation(current.rotationDeg + deltaDeg),
    }))
  }

  const resetViewportRotation = () => {
    setViewport((current) => {
      if (current.rotationDeg === 0) {
        return current
      }

      return {
        ...current,
        rotationDeg: 0,
      }
    })
  }

  const setFollowRobot = (follow: boolean) => {
    setFollowRobotState(follow)
  }

  const toggleFollowRobot = () => {
    setFollowRobotState((current) => !current)
  }

  return {
    sourceOverride,
    setSourceOverride,
    selectedPose,
    selectedLidar,
    lidarDiagnostics,
    scanRegistration,
    sourceStates: snapshot.poseSources,
    trail,
    displayTrail,
    lidarHistory,
    displayLidarHistory,
    observedMapScans,
    displayObservedMapScans,
    occupancySessionScanCount: occupancySessionScans.length,
    observedMapFrozen,
    observedMapFadeOlderScans,
    observedMapHistoryLimit,
    observedMapHistoryLimitOptions: OBSERVED_MAP_HISTORY_LIMIT_OPTIONS,
    showOccupancyLayer,
    toggleOccupancyLayer,
    occupancyCellSizeMm,
    occupancyCellSizeOptionsMm: OCCUPANCY_CELL_SIZE_OPTIONS_MM,
    occupancyDisplayMode,
    toggleOccupancyDisplayMode,
    occupancyLayer,
    mazeOverlay,
    goalPreview,
    selectGoalAtWorldPoint,
    armGoalPreview,
    disarmGoalPreview,
    clearGoalPreview,
    replayMode,
    replaySelection,
    viewport,
    poseTransition,
    followRobot,
    setFollowRobot,
    toggleFollowRobot,
    centerOnRobot,
    resetView,
    clearTrail,
    clearLidarHistory,
    clearObservedMap,
    toggleObservedMapFrozen,
    toggleObservedMapFadeOlderScans,
    setObservedMapHistoryLimit,
    setOccupancyCellSizeMm,
    enterReplayAtIndex,
    stepReplay,
    returnToLive,
    panViewport,
    zoomViewport,
    rotateViewport,
    resetViewportRotation,
  }
}
