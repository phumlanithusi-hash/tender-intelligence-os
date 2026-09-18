-- Phase 2: extensions required by the schema.
-- pgvector: tender/document embeddings (populated starting Phase 6/11 —
-- the column exists from Phase 2 so the schema doesn't need to change
-- shape later, but nothing writes to it yet).
-- pgcrypto: gen_random_uuid() for UUID primary keys (spec: all IDs are UUID).
create extension if not exists pgcrypto;
create extension if not exists vector;
