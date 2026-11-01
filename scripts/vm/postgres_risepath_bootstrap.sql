-- 古い手順です（nexloom-gce）。新しい VM では使いません。公開の手順は doc/guides/first-launch.ja.md です。
-- Rise Path — dedicated DB on nexloom-gce (run once as postgres superuser). Legacy only: the Docker stack in
-- deploy/risepath-vm/ makes its own role. A development .env.local never points at a production database
-- (doc/guides/first-launch.ja.md 18 章).
--
-- Edit the password below, then on that VM run this file with psql as the postgres user.

CREATE ROLE risepath_app LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';

CREATE DATABASE risepath OWNER risepath_app;

\connect risepath

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO risepath_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO risepath_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO risepath_app;

\connect postgres

-- If autogrants exists on the same instance, deny cross-DB access
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'autogrants') THEN
    EXECUTE 'REVOKE CONNECT ON DATABASE autogrants FROM risepath_app';
  END IF;
END $$;