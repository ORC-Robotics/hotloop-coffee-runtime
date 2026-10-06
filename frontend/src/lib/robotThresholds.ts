import type { UiTone } from '../types/telemetry'

/** Pack voltage thresholds shared by every battery readout and alert rule. */
export const BATTERY_WARNING_V = 11.8
export const BATTERY_CRITICAL_V = 11.0

export function voltageTone(voltageV: number): UiTone {
  if (voltageV <= 0) return 'neutral'
  if (voltageV < BATTERY_CRITICAL_V) return 'critical'
  if (voltageV < BATTERY_WARNING_V) return 'warning'
  return 'good'
}

export function toneColor(tone: UiTone) {
  if (tone === 'good') return 'var(--success)'
  if (tone === 'warning') return 'var(--warning)'
  if (tone === 'critical') return 'var(--danger)'
  if (tone === 'info') return 'var(--info)'
  return 'var(--text-faint)'
}
