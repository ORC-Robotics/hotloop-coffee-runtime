import { useId, type ReactNode } from 'react'
import { useElementSize } from '../../hooks/useElementSize'
import { cn } from '../../lib/cn'
import { clamp } from '../../lib/format'
import { toneColor } from '../../lib/robotThresholds'
import type { UiTone } from '../../types/telemetry'

/* -------------------------------------------------------------------------- */
/* Readouts                                                                   */
/* -------------------------------------------------------------------------- */

const readoutSizes = {
  sm: 'text-[17px]',
  md: 'text-[24px]',
  lg: 'text-[34px]',
} as const

interface ReadoutProps {
  label: ReactNode
  value: string
  unit?: string
  tone?: UiTone
  size?: keyof typeof readoutSizes
  hint?: ReactNode
  className?: string
}

/** Label over a monospace value. Tone only colours the value when it matters. */
export function Readout({ label, value, unit, tone, size = 'md', hint, className }: ReadoutProps) {
  const colored = tone === 'warning' || tone === 'critical'

  return (
    <div className={cn('min-w-0', className)}>
      <div className="hl-label flex items-center gap-1.5 truncate">{label}</div>
      <div
        className={cn('hl-value mt-0.5 truncate leading-[1.1] font-medium', readoutSizes[size])}
        style={colored ? { color: toneColor(tone) } : undefined}
      >
        {value}
        {unit ? <span className="hl-unit">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-0.5 truncate text-[11px] text-[var(--text-faint)]">{hint}</div> : null}
    </div>
  )
}

/**
 * A single value that scales with its container (container query units), so a
 * widget reads the same way at any size instead of switching layouts.
 */
export function FitValue({
  value,
  unit,
  tone,
  caption,
  className,
}: {
  value: string
  unit?: string
  tone?: UiTone
  caption?: ReactNode
  className?: string
}) {
  const colored = tone === 'warning' || tone === 'critical'

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col justify-center [container-type:size]', className)}>
      <div
        className="hl-value truncate font-medium leading-none text-[clamp(18px,min(52cqh,19cqw),96px)]"
        style={colored ? { color: toneColor(tone) } : undefined}
      >
        {value}
        {unit ? <span className="hl-unit">{unit}</span> : null}
      </div>
      {caption ? (
        <div className="mt-[min(6cqh,8px)] truncate text-[clamp(10.5px,9cqh,12.5px)] text-[var(--text-muted)]">{caption}</div>
      ) : null}
    </div>
  )
}

