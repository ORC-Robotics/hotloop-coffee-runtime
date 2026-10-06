import { BATTERY_CRITICAL_V, BATTERY_WARNING_V } from './robotThresholds'
import type {
  AlertItem,
  AlertSeverity,
  TelemetryDerivedState,
  TelemetrySnapshot,
  UiTone,
} from '../types/telemetry'
import { formatDegrees, formatMillimeters, formatSeconds } from './format'

function severityOrder(severity: AlertSeverity) {
  return { critical: 0, warning: 1, info: 2 }[severity]
}

function severityToTone(severity: AlertSeverity): UiTone {
  const toneMap: Record<AlertSeverity, UiTone> = {
    critical: 'critical',
    warning: 'warning',
    info: 'info',
  }

  return toneMap[severity]
}

export function deriveAlerts(snapshot: TelemetrySnapshot): AlertItem[] {
  const alerts: AlertItem[] = []

  if (!snapshot.connection.online) {
    alerts.push({
      id: 'offline',
      severity: 'critical',
      source: 'connection',
      title: 'Robot offline',
      message: `No active route to ${snapshot.connection.target}.`,
    })

    return alerts
  }

  if (!snapshot.systems.validScan) {
    alerts.push({
      id: 'valid-scan',
      severity: 'critical',
      source: 'systems',
      title: 'Invalid scan',
      message: 'Reactive planner is operating without a stable LiDAR scan.',
    })
  }

  if (!snapshot.systems.lidarHealthy) {
    alerts.push({
      id: 'lidar-health',
      severity: 'critical',
      source: 'systems',
      title: 'LiDAR unhealthy',
      message: 'LiDAR health flag is down. Sensor trust should be reduced.',
    })
  }

  if (!snapshot.systems.navxConnected) {
    alerts.push({
      id: 'navx',
      severity: 'warning',
      source: 'systems',
      title: 'NavX link lost',
      message: 'Heading control is relying on stale or fallback orientation data.',
    })
  }

  if (snapshot.battery.voltageV > 0 && snapshot.battery.voltageV < BATTERY_CRITICAL_V) {
    alerts.push({
      id: 'battery-critical',
      severity: 'critical',
      source: 'systems',
      title: 'Battery sag critical',
      message: `Battery voltage dropped to ${snapshot.battery.voltageV.toFixed(2)} V.`,
    })
  } else if (snapshot.battery.voltageV > 0 && snapshot.battery.voltageV < BATTERY_WARNING_V) {
    alerts.push({
      id: 'battery-warning',
      severity: 'warning',
      source: 'systems',
      title: 'Battery droop detected',
      message: `Battery voltage is ${snapshot.battery.voltageV.toFixed(2)} V under load.`,
    })
  }

  if (snapshot.perception.frontBlocked) {
    alerts.push({
      id: 'front-blocked',
      severity: 'critical',
      source: 'perception',
      title: 'Front corridor blocked',
      message: `Front median collapsed to ${formatMillimeters(snapshot.perception.frontMedianMm)}.`,
    })
  } else if (snapshot.perception.frontSlow) {
    alerts.push({
      id: 'front-slow',
      severity: 'warning',
      source: 'perception',
      title: 'Reduced forward margin',
      message: `Front clearance is down to ${formatMillimeters(snapshot.perception.frontMedianMm)}.`,
    })
  }

  if (snapshot.perception.deadEnd) {
    alerts.push({
      id: 'dead-end',
      severity: snapshot.perception.frontBlocked ? 'critical' : 'warning',
      source: 'reactive',
      title: 'Dead end behaviour active',
      message: 'Reactive state is performing dead-end recovery.',
    })
  }

  if (Math.abs(snapshot.heading.angularErrorDeg) > 18) {
    alerts.push({
      id: 'angular-error',
      severity: 'warning',
      source: 'heading',
      title: 'High angular error',
      message: `Angular error is ${formatDegrees(snapshot.heading.angularErrorDeg)}.`,
    })
  }

  if (Math.abs(snapshot.heading.lateralErrorM) > 0.18) {
    alerts.push({
      id: 'lateral-error',
      severity: 'info',
      source: 'heading',
      title: 'Lateral drift detected',
      message: `Lateral error is ${snapshot.heading.lateralErrorM.toFixed(2)} m.`,
    })
  }

  return alerts.sort((left, right) => severityOrder(left.severity) - severityOrder(right.severity))
}

export function deriveTelemetryState(
  snapshot: TelemetrySnapshot,
  alerts: AlertItem[],
): TelemetryDerivedState {
  if (!snapshot.connection.online) {
    return {
      connectionTone: 'critical',
      robotHealthTone: 'critical',
      frontClearanceTone: 'info',
      alignmentTone: 'neutral',
      lastUpdatedLabel: 'awaiting live telemetry',
      commandNarrative: 'No command stream is being received while the robot link is offline.',
      stateNarrative: 'The dashboard is in standby and waiting for a live telemetry bridge.',
    }
  }

  const connectionTone: UiTone = snapshot.connection.online
    ? snapshot.connection.health === 'stable'
      ? 'good'
      : 'warning'
    : 'critical'

  const robotHealthTone: UiTone = alerts.some((alert) => alert.severity === 'critical')
    ? 'critical'
    : alerts.some((alert) => alert.severity === 'warning')
      ? 'warning'
      : 'good'

  const frontClearanceTone: UiTone = snapshot.perception.frontBlocked
    ? 'critical'
    : snapshot.perception.frontSlow
      ? 'warning'
      : 'good'

  const alignmentTone: UiTone =
    Math.abs(snapshot.heading.angularErrorDeg) > 18
      ? 'warning'
      : Math.abs(snapshot.heading.angularErrorDeg) > 8
        ? 'info'
        : 'good'

  return {
    connectionTone,
    robotHealthTone,
    frontClearanceTone,
    alignmentTone,
    lastUpdatedLabel: `${new Date(snapshot.timestamp).toLocaleTimeString()} | state ${formatSeconds(snapshot.reactive.stateTimeSec)}`,
    commandNarrative:
      Math.abs(snapshot.commands.rotation) > 0.45
        ? 'Controller is prioritizing heading correction over pure forward progress.'
        : snapshot.commands.forward < 0.3
          ? 'Forward command is intentionally reduced to keep a safe corridor margin.'
          : 'Drive command is favoring forward progress while centering in the corridor.',
    stateNarrative:
      `${snapshot.reactive.decision}. ${snapshot.reactive.driveControl}. Last turn: ${snapshot.reactive.lastTurn}.`,
  }
}

export { severityToTone }
