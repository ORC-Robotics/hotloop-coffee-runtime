/* eslint-disable react-refresh/only-export-components */

import { useMemo, useState } from 'react'
import { writeTelemetryTopicValue } from '../../../data/telemetryGateway'
import { useElementSize } from '../../../hooks/useElementSize'
import { useSpatialTelemetry } from '../../../hooks/useSpatialTelemetry'
import { cn } from '../../../lib/cn'
import { clamp } from '../../../lib/format'
import { toneColor } from '../../../lib/robotThresholds'
import { getHomeWorkspacePresetDefinition } from '../../../home-workspace/homeWorkspacePresets'
import {
  type HomeWorkspacePresetWidget,
  isHomeWorkspacePresetWidget,
  type HomeWorkspaceTopicWidget,
  type HomeWorkspaceWidget,
  type HomeWorkspaceWidgetRenderer as WidgetRendererId,
} from '../../../home-workspace/homeWorkspaceStore'
import type {
  AlertItem,
  BatteryHistoryPoint,
  TelemetryDerivedState,
  TelemetrySnapshot,
  TelemetryTopic,
  UiTone,
} from '../../../types/telemetry'
import { EmptyHint, FillBar, FitValue, StatusDot, TimePlot } from '../../viz/viz'
import { AlertsPanelBody } from '../AlertsPanel'
import { BatteryPanelBody } from '../BatteryPanel'
import { CommandsPanelBody } from '../CommandsPanel'
import { HeadingPanelBody } from '../HeadingPanel'
import { SystemsHealthPanelBody } from '../SystemsHealthPanel'
import { HomeWorkspaceCameraStreamWidget } from './HomeWorkspaceCameraStreamWidget'
import { HomeWorkspaceSpatialViewWidget } from './HomeWorkspaceSpatialViewWidget'

export type WorkspaceHistoryPoint = {
  timestamp: string
  value: number
}

type WorkspaceTopicKind = 'number' | 'boolean' | 'text'

const RASPBERRY_AVAILABLE_TOPIC = 'Telemetry/Robot/Raspberry/Available'
const RASPBERRY_CPU_TOPIC = 'Telemetry/Robot/Raspberry/CPU Usage (%)'
const RASPBERRY_RAM_TOPIC = 'Telemetry/Robot/Raspberry/RAM Usage (%)'
const RASPBERRY_TEMPERATURE_TOPIC = 'Telemetry/Robot/Raspberry/Temperature (C)'

/* -------------------------------------------------------------------------- */
/* Renderer catalogue                                                         */
/* -------------------------------------------------------------------------- */

function getTopicKind(topic: TelemetryTopic | null): WorkspaceTopicKind {
  if (topic?.valueKind === 'number') return 'number'
  if (topic?.valueKind === 'boolean') return 'boolean'
  return 'text'
}

function getNumericTopicValue(topic: TelemetryTopic | null) {
  if (!topic || topic.valueKind !== 'number' || typeof topic.value !== 'number' || !Number.isFinite(topic.value)) {
    return null
  }

  return topic.value
}

export function allowedWidgetRenderers(topic: TelemetryTopic | null): WidgetRendererId[] {
  const kind = getTopicKind(topic)

  if (kind === 'boolean') {
    return topic?.isWritable ? ['auto', 'boolean-light', 'boolean-button', 'text-line'] : ['auto', 'boolean-light', 'text-line']
  }

  if (kind === 'number') {
    return ['auto', 'stat', 'number', 'sparkline', 'gauge', 'bar']
  }

  return ['auto', 'text-line']
}

export function widgetRendererLabel(renderer: WidgetRendererId) {
  if (renderer === 'number') return 'Value'
  if (renderer === 'stat') return 'Value + trend'
  if (renderer === 'gauge') return 'Gauge'
  if (renderer === 'bar') return 'Bar'
  if (renderer === 'sparkline') return 'Plot'
  if (renderer === 'boolean-button') return 'Toggle button'
  if (renderer === 'boolean-light' || renderer === 'boolean-pill' || renderer === 'boolean-tile') return 'Indicator'
  if (renderer === 'text-line' || renderer === 'text-tile') return 'Text'
  return 'Auto'
}

