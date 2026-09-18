import type { AdapterHealthCheckResult } from '../types.js'
import type { EtendersTransport } from './types.js'

/**
 * Real health check (Phase 5 §20): a single cheap reachability probe
 * against the actual public discovery mechanism — never a full scan,
 * never marked HEALTHY just because the domain resolves. `checkReachable`
 * (playwrightTransport.ts) does one navigation to the opportunities
 * page and inspects the HTTP response; it does not wait for or parse
 * the client-rendered table (that would make health checks as slow
 * and heavy as a real scan, which Phase 5 §20 explicitly rules out).
 */
export async function checkEtendersHealth(transport: EtendersTransport): Promise<AdapterHealthCheckResult> {
  const checkedAt = new Date().toISOString()
  try {
    const result = await transport.checkReachable()
    return {
      status: result.reachable ? 'HEALTHY' : 'FAILED',
      message: result.message,
      checkedAt,
    }
  } catch (err) {
    return {
      status: 'FAILED',
      message: err instanceof Error ? err.message : 'eTenders health check threw an unexpected error.',
      checkedAt,
    }
  }
}
