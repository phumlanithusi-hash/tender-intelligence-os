import * as React from 'react'
import { cn } from '../../lib/utils.js'

/**
 * A small, accessible tabs primitive (Phase 3 §26: "accessible
 * tabs") — real ARIA tablist/tab/tabpanel roles, arrow-key roving
 * focus, and only the active panel mounted in the DOM (which is also
 * what makes "lazy loading of detail tabs" — Phase 3 §27 — simple:
 * an unmounted tab's content, and therefore its data hook, never runs
 * until it is selected).
 */
export interface TabItem {
  value: string
  label: string
  badge?: React.ReactNode
}

export function Tabs({
  items,
  value,
  onChange,
  children,
}: {
  items: TabItem[]
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  const tabRefs = React.useRef<Record<string, HTMLButtonElement | null>>({})

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % items.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + items.length) % items.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = items.length - 1
    if (nextIndex !== null) {
      event.preventDefault()
      const next = items[nextIndex]
      if (next) {
        onChange(next.value)
        tabRefs.current[next.value]?.focus()
      }
    }
  }

  return (
    <div>
      <div role="tablist" aria-label="Tender detail sections" className="flex gap-1 overflow-x-auto border-b border-border">
        {items.map((item, index) => {
          const selected = item.value === value
          return (
            <button
              key={item.value}
              ref={(el) => {
                tabRefs.current[item.value] = el
              }}
              role="tab"
              type="button"
              id={`tab-${item.value}`}
              aria-selected={selected}
              aria-controls={`tabpanel-${item.value}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                selected
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
              {item.badge}
            </button>
          )
        })}
      </div>
      {children}
    </div>
  )
}

export function TabPanel({
  value,
  activeValue,
  children,
}: {
  value: string
  activeValue: string
  children: React.ReactNode
}) {
  if (value !== activeValue) return null
  return (
    <div role="tabpanel" id={`tabpanel-${value}`} aria-labelledby={`tab-${value}`} tabIndex={0} className="pt-4">
      {children}
    </div>
  )
}
