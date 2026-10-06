import { useMemo, useRef, useState } from 'react'
import { StatusBadge } from '../../components/dashboard/StatusBadge'
import {
  TelemetryTopicBrowser,
  scopeChipClass,
  scopeLabel,
  type TelemetryTopicScopeFilter,
} from '../../components/dashboard/TelemetryTopicBrowser'
import { EmptyHint, FitValue, StatRow, TimePlot, Toggle } from '../../components/viz/viz'
import { writeTelemetryTopicValue } from '../../data/telemetryGateway'
import { appendTopicWidgetToSavedLayout } from '../../home-workspace/homeWorkspaceStore'
import { useTelemetryCatalog } from '../../hooks/useTelemetryCatalog'
import { cn } from '../../lib/cn'
import type { TelemetryTopic } from '../../types/telemetry'

const HISTORY_LIMIT = 160

type WritableKind = 'number' | 'boolean' | 'string'

function writableKind(topic: TelemetryTopic | null): WritableKind | null {
  if (!topic?.isWritable) return null
  if (topic.valueKind === 'number' || topic.valueKind === 'boolean' || topic.valueKind === 'string') return topic.valueKind
  return null
}

function TopicWriter({ topic }: { topic: TelemetryTopic }) {
  const kind = writableKind(topic)
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState<{ tone: 'good' | 'critical' | 'warning'; message: string } | null>(null)

  if (!kind) {
    return null
  }

  const publish = async (value: number | boolean | string) => {
    setStatus({ tone: 'warning', message: 'Publishing…' })
    try {
      const response = await writeTelemetryTopicValue(topic.key, kind, value)
      if (response.error) {
        setStatus({ tone: 'critical', message: response.error })
        return
      }
      setDraft(null)
      setStatus({ tone: 'good', message: response.message ?? 'Value published.' })
    } catch {
      setStatus({ tone: 'critical', message: 'The bridge did not accept the write.' })
    }
  }

  return (
    <section className="grid gap-2 border-t border-[var(--border)] pt-3">
      <h3 className="hl-eyebrow">Set value</h3>
      {kind === 'boolean' ? (
        <Toggle checked={topic.value === true} onChange={(value) => void publish(value)} label={topic.value === true ? 'On' : 'Off'} />
      ) : (
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            const raw = draft ?? String(topic.value ?? '')
            if (kind === 'number') {
              const parsed = Number(raw)
              if (!Number.isFinite(parsed)) {
                setStatus({ tone: 'critical', message: 'Type a valid number.' })
                return
              }
              void publish(parsed)
              return
            }
            void publish(raw)
          }}
        >
          <input
            value={draft ?? String(topic.value ?? '')}
            onChange={(event) => setDraft(event.target.value)}
            inputMode={kind === 'number' ? 'decimal' : 'text'}
            className="hl-input font-mono"
            aria-label="New value"
          />
          <button type="submit" className="hl-btn hl-btn-primary" disabled={draft === null}>
            Apply
          </button>
        </form>
      )}
      {status ? (
        <p className="text-[11.5px]" style={{ color: status.tone === 'critical' ? 'var(--danger)' : status.tone === 'good' ? 'var(--success)' : 'var(--text-muted)' }}>
          {status.message}
        </p>
      ) : null}
    </section>
  )
}

/** Foxglove-style topic explorer: list on the left, live inspector on the right. */
export function TopicsPage() {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<TelemetryTopicScopeFilter>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [history, setHistory] = useState<number[]>([])
  const [addedTo, setAddedTo] = useState<string | null>(null)
  const selectedKeyRef = useRef<string | null>(null)

  const catalog = useTelemetryCatalog((incoming) => {
    const key = selectedKeyRef.current
    if (!key) return
    const topic = incoming.topics.find((candidate) => candidate.key === key)
    if (topic && typeof topic.value === 'number' && Number.isFinite(topic.value)) {
      const value = topic.value
      setHistory((current) => [...current, value].slice(-HISTORY_LIMIT))
    }
  })

  const selected = useMemo(
    () => (selectedKey ? catalog.topics.find((topic) => topic.key === selectedKey) ?? null : null),
    [catalog.topics, selectedKey],
  )

  const select = (key: string) => {
    selectedKeyRef.current = key
    setSelectedKey(key)
    setHistory([])
    setAddedTo(null)
  }

  return (
    <div className="grid h-full min-h-0 gap-2.5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="hl-panel h-full">
        <header className="hl-panel-header">
          <h2 className="hl-panel-title">Topics</h2>
          <span className="hl-panel-meta font-sans">{catalog.stats.groupCount} groups</span>
          <span className="ml-auto">
            <StatusBadge tone={catalog.stats.online ? 'good' : 'warning'} label={catalog.stats.online ? 'live' : 'cached'} />
          </span>
        </header>
        <div className="min-h-0 flex-1 p-2.5">
          <TelemetryTopicBrowser
            topics={catalog.topics}
            searchQuery={query}
            onSearchQueryChange={setQuery}
            scopeFilter={scope}
            onScopeFilterChange={setScope}
            maxResults={300}
            emptyMessage={catalog.topics.length ? 'No topics match this filter.' : 'Waiting for the topic catalog…'}
            getAction={(topic) => ({
              label: topic.key === selectedKey ? 'Inspecting' : 'Inspect',
              disabled: topic.key === selectedKey,
              onClick: () => select(topic.key),
            })}
          />
        </div>
      </section>

      <aside className="hl-panel h-full">
        <header className="hl-panel-header">
          <h2 className="hl-panel-title">Inspector</h2>
        </header>
        {selected ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="truncate text-[14px] font-semibold">{selected.label}</span>
                <span className={cn('shrink-0 rounded-[4px] border px-1.5 text-[10px] font-medium leading-[16px]', scopeChipClass(selected.scope))}>
                  {scopeLabel(selected.scope)}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[11px] break-all text-[var(--text-faint)]">{selected.key}</div>
            </div>

            <div className="hl-well h-[88px] px-3 py-2">
              <FitValue value={selected.valueText || '—'} caption={selected.valueKind} />
            </div>

            {selected.valueKind === 'number' ? (
              <div className="hl-well h-[150px] px-2 py-1.5">
                <TimePlot values={history} decimals={2} minSpan={0.01} emptyLabel="Collecting samples…" />
              </div>
            ) : null}

            <div>
              <StatRow label="Kind" value={selected.valueKind} />
              <StatRow label="Group" value={selected.groupPath || 'root'} />
              <StatRow label="Writable" value={selected.isWritable ? 'yes' : 'no'} />
              <StatRow label="Persistent" value={selected.persistent ? 'yes' : 'no'} />
            </div>

            <TopicWriter key={selected.key} topic={selected} />

            <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-3">
              <button
                type="button"
                className="hl-btn"
                onClick={() => setAddedTo(appendTopicWidgetToSavedLayout(selected.key, selected.label))}
              >
                Add to Drive layout
              </button>
              <button type="button" className="hl-btn hl-btn-ghost" onClick={() => void navigator.clipboard?.writeText(selected.key)}>
                Copy key
              </button>
              {addedTo ? <span className="text-[11.5px] text-[var(--success)]">Added to “{addedTo}”</span> : null}
            </div>
          </div>
        ) : (
          <EmptyHint title="Select a topic">Pick any topic to see its live value, plot it and — if it is writable — tune it.</EmptyHint>
        )}
      </aside>
    </div>
  )
}
