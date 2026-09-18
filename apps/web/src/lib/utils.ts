import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn/ui-convention class-name combinator. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
