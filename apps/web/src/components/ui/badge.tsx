import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'

const badgeVariants = cva(
  'inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-muted-foreground',
        success: 'border-success/30 bg-success/10 text-success',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
