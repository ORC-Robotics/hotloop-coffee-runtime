import { useEffect, useMemo, useState } from 'react'
import type { ResolvedCameraFeed } from '../../lib/cameraFeeds'
import { cn } from '../../lib/cn'

export type CameraFeedResourceStatus = 'loading' | 'live' | 'error'

function useSnapshotUrl(feed: ResolvedCameraFeed) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (feed.kind !== 'snapshot' || !feed.enabled || !feed.url.trim()) {
      return
    }

    if (feed.url.startsWith('data:') || feed.url.startsWith('blob:')) {
      return
    }

    const intervalId = window.setInterval(() => {
      setTick((current) => current + 1)
    }, Math.max(250, feed.refreshMs))

    return () => {
      window.clearInterval(intervalId)
    }
  }, [feed.enabled, feed.kind, feed.refreshMs, feed.url])

  return useMemo(() => {
    if (feed.kind !== 'snapshot' || !feed.url.trim()) {
      return feed.url
    }

    if (feed.url.startsWith('data:') || feed.url.startsWith('blob:')) {
      return feed.url
    }

    const separator = feed.url.includes('?') ? '&' : '?'
    return `${feed.url}${separator}_orion=${tick}`
  }, [feed.kind, feed.url, tick])
}

export function CameraFeedMedia({
  feed,
  className,
  mediaClassName,
  emptyMessage = 'Configure a stream URL in Settings.',
  showGradient = false,
  onStatusChange,
}: {
  feed: ResolvedCameraFeed
  className?: string
  mediaClassName?: string
  emptyMessage?: string
  showGradient?: boolean
  onStatusChange?: (status: CameraFeedResourceStatus) => void
}) {
  const src = useSnapshotUrl(feed)
  const resourceKey = `${feed.kind}:${src}`

  useEffect(() => {
    onStatusChange?.(feed.url.trim() ? 'loading' : 'error')
  }, [feed.url, onStatusChange, resourceKey])

  return (
    <div className={cn('relative overflow-hidden bg-black', className)}>
      {feed.url.trim() ? (
        feed.kind === 'video' ? (
          <video
            src={src}
            autoPlay
            muted
            playsInline
            className={cn('w-full object-contain', mediaClassName)}
            onCanPlay={() => onStatusChange?.('live')}
            onError={() => onStatusChange?.('error')}
          />
        ) : (
          <img
            src={src}
            alt={feed.label}
            className={cn('w-full object-contain', mediaClassName)}
            onLoad={() => onStatusChange?.('live')}
            onError={() => onStatusChange?.('error')}
          />
        )
      ) : (
        <div className={cn('flex items-center justify-center px-4 text-center text-[0.84rem] text-[var(--text-muted)]', mediaClassName)}>
          {emptyMessage}
        </div>
      )}

      {showGradient ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--overlay)] to-transparent" />
      ) : null}
    </div>
  )
}
