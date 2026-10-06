import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { APP_PAGES, type AppPageId } from './appPages'

interface NavRailProps {
  activePage: AppPageId
  onChange: (page: AppPageId) => void
  badges?: Partial<Record<AppPageId, ReactNode>>
  footer?: ReactNode
}

export function NavRail({ activePage, onChange, badges, footer }: NavRailProps) {
  return (
    <nav
      className="flex w-[64px] shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--background)] py-2"
      aria-label="Pages"
    >
      {APP_PAGES.map((page) => {
        const active = page.id === activePage
        const Icon = page.icon
        return (
          <button
            key={page.id}
            type="button"
            onClick={() => onChange(page.id)}
            title={page.hint}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex w-[54px] flex-col items-center gap-1 rounded-[9px] py-2 text-[10.5px] font-medium transition-colors',
              active ? 'bg-[var(--surface-alt)] text-[var(--text)]' : 'text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-[var(--text-secondary)]',
            )}
          >
            <span
              className={cn(
                'absolute top-2 bottom-2 -left-[5px] w-[3px] rounded-r-full transition-opacity',
                active ? 'bg-[var(--primary)] opacity-100' : 'opacity-0',
              )}
            />
            <Icon className={active ? 'text-[var(--primary)]' : undefined} />
            {page.label}
            {badges?.[page.id] ? <span className="absolute top-1 right-1.5">{badges[page.id]}</span> : null}
          </button>
        )
      })}
      <div className="mt-auto flex flex-col items-center gap-1">{footer}</div>
    </nav>
  )
}
