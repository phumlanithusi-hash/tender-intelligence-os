import type { AdapterHealthCheckResult } from '../types.js'
import type { EasyTendersTransport } from './types.js'

/** Real, cheap health check — one navigation to the listing page, never a full discovery pass (same rule as adapters/etenders/health.ts). */
export async function checkEasyTendersHealth(transport: EasyTendersTransport): Promise<AdapterHealthCheckResult> {
  const checkedAt = new Date().toISOString()
  try {
    const result = await transport.checkReachable()
    return { status: result.reachable ? 'HEALTHY' : 'FAILED', message: result.message, checkedAt }
  } catch (err) {
    return {
      status: 'FAILED',
      message: err instanceof Error ? err.message : 'EasyTenders health check threw an unexpected error.',
      checkedAt,
    }
  }
}
