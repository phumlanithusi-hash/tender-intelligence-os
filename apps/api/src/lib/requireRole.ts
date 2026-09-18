import type { FastifyReply, FastifyRequest } from 'fastify'
import type { UserRole } from '@tender-os/constants'

/**
 * RBAC guard for administrative actions (Phase 4 §18: "Only
 * appropriate roles should modify source configuration"). Used
 * alongside `requireAuth` (which resolves `request.user.role` from
 * the real `users` table) — this never re-derives a role itself, only
 * checks the one auth middleware already enriched.
 *
 * Returns true and does nothing further when the caller's role is
 * allowed; sends a 403 and returns false otherwise, matching
 * `requireSupabase`'s "send the response, return null/false" shape so
 * route handlers can `if (!requireRole(...)) return`.
 */
export function requireRole(request: FastifyRequest, reply: FastifyReply, allowed: readonly UserRole[]): boolean {
  const role = request.user?.role
  if (role && allowed.includes(role)) return true

  reply.code(403).send({
    error: {
      code: 'FORBIDDEN',
      message: `This action requires one of the following roles: ${allowed.join(', ')}.`,
    },
  })
  return false
}