export function workspaceWidgetLabel(widget: HomeWorkspaceWidget) {
  if (isHomeWorkspacePresetWidget(widget)) {
    return getHomeWorkspacePresetDefinition(widget.presetId)?.label ?? 'Preset'
  }

  return widgetRendererLabel(widget.renderer)
}

export function suggestedWidgetTitle(topic: TelemetryTopic | null) {
  return topic?.label?.trim() || 'New panel'
}

/** One renderer per topic kind; size never changes which renderer is used. */
function resolveRenderer(widget: HomeWorkspaceTopicWidget, topic: TelemetryTopic | null): WidgetRendererId {
  const kind = getTopicKind(topic)

  if (widget.renderer !== 'auto' && (topic === null || allowedWidgetRenderers(topic).includes(widget.renderer))) {
    return widget.renderer
  }
  if (widget.renderer === 'boolean-pill' || widget.renderer === 'boolean-tile') return 'boolean-light'
  if (widget.renderer === 'text-tile') return 'text-line'

  if (kind === 'boolean') return 'boolean-light'
  if (kind === 'number') return 'stat'
  return 'text-line'
}

function evaluateNumericTone(value: number | null, widget: HomeWorkspaceTopicWidget): UiTone {
  if (value === null) {
    return 'neutral'
  }

  const { warningMin, warningMax, criticalMin, criticalMax } = widget.config
  if ((criticalMin !== null && value < criticalMin) || (criticalMax !== null && value > criticalMax)) {
    return 'critical'
  }
  if ((warningMin !== null && value < warningMin) || (warningMax !== null && value > warningMax)) {
    return 'warning'
  }

  const hasThresholds = [warningMin, warningMax, criticalMin, criticalMax].some((limit) => limit !== null)
  return hasThresholds ? 'good' : 'neutral'
}

function formatValue(value: number | null, decimals: number) {
  return value === null ? '--' : value.toFixed(decimals)
}

function rangeOf(widget: HomeWorkspaceTopicWidget, history: number[], value: number | null) {
  const min = widget.config.criticalMin ?? widget.config.warningMin
  const max = widget.config.criticalMax ?? widget.config.warningMax
  if (min !== null && max !== null && max > min) {
    return { min, max }
  }

  const samples = history.length ? history : value === null ? [0] : [value]
  const lo = Math.min(...samples, min ?? Number.POSITIVE_INFINITY)
  const hi = Math.max(...samples, max ?? Number.NEGATIVE_INFINITY)
  return { min: Math.min(lo, 0), max: hi > lo ? hi : lo + 1 }
}

function seriesColor(tone: UiTone) {
  return tone === 'warning' || tone === 'critical' ? toneColor(tone) : 'var(--series-1)'
}

function thresholdLines(widget: HomeWorkspaceTopicWidget) {
  const { warningMin, warningMax, criticalMin, criticalMax } = widget.config
  return [
    warningMin !== null ? { value: warningMin, tone: 'warning' as const } : null,
    warningMax !== null ? { value: warningMax, tone: 'warning' as const } : null,
    criticalMin !== null ? { value: criticalMin, tone: 'critical' as const } : null,
    criticalMax !== null ? { value: criticalMax, tone: 'critical' as const } : null,
  ].filter((line): line is { value: number; tone: 'warning' | 'critical' } => line !== null)
}

/* -------------------------------------------------------------------------- */
/* Numeric renderers                                                          */
/* -------------------------------------------------------------------------- */

interface NumericViewProps {
  value: number | null
  widget: HomeWorkspaceTopicWidget
  history: number[]
}

function ValueView({ value, widget }: NumericViewProps) {
  const tone = evaluateNumericTone(value, widget)
  return <FitValue value={formatValue(value, widget.config.decimals)} unit={widget.config.units} tone={tone} />
}

