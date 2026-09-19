/**
 * Adapter registration entry point. Imported once from
 * apps/api/src/app.ts at process startup so every real adapter
 * registers itself before the first request is served.
 *
 * Phase 4 registered nothing here (Phase 4 §25: "No live scraping in
 * Phase 4"). Phase 5 adds the first real entry: eTenders. Registering
 * the adapter here does NOT make the source ACTIVE — that still
 * requires `tender_sources.adapter_state` to be set explicitly (see
 * database/seeds/004_tender_sources.sql and this phase's decision,
 * documented in docs/DECISIONS.md, to leave it at CONFIGURED rather
 * than ACTIVE until a real deployment can validate it against the
 * live site).
 */
import { registerAdapter } from './registry.js'
import { createEtendersAdapter } from './etenders/adapter.js'
import { createEasyTendersAdapter } from './easytenders/adapter.js'
import { createTenderBulletinsAdapter } from './tenderbulletins/adapter.js'
import { createJoburgAdapter } from './joburg/adapter.js'
import { createEskomAdapter } from './eskom/adapter.js'
import { createCapeTownAdapter } from './capetown/adapter.js'
import { createTransnetAdapter } from './transnet/adapter.js'
import { createTenderAlertsAdapter } from './tenderalerts/adapter.js'

registerAdapter(createEtendersAdapter())
registerAdapter(createEasyTendersAdapter())
registerAdapter(createTenderBulletinsAdapter())
registerAdapter(createJoburgAdapter())
registerAdapter(createEskomAdapter())
registerAdapter(createCapeTownAdapter())
registerAdapter(createTransnetAdapter())
registerAdapter(createTenderAlertsAdapter())
