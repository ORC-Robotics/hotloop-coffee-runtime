import { useState, type PropsWithChildren, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

type AccentTone = 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

interface DashboardCardProps extends PropsWithChildren {
  title: string
  subtitle?: string
  /** Kept for API compatibility; panels no longer carry decorative accents. */
  accent?: AccentTone
  headerSlot?: ReactNode
  className?: string
  bodyClassName?: string
  /** Lets the operator fold the panel down to its header. */
  collapsible?: boolean
  defaultOpen?: boolean
}

export function DashboardCard({
  title,
  subtitle,
  headerSlot,
  className,
  bodyClassName,
  collapsible = false,
  defaultOpen = true,
  children,
}: DashboardCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const expanded = !collapsible || open

  return (
    <section className={cn('hl-panel', expanded ? 'h-full' : 'h-auto', className)}>
      <header className={cn('hl-panel-header', !expanded && 'border-b-0')}>
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="-ml-1 flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <svg
              viewBox="0 0 12 12"
              width="10"
              height="10"
              aria-hidden="true"
              className={cn('shrink-0 text-[var(--text-faint)] transition-transform', open && 'rotate-90')}
            >
              <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2 className="hl-panel-title">{title}</h2>
            {subtitle ? <span className="hl-panel-meta hidden font-sans sm:inline">{subtitle}</span> : null}
          </button>
        ) : (
          <>
            <h2 className="hl-panel-title">{title}</h2>
            {subtitle ? <span className="hl-panel-meta hidden font-sans sm:inline">{subtitle}</span> : null}
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">{headerSlot}</div>
      </header>
      {expanded ? <div className={cn('relative min-h-0 flex-1 p-3', bodyClassName)}>{children}</div> : null}
    </section>
  )
}
