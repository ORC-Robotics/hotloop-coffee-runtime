import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { HOME_WORKSPACE_PRESET_DEFINITIONS, type HomeWorkspacePresetId } from '../../home-workspace/homeWorkspacePresets'
import { isHomeWorkspaceTopicWidget } from '../../home-workspace/homeWorkspaceStore'
import { useTelemetryCatalog } from '../../hooks/useTelemetryCatalog'
import { useHomeWorkspace } from '../../home-workspace/useHomeWorkspace'
import type {
  AlertItem,
  BatteryHistoryPoint,
  TelemetryDerivedState,
  TelemetrySnapshot,
  TelemetryTopic,
} from '../../types/telemetry'
import { EditIcon, PlusIcon } from '../shell/icons'
import { EmptyHint } from '../viz/viz'
import { HomeWorkspaceCanvas } from './home-workspace/HomeWorkspaceCanvas'
import type { WorkspaceHistoryPoint } from './home-workspace/HomeWorkspaceWidgetRenderer'

const HISTORY_LIMIT = 64

function getNumericTopicValue(topic: TelemetryTopic | null) {
  if (!topic || topic.valueKind !== 'number' || typeof topic.value !== 'number' || !Number.isFinite(topic.value)) {
    return null
  }

  return topic.value
}

