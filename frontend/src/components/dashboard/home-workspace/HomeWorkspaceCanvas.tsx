import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../../lib/cn'
import { resolveActiveCameraFeeds } from '../../../lib/cameraFeeds'
import { useDashboardPreferences } from '../../../preferences/useDashboardPreferences'
import {
  HOME_WORKSPACE_GRID_COLUMNS,
  HOME_WORKSPACE_GRID_GAP_PX,
  HOME_WORKSPACE_GRID_ROW_PX,
  getHomeWorkspaceWidgetMaxSize,
  getHomeWorkspaceWidgetMinSize,
  type HomeWorkspacePresetWidgetConfig,
  type HomeWorkspaceWidgetConfig,
  type HomeWorkspaceWidgetRenderer as HomeWorkspaceRendererId,
  isHomeWorkspacePresetWidget,
  isHomeWorkspaceTopicWidget,
  type HomeWorkspaceWidget,
} from '../../../home-workspace/homeWorkspaceStore'
import { getHomeWorkspacePresetDefinition } from '../../../home-workspace/homeWorkspacePresets'
import type {
  AlertItem,
  BatteryHistoryPoint,
  TelemetryDerivedState,
  TelemetrySnapshot,
  TelemetryTopic,
} from '../../../types/telemetry'
import {
  HomeWorkspaceWidgetRenderer,
  allowedWidgetRenderers,
  isFullBleedWidget,
  suggestedWidgetTitle,
  widgetRendererLabel,
  type WorkspaceHistoryPoint,
} from './HomeWorkspaceWidgetRenderer'
import { TelemetryTopicBrowser, type TelemetryTopicScopeFilter } from '../TelemetryTopicBrowser'
import { CloseIcon, GearSmallIcon, GripIcon } from '../../shell/icons'

interface HomeWorkspaceCanvasProps {
  alerts: AlertItem[]
  batteryHistory: BatteryHistoryPoint[]
  derived: TelemetryDerivedState
  widgets: HomeWorkspaceWidget[]
  topics: TelemetryTopic[]
  historyByTopic: Record<string, WorkspaceHistoryPoint[]>
  editMode: boolean
  snapshot: TelemetrySnapshot
  onUpdateWidget: (
    widgetId: string,
    patch: {
      title?: string
      topicKey?: string | null
      renderer?: HomeWorkspaceRendererId
      config?: Partial<HomeWorkspaceWidgetConfig>
      presetConfig?: Partial<HomeWorkspacePresetWidgetConfig>
    },
  ) => void
  onRemoveWidget: (widgetId: string) => void
  onMoveWidget: (widgetId: string, x: number, y: number) => void
  onResizeWidget: (widgetId: string, w: number, h: number) => void
}

interface InteractionState {
  kind: 'move' | 'resize'
  widgetId: string
  startClientX: number
  startClientY: number
  minH: number
  minW: number
  maxH: number
  maxW: number
  startRect: Pick<HomeWorkspaceWidget, 'x' | 'y' | 'w' | 'h'>
  previewRect: Pick<HomeWorkspaceWidget, 'x' | 'y' | 'w' | 'h'>
  cellWidth: number
}

const UNBOUND_RENDERER_OPTIONS: HomeWorkspaceRendererId[] = [
  'auto',
  'boolean-button',
  'boolean-light',
  'boolean-pill',
  'boolean-tile',
  'text-line',
  'text-tile',
]

function clampSize(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeHeadingDegrees(value: number) {
  let normalized = value

  while (normalized > 180) {
    normalized -= 360
  }

  while (normalized < -180) {
    normalized += 360
  }

  return normalized
}

function ToolbarButton({
  children,
  onClick,
  active = false,
  title,
}: {
  children: string
  onClick: () => void
  active?: boolean
  title?: string
}) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={active} className="hl-btn h-7 px-2.5 text-[12px]">
      {children}
    </button>
  )
}

function FrameIconButton({
  onClick,
  label,
  danger = false,
  children,
}: {
  onClick: () => void
  label: string
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-faint)] transition-colors',
        danger ? 'hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]' : 'hover:bg-[var(--surface-raised)] hover:text-[var(--text)]',
      )}
    >
      {children}
    </button>
  )
}

function matchesEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function matchesSelectionBlockedTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('button, input, textarea, select, a, canvas, video, [role="button"], [contenteditable="true"]'))
  )
}

function FieldLabel({
  children,
}: {
  children: string
}) {
  return <div className="hl-label">{children}</div>
}

function PanelInput({
  value,
  onChange,
  list,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  list?: string
  placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      list={list}
      placeholder={placeholder}
      className="hl-input"
    />
  )
}

function PanelSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ id: T; label: string }>
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as T)} className="hl-input">
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function NumberField({
  label,
  defaultValue,
  onCommit,
  min,
  max,
  placeholder,
}: {
  label: string
  defaultValue: number | string
  onCommit: (value: string) => void
  min?: number
  max?: number
  placeholder?: string
}) {
  return (
    <label className="grid gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        min={min}
        max={max}
        defaultValue={defaultValue}
        placeholder={placeholder}
        onBlur={(event) => onCommit(event.target.value)}
        className="hl-input font-mono"
      />
    </label>
  )
}

function ConfigSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <h4 className="hl-eyebrow">{title}</h4>
      {children}
    </section>
  )
}

function WidgetConfigPanel({
  widget,
  topic,
  topics,
  snapshot,
  onUpdateWidget,
  onResizeWidget,
}: {
  widget: HomeWorkspaceWidget
  topic: TelemetryTopic | null
  topics: TelemetryTopic[]
  snapshot: TelemetrySnapshot
  onUpdateWidget: HomeWorkspaceCanvasProps['onUpdateWidget']
  onResizeWidget: HomeWorkspaceCanvasProps['onResizeWidget']
}) {
  const { preferences } = useDashboardPreferences()
  const [topicSearchQuery, setTopicSearchQuery] = useState('')
  const [topicScopeFilter, setTopicScopeFilter] = useState<TelemetryTopicScopeFilter>('all')
  const title = widget.title
  const widgetMinimums = getHomeWorkspaceWidgetMinSize(widget)
  const widgetMaximums = getHomeWorkspaceWidgetMaxSize(widget)
  const preset = isHomeWorkspacePresetWidget(widget) ? getHomeWorkspacePresetDefinition(widget.presetId) : null
  const resolvedCameraFeeds = useMemo(
    () => resolveActiveCameraFeeds(preferences.cameraFeeds, snapshot.bridgeStatus?.discoveredCameraFeeds ?? []),
    [preferences.cameraFeeds, snapshot.bridgeStatus?.discoveredCameraFeeds],
  )
  const cameraFeedOptions = useMemo(
    () => {
      const options = [
        { id: '__auto__', label: 'Auto / first live feed' },
        ...resolvedCameraFeeds.map((feed) => ({
          id: feed.id,
          label: `${feed.label} (${feed.source === 'auto' ? 'auto' : 'manual'})`,
        })),
      ]

      if (
        isHomeWorkspacePresetWidget(widget) &&
        widget.presetId === 'camera-stream' &&
        widget.config.cameraFeedId &&
        !resolvedCameraFeeds.some((feed) => feed.id === widget.config.cameraFeedId)
      ) {
        options.push({
          id: widget.config.cameraFeedId,
          label: `Missing feed (${widget.config.cameraFeedId})`,
        })
      }

      return options
    },
    [resolvedCameraFeeds, widget],
  )
  const rendererOptionIds = isHomeWorkspaceTopicWidget(widget)
    ? (() => {
        const baseOptions = widget.topicKey === null ? UNBOUND_RENDERER_OPTIONS : allowedWidgetRenderers(topic)
        return baseOptions.includes(widget.renderer) ? baseOptions : [widget.renderer, ...baseOptions]
      })()
    : []
  const rendererOptions = isHomeWorkspaceTopicWidget(widget)
    ? rendererOptionIds.map((renderer) => ({
        id: renderer,
        label: widgetRendererLabel(renderer),
      }))
    : []
  const topicKey = isHomeWorkspaceTopicWidget(widget) ? widget.topicKey ?? '' : ''
  const numericTopic = isHomeWorkspaceTopicWidget(widget) && topic?.valueKind === 'number'

  const handleTopicChange = (value: string) => {
    if (!isHomeWorkspaceTopicWidget(widget)) {
      return
    }

    const nextKey = value.trim() || null
    const nextTopic = nextKey ? topics.find((candidate) => candidate.key === nextKey) ?? null : null
    const nextTitle =
      !title.trim() || /^new widget$/i.test(title.trim()) ? suggestedWidgetTitle(nextTopic) : title
    const nextRenderer =
      nextTopic && widget.renderer !== 'auto' && !allowedWidgetRenderers(nextTopic).includes(widget.renderer)
        ? 'auto'
        : undefined

    onUpdateWidget(widget.id, {
      topicKey: nextKey,
      title: nextTitle,
      renderer: nextRenderer,
    })
  }

  const commitDimension = (field: 'w' | 'h', rawValue: string) => {
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) {
      return
    }

    if (field === 'w') {
      onResizeWidget(widget.id, clampSize(parsed, widgetMinimums.w, widgetMaximums.w), widget.h)
      return
    }

    onResizeWidget(widget.id, widget.w, clampSize(parsed, widgetMinimums.h, widgetMaximums.h))
  }

  const commitNumericConfig = (field: keyof HomeWorkspaceWidgetConfig, rawValue: string) => {
    if (!isHomeWorkspaceTopicWidget(widget)) {
      return
    }

    if (rawValue.trim() === '') {
      onUpdateWidget(widget.id, { config: { [field]: null } })
      return
    }

    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) {
      return
    }

    onUpdateWidget(widget.id, { config: { [field]: parsed } })
  }

  const commitSpatialTargetYaw = (rawValue: string) => {
    if (!isHomeWorkspacePresetWidget(widget) || widget.presetId !== 'spatial-view') {
      return
    }

    if (rawValue.trim() === '') {
      onUpdateWidget(widget.id, { presetConfig: { spatialTargetYawDeg: null } })
      return
    }

    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) {
      return
    }

    onUpdateWidget(widget.id, {
      presetConfig: { spatialTargetYawDeg: normalizeHeadingDegrees(parsed) },
    })
  }

  return (
    <div className="grid gap-5">
      <ConfigSection title="Panel">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <FieldLabel>Title</FieldLabel>
            <PanelInput value={title} onChange={(value) => onUpdateWidget(widget.id, { title: value })} />
          </label>

          {isHomeWorkspaceTopicWidget(widget) ? (
            <label className="grid gap-1.5">
              <FieldLabel>Display as</FieldLabel>
              <PanelSelect
                value={widget.renderer}
                onChange={(value) => onUpdateWidget(widget.id, { renderer: value })}
                options={rendererOptions}
              />
            </label>
          ) : (
            <div className="grid gap-1.5">
              <FieldLabel>Type</FieldLabel>
              <div className="hl-input flex items-center text-[var(--text-secondary)]">{preset?.label ?? 'Preset panel'}</div>
            </div>
          )}
        </div>
        {!isHomeWorkspaceTopicWidget(widget) && preset?.description ? (
          <p className="text-[11.5px] text-[var(--text-faint)]">{preset.description}</p>
        ) : null}
      </ConfigSection>

      {isHomeWorkspaceTopicWidget(widget) ? (
        <ConfigSection title="Topic">
          <PanelInput value={topicKey} onChange={handleTopicChange} placeholder="/robot/topic/path" />
          <div className="h-[260px]">
            <TelemetryTopicBrowser
              topics={topics}
              searchQuery={topicSearchQuery}
              onSearchQueryChange={setTopicSearchQuery}
              scopeFilter={topicScopeFilter}
              onScopeFilterChange={setTopicScopeFilter}
              maxResults={40}
              emptyMessage="No live topics matched this filter."
              getAction={(candidate) => ({
                label: candidate.key === topicKey ? 'Bound' : 'Use',
                disabled: candidate.key === topicKey,
                onClick: () => handleTopicChange(candidate.key),
              })}
            />
          </div>
        </ConfigSection>
      ) : null}

      {isHomeWorkspacePresetWidget(widget) && widget.presetId === 'camera-stream' ? (
        <ConfigSection title="Camera">
          <PanelSelect
            value={widget.config.cameraFeedId ?? '__auto__'}
            onChange={(value) =>
              onUpdateWidget(widget.id, {
                presetConfig: { cameraFeedId: value === '__auto__' ? null : value },
              })
            }
            options={cameraFeedOptions}
          />
          {resolvedCameraFeeds.length === 0 ? (
            <p className="text-[11.5px] text-[var(--text-faint)]">
              No live feed right now. In simulation, turn the camera on; on hardware, add a manual feed in Settings.
            </p>
          ) : null}
        </ConfigSection>
      ) : null}

      {isHomeWorkspacePresetWidget(widget) && widget.presetId === 'spatial-view' ? (
        <ConfigSection title="Goal heading">
          <div className="flex flex-wrap items-center gap-1.5">
            <ToolbarButton
              active={widget.config.spatialTargetYawDeg === null}
              onClick={() => onUpdateWidget(widget.id, { presetConfig: { spatialTargetYawDeg: null } })}
            >
              Follow path
            </ToolbarButton>
            {([0, 90, 180, -90] as const).map((targetYawDeg) => (
              <ToolbarButton
                key={targetYawDeg}
                active={widget.config.spatialTargetYawDeg === targetYawDeg}
                onClick={() => onUpdateWidget(widget.id, { presetConfig: { spatialTargetYawDeg: targetYawDeg } })}
              >
                {`${targetYawDeg}°`}
              </ToolbarButton>
            ))}
            <input
              key={widget.config.spatialTargetYawDeg ?? 'auto'}
              type="number"
              step={5}
              defaultValue={widget.config.spatialTargetYawDeg ?? ''}
              placeholder="custom °"
              onBlur={(event) => commitSpatialTargetYaw(event.target.value)}
              className="hl-input h-7 w-[96px] font-mono"
            />
          </div>
          <p className="text-[11.5px] text-[var(--text-faint)]">Locks the arrival heading used by the goal preview.</p>
        </ConfigSection>
      ) : null}

      {isHomeWorkspaceTopicWidget(widget) ? (
        <ConfigSection title="Format">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Decimals"
              min={0}
              max={4}
              defaultValue={widget.config.decimals}
              onCommit={(value) => onUpdateWidget(widget.id, { config: { decimals: clampSize(Number(value) || 0, 0, 4) } })}
            />
            <label className="grid gap-1.5">
              <FieldLabel>Unit</FieldLabel>
              <PanelInput
                value={widget.config.units}
                onChange={(value) => onUpdateWidget(widget.id, { config: { units: value.slice(0, 16) } })}
                placeholder="V, mm, %"
              />
            </label>
          </div>
        </ConfigSection>
      ) : null}

      {numericTopic ? (
        <ConfigSection title="Thresholds">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField label="Warn below" defaultValue={widget.config.warningMin ?? ''} onCommit={(value) => commitNumericConfig('warningMin', value)} />
            <NumberField label="Warn above" defaultValue={widget.config.warningMax ?? ''} onCommit={(value) => commitNumericConfig('warningMax', value)} />
            <NumberField label="Critical below" defaultValue={widget.config.criticalMin ?? ''} onCommit={(value) => commitNumericConfig('criticalMin', value)} />
            <NumberField label="Critical above" defaultValue={widget.config.criticalMax ?? ''} onCommit={(value) => commitNumericConfig('criticalMax', value)} />
          </div>
          <p className="text-[11.5px] text-[var(--text-faint)]">
            Values outside these limits turn amber or red. Gauge and bar use the critical limits as their range.
          </p>
        </ConfigSection>
      ) : null}

      <ConfigSection title="Size">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label={`Width (${widgetMinimums.w}–${widgetMaximums.w} columns)`}
            min={widgetMinimums.w}
            max={widgetMaximums.w}
            defaultValue={widget.w}
            onCommit={(value) => commitDimension('w', value)}
          />
          <NumberField
            label={`Height (${widgetMinimums.h}–${widgetMaximums.h} rows)`}
            min={widgetMinimums.h}
            max={widgetMaximums.h}
            defaultValue={widget.h}
            onCommit={(value) => commitDimension('h', value)}
          />
        </div>
      </ConfigSection>
    </div>
  )
}

