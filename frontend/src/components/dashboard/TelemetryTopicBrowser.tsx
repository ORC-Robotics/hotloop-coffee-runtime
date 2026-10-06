/* eslint-disable react-refresh/only-export-components */

import { useDeferredValue, useMemo } from 'react'
import { cn } from '../../lib/cn'
import type { TelemetryTopic, TelemetryTopicScope } from '../../types/telemetry'

export type TelemetryTopicScopeFilter = 'all' | TelemetryTopicScope

export const TELEMETRY_TOPIC_SCOPE_FILTERS: TelemetryTopicScopeFilter[] = [
  'all',
  'telemetry',
  'debug',
  'config',
  'auto-mode',
  'other',
]

export function scopeLabel(scope: TelemetryTopicScope) {
  if (scope === 'telemetry') return 'Telemetry'
  if (scope === 'debug') return 'Debug'
  if (scope === 'config') return 'Config'
  if (scope === 'auto-mode') return 'Auto Mode'
  return 'Other'
}

export function scopeChipClass(scope: TelemetryTopicScope) {
  if (scope === 'telemetry') return 'border-transparent bg-[var(--surface-raised)] text-[var(--series-1)]'
  if (scope === 'debug') return 'border-transparent bg-[var(--surface-raised)] text-[var(--warning)]'
  if (scope === 'config') return 'border-transparent bg-[var(--surface-raised)] text-[var(--series-4)]'
  if (scope === 'auto-mode') return 'border-transparent bg-[var(--surface-raised)] text-[var(--accent)]'
  return 'border-transparent bg-[var(--surface-raised)] text-[var(--text-muted)]'
}

export function isTelemetryTopicSearchMatch(topic: TelemetryTopic, query: string) {
  if (!query) {
    return true
  }

  const searchable = `${topic.key} ${topic.label} ${topic.groupPath} ${topic.valueText}`.toLowerCase()
  return searchable.includes(query)
}

interface TelemetryTopicBrowserAction {
  disabled?: boolean
  label: string
  onClick: () => void
}

interface TelemetryTopicBrowserProps {
  emptyMessage: string
  getAction: (topic: TelemetryTopic) => TelemetryTopicBrowserAction
  listClassName?: string
  maxResults?: number
  scopeFilter: TelemetryTopicScopeFilter
  onScopeFilterChange: (scope: TelemetryTopicScopeFilter) => void
  onSearchQueryChange: (value: string) => void
  searchPlaceholder?: string
  searchQuery: string
  topics: TelemetryTopic[]
}

function TelemetryTopicRow({
  topic,
  action,
}: {
  topic: TelemetryTopic
  action: TelemetryTopicBrowserAction
}) {
  return (
    <div
      onClick={(event) => {
        if (!action.disabled && !(event.target as HTMLElement).closest('button')) action.onClick()
      }}
      className={cn(
        'group grid cursor-pointer grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_auto] items-center gap-3 border-b border-[var(--border)] px-2.5 py-1.5 last:border-b-0 hover:bg-[var(--surface-raised)]',
        action.disabled && 'bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)]',
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12.5px] text-[var(--text)]">{topic.label}</span>
          <span className={cn('shrink-0 rounded-[4px] border px-1.5 text-[10px] font-medium leading-[16px]', scopeChipClass(topic.scope))}>
            {scopeLabel(topic.scope)}
          </span>
          {topic.isWritable ? (
            <span className="shrink-0 text-[10px] font-medium text-[var(--success)]" title="Writable topic">
              rw
            </span>
          ) : null}
        </div>
        <div className="truncate font-mono text-[11px] text-[var(--text-faint)]" title={topic.key}>
          {topic.key}
        </div>
      </div>
      <div className="min-w-0 truncate text-right font-mono text-[12px] text-[var(--text-secondary)]" title={topic.valueText}>
        {topic.valueText}
        <span className="ml-1.5 text-[10px] text-[var(--text-faint)]">{topic.valueKind}</span>
      </div>
      <button type="button" onClick={action.onClick} disabled={action.disabled} className="hl-btn h-7 px-2.5 text-[12px]">
        {action.label}
      </button>
    </div>
  )
}

export function TelemetryTopicBrowser({
  emptyMessage,
  getAction,
  listClassName,
  maxResults = 80,
  scopeFilter,
  onScopeFilterChange,
  onSearchQueryChange,
  searchPlaceholder = 'Config/Reactive/Turn Gain',
  searchQuery,
  topics,
}: TelemetryTopicBrowserProps) {
  const deferredQuery = useDeferredValue(searchQuery.trim().toLowerCase())

  const filteredTopics = useMemo(() => {
    return topics.filter((topic) => {
      if (scopeFilter !== 'all' && topic.scope !== scopeFilter) {
        return false
      }

      return isTelemetryTopicSearchMatch(topic, deferredQuery)
    })
  }, [deferredQuery, scopeFilter, topics])

  const visibleTopics = filteredTopics.slice(0, maxResults)

  const scopeCounts = useMemo(() => {
    return {
      telemetry: topics.filter((topic) => topic.scope === 'telemetry').length,
      debug: topics.filter((topic) => topic.scope === 'debug').length,
      config: topics.filter((topic) => topic.scope === 'config').length,
      'auto-mode': topics.filter((topic) => topic.scope === 'auto-mode').length,
      other: topics.filter((topic) => topic.scope === 'other').length,
    } satisfies Record<TelemetryTopicScope, number>
  }, [topics])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <input
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        placeholder={`Search topics — ${searchPlaceholder}`}
        aria-label="Search topics by key, group or value"
        className="hl-input h-8 font-mono text-[12px]"
      />

      <div className="flex flex-wrap items-center gap-1">
        {TELEMETRY_TOPIC_SCOPE_FILTERS.map((scope) => {
          const active = scope === scopeFilter
          const label = scope === 'all' ? 'All' : scopeLabel(scope)
          const count = scope === 'all' ? topics.length : scopeCounts[scope]

          return (
            <button
              key={scope}
              type="button"
              onClick={() => onScopeFilterChange(scope)}
              aria-pressed={active}
              className="hl-btn h-6 gap-1 rounded-[6px] px-2 text-[11.5px]"
            >
              {label}
              <span className="font-mono text-[10.5px] text-[var(--text-faint)]">{count}</span>
            </button>
          )
        })}
        <span className="ml-auto text-[11px] text-[var(--text-faint)]">
          {visibleTopics.length} / {filteredTopics.length}
        </span>
      </div>

      <div className={cn('hl-well min-h-0 flex-1 overflow-auto', listClassName)}>
        {visibleTopics.length ? (
          visibleTopics.map((topic) => <TelemetryTopicRow key={topic.key} topic={topic} action={getAction(topic)} />)
        ) : (
          <div className="px-4 py-6 text-center text-[12px] text-[var(--text-faint)]">{emptyMessage}</div>
        )}
      </div>

      {filteredTopics.length > visibleTopics.length ? (
        <div className="text-[11px] text-[var(--text-faint)]">Showing the first {maxResults} matches — refine the search to see more.</div>
      ) : null}
    </div>
  )
}
