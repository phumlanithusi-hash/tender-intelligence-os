# Database — migrations, seeds, and local testing

Phase 2 (see `docs/DATABASE.md` for the full schema catalogue, ERD, and rationale). This file covers only the mechanics: how migrations are created, applied, and rolled back, and how to run the schema test suite locally.

## Layout

```
database/
├── migrations/     # versioned SQL, timestamp-ordered, portable to Supabase as-is
├── seeds/          # reference data only (geography, taxonomy, source registry) — never fake tenders/agencies
├── scripts/        # migrate.mjs / seed.mjs / reset.mjs (local + CI runner) + local-only-auth-shim.sql
├── package.json    # @tender-os/database — pnpm workspace package
└── src/            # typed read helpers and the Vitest schema/RLS test suite
```

## Migrations are plain SQL, Supabase-CLI-compatible

Each file in `database/migrations/` is named `<UTC timestamp>_<description>.sql` — the exact naming convention the Supabase CLI's own `supabase migration new` command produces. This is deliberate: these files can be copied into a `supabase/migrations/` directory and applied with `supabase db push` (or `supabase migration up` against a local `supabase start` stack) with no changes, whenever the project adopts the Supabase CLI directly. Nothing in this session's sandbox can reach the Supabase CLI's Docker-based local stack or a real Supabase project, so migrations here are applied and tested against a plain local PostgreSQL 16 instance (with the `pgvector` and `pgcrypto` extensions) instead — see "Local testing" below.

**Creating a migration:** add a new file with the next timestamp and a short description, e.g. `20260911090000_add_tender_keywords.sql`. Never edit an already-applied migration in place — a later correction is a new migration, so the history stays a true record of what happened to the schema over time (this also protects anyone who already applied the earlier version).

**Applying to Supabase (once a project exists):**
1. Install the Supabase CLI and run `supabase login` / `supabase link --project-ref <ref>`.
2. Copy (or symlink) `database/migrations/*.sql` into `supabase/migrations/`.
3. `supabase db push` applies any migration not yet recorded in Supabase's own migration history table.

**Rolling back / reconciling:** Supabase (and this project) treats migrations as forward-only. A mistake is fixed with a new corrective migration, not by editing or deleting a past one — this matches `docs/DATABASE.md` §6's rule that nothing affecting procurement history is ever silently rewritten. If a migration was applied to a real Supabase project in error, `supabase migration repair` reconciles the CLI's local history against what's actually on the server; it does not undo the SQL itself.

## Local testing (this sandbox, and any environment without Supabase CLI/Docker access)

`database/scripts/local-only-auth-shim.sql` recreates the minimal slice of what a real Supabase project already provides (the `auth` schema, `auth.users`, `auth.uid()`, and the `authenticated`/`service_role` Postgres roles) so the RLS policies in the versioned migrations can be exercised against a plain local Postgres. This file is **never** applied to a real Supabase project — it would conflict with Supabase's own `auth` schema — and is intentionally kept outside `database/migrations/` so it can never be mistaken for one.

```bash
# One-time: create a local database (adjust to your Postgres setup)
createdb tender_intelligence_dev

# Apply the auth shim (local/dev only, once per database) + all migrations
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/tender_intelligence_dev \
  pnpm --filter @tender-os/database migrate

# Load reference seed data (provinces, municipalities, services, tender sources)
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/tender_intelligence_dev \
  pnpm --filter @tender-os/database seed

# Run the schema/RLS test suite (creates and tears down its own test database)
pnpm --filter @tender-os/database test
```

`migrate.mjs` tracks applied migrations in a `schema_migrations` table and is idempotent — re-running it only applies files not already recorded, mirroring how the Supabase CLI's own migration history works.

## Seed data is reference data only

`database/seeds/` contains South Africa's provinces, a representative municipality structure, the initial service taxonomy, and the known tender source registry (recorded, not yet necessarily scrapeable — see `docs/SCRAPING-ARCHITECTURE.md` §3). It contains **no tenders, no agencies, no requirements, no scores** — the master spec is explicit that seed data must never be mistaken for real procurement data, and the only way to guarantee that is to never seed anything procurement-shaped in the first place, rather than relying on a label to be trusted later.
