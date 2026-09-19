-- Reference data: the known tender source registry (Phase 2 §3,
-- extended Phase 4 §5). Recording a source here is NOT a claim that
-- it is automatically scrapeable, connected, or currently scanned —
-- active defaults false, requires_manual_ingestion defaults true, and
-- adapter_key/adapter_state default to null/NOT_IMPLEMENTED (see
-- tender_sources.sql and 20260911100000_source_registry.sql) until a
-- real adapter exists and has been verified (Phase 5+). No row here
-- gets a scan_frequency override, a scan history entry, or an error
-- entry — this is configuration only (Phase 4 §5: "DO NOT scrape them
-- in Phase 4. DO NOT claim that they are currently connected.").
--
-- Every URL below is the entity's real, public procurement or
-- corporate site — factual reference data, not a fabricated or
-- invented source.
insert into tender_sources (name, base_url, source_type, authority_level, jurisdiction, notes) values
  -- Primary / authoritative: national e-procurement + Treasury.
  ('eTenders (National Treasury)', 'https://www.etenders.gov.za', 'OFFICIAL', 'PRIMARY', 'National',
   'South Africa''s central government e-procurement portal. No automated adapter yet — Phase 5.'),
  ('National Treasury', 'https://www.treasury.gov.za', 'GOVERNMENT', 'PRIMARY', 'National',
   'Publishes tender-related circulars, instruction notes, and some bid documents directly.'),
  ('Central Supplier Database (CSD)', 'https://secure.csd.gov.za', 'OFFICIAL', 'PRIMARY', 'National',
   'Supplier registration and verification system referenced by many tender qualification requirements, not itself a tender listing source.'),

  -- Primary / authoritative: example issuing government entities,
  -- municipalities, and SOEs (Phase 4 §5). Each is the issuing
  -- authority for its own tenders where it publishes them directly —
  -- the source's own portal is authoritative over any aggregator
  -- that also lists the same opportunity (Phase 4 §4/§21). Added
  -- individually, not as a bulk import — further entities are
  -- onboarded the same way as each is prioritised.
  ('Department of Public Works and Infrastructure', 'https://www.publicworks.gov.za', 'GOVERNMENT', 'PRIMARY', 'National',
   'National government department; issuing authority for its own infrastructure and facilities tenders. No automated adapter yet.'),
  ('City of Johannesburg', 'https://www.joburg.org.za', 'MUNICIPAL', 'PRIMARY', 'Gauteng',
   'Metropolitan municipality; issuing authority for its own procurement. No automated adapter yet.'),
  ('City of Cape Town', 'https://www.capetown.gov.za', 'MUNICIPAL', 'PRIMARY', 'Western Cape',
   'Metropolitan municipality; issuing authority for its own procurement. No automated adapter yet.'),
  ('Eskom Holdings SOC Ltd', 'https://www.eskom.co.za', 'SOE', 'PRIMARY', 'National',
   'State-owned electricity utility; issuing authority for its own procurement. No automated adapter yet.'),
  ('Transnet SOC Ltd', 'https://www.transnet.net', 'SOE', 'PRIMARY', 'National',
   'State-owned freight/logistics utility; issuing authority for its own procurement. No automated adapter yet.'),

  -- Discovery / secondary: third-party aggregators. Authority is
  -- DISCOVERY, never PRIMARY or SECONDARY — an aggregator can help
  -- find a tender, but the original issuing authority's own record
  -- remains authoritative where available, and this distinction must
  -- never be blurred by future ingestion logic (Phase 4 §4/§21).
  ('EasyTenders', 'https://www.easytenders.co.za', 'AGGREGATOR', 'DISCOVERY', 'National',
   'Third-party aggregator. Discovery source only — the original tender document and issuing portal remain authoritative (master spec §4).'),
  ('TenderAlerts', 'https://www.tenderalerts.co.za', 'AGGREGATOR', 'DISCOVERY', 'National',
   'Third-party aggregator. Discovery source only.'),
  ('TenderBulletins', 'https://www.tenderbulletin.co.za', 'AGGREGATOR', 'DISCOVERY', 'National',
   'Third-party aggregator. Discovery source only.'),

  -- Category placeholders for the long tail of municipalities/SOEs
  -- not yet individually onboarded — kept distinct from the named
  -- rows above so the registry never implies full national coverage.
  ('Municipal Sources (placeholder)', 'https://www.gov.za/local-government', 'MUNICIPAL', 'DISCOVERY', 'Provincial/Local',
   'Placeholder representing the category of individual municipal procurement portals not yet onboarded by name.'),
  ('State-Owned Entity Sources (placeholder)', 'https://www.gov.za/state-owned-entities', 'SOE', 'DISCOVERY', 'National',
   'Placeholder representing the category of individual SOE procurement portals not yet onboarded by name.')
on conflict (name) do nothing;

-- Phase 5: a real adapter now exists for eTenders
-- (apps/api/src/lib/adapters/etenders/) and is registered under the
-- key 'etenders' (apps/api/src/lib/adapters/index.ts) — so this row
-- alone moves out of NOT_IMPLEMENTED. It is deliberately left at
-- CONFIGURED, NOT ACTIVE (Phase 5 §21/docs/DECISIONS.md): this
-- sandboxed build environment has no outbound network access to
-- etenders.gov.za (confirmed directly — see
-- docs/SCRAPING-ARCHITECTURE.md's Limitations section), so the
-- adapter's real discovery mechanism has only been validated against
-- constructed fixture data, never the live site. Moving to ACTIVE is
-- a deployment-time decision (via the Source Registry's own
-- ADMIN-only "enable" action, apps/api/src/routes/tenderSources.ts)
-- for whoever can actually run `pnpm --filter api etenders:smoke`
-- against the real site and see it succeed — this seed does not make
-- that claim on their behalf. `active` is left at its column default
-- (true, matching every other seeded source) — it only governs
-- whether a future scheduled run would consider this source at all,
-- which is a separate question from whether its adapter has been
-- validated.
update tender_sources
set adapter_key = 'etenders',
    adapter_state = 'CONFIGURED',
    notes = 'South Africa''s central government e-procurement portal. Adapter implemented (Phase 5) — headless-Chromium discovery against the public opportunities listing. Left CONFIGURED, not ACTIVE: not yet validated against the live site from this build environment (no outbound network access here). Run `pnpm --filter api etenders:smoke` from an environment with real network access, then enable via the Source Registry once it succeeds.'
where name = 'eTenders (National Treasury)';

-- A real adapter now also exists for EasyTenders
-- (apps/api/src/lib/adapters/easytenders/), registered under the key
-- 'easytenders'. Same CONFIGURED-not-ACTIVE rule as eTenders above:
-- run `pnpm --filter api easytenders:smoke` from an environment with
-- real network access to easytenders.co.za, then enable via the
-- Source Registry once it succeeds.
update tender_sources
set adapter_key = 'easytenders',
    adapter_state = 'CONFIGURED',
    notes = 'Third-party aggregator. Discovery source only — the original tender document and issuing portal remain authoritative (master spec §4). Adapter implemented — headless-Chromium discovery against the public /tenders listing and per-tender detail pages. Left CONFIGURED, not ACTIVE: not yet validated against the live site from this build environment. Run `pnpm --filter api easytenders:smoke` from an environment with real network access, then enable via the Source Registry once it succeeds.'
where name = 'EasyTenders';

-- A real adapter now also exists for TenderBulletins
-- (apps/api/src/lib/adapters/tenderbulletins/), registered under the
-- key 'tenderbulletins'. This one is DISCOVERY-ONLY by design — the
-- site's own document/full-record view sits behind a login wall this
-- project will not automate past (see that adapter directory's
-- types.ts module comment) — so fetchDetails/fetchDocuments are
-- honest, limited stubs, not full implementations. Same
-- CONFIGURED-not-ACTIVE rule: run `pnpm --filter api
-- tenderbulletins:smoke` from an environment with real network access
-- to tenderbulletin.co.za, then enable via the Source Registry once it
-- succeeds.
update tender_sources
set adapter_key = 'tenderbulletins',
    adapter_state = 'CONFIGURED',
    notes = 'Third-party aggregator. Discovery source only. Adapter implemented — headless-Chromium discovery against the public /search listing ONLY (no detail-page or document fetch: full records sit behind a login wall this project does not automate past). Left CONFIGURED, not ACTIVE: not yet validated against the live site from this build environment. Run `pnpm --filter api tenderbulletins:smoke` from an environment with real network access, then enable via the Source Registry once it succeeds.'
where name = 'TenderBulletins';

-- A real adapter now also exists for the City of Johannesburg
-- (apps/api/src/lib/adapters/joburg/), registered under the key
-- 'joburg'. Unlike the discovery-only aggregators above, this is a
-- PRIMARY issuing-authority source with a real (if deeply-nested and
-- year-specific) live "Current Bid Proposals" listing page that
-- carries the full record — reference number, description, closing
-- date, and every document link — in one page, with no separate
-- detail page to fetch. Same CONFIGURED-not-ACTIVE rule: run `pnpm
-- --filter api joburg:smoke` from an environment with real network
-- access to joburg.org.za, then enable via the Source Registry once
-- it succeeds.
update tender_sources
set adapter_key = 'joburg',
    adapter_state = 'CONFIGURED',
    notes = 'Metropolitan municipality; issuing authority for its own procurement. Adapter implemented — headless-Chromium discovery against the live "Current Bid Proposals" listing table (reference number, description, closing date, and every document link all come from this one page — no separate detail page exists on this source). The listing URL is year-specific (2026-Tenders/2026-Bid-Proposals.aspx) and will need updating when the City publishes next year''s page. Left CONFIGURED, not ACTIVE: not yet validated against the live site from this build environment. Run `pnpm --filter api joburg:smoke` from an environment with real network access, then enable via the Source Registry once it succeeds.'
where name = 'City of Johannesburg';

-- A real adapter now also exists for Eskom
-- (apps/api/src/lib/adapters/eskom/), registered under the key
-- 'eskom'. Eskom's own tender bulletin (a dedicated subdomain,
-- tenderbulletin.eskom.co.za) is a client-side rendered app — the
-- listing card itself carries the full record (reference,
-- description, organisation, location, closing/published dates, and
-- a single "download all documents" bundle link), so no separate
-- detail-page fetch is needed. Same CONFIGURED-not-ACTIVE rule: run
-- `pnpm --filter api eskom:smoke` from an environment with real
-- network access to tenderbulletin.eskom.co.za, then enable via the
-- Source Registry once it succeeds.
update tender_sources
set adapter_key = 'eskom',
    adapter_state = 'CONFIGURED',
    notes = 'State-owned electricity utility; issuing authority for its own procurement. Adapter implemented — the live tender bulletin (tenderbulletin.eskom.co.za, a separate subdomain from the main site) is a client-side app whose listing cards carry the full record plus a single document-bundle download link per tender. Left CONFIGURED, not ACTIVE: not yet validated against the live site from this build environment. Run `pnpm --filter api eskom:smoke` from an environment with real network access, then enable via the Source Registry once it succeeds.'
where name = 'Eskom Holdings SOC Ltd';

-- A real adapter now also exists for the City of Cape Town
-- (apps/api/src/lib/adapters/capetown/), registered under the key
-- 'capetown'. Discovery-only by design: the public tender listing
-- itself states that additional detail requires registering and
-- logging in, so (like TenderBulletins) this adapter never
-- navigates past that login wall — fetchDocuments always returns
-- []. Same CONFIGURED-not-ACTIVE rule: run `pnpm --filter api
-- capetown:smoke` from an environment with real network access to
-- web1.capetown.gov.za, then enable via the Source Registry once it
-- succeeds.
update tender_sources
set adapter_key = 'capetown',
    adapter_state = 'CONFIGURED',
    notes = 'Metropolitan municipality; issuing authority for its own procurement. Adapter implemented — headless-Chromium discovery against the public Procurement Administration Portal tender listing (a classic client-side jQuery DataTable; every tender loads with the initial page and pagination is a pure in-browser redraw with no extra network calls, so this adapter clicks through every page within one browser session). Discovery-only: the listing itself states that further detail requires registering and logging in, and this project does not automate past a source''s own login wall, so no document links are ever surfaced. Left CONFIGURED, not ACTIVE: not yet validated against the live site from this build environment. Run `pnpm --filter api capetown:smoke` from an environment with real network access, then enable via the Source Registry once it succeeds.'
where name = 'City of Cape Town';