function AddPanelMenu({
  onAddTopic,
  onAddIndicator,
  onAddToggle,
  onAddPreset,
}: {
  onAddTopic: () => void
  onAddIndicator: () => void
  onAddToggle: () => void
  onAddPreset: (presetId: HomeWorkspacePresetId) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  const pick = (action: () => void) => () => {
    action()
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <button type="button" className="hl-btn h-7 px-2.5 text-[12px]" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <PlusIcon width="14" height="14" />
        Add panel
      </button>
      {open ? (
        <div className="hl-panel absolute top-[calc(100%+6px)] right-0 z-[40] w-[300px] bg-[var(--surface-alt)] p-1 shadow-[var(--card-shadow-strong)]">
          <div className="hl-eyebrow px-2 pt-1.5 pb-1">From a topic</div>
          {[
            { label: 'Value / plot', hint: 'Any number, text or boolean topic', action: onAddTopic },
            { label: 'Indicator', hint: 'On/off light for a boolean topic', action: onAddIndicator },
            { label: 'Toggle button', hint: 'Write a boolean topic', action: onAddToggle },
          ].map((item) => (
            <button key={item.label} type="button" onClick={pick(item.action)} className="flex w-full flex-col rounded-[6px] px-2 py-1.5 text-left hover:bg-[var(--surface-raised)]">
              <span className="text-[12.5px] text-[var(--text)]">{item.label}</span>
              <span className="text-[11px] text-[var(--text-faint)]">{item.hint}</span>
            </button>
          ))}
          <div className="my-1 h-px bg-[var(--border)]" />
          <div className="hl-eyebrow px-2 pt-1 pb-1">Robot panels</div>
          {HOME_WORKSPACE_PRESET_DEFINITIONS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={pick(() => onAddPreset(preset.id))}
              className="flex w-full flex-col rounded-[6px] px-2 py-1.5 text-left hover:bg-[var(--surface-raised)]"
            >
              <span className="text-[12.5px] text-[var(--text)]">{preset.label}</span>
              <span className="truncate text-[11px] text-[var(--text-faint)]">{preset.description}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PageTab({
  active,
  label,
  editable,
  onSelect,
  onRename,
}: {
  active: boolean
  label: string
  editable: boolean
  onSelect: () => void
  onRename: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={label}
        onBlur={(event) => {
          onRename(event.target.value)
          setEditing(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setEditing(false)
        }}
        className="hl-input h-7 w-[120px] text-[12px]"
        aria-label="Page name"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={() => editable && setEditing(true)}
      title={editable ? 'Double-click to rename' : undefined}
      className={cn(
        'relative h-full shrink-0 px-2.5 text-[12.5px] font-medium transition-colors',
        active ? 'text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]',
      )}
    >
      {label}
      <span
        className={cn('absolute right-2 bottom-0 left-2 h-[2px] rounded-full', active ? 'bg-[var(--primary)]' : 'bg-transparent')}
      />
    </button>
  )
}

interface HomeWorkspaceShellProps {
  alerts: AlertItem[]
  batteryHistory: BatteryHistoryPoint[]
  derived: TelemetryDerivedState
  snapshot: TelemetrySnapshot
}

export function HomeWorkspaceShell({
  alerts,
  batteryHistory,
  derived,
  snapshot,
}: HomeWorkspaceShellProps) {
  const {
    workspace,
    activePage,
    canAddPage,
    setActivePage,
    renamePage,
    addPage,
    removePage,
    addTopicWidgetToActivePage,
    addBooleanStarterToActivePage,
    addBooleanButtonStarterToActivePage,
    addPresetWidgetToActivePage,
    removeWidget,
    updateWidget,
    moveWidget,
    resizeWidget,
    clearActivePage,
    loadDefaultLayoutIntoActivePage,
  } = useHomeWorkspace()
  const [editMode, setEditMode] = useState(false)
  const [historyByTopic, setHistoryByTopic] = useState<Record<string, WorkspaceHistoryPoint[]>>({})
  const widgetTopicKeysRef = useRef<string[]>([])

  useEffect(() => {
    widgetTopicKeysRef.current = workspace.pages.flatMap((page) =>
      page.widgets.flatMap((widget) => (isHomeWorkspaceTopicWidget(widget) && widget.topicKey ? [widget.topicKey] : [])),
    )
  }, [workspace.pages])

  const catalog = useTelemetryCatalog((incoming) => {
    setHistoryByTopic((current) => {
      const trackedKeys = new Set(widgetTopicKeysRef.current)
      const incomingTopicMap = new Map(incoming.topics.map((topic) => [topic.key, topic]))
      let changed = false
      const next: Record<string, WorkspaceHistoryPoint[]> = {}

      for (const key of trackedKeys) {
        const previousHistory = current[key] ?? []
        const topic = incomingTopicMap.get(key) ?? null
        const value = getNumericTopicValue(topic)

        if (value === null) {
          if (previousHistory.length) {
            next[key] = previousHistory
          }
          continue
        }

        const lastPoint = previousHistory[previousHistory.length - 1]
        if (lastPoint && lastPoint.timestamp === incoming.timestamp) {
          next[key] = previousHistory
          continue
        }

        next[key] = [...previousHistory, { timestamp: incoming.timestamp, value }].slice(-HISTORY_LIMIT)
        changed = true
      }

      if (Object.keys(current).some((key) => !trackedKeys.has(key))) {
        changed = true
      }

      return changed ? next : current
    })
  })

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex h-9 shrink-0 items-stretch gap-2 border-b border-[var(--border)]">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {workspace.pages.map((page) => (
            <PageTab
              key={page.id}
              active={page.id === activePage.id}
              label={page.title}
              editable
              onSelect={() => setActivePage(page.id)}
              onRename={(value) => renamePage(page.id, value)}
            />
          ))}
          <button
            type="button"
            onClick={addPage}
            disabled={!canAddPage}
            className="flex w-8 shrink-0 items-center justify-center text-[var(--text-faint)] hover:text-[var(--text)] disabled:opacity-30"
            title="New page"
            aria-label="New page"
          >
            <PlusIcon width="14" height="14" />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pb-1">
          {editMode ? (
            <>
              <button type="button" className="hl-btn hl-btn-ghost h-7 px-2 text-[12px]" onClick={loadDefaultLayoutIntoActivePage}>
                Reset to default
              </button>
              <button
                type="button"
                className="hl-btn hl-btn-ghost h-7 px-2 text-[12px]"
                onClick={clearActivePage}
                disabled={activePage.widgets.length === 0}
              >
                Clear
              </button>
              <button
                type="button"
                className="hl-btn hl-btn-ghost h-7 px-2 text-[12px] hover:!text-[var(--danger)]"
                onClick={() => removePage(activePage.id)}
                disabled={workspace.pages.length <= 1}
              >
                Delete page
              </button>
              <span className="mx-0.5 h-4 w-px bg-[var(--border)]" />
            </>
          ) : null}
          <AddPanelMenu
            onAddTopic={() => {
              setEditMode(true)
              addTopicWidgetToActivePage()
            }}
            onAddIndicator={() => {
              setEditMode(true)
              addBooleanStarterToActivePage()
            }}
            onAddToggle={() => {
              setEditMode(true)
              addBooleanButtonStarterToActivePage()
            }}
            onAddPreset={(presetId) => {
              setEditMode(true)
              addPresetWidgetToActivePage(presetId)
            }}
          />
          <button
            type="button"
            aria-pressed={editMode}
            onClick={() => setEditMode((current) => !current)}
            className={cn('hl-btn h-7 px-2.5 text-[12px]', editMode && 'hl-btn-primary')}
            title={editMode ? 'Lock the layout' : 'Move, resize and remove panels'}
          >
            <EditIcon />
            {editMode ? 'Done' : 'Edit layout'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pt-2 pr-0.5">
        {activePage.widgets.length ? (
          <HomeWorkspaceCanvas
            alerts={alerts}
            batteryHistory={batteryHistory}
            derived={derived}
            widgets={activePage.widgets}
            topics={catalog.topics}
            historyByTopic={historyByTopic}
            editMode={editMode}
            snapshot={snapshot}
            onUpdateWidget={updateWidget}
            onRemoveWidget={removeWidget}
            onMoveWidget={moveWidget}
            onResizeWidget={resizeWidget}
          />
        ) : (
          <div className="flex h-full min-h-[320px] items-center justify-center rounded-[10px] border border-dashed border-[var(--border-strong)]">
            <EmptyHint
              title={`${activePage.title} is empty`}
              action={
                <div className="flex flex-wrap justify-center gap-1.5">
                  <button type="button" className="hl-btn hl-btn-primary" onClick={loadDefaultLayoutIntoActivePage}>
                    Load default Drive layout
                  </button>
                  <button
                    type="button"
                    className="hl-btn"
                    onClick={() => {
                      setEditMode(true)
                      addTopicWidgetToActivePage()
                    }}
                  >
                    Add a topic panel
                  </button>
                </div>
              }
            >
              Map, pose, heading, battery, sensors and alerts — or build your own from any topic.
            </EmptyHint>
          </div>
        )}
      </div>
    </section>
  )
}