export function StatRow({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: UiTone }) {
  const colored = tone === 'warning' || tone === 'critical'
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-[3px]">
      <span className="hl-label min-w-[3ch] truncate">{label}</span>
      <span
        className="hl-value max-w-[78%] min-w-0 shrink-0 truncate text-right text-[12.5px]"
        style={colored ? { color: toneColor(tone) } : undefined}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

export function StatusDot({ tone, pulse = false, className }: { tone: UiTone; pulse?: boolean; className?: string }) {
  return (
    <span
      className={cn('hl-dot', pulse && 'animate-hl-pulse', className)}
      style={{
        background: toneColor(tone),
        boxShadow: tone === 'neutral' ? undefined : `0 0 8px color-mix(in srgb, ${toneColor(tone)} 60%, transparent)`,
      }}
    />
  )
}

/** Flat boolean indicator — label plus a tone-coloured state, no gloss. */
export function BoolIndicator({
  label,
  value,
  onLabel = 'on',
  offLabel = 'off',
  offTone = 'critical',
}: {
  label: ReactNode
  value: boolean | null
  onLabel?: string
  offLabel?: string
  offTone?: UiTone
}) {
  const tone: UiTone = value === null ? 'neutral' : value ? 'good' : offTone
  return (
    <div className="hl-well flex min-w-0 items-center gap-2 px-2.5 py-2 h-lt-120:py-1.5" title={typeof label === 'string' ? label : undefined}>
      <StatusDot tone={tone} />
      <span className="truncate text-[12.5px] text-[var(--text-secondary)]">{label}</span>
      <span className="ml-auto shrink-0 text-[11.5px] font-medium" style={{ color: value === null ? 'var(--text-faint)' : toneColor(tone) }}>
        {value === null ? '—' : value ? onLabel : offLabel}
      </span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Bars                                                                       */
/* -------------------------------------------------------------------------- */

/** Fill bar for a 0..1 ratio. */
export function FillBar({ ratio, color = 'var(--primary)', className }: { ratio: number; color?: string; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-[var(--surface-raised)]', className)}>
      <div
        className="h-full rounded-full transition-[width] duration-200"
        style={{ width: `${clamp(ratio, 0, 1) * 100}%`, background: color }}
      />
    </div>
  )
}

/** Bidirectional bar for a -1..1 command, filled from the centre. */
export function CenterBar({ value, color = 'var(--primary)', className }: { value: number; color?: string; className?: string }) {
  const magnitude = clamp(Math.abs(value), 0, 1) * 50
  return (
    <div className={cn('relative h-1.5 rounded-full bg-[var(--surface-raised)]', className)}>
      <div className="absolute inset-y-[-3px] left-1/2 w-px bg-[var(--border-strong)]" />
      <div
        className="absolute inset-y-0 rounded-full transition-[width,left] duration-100"
        style={{
          left: value >= 0 ? '50%' : `${50 - magnitude}%`,
          width: `${magnitude}%`,
          background: color,
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Compass                                                                    */
/* -------------------------------------------------------------------------- */

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r }
}

/** Heading dial: needle for current yaw, ember marker for the target. */
export function Compass({ yawDeg, targetDeg, className }: { yawDeg: number; targetDeg?: number | null; className?: string }) {
  const c = 50
  const r = 40
  const tip = polar(c, c, r - 6, yawDeg)
  const tail = polar(c, c, 10, yawDeg + 180)
  const target = targetDeg === null || targetDeg === undefined ? null : polar(c, c, r + 1, targetDeg)

  return (
    <svg viewBox="0 0 100 100" className={cn('aspect-square', className)} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="var(--surface-alt)" stroke="var(--border-strong)" strokeWidth="1" />
      {Array.from({ length: 36 }, (_, index) => {
        const deg = index * 10
        const major = deg % 90 === 0
        const a = polar(c, c, r, deg)
        const b = polar(c, c, r - (major ? 6 : 3), deg)
        return (
          <line
            key={deg}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={major ? 'var(--text-muted)' : 'var(--border-strong)'}
            strokeWidth={major ? 1.2 : 0.8}
          />
        )
      })}
      {target ? <circle cx={target.x} cy={target.y} r="3.2" fill="var(--primary)" stroke="var(--surface)" strokeWidth="1" /> : null}
      <line x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx={c} cy={c} r="3.4" fill="var(--surface)" stroke="var(--text)" strokeWidth="1.2" />
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/* Time plot                                                                  */
/* -------------------------------------------------------------------------- */

function niceDomain(values: number[], minSpan: number, fixed?: { min?: number | null; max?: number | null }) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 1
  }

  const span = Math.max(max - min, minSpan)
  const middle = (max + min) / 2
  let lo = middle - span / 2 - span * 0.12
  let hi = middle + span / 2 + span * 0.12

  if (fixed?.min !== null && fixed?.min !== undefined) lo = fixed.min
  if (fixed?.max !== null && fixed?.max !== undefined) hi = fixed.max
  if (hi - lo < 1e-9) hi = lo + 1

  return { lo, hi }
}

function formatTick(value: number, decimals: number) {
  const abs = Math.abs(value)
  if (abs >= 10000) return `${(value / 1000).toFixed(0)}k`
  return value.toFixed(decimals)
}

interface PlotThreshold {
  value: number
  tone: UiTone
}

/**
 * Live line plot sized in real pixels (no stretched strokes or text) with a
 * light grid, right-hand axis labels, area fill and a marker on the newest sample.
 */
export function TimePlot({
  values,
  color = 'var(--series-1)',
  decimals = 1,
  minSpan = 0.5,
  domain,
  thresholds = [],
  className,
  emptyLabel = 'Waiting for samples',
}: {
  values: number[]
  color?: string
  decimals?: number
  minSpan?: number
  domain?: { min?: number | null; max?: number | null }
  thresholds?: PlotThreshold[]
  className?: string
  emptyLabel?: string
}) {
  const gradientId = useId()
  const [ref, size] = useElementSize<HTMLDivElement>()
  const width = Math.max(1, size.width)
  const height = Math.max(1, size.height)
  const axisWidth = 34
  const plotWidth = Math.max(1, width - axisWidth)
  const padTop = 6
  const padBottom = 6
  const plotHeight = Math.max(1, height - padTop - padBottom)
  const { lo, hi } = niceDomain(values, minSpan, domain)
  const toY = (value: number) => padTop + (1 - (value - lo) / (hi - lo)) * plotHeight
  const toX = (index: number) => (values.length <= 1 ? plotWidth : (index / (values.length - 1)) * plotWidth)

  const line = values
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${toX(index).toFixed(1)},${clamp(toY(value), padTop, padTop + plotHeight).toFixed(1)}`)
    .join(' ')
  const area = values.length > 1 ? `${line} L${plotWidth.toFixed(1)},${padTop + plotHeight} L0,${padTop + plotHeight} Z` : ''
  const ticks = [hi, (hi + lo) / 2, lo]
  const last = values.length ? values[values.length - 1] : null

  return (
    <div ref={ref} className={cn('relative h-full min-h-[48px] w-full', className)}>
      {size.width > 0 ? (
        <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((tick, index) => (
            <g key={index}>
              <line
                x1={0}
                x2={plotWidth}
                y1={toY(tick)}
                y2={toY(tick)}
                stroke="var(--border)"
                strokeDasharray={index === 1 ? '2 4' : undefined}
              />
              <text
                x={width - 2}
                y={toY(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--text-faint)"
                fontSize="10"
                fontFamily="var(--font-mono)"
              >
                {formatTick(tick, decimals)}
              </text>
            </g>
          ))}

          {thresholds
            .filter((threshold) => threshold.value > lo && threshold.value < hi)
            .map((threshold) => (
              <line
                key={`${threshold.tone}-${threshold.value}`}
                x1={0}
                x2={plotWidth}
                y1={toY(threshold.value)}
                y2={toY(threshold.value)}
                stroke={toneColor(threshold.tone)}
                strokeOpacity="0.55"
                strokeDasharray="4 3"
              />
            ))}

          {values.length > 1 ? (
            <>
              <path d={area} fill={`url(#${gradientId})`} />
              <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
            </>
          ) : null}

          {last !== null ? (
            <circle
              cx={toX(values.length - 1)}
              cy={clamp(toY(last), padTop, padTop + plotHeight)}
              r="3"
              fill={color}
              stroke="var(--surface)"
              strokeWidth="1.5"
            />
          ) : null}
        </svg>
      ) : null}

      {values.length < 2 ? (
        <div className="absolute inset-0 flex items-center justify-center text-[11.5px] text-[var(--text-faint)]">{emptyLabel}</div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

export function EmptyHint({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-1.5 px-4 text-center">
      <div className="text-[12.5px] font-medium text-[var(--text-secondary)]">{title}</div>
      {children ? <div className="max-w-[36ch] text-[11.5px] leading-5 text-[var(--text-faint)] h-lt-120:hidden">{children}</div> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Toggle                                                                     */
/* -------------------------------------------------------------------------- */

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: ReactNode
  description?: ReactNode
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-[8px] py-1 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-[var(--text-secondary)]">{label}</span>
        {description ? <span className="block text-[11px] leading-4 text-[var(--text-faint)]">{description}</span> : null}
      </span>
      <span
        className={cn(
          'relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border transition-colors',
          checked ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-[var(--border-strong)] bg-[var(--surface-raised)]',
        )}
      >
        <span
          className={cn(
            'absolute h-3 w-3 rounded-full transition-[left,background-color]',
            checked ? 'left-[16px] bg-[#1a1209]' : 'left-[2px] bg-[var(--text-muted)]',
          )}
        />
      </span>
    </button>
  )
}
