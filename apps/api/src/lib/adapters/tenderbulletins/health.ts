import type { AdapterHealthCheckResult } from '../types.js'
import type { TenderBulletinsTransport } from './types.js'

/** Real, cheap health check — one navigation to the search page, never a full discovery pass (same rule as adapters/etenders/health.ts and adapters/easytenders/health.ts). */
export async function checkTenderBulletinsHealth(transport: TenderBulletinsTransport): Promise<AdapterHealthCheckResult> {
  const checkedAt = new Date().toISOString()
  try {
    const result = await transport.checkReachable()
    return { status: result.reachable ? 'HEALTHY' : 'FAILED', message: result.message, checkedAt }
  } catch (err) {
    return {
      status: 'FAILED',
      message: err instanceof Error ? err.message : 'TenderBulletins health check threw an unexpected error.',
      checkedAt,
    }
  }
}
