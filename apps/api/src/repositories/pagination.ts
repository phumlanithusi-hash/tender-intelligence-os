import { z } from 'zod'

/**
 * Shared list-query shape for every read-only repository in this
 * directory. Kept small and explicit rather than a generic
 * query-builder passthrough, so a repository can never be asked to
 * run an arbitrary filter/column selection it wasn't written for.
 */
export const listQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
})
export type ListQuery = z.infer<typeof listQuerySchema>

export interface ListResult<T> {
  rows: T[]
  limit: number
  offset: number
  /** Total matching rows across all pages, when the query requested a count. */
  total?: number
}
