import { useMemo, useState } from 'react'
import { resolveActiveCameraFeeds, type ResolvedCameraFeed } from '../../../lib/cameraFeeds'
import type { DiscoveredCameraFeed } from '../../../types/telemetry'
import { useDashboardPreferences } from '../../../preferences/useDashboardPreferences'
import { CameraFeedMedia, type CameraFeedResourceStatus } from '../CameraFeedMedia'
import { EmptyHint, StatusDot } from '../../viz/viz'

function hostLabel(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function CameraWidgetEmptyState({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <div className="h-full p-2.5">
      <EmptyHint title={title}>{message}</EmptyHint>
    </div>
  )
}

function resolveSelectedFeed(
  feeds: ResolvedCameraFeed[],
  selectedFeedId: string | null,
) {
  if (!feeds.length) {
    return null
  }

  if (!selectedFeedId) {
    return feeds[0] ?? null
  }

  return feeds.find((feed) => feed.id === selectedFeedId) ?? null
}

export function HomeWorkspaceCameraStreamWidget({
  selectedFeedId,
  discoveredFeeds,
}: {
  selectedFeedId: string | null
  discoveredFeeds: DiscoveredCameraFeed[]
}) {
  const { preferences } = useDashboardPreferences()
  const [status, setStatus] = useState<CameraFeedResourceStatus>('loading')
  const resolvedFeeds = useMemo(
    () => resolveActiveCameraFeeds(preferences.cameraFeeds, discoveredFeeds),
    [discoveredFeeds, preferences.cameraFeeds],
  )
  const feed = useMemo(
    () => resolveSelectedFeed(resolvedFeeds, selectedFeedId),
    [resolvedFeeds, selectedFeedId],
  )

  if (!resolvedFeeds.length) {
    return (
      <CameraWidgetEmptyState
        title="No camera feed"
        message="Turn on the simulated camera or add a stream in Settings."
      />
    )
  }

  if (!feed) {
    return (
      <CameraWidgetEmptyState
        title="Feed unavailable"
        message="The selected feed is not being published right now."
      />
    )
  }

  return (
    <div className="relative h-full min-h-0 bg-black">
      <CameraFeedMedia feed={feed} className="h-full" mediaClassName="h-full" onStatusChange={setStatus} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-6 pb-1.5 text-[11px] text-white/85">
        <StatusDot tone={status === 'live' ? 'good' : status === 'loading' ? 'warning' : 'critical'} pulse={status === 'loading'} />
        <span className="truncate font-medium">{feed.label}</span>
        <span className="truncate font-mono text-white/55">{hostLabel(feed.url)}</span>
        <span className="ml-auto shrink-0 text-white/55">
          {feed.kind} · {feed.source === 'auto' ? 'auto' : 'manual'}
        </span>
      </div>
    </div>
  )
}