function WidgetConfigModal({
  editMode,
  onClose,
  onRemoveWidget,
  onResizeWidget,
  onUpdateWidget,
  snapshot,
  topic,
  topics,
  widget,
}: {
  editMode: boolean
  onClose: () => void
  onRemoveWidget: HomeWorkspaceCanvasProps['onRemoveWidget']
  onResizeWidget: HomeWorkspaceCanvasProps['onResizeWidget']
  onUpdateWidget: HomeWorkspaceCanvasProps['onUpdateWidget']
  snapshot: TelemetrySnapshot
  topic: TelemetryTopic | null
  topics: TelemetryTopic[]
  widget: HomeWorkspaceWidget
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`widget-config-title-${widget.id}`}
        onClick={(event) => event.stopPropagation()}
        className="hl-panel relative z-[1] max-h-[min(86vh,820px)] w-full max-w-[720px] bg-[var(--surface)] shadow-[var(--card-shadow-strong)]"
      >
        <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 id={`widget-config-title-${widget.id}`} className="truncate text-[14px] font-semibold">
              {widget.title || 'Panel settings'}
            </h3>
            <div className="truncate font-mono text-[11px] text-[var(--text-faint)]">
              {isHomeWorkspaceTopicWidget(widget) ? widget.topicKey ?? 'no topic' : 'preset panel'}
            </div>
          </div>
          {editMode ? (
            <button
              type="button"
              onClick={() => {
                onRemoveWidget(widget.id)
                onClose()
              }}
              className="hl-btn hl-btn-ghost text-[var(--danger)]"
            >
              Remove
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="hl-btn hl-btn-primary">
            Done
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-4 py-4">
          <WidgetConfigPanel
            key={widget.id}
            widget={widget}
            topic={topic}
            topics={topics}
            snapshot={snapshot}
            onUpdateWidget={onUpdateWidget}
            onResizeWidget={onResizeWidget}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function HomeWorkspaceCanvas({
  alerts,
  batteryHistory,
  derived,
  widgets,
  topics,
  historyByTopic,
  editMode,
  snapshot,
  onUpdateWidget,
  onRemoveWidget,
  onMoveWidget,
  onResizeWidget,
}: HomeWorkspaceCanvasProps) {
  const topicMap = useMemo(() => new Map(topics.map((topic) => [topic.key, topic])), [topics])
  const gridRef = useRef<HTMLDivElement | null>(null)
  const interactionRef = useRef<InteractionState | null>(null)
  const [interaction, setInteraction] = useState<InteractionState | null>(null)
  const [configuredWidgetId, setConfiguredWidgetId] = useState<string | null>(null)
  const [selectedWidgetIdState, setSelectedWidgetId] = useState<string | null>(null)

  const syncInteraction = (next: InteractionState | null) => {
    interactionRef.current = next
    setInteraction(next)
  }

  const configuredWidget = configuredWidgetId
    ? widgets.find((candidate) => candidate.id === configuredWidgetId) ?? null
    : null
  const configuredTopic =
    configuredWidget && isHomeWorkspaceTopicWidget(configuredWidget) && configuredWidget.topicKey
      ? topicMap.get(configuredWidget.topicKey) ?? null
      : null
  const selectedWidgetId =
    editMode && selectedWidgetIdState && widgets.some((widget) => widget.id === selectedWidgetIdState)
      ? selectedWidgetIdState
      : null

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!editMode || configuredWidgetId) {
        return
      }

      if (matchesEditableTarget(event.target)) {
        return
      }

      if (event.key === 'Escape') {
        if (selectedWidgetId !== null) {
          event.preventDefault()
          setSelectedWidgetId(null)
        }
        return
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedWidgetId) {
        event.preventDefault()
        onRemoveWidget(selectedWidgetId)
        setSelectedWidgetId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [configuredWidgetId, editMode, onRemoveWidget, selectedWidgetId])

  const beginInteraction = (
    event: ReactPointerEvent<HTMLElement>,
    widget: HomeWorkspaceWidget,
    kind: 'move' | 'resize',
  ) => {
    if (!editMode || !gridRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const rect = gridRef.current.getBoundingClientRect()
    const cellWidth =
      (rect.width - HOME_WORKSPACE_GRID_GAP_PX * (HOME_WORKSPACE_GRID_COLUMNS - 1)) / HOME_WORKSPACE_GRID_COLUMNS
    const minimums = getHomeWorkspaceWidgetMinSize(widget)
    const maximums = getHomeWorkspaceWidgetMaxSize(widget)
    setSelectedWidgetId(widget.id)

    syncInteraction({
      kind,
      widgetId: widget.id,
      minH: minimums.h,
      minW: minimums.w,
      maxH: maximums.h,
      maxW: maximums.w,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: {
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
      },
      previewRect: {
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
      },
      cellWidth,
    })
  }

  const handlePointerMove = useEffectEvent((event: PointerEvent) => {
    setInteraction((current) => {
      if (!current) {
        return current
      }

      const deltaColumns = Math.round((event.clientX - current.startClientX) / (current.cellWidth + HOME_WORKSPACE_GRID_GAP_PX))
      const deltaRows = Math.round((event.clientY - current.startClientY) / (HOME_WORKSPACE_GRID_ROW_PX + HOME_WORKSPACE_GRID_GAP_PX))

      if (current.kind === 'move') {
        const nextRect = {
          ...current.previewRect,
          x: Math.max(0, Math.min(HOME_WORKSPACE_GRID_COLUMNS - current.startRect.w, current.startRect.x + deltaColumns)),
          y: Math.max(0, current.startRect.y + deltaRows),
        }

        if (
          nextRect.x === current.previewRect.x &&
          nextRect.y === current.previewRect.y
        ) {
          return current
        }

        const next = {
          ...current,
          previewRect: nextRect,
        }
        interactionRef.current = next
        return next
      }

      const nextRect = {
        ...current.previewRect,
        w: clampSize(current.startRect.w + deltaColumns, current.minW, current.maxW),
        h: clampSize(current.startRect.h + deltaRows, current.minH, current.maxH),
      }

      nextRect.w = Math.min(nextRect.w, HOME_WORKSPACE_GRID_COLUMNS - current.startRect.x)

      if (
        nextRect.w === current.previewRect.w &&
        nextRect.h === current.previewRect.h
      ) {
        return current
      }

      const next = {
        ...current,
        previewRect: nextRect,
      }
      interactionRef.current = next
      return next
    })
  })

  const handlePointerUp = useEffectEvent(() => {
    const current = interactionRef.current
    if (!current) {
      return
    }

    if (current.kind === 'move') {
      onMoveWidget(current.widgetId, current.previewRect.x, current.previewRect.y)
    } else {
      onResizeWidget(current.widgetId, current.previewRect.w, current.previewRect.h)
    }

    syncInteraction(null)
  })

  useEffect(() => {
    if (!interaction) {
      return
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [interaction])

  return (
    <>
      <div
        ref={gridRef}
        className="relative grid min-h-full min-w-0"
        style={{
          gridTemplateColumns: `repeat(${HOME_WORKSPACE_GRID_COLUMNS}, minmax(0, 1fr))`,
          gridAutoRows: `${HOME_WORKSPACE_GRID_ROW_PX}px`,
          gap: `${HOME_WORKSPACE_GRID_GAP_PX}px`,
          ...(editMode
            ? {
                backgroundImage: 'radial-gradient(circle, var(--border-strong) 1px, transparent 1.2px)',
                backgroundSize: `calc((100% + ${HOME_WORKSPACE_GRID_GAP_PX}px) / ${HOME_WORKSPACE_GRID_COLUMNS}) ${HOME_WORKSPACE_GRID_ROW_PX + HOME_WORKSPACE_GRID_GAP_PX}px`,
                backgroundPosition: `-${HOME_WORKSPACE_GRID_GAP_PX / 2}px -${HOME_WORKSPACE_GRID_GAP_PX / 2}px`,
              }
            : null),
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setSelectedWidgetId(null)
          }
        }}
      >
        {widgets.map((widget) => {
          const previewRect =
            interaction?.widgetId === widget.id
              ? interaction.previewRect
              : {
                  x: widget.x,
                  y: widget.y,
                  w: widget.w,
                  h: widget.h,
                }
          const topic = isHomeWorkspaceTopicWidget(widget) && widget.topicKey ? topicMap.get(widget.topicKey) ?? null : null
          const history = isHomeWorkspaceTopicWidget(widget) && widget.topicKey ? historyByTopic[widget.topicKey] ?? [] : []
          const selected = selectedWidgetId === widget.id
          const dragging = interaction?.widgetId === widget.id
          const fullBleed = isFullBleedWidget(widget)
          const openConfig = () => {
            setSelectedWidgetId(widget.id)
            setConfiguredWidgetId(widget.id)
          }

          return (
            <div
              key={widget.id}
              className={cn('min-h-0 min-w-0', dragging ? 'z-[3]' : selected ? 'z-[2]' : 'z-[1]')}
              style={{
                gridColumn: `${previewRect.x + 1} / span ${previewRect.w}`,
                gridRow: `${previewRect.y + 1} / span ${previewRect.h}`,
              }}
            >
              <article
                aria-selected={editMode ? selected : undefined}
                onClick={(event) => {
                  if (!editMode || matchesSelectionBlockedTarget(event.target)) {
                    return
                  }

                  setSelectedWidgetId(widget.id)
                }}
                className={cn(
                  'hl-panel group @container h-full transition-[border-color,box-shadow]',
                  dragging
                    ? 'border-[var(--primary)] shadow-[0_12px_32px_rgba(0,0,0,0.45)]'
                    : selected
                      ? 'border-[color-mix(in_srgb,var(--primary)_55%,transparent)]'
                      : editMode
                        ? 'border-dashed border-[var(--border-strong)]'
                        : '',
                )}
              >
                <header
                  className={cn(
                    'flex h-8 shrink-0 items-center gap-1.5 border-b border-[var(--border)] pr-1.5 pl-2.5',
                    editMode && 'cursor-grab touch-none active:cursor-grabbing',
                  )}
                  onPointerDown={
                    editMode
                      ? (event) => {
                          if (matchesSelectionBlockedTarget(event.target)) return
                          beginInteraction(event, widget, 'move')
                        }
                      : undefined
                  }
                  title={editMode ? 'Drag to move' : undefined}
                >
                  {editMode ? <GripIcon className="-ml-1 shrink-0 text-[var(--text-faint)]" /> : null}
                  <span className="hl-panel-title text-[12px]">{widget.title}</span>
                  {isHomeWorkspaceTopicWidget(widget) && widget.topicKey ? (
                    <span className="hl-panel-meta hidden text-[10.5px] @[300px]:inline" title={widget.topicKey}>
                      {widget.topicKey}
                    </span>
                  ) : null}
                  <div
                    className={cn(
                      'ml-auto flex shrink-0 items-center gap-0.5 transition-opacity',
                      editMode || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
                    )}
                  >
                    <FrameIconButton onClick={openConfig} label="Panel settings">
                      <GearSmallIcon />
                    </FrameIconButton>
                    {editMode ? (
                      <FrameIconButton
                        danger
                        label="Remove panel"
                        onClick={() => {
                          onRemoveWidget(widget.id)
                          setSelectedWidgetId((current) => (current === widget.id ? null : current))
                        }}
                      >
                        <CloseIcon width="14" height="14" />
                      </FrameIconButton>
                    ) : null}
                  </div>
                </header>

                <div className={cn('relative min-h-0 flex-1 overflow-hidden', fullBleed ? '' : 'p-2.5')}>
                  <HomeWorkspaceWidgetRenderer
                    widget={widget}
                    topic={topic}
                    topicMap={topicMap}
                    history={history}
                    snapshot={snapshot}
                    derived={derived}
                    alerts={alerts}
                    batteryHistory={batteryHistory}
                    onUpdateWidget={onUpdateWidget}
                    onConfigure={openConfig}
                  />
                </div>

                {editMode ? (
                  <div
                    role="presentation"
                    onPointerDown={(event) => beginInteraction(event, widget, 'resize')}
                    className="absolute right-0 bottom-0 z-[2] h-4 w-4 cursor-se-resize"
                    title="Drag to resize"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-full w-full text-[var(--text-muted)]">
                      <path d="M14 6v8H6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </div>
                ) : null}
              </article>
            </div>
          )
        })}
      </div>

      {configuredWidget ? (
        <WidgetConfigModal
          widget={configuredWidget}
          topic={configuredTopic}
          topics={topics}
          snapshot={snapshot}
          editMode={editMode}
          onClose={() => setConfiguredWidgetId(null)}
          onUpdateWidget={onUpdateWidget}
          onResizeWidget={onResizeWidget}
          onRemoveWidget={onRemoveWidget}
        />
      ) : null}
    </>
  )
}
