-- Rise Path migration 000: extensions, auth stub (Supabase user IDs), shared triggers
-- Target: GCP Postgres `risepath` on nexloom-gce (Supabase Auth is external)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pgvector not available; material_chunks will use float8[]';
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;

-- Mirror Supabase Auth user UUIDs for FK integrity (upserted by Express on first request)
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Alias kept for older migration snippets
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Dev / test fallback user (PHASE1_USER_ID)
INSERT INTO auth.users (id)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid)
ON CONFLICT (id) DO NOTHING;