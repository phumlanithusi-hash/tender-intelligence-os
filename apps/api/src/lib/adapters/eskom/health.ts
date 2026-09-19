import type { AdapterHealthCheckResult } from '../types.js'
import type { EskomTransport } from './types.js'

/** Real, cheap health check — one navigation to the listing page, never a full discovery pass (same rule as every other adapter's health.ts). */
export async function checkEskomHealth(transport: EskomTransport): Promise<AdapterHealthCheckResult> {
  const checkedAt = new Date().toISOString()
  try {
    const result = await transport.checkReachable()
    return { status: result.reachable ? 'HEALTHY' : 'FAILED', message: result.message, checkedAt }
  } catch (err) {
    return {
      status: 'FAILED',
      message: err instanceof Error ? err.message : 'Eskom health check threw an unexpected error.',
      checkedAt,
    }
  }
}
