import * as React from 'react'
import { cn } from '../../lib/utils.js'

/**
 * A plain, native `<select>` — deliberately not a custom-styled
 * listbox. A native select gives keyboard support, screen-reader
 * semantics, and mobile behaviour for free (Phase 3 §26), and the
 * filter panel has no need for anything richer.
 */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
)
Select.displayName = 'Select'