function StatView({ value, widget, history }: NumericViewProps) {
  const tone = evaluateNumericTone(value, widget)
  const [ref, size] = useElementSize<HTMLDivElement>()
  const showPlot = size.height >= 96

  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col gap-2">
      <div className={cn('min-h-0', showPlot ? 'h-[46%] max-h-[90px]' : 'flex-1')}>
        <FitValue value={formatValue(value, widget.config.decimals)} unit={widget.config.units} tone={tone} />
      </div>
      {showPlot ? (
        <div className="min-h-0 flex-1">
          <TimePlot
            values={history}
            color={seriesColor(tone)}
            decimals={widget.config.decimals}
            minSpan={Math.pow(10, -widget.config.decimals) * 4}
            thresholds={thresholdLines(widget)}
          />
        </div>
      ) : null}
    </div>
  )
}

function PlotView({ value, widget, history }: NumericViewProps) {
  const tone = evaluateNumericTone(value, widget)
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="hl-value text-[18px] font-medium" style={tone === 'warning' || tone === 'critical' ? { color: toneColor(tone) } : undefined}>
          {formatValue(value, widget.config.decimals)}
          {widget.config.units ? <span className="hl-unit">{widget.config.units}</span> : null}
        </span>
        <span className="ml-auto text-[10.5px] text-[var(--text-faint)]">{history.length} samples</span>
      </div>
      <div className="min-h-0 flex-1">
        <TimePlot
          values={history}
          color={seriesColor(tone)}
          decimals={widget.config.decimals}
          minSpan={Math.pow(10, -widget.config.decimals) * 4}
          domain={{
            min: widget.config.criticalMin ?? null,
            max: widget.config.criticalMax ?? null,
          }}
          thresholds={thresholdLines(widget)}
        />
      </div>
    </div>
  )
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const start = polar(cx, cy, r, to)
  const end = polar(cx, cy, r, from)
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${to - from <= 180 ? 0 : 1} 0 ${end.x} ${end.y}`
}

function GaugeView({ value, widget, history }: NumericViewProps) {
  const tone = evaluateNumericTone(value, widget)
  const { min, max } = rangeOf(widget, history, value)
  const ratio = value === null ? 0 : clamp((value - min) / (max - min), 0, 1)
  const end = -120 + ratio * 240
  const color = tone === 'neutral' ? 'var(--series-1)' : toneColor(tone)

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center">
      <svg viewBox="0 0 100 86" className="h-full max-h-full w-auto max-w-full" aria-hidden="true">
        <path d={arc(50, 52, 40, -120, 120)} fill="none" stroke="var(--surface-raised)" strokeWidth="7" strokeLinecap="round" />
        {value !== null ? (
          <path d={arc(50, 52, 40, -120, Math.max(-119.5, end))} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" />
        ) : null}
        <text x="50" y="54" textAnchor="middle" dominantBaseline="middle" fill="var(--text)" fontSize="17" fontFamily="var(--font-mono)" fontWeight="500">
          {formatValue(value, widget.config.decimals)}
        </text>
        {widget.config.units ? (
          <text x="50" y="68" textAnchor="middle" fill="var(--text-muted)" fontSize="7.5" fontFamily="var(--font-sans)">
            {widget.config.units}
          </text>
        ) : null}
        <text x="22" y="84" textAnchor="middle" fill="var(--text-faint)" fontSize="6.5" fontFamily="var(--font-mono)">
          {min.toFixed(widget.config.decimals)}
        </text>
        <text x="78" y="84" textAnchor="middle" fill="var(--text-faint)" fontSize="6.5" fontFamily="var(--font-mono)">
          {max.toFixed(widget.config.decimals)}
        </text>
      </svg>
    </div>
  )
}

function BarView({ value, widget, history }: NumericViewProps) {
  const tone = evaluateNumericTone(value, widget)
  const { min, max } = rangeOf(widget, history, value)
  const ratio = value === null ? 0 : (value - min) / (max - min)

  return (
    <div className="flex h-full min-h-0 flex-col justify-center gap-2">
      <div className="min-h-0 flex-1">
        <FitValue value={formatValue(value, widget.config.decimals)} unit={widget.config.units} tone={tone} />
      </div>
      <FillBar ratio={ratio} color={tone === 'neutral' ? 'var(--series-1)' : toneColor(tone)} className="h-2" />
      <div className="hl-value flex justify-between text-[10.5px] text-[var(--text-faint)]">
        <span>{min.toFixed(widget.config.decimals)}</span>
        <span>{max.toFixed(widget.config.decimals)}</span>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Boolean + text renderers                                                   */
/* -------------------------------------------------------------------------- */

function IndicatorView({ value }: { value: boolean | null }) {
  const tone: UiTone = value === null ? 'neutral' : value ? 'good' : 'critical'
  const color = toneColor(tone)

  return (
    <div
      className="flex h-full min-h-0 items-center justify-center gap-[min(4cqw,10px)] rounded-[7px] border [container-type:size]"
      style={{
        borderColor: value === null ? 'var(--border)' : `color-mix(in srgb, ${color} 40%, transparent)`,
        background: value === null ? 'var(--surface-alt)' : `color-mix(in srgb, ${color} 13%, var(--surface))`,
      }}
    >
      <span
        className="shrink-0 rounded-full"
        style={{
          width: 'clamp(8px, min(18cqh, 9cqw), 18px)',
          height: 'clamp(8px, min(18cqh, 9cqw), 18px)',
          background: color,
          boxShadow: value === null ? undefined : `0 0 14px ${color}`,
        }}
      />
      <span
        className="font-semibold tracking-[0.04em] uppercase"
        style={{ fontSize: 'clamp(11px, min(30cqh, 14cqw), 40px)', color: value === null ? 'var(--text-faint)' : 'var(--text)' }}
      >
        {value === null ? '—' : value ? 'On' : 'Off'}
      </span>
    </div>
  )
}

function ToggleButtonView({ value, topic }: { value: boolean | null; topic: TelemetryTopic | null }) {
  const [isWriting, setIsWriting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const canWrite = topic?.isWritable === true && topic.valueKind === 'boolean'
  const on = value === true

  const toggle = async () => {
    if (!canWrite || !topic || isWriting) {
      return
    }

    setIsWriting(true)
    setErrorMessage(null)
    try {
      const response = await writeTelemetryTopicValue(topic.key, 'boolean', value === null ? true : !value)
      if (response.error) {
        setErrorMessage(response.error)
      }
    } catch {
      setErrorMessage('Unable to write this topic right now.')
    } finally {
      setIsWriting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={!canWrite || isWriting}
      aria-pressed={on}
      title={errorMessage ?? (canWrite ? 'Toggle value' : 'This topic is read-only')}
      className="flex h-full min-h-0 w-full items-center justify-center gap-3 rounded-[7px] border transition-[background-color,border-color,filter] hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 [container-type:size]"
      style={{
        borderColor: on ? 'color-mix(in srgb, var(--success) 55%, transparent)' : 'var(--border-strong)',
        background: on ? 'color-mix(in srgb, var(--success) 20%, var(--surface))' : 'var(--surface-alt)',
      }}
    >
      <span
        className={cn('relative inline-flex shrink-0 items-center rounded-full border transition-colors')}
        style={{
          width: 'clamp(26px, min(36cqh, 18cqw), 44px)',
          height: 'clamp(15px, min(20cqh, 10cqw), 24px)',
          borderColor: on ? 'var(--success)' : 'var(--border-strong)',
          background: on ? 'var(--success)' : 'var(--surface-raised)',
        }}
      >
        <span
          className="absolute aspect-square h-[70%] rounded-full transition-[left]"
          style={{ left: on ? 'calc(100% - 85%)' : '12%', background: on ? '#0d1410' : 'var(--text-muted)' }}
        />
      </span>
      <span className="font-semibold uppercase" style={{ fontSize: 'clamp(11px, min(24cqh, 11cqw), 28px)', color: errorMessage ? 'var(--danger)' : 'var(--text)' }}>
        {isWriting ? '…' : errorMessage ? 'Error' : value === null ? 'Set' : on ? 'On' : 'Off'}
      </span>
    </button>
  )
}

function TextView({ topic }: { topic: TelemetryTopic | null }) {
  return (
    <div className="flex h-full min-h-0 items-center [container-type:size]">
      <div
        className="hl-value line-clamp-3 break-words leading-[1.2]"
        style={{ fontSize: 'clamp(12px, min(26cqh, 9cqw), 32px)' }}
      >
        {topic?.valueText || '—'}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Presets                                                                    */
/* -------------------------------------------------------------------------- */

function PosePreset() {
  const spatial = useSpatialTelemetry()
  const pose = spatial.pose
  const freshnessTone: UiTone = !pose.available ? 'neutral' : pose.freshness === 'live' ? 'good' : pose.freshness === 'stale' ? 'warning' : 'critical'
  const values = [
    { label: 'X', value: pose.available ? (pose.xMm / 1000).toFixed(3) : '--', unit: 'm' },
    { label: 'Y', value: pose.available ? (pose.yMm / 1000).toFixed(3) : '--', unit: 'm' },
    { label: 'θ', value: pose.available ? pose.yawDeg.toFixed(1) : '--', unit: '°' },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col justify-between gap-2 [container-type:inline-size]">
      <div className="grid grid-cols-3 gap-3">
        {values.map((item) => (
          <div key={item.label} className="min-w-0">
            <div className="hl-label">{item.label}</div>
            <div className="hl-value truncate font-medium leading-tight" style={{ fontSize: 'clamp(15px, 7.4cqw, 30px)' }}>
              {item.value}
              <span className="hl-unit">{item.unit}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--text-faint)]">
        <StatusDot tone={freshnessTone} />
        <span className="truncate">
          {pose.available ? `${pose.source} · ${pose.freshness} · ${pose.frame}` : 'No pose source'}
        </span>
        <span className="hl-value ml-auto shrink-0">#{pose.sequence}</span>
      </div>
    </div>
  )
}

function raspberryTone(value: number | null, warning: number, critical: number): UiTone {
  if (value === null) return 'neutral'
  if (value >= critical) return 'critical'
  if (value >= warning) return 'warning'
  return 'good'
}

function RaspberryMonitorPreset({ topicMap }: { topicMap: Map<string, TelemetryTopic> }) {
  const availableTopic = topicMap.get(RASPBERRY_AVAILABLE_TOPIC) ?? null
  const available = availableTopic?.valueKind === 'boolean' && availableTopic.value === true
  const metrics = [
    { label: 'CPU', value: available ? getNumericTopicValue(topicMap.get(RASPBERRY_CPU_TOPIC) ?? null) : null, unit: '%', max: 100, warn: 75, crit: 90, decimals: 0 },
    { label: 'RAM', value: available ? getNumericTopicValue(topicMap.get(RASPBERRY_RAM_TOPIC) ?? null) : null, unit: '%', max: 100, warn: 75, crit: 90, decimals: 0 },
    { label: 'Temp', value: available ? getNumericTopicValue(topicMap.get(RASPBERRY_TEMPERATURE_TOPIC) ?? null) : null, unit: '°C', max: 90, warn: 65, crit: 75, decimals: 1 },
  ]

  if (!available) {
    return <EmptyHint title="Raspberry Pi not reporting">Waiting for {RASPBERRY_AVAILABLE_TOPIC}</EmptyHint>
  }

  return (
    <div className="grid h-full content-center gap-3">
      {metrics.map((metric) => {
        const tone = raspberryTone(metric.value, metric.warn, metric.crit)
        return (
          <div key={metric.label} className="grid grid-cols-[40px_minmax(0,1fr)_64px] items-center gap-2.5">
            <span className="hl-label">{metric.label}</span>
            <FillBar ratio={(metric.value ?? 0) / metric.max} color={toneColor(tone === 'neutral' ? 'good' : tone)} />
            <span className="hl-value text-right text-[13px]" style={tone === 'warning' || tone === 'critical' ? { color: toneColor(tone) } : undefined}>
              {metric.value === null ? '--' : metric.value.toFixed(metric.decimals)}
              <span className="hl-unit">{metric.unit}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function PresetWorkspaceWidgetRenderer({
  widget,
  topicMap,
  snapshot,
  derived,
  alerts,
  batteryHistory,
  onUpdateWidget,
}: {
  widget: HomeWorkspacePresetWidget
  topicMap: Map<string, TelemetryTopic>
  snapshot: TelemetrySnapshot
  derived: TelemetryDerivedState
  alerts: AlertItem[]
  batteryHistory: BatteryHistoryPoint[]
  onUpdateWidget: (widgetId: string, patch: { presetConfig?: Record<string, unknown> }) => void
}) {
  switch (widget.presetId) {
    case 'pose':
      return <PosePreset />
    case 'battery-watch':
      return <BatteryPanelBody battery={snapshot.battery} history={batteryHistory} />
    case 'heading-gyro':
      return <HeadingPanelBody data={snapshot.heading} variant="widget" />
    case 'systems-health':
      return <SystemsHealthPanelBody data={snapshot.systems} />
    case 'commands':
      return <CommandsPanelBody data={snapshot.commands} derived={derived} />
    case 'alerts':
      return <AlertsPanelBody alerts={alerts} />
    case 'raspberry-monitor':
      return <RaspberryMonitorPreset topicMap={topicMap} />
    case 'camera-stream':
      return (
        <HomeWorkspaceCameraStreamWidget
          selectedFeedId={widget.config.cameraFeedId}
          discoveredFeeds={snapshot.bridgeStatus?.discoveredCameraFeeds ?? []}
        />
      )
    case 'spatial-view':
      return <HomeWorkspaceSpatialViewWidget widget={widget} onUpdateWidget={onUpdateWidget} />
    default:
      return <EmptyHint title="Unknown panel type" />
  }
}

/** Presets that draw edge to edge (no body padding). */
export function isFullBleedWidget(widget: HomeWorkspaceWidget) {
  return isHomeWorkspacePresetWidget(widget) && (widget.presetId === 'spatial-view' || widget.presetId === 'camera-stream')
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function HomeWorkspaceWidgetRenderer({
  widget,
  topic,
  topicMap,
  history,
  snapshot,
  derived,
  alerts,
  batteryHistory,
  onUpdateWidget,
  onConfigure,
}: {
  widget: HomeWorkspaceWidget
  topic: TelemetryTopic | null
  topicMap: Map<string, TelemetryTopic>
  history: WorkspaceHistoryPoint[]
  snapshot: TelemetrySnapshot
  derived: TelemetryDerivedState
  alerts: AlertItem[]
  batteryHistory: BatteryHistoryPoint[]
  onUpdateWidget: (widgetId: string, patch: { presetConfig?: Record<string, unknown> }) => void
  onConfigure?: () => void
}) {
  const historyValues = useMemo(() => history.map((point) => point.value), [history])

  if (isHomeWorkspacePresetWidget(widget)) {
    return (
      <PresetWorkspaceWidgetRenderer
        widget={widget}
        topicMap={topicMap}
        snapshot={snapshot}
        derived={derived}
        alerts={alerts}
        batteryHistory={batteryHistory}
        onUpdateWidget={onUpdateWidget}
      />
    )
  }

  if (widget.topicKey === null) {
    return (
      <EmptyHint
        title="No topic selected"
        action={
          onConfigure ? (
            <button type="button" className="hl-btn" onClick={onConfigure}>
              Choose topic
            </button>
          ) : null
        }
      />
    )
  }

  if (!topic) {
    return (
      <EmptyHint title="Topic not published">
        <span className="font-mono">{widget.topicKey}</span>
      </EmptyHint>
    )
  }

  const numericValue = getNumericTopicValue(topic)
  const booleanValue = topic.valueKind === 'boolean' && typeof topic.value === 'boolean' ? topic.value : null
  const renderer = resolveRenderer(widget, topic)
  const numericProps = { value: numericValue, widget, history: historyValues }

  switch (renderer) {
    case 'number':
      return <ValueView {...numericProps} />
    case 'stat':
      return <StatView {...numericProps} />
    case 'sparkline':
      return <PlotView {...numericProps} />
    case 'gauge':
      return <GaugeView {...numericProps} />
    case 'bar':
      return <BarView {...numericProps} />
    case 'boolean-button':
      return <ToggleButtonView value={booleanValue} topic={topic} />
    case 'boolean-light':
    case 'boolean-pill':
    case 'boolean-tile':
      return <IndicatorView value={booleanValue} />
    default:
      return <TextView topic={topic} />
  }
}
