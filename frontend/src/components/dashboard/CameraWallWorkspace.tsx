import { useState } from 'react'
import type { ResolvedCameraFeed } from '../../lib/cameraFeeds'
import { EmptyHint, StatusDot } from '../viz/viz'
import { CameraFeedMedia, type CameraFeedResourceStatus } from './CameraFeedMedia'

function hostLabel(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function CameraTile({ feed }: { feed: ResolvedCameraFeed }) {
  const [status, setStatus] = useState<CameraFeedResourceStatus>('loading')

  return (
    <section className="hl-panel min-h-[220px]">
      <header className="hl-panel-header">
        <StatusDot tone={status === 'live' ? 'good' : status === 'loading' ? 'warning' : 'critical'} pulse={status === 'loading'} />
        <h2 className="hl-panel-title">{feed.label}</h2>
        <span className="hl-panel-meta">{hostLabel(feed.url)}</span>
        <span className="ml-auto shrink-0 text-[11px] text-[var(--text-faint)]">
          {feed.kind} · {feed.source === 'auto' ? 'auto' : 'manual'}
        </span>
      </header>
      <CameraFeedMedia feed={feed} className="min-h-0 flex-1" mediaClassName="h-full" onStatusChange={setStatus} />
    </section>
  )
}

export function CameraWallWorkspace({ feeds }: { feeds: ResolvedCameraFeed[] }) {
  if (!feeds.length) {
    return (
      <div className="flex h-full items-center justify-center rounded-[10px] border border-dashed border-[var(--border-strong)]">
        <EmptyHint title="No camera feeds">
          Feeds published by the robot (CameraPublisher) show up here automatically. You can also add a stream URL in Settings.
        </EmptyHint>
      </div>
    )
  }

  const columns = feeds.length === 1 ? 1 : feeds.length <= 4 ? 2 : 3

  return (
    <div
      className="grid h-full min-h-0 auto-rows-fr gap-2.5 overflow-y-auto"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {feeds.map((feed) => (
        <CameraTile key={feed.id} feed={feed} />
      ))}
    </div>
  )
}
