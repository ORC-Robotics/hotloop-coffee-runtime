import { cn } from '../../lib/cn'
import type { UiTone } from '../../types/telemetry'

interface StatusBadgeProps {
  tone: UiTone
  label: string
  className?: string
}

/** Small status marker: a tone dot plus a short lowercase label. */
export function StatusBadge({ tone, label, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        `tone-${tone} inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2 text-[11.5px] font-medium whitespace-nowrap`,
        className,
      )}
      style={{
        borderColor: tone === 'neutral' ? 'var(--border)' : 'color-mix(in srgb, var(--tone) 32%, transparent)',
        background: tone === 'neutral' ? 'transparent' : 'color-mix(in srgb, var(--tone) 10%, transparent)',
        color: tone === 'neutral' ? 'var(--text-muted)' : 'color-mix(in srgb, var(--tone) 70%, var(--text) 30%)',
      }}
    >
      <span className="hl-dot !h-1.5 !w-1.5" style={{ background: 'var(--tone)' }} />
      {label}
    </span>
  )
}
