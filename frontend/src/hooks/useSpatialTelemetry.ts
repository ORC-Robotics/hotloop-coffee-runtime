import { useSyncExternalStore } from 'react'
import { getSpatialSnapshot, subscribeSpatialTelemetry } from '../data/spatialGateway'
import { createOfflineSpatialSnapshot } from '../data/mockTelemetry'
import { getTelemetryMode, subscribeTelemetryMode } from '../telemetry-mode/telemetryModeStore'
import type { SpatialSnapshot } from '../types/telemetry'

const TICK_MS = 150

function mergeIncomingSpatial(previous: SpatialSnapshot, incoming: SpatialSnapshot): SpatialSnapshot {
  if (!incoming.connection.online && !previous.connection.online) {
    return {
      ...incoming,
      timestamp: previous.timestamp,
    }
  }

  return incoming
}

function toBridgeOfflineSpatialSnapshot(previous?: SpatialSnapshot): SpatialSnapshot {
  const offline = createOfflineSpatialSnapshot()

  if (!previous) {
    return offline
  }

  return {
    ...offline,
    timestamp: previous.connection.online ? new Date().toISOString() : previous.timestamp,
    bridgeStatus: previous.bridgeStatus,
    connection: {
      ...offline.connection,
      team: previous.connection.team,
      target: previous.connection.target,
      mode: previous.connection.mode === 'mock-bridge' ? 'team-auto' : previous.connection.mode,
    },
    pose: previous.pose.available ? { ...previous.pose, freshness: 'stale' } : offline.pose,
    poseSources: {
      odometry: previous.poseSources.odometry.available
        ? { ...previous.poseSources.odometry, freshness: 'stale' }
        : offline.poseSources.odometry,
      reactive: previous.poseSources.reactive.available
        ? { ...previous.poseSources.reactive, freshness: 'stale' }
        : offline.poseSources.reactive,
      mapeamento: previous.poseSources.mapeamento.available
        ? { ...previous.poseSources.mapeamento, freshness: 'stale' }
        : offline.poseSources.mapeamento,
      simulation: previous.poseSources.simulation.available
        ? { ...previous.poseSources.simulation, freshness: 'stale' }
        : offline.poseSources.simulation,
    },
    lidar: previous.lidar.available ? { ...previous.lidar, freshness: 'stale' } : offline.lidar,
    stream: previous.stream,
  }
}

/*
 * One shared poller for every consumer (map page, map widget, pose widget).
 * It starts with the first subscriber, restarts when the telemetry mode
 * changes, and stops when the last subscriber leaves.
 */
let sharedSnapshot: SpatialSnapshot = createOfflineSpatialSnapshot()
const sharedListeners = new Set<() => void>()
let stopShared: (() => void) | null = null
let sharedMode: string | null = null

function emitShared(next: SpatialSnapshot) {
  if (next === sharedSnapshot) {
    return
  }
  sharedSnapshot = next
  sharedListeners.forEach((listener) => listener())
}

function startShared() {
  stopShared?.()
  sharedMode = getTelemetryMode()
  stopShared = subscribeSpatialTelemetry(
    (incoming) => emitShared(mergeIncomingSpatial(sharedSnapshot, incoming)),
    () => {
      if (sharedSnapshot.connection.online) {
        emitShared(toBridgeOfflineSpatialSnapshot(sharedSnapshot))
      }
    },
    TICK_MS,
  )
  void getSpatialSnapshot()
}

function subscribeShared(listener: () => void) {
  sharedListeners.add(listener)
  if (!stopShared || sharedMode !== getTelemetryMode()) {
    startShared()
  }

  return () => {
    sharedListeners.delete(listener)
    if (sharedListeners.size === 0) {
      stopShared?.()
      stopShared = null
    }
  }
}

subscribeTelemetryMode(() => {
  if (sharedListeners.size > 0) {
    startShared()
  }
})

const getSharedSnapshot = () => sharedSnapshot

export function useSpatialTelemetry(): SpatialSnapshot {
  return useSyncExternalStore(subscribeShared, getSharedSnapshot, getSharedSnapshot)
}
