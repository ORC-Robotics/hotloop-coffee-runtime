import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DiscoveredCameraFeed } from '../../types/telemetry'
import { useDashboardPreferences } from '../../preferences/useDashboardPreferences'
import type { CameraFeedConfig, CameraFeedKind, UiScaleId } from '../../preferences/dashboardPreferencesStore'
import { useTheme } from '../../hooks/useTheme'
import { cn } from '../../lib/cn'
import { themes, type ThemeId } from '../../theme/themes'
import { CloseIcon, SettingsIcon } from '../shell/icons'
import { StatusDot } from '../viz/viz'

const uiScaleOptions: Array<{ id: UiScaleId; label: string }> = [
  { id: 'compact', label: 'Compact' },
  { id: 'standard', label: 'Standard' },
  { id: 'large', label: 'Large' },
]

const cameraKinds: Array<{ id: CameraFeedKind; label: string }> = [
  { id: 'mjpeg', label: 'MJPEG stream' },
  { id: 'snapshot', label: 'Snapshot / JPEG' },
  { id: 'video', label: 'Video / MP4' },
]

function hostLabel(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-b border-[var(--border)] py-4 last:border-b-0">
      <div>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {description ? <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function ThemeSwatch({ id, active, onClick }: { id: ThemeId; active: boolean; onClick: () => void }) {
  const theme = themes[id]
  const t = theme.tokens

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'grid gap-2 rounded-[9px] border p-2 text-left transition-colors',
        active ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]',
      )}
    >
      <div className="flex h-12 overflow-hidden rounded-[6px] border border-[var(--border)]" style={{ background: t.background }}>
        <div className="w-3" style={{ background: t.surface }} />
        <div className="flex flex-1 flex-col justify-end gap-1 p-1.5">
          <div className="h-1.5 w-2/3 rounded-full" style={{ background: t.primary }} />
          <div className="flex gap-1">
            {[t.series1, t.series2, t.series3, t.success, t.danger].map((color) => (
              <span key={color} className="h-1.5 flex-1 rounded-full" style={{ background: color }} />
            ))}
          </div>
        </div>
      </div>
      <div className="text-[12px] font-medium">{theme.label}</div>
    </button>
  )
}

function CameraFeedEditor({
  feed,
  onChange,
}: {
  feed: CameraFeedConfig
  onChange: (patch: Partial<CameraFeedConfig>) => void
}) {
  return (
    <div className="hl-well grid gap-2.5 p-3">
      <div className="flex items-center gap-2">
        <input
          value={feed.label}
          onChange={(event) => onChange({ label: event.target.value })}
          className="hl-input h-7 flex-1"
          aria-label="Feed name"
        />
        <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={feed.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
            className="h-3.5 w-3.5 accent-[var(--primary)]"
          />
          Enabled
        </label>
      </div>
      <input
        value={feed.url}
        onChange={(event) => onChange({ url: event.target.value })}
        placeholder="http://10.12.34.11:1181/stream.mjpg"
        className="hl-input font-mono text-[12px]"
        aria-label="Stream URL"
      />
      <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
        <select
          value={feed.kind}
          onChange={(event) => onChange({ kind: event.target.value as CameraFeedKind })}
          className="hl-input"
          aria-label="Feed type"
        >
          {cameraKinds.map((kind) => (
            <option key={kind.id} value={kind.id}>
              {kind.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={feed.refreshMs}
          min={250}
          step={50}
          onChange={(event) => onChange({ refreshMs: Number(event.target.value) || 900 })}
          className="hl-input font-mono"
          aria-label="Snapshot refresh in milliseconds"
          title="Snapshot refresh (ms)"
        />
      </div>
    </div>
  )
}

export function DashboardSettingsLauncher({
  discoveredFeeds = [],
}: {
  discoveredFeeds?: DiscoveredCameraFeed[]
}) {
  const [open, setOpen] = useState(false)
  const { themeId, setThemeId } = useTheme()
  const { preferences, setLayoutSetting, updateCameraFeed } = useDashboardPreferences()
  const canPortal = typeof document !== 'undefined'

  useEffect(() => {
    if (!open) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  const overlay =
    open && canPortal
      ? createPortal(
          <div className="fixed inset-0 z-[120]">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute inset-0 h-full w-full bg-black/45"
              aria-label="Close settings"
            />
            <aside
              className="absolute inset-y-0 right-0 z-[121] flex w-full max-w-[460px] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--card-shadow-strong)]"
              role="dialog"
              aria-modal="true"
              aria-label="Settings"
            >
              <header className="flex h-12 items-center justify-between border-b border-[var(--border)] px-4">
                <h2 className="text-[14px] font-semibold">Settings</h2>
                <button type="button" onClick={() => setOpen(false)} className="hl-btn hl-btn-ghost hl-btn-icon" aria-label="Close settings">
                  <CloseIcon width="16" height="16" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-4">
                <Section title="Theme">
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(themes) as ThemeId[]).map((id) => (
                      <ThemeSwatch key={id} id={id} active={themeId === id} onClick={() => setThemeId(id)} />
                    ))}
                  </div>
                </Section>

                <Section title="Interface size" description="Scales the whole console — useful on small laptops or far-away screens.">
                  <div className="hl-seg w-fit" role="group" aria-label="Interface size">
                    {uiScaleOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="hl-seg-item"
                        aria-pressed={preferences.layout.uiScale === option.id}
                        onClick={() => setLayoutSetting('uiScale', option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </Section>

                <Section
                  title="Camera feeds"
                  description="Streams published by the robot (CameraPublisher / CameraServer) appear automatically. Manual feeds below are a fallback or extra sources."
                >
                  {discoveredFeeds.length ? (
                    <ul className="hl-well divide-y divide-[var(--border)]">
                      {discoveredFeeds.map((feed) => (
                        <li key={feed.id} className="flex items-center gap-2.5 px-3 py-2">
                          <StatusDot tone={feed.connected ? 'good' : 'warning'} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px]">{feed.label}</div>
                            <div className="truncate font-mono text-[11px] text-[var(--text-faint)]">{hostLabel(feed.url)}</div>
                          </div>
                          <span className="text-[11px] text-[var(--text-faint)]">{feed.kind}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="hl-well px-3 py-2.5 text-[12px] text-[var(--text-faint)]">No robot-published feeds detected yet.</p>
                  )}

                  <div className="grid gap-2">
                    {preferences.cameraFeeds.map((feed) => (
                      <CameraFeedEditor key={feed.id} feed={feed} onChange={(patch) => updateCameraFeed(feed.id, patch)} />
                    ))}
                  </div>
                </Section>
              </div>
            </aside>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-[54px] flex-col items-center gap-1 rounded-[9px] py-2 text-[10.5px] font-medium text-[var(--text-faint)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-secondary)]"
        aria-label="Open settings"
        title="Settings"
      >
        <SettingsIcon />
        Settings
      </button>
      {overlay}
    </>
  )
}
