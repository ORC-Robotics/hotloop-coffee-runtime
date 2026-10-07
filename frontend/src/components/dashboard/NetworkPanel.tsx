import { useEffect, useState } from 'react'
import { getBridgeConnectionStatus, updateBridgeConnection } from '../../data/telemetryGateway'
import type { BridgeStatus, ConnectionStatus, ControlModeState, UiTone } from '../../types/telemetry'
import { BoolIndicator, StatRow } from '../viz/viz'
import { DashboardCard } from './DashboardCard'
import { StatusBadge } from './StatusBadge'

interface NetworkPanelProps {
  data: ConnectionStatus
  tone: UiTone
  bridgeStatus?: BridgeStatus
  controlMode?: ControlModeState
}

function syncTone(status: ControlModeState['syncStatus'] | undefined): UiTone {
  if (status === 'synced' || status === 'applied') return 'good'
  if (status === 'pending' || status === 'stale') return 'warning'
  if (status === 'rejected' || status === 'unavailable') return 'critical'
  return 'neutral'
}

export function NetworkPanel({ data, tone, bridgeStatus, controlMode }: NetworkPanelProps) {
  const [manualHostInput, setManualHostInput] = useState(bridgeStatus?.manualHost ?? '')
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const localBackendOnline = bridgeStatus?.connected ?? false
  const robotLinkOnline = bridgeStatus?.robotLinkConnected ?? data.online
  const configuredHost = bridgeStatus?.manualHost?.trim() ? bridgeStatus.manualHost : 'team discovery'
  const canRetryLocalBackend = Boolean(window.orionDesktop?.restartBridge)

  useEffect(() => {
    setManualHostInput(bridgeStatus?.manualHost ?? '')
  }, [bridgeStatus?.manualHost])

  const handleReconnect = async () => {
    setIsSubmitting(true)
    setActionMessage(null)

    try {
      if (!localBackendOnline) {
        if (!window.orionDesktop?.restartBridge) {
          setActionMessage('The local bridge backend is offline and this environment cannot restart it automatically.')
          return
        }

        const restart = await window.orionDesktop.restartBridge()
        if (!restart.ok) {
          setActionMessage(restart.error ?? 'quente retried the local bridge backend, but it is still starting or unavailable.')
          return
        }

        await getBridgeConnectionStatus()
        setActionMessage('Local bridge backend restarted. If the robot link is still waiting, use Reconnect or update the robot host/IP.')
        return
      }

      const response = await updateBridgeConnection(undefined, undefined, true)
      setActionMessage(response.error ?? response.message ?? 'Reconnect requested.')
    } catch {
      setActionMessage('Unable to reach the local bridge backend. Start or restore the backend service first.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleApplyHost = async () => {
    const trimmedHost = manualHostInput.trim()
    if (!trimmedHost) {
      setActionMessage('Type an IP or hostname before applying a manual robot target.')
      return
    }

    setIsSubmitting(true)
    setActionMessage(null)

    try {
      const response = await updateBridgeConnection(trimmedHost, 'manual-host', true)
      setActionMessage(
        response.error ?? response.message ?? `Manual host override applied to ${trimmedHost}.`,
      )
    } catch {
      setActionMessage('Unable to save the manual robot host because the local bridge backend is unavailable.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUseTeamAuto = async () => {
    setIsSubmitting(true)
    setActionMessage(null)

    try {
      const response = await updateBridgeConnection(null, 'team-auto', true)
      setManualHostInput('')
      setActionMessage(response.error ?? response.message ?? 'Team auto discovery restored.')
    } catch {
      setActionMessage('Unable to restore team auto discovery because the local bridge backend is unavailable.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <DashboardCard
      title="Connection"
      subtitle="bridge and robot link"
      headerSlot={<StatusBadge tone={tone} label={data.health} />}
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-1.5">
          <BoolIndicator label="Local bridge" value={localBackendOnline} onLabel="online" offLabel="offline" />
          <BoolIndicator label="Robot link" value={robotLinkOnline} onLabel="connected" offLabel="waiting" offTone="warning" />
        </div>

        <div className="grid grid-cols-2 gap-x-5">
          <StatRow label="Target" value={configuredHost} />
          <StatRow label="Host seen" value={data.hostSeen} />
          <StatRow label="Team" value={bridgeStatus?.teamNumber ? String(bridgeStatus.teamNumber) : String(data.team || '--')} />
          <StatRow label="Transport" value={bridgeStatus?.transport ?? 'networktables'} />
          <StatRow label="Route" value={data.routeLabel} />
          <StatRow label="Auto sync" value={controlMode?.syncStatus ?? 'unknown'} tone={syncTone(controlMode?.syncStatus)} />
        </div>

        <div className="grid gap-1.5">
          <label className="hl-label" htmlFor="robot-host-override">
            Robot host / IP override
          </label>
          <div className="flex gap-1.5">
            <input
              id="robot-host-override"
              value={manualHostInput}
              onChange={(event) => setManualHostInput(event.target.value)}
              placeholder="10.12.34.11 or raspberrypi.local"
              className="hl-input font-mono"
            />
            <button
              type="button"
              onClick={() => void handleApplyHost()}
              disabled={isSubmitting || !localBackendOnline}
              className="hl-btn"
            >
              Save
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => void handleReconnect()}
              disabled={isSubmitting || (!localBackendOnline && !canRetryLocalBackend)}
              className="hl-btn"
            >
              {localBackendOnline ? 'Reconnect' : 'Restart bridge'}
            </button>
            <button
              type="button"
              onClick={() => void handleUseTeamAuto()}
              disabled={isSubmitting || !localBackendOnline}
              className="hl-btn hl-btn-ghost"
            >
              Use team discovery
            </button>
          </div>
        </div>

        <p className="text-[11.5px] leading-5 text-[var(--text-muted)]">
          {actionMessage ?? controlMode?.message ?? bridgeStatus?.message ?? 'Bridge ready.'}
        </p>
      </div>
    </DashboardCard>
  )
}
