import { describe, expect, it, vi } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { requireRole } from '../requireRole.js'

function fakeRequest(role: string | undefined): FastifyRequest {
  return { user: role ? { id: 'u1', email: 'u1@example.com', role, agencyId: null, fullName: null } : undefined } as unknown as FastifyRequest
}

function fakeReply() {
  const send = vi.fn()
  const code = vi.fn().mockReturnValue({ send })
  return { code, send, reply: { code } as unknown as FastifyReply }
}

describe('requireRole (Phase 4 §18)', () => {
  it('allows a caller whose role is in the allow-list', () => {
    const { reply, code } = fakeReply()
    const ok = requireRole(fakeRequest('ADMIN'), reply, ['ADMIN'] as const)
    expect(ok).toBe(true)
    expect(code).not.toHaveBeenCalled()
  })

  it('rejects a caller whose role is not in the allow-list with 403', () => {
    const { reply, code, send } = fakeReply()
    const ok = requireRole(fakeRequest('VIEWER'), reply, ['ADMIN'] as const)
    expect(ok).toBe(false)
    expect(code).toHaveBeenCalledWith(403)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'FORBIDDEN' }) }),
    )
  })

  it('rejects a caller with no resolved user/role at all', () => {
    const { reply, code } = fakeReply()
    const ok = requireRole(fakeRequest(undefined), reply, ['ADMIN'] as const)
    expect(ok).toBe(false)
    expect(code).toHaveBeenCalledWith(403)
  })

  it('allows any role present in a multi-role allow-list', () => {
    const { reply } = fakeReply()
    expect(requireRole(fakeRequest('BID_MANAGER'), reply, ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const)).toBe(true)
    expect(requireRole(fakeRequest('RESEARCHER'), reply, ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const)).toBe(true)
  })
})
