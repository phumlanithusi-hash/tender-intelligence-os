import type { AdapterState, SourceHealth } from '@tender-os/constants'
import { Badge } from '../ui/badge.js'

const HEALTH_LABEL: Record<SourceHealth, string> = {
  HEALTHY: 'Healthy',
  WARNING: 'Warning',
  FAILED: 'Failed',
  DISABLED: 'Disabled',
}

const HEALTH_VARIANT: Record<SourceHealth, 'default' | 'success' | 'warning' | 'destructive'> = {
  HEALTHY: 'success',
  WARNING: 'warning',
  FAILED: 'destructive',
  DISABLED: 'default',
}

export function SourceHealthBadge({ status }: { status: SourceHealth }) {
  return <Badge variant={HEALTH_VARIANT[status]}>{HEALTH_LABEL[status]}</Badge>
}

const ADAPTER_STATE_LABEL: Record<AdapterState, string> = {
  NOT_IMPLEMENTED: 'Not connected',
  CONFIGURED: 'Configured',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  FAILED: 'Failed',
  DISABLED: 'Disabled',
}

const ADAPTER_STATE_VARIANT: Record<AdapterState, 'default' | 'success' | 'warning' | 'destructive'> = {
  NOT_IMPLEMENTED: 'default',
  CONFIGURED: 'default',
  ACTIVE: 'success',
  PAUSED: 'warning',
  FAILED: 'destructive',
  DISABLED: 'default',
}

/**
 * Adapter/connection state (Phase 4 §7/§21). NOT_IMPLEMENTED renders
 * as the plain, unemphasised "Not connected" — never a colour that
 * could read as a working state — since every Phase 4 source is in
 * exactly this state (Phase 4 §5: "Clearly indicate NOT CONNECTED
 * where no adapter exists").
 */
export function AdapterStateBadge({ state }: { state: AdapterState }) {
  return <Badge variant={ADAPTER_STATE_VARIANT[state]}>{ADAPTER_STATE_LABEL[state]}</Badge>
}

const AUTHORITY_LABEL: Record<string, string> = {
  PRIMARY: 'Primary',
  SECONDARY: 'Secondary',
  DISCOVERY: 'Discovery',
}

/**
 * Authority level (Phase 4 §21 — "This is critical"). PRIMARY is the
 * only authority level given any visual weight; SECONDARY/DISCOVERY
 * stay neutral so an aggregator never reads as equally authoritative
 * to the issuing source it merely discovered a tender from.
 */
export function AuthorityBadge({ authority }: { authority: string }) {
  return <Badge variant={authority === 'PRIMARY' ? 'success' : 'default'}>{AUTHORITY_LABEL[authority] ?? authority}</Badge>
}
