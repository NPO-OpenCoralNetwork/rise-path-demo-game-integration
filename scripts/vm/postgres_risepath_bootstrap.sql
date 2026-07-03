-- Rise Path — dedicated DB on nexloom-gce (run once as postgres superuser)
--
-- 1) Edit the password below, then on VM:
--      sudo -u postgres psql -f /tmp/postgres_risepath_bootstrap.sql
--
-- 2) Mac .env.local:
--      DATABASE_URL_PHASE1=postgresql://risepath_app:<password>@nexloom-gce:5432/risepath?sslmode=disable
--
-- 3) Mac からスキーマ適用:
--      npm run db:migrate

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