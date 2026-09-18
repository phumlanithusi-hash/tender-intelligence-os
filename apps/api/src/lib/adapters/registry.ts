import type { TenderSourceAdapter } from './types.js'

/**
 * The adapter registry (Phase 4 §6): the single place the rest of the
 * application asks "which adapter handles this source?" — never by
 * embedding a source-specific `if (source.name === 'eTenders')`
 * anywhere else (Phase 4 §2/§6). Adapters register themselves here at
 * process startup (see adapters/index.ts); nothing about this module
 * knows what a real adapter looks like beyond the `TenderSourceAdapter`
 * contract.
 */
const registry = new Map<string, TenderSourceAdapter>()

export function registerAdapter(adapter: TenderSourceAdapter): void {
  if (registry.has(adapter.key)) {
    throw new Error(`An adapter is already registered under key "${adapter.key}".`)
  }
  registry.set(adapter.key, adapter)
}

/** Looks up the adapter for a source's `adapter_key`. Returns null for a null/unset key or one with no registered adapter — both mean "not connected" (Phase 4 §5/§20), never an error. */
export function getAdapter(adapterKey: string | null | undefined): TenderSourceAdapter | null {
  if (!adapterKey) return null
  return registry.get(adapterKey) ?? null
}

export function isAdapterRegistered(adapterKey: string | null | undefined): boolean {
  return getAdapter(adapterKey) !== null
}

export function listRegisteredAdapterKeys(): string[] {
  return [...registry.keys()]
}

/** Test-only: clears every registered adapter so tests can register their own fixtures without cross-test leakage. */
export function __resetAdapterRegistryForTests(): void {
  registry.clear()
}
