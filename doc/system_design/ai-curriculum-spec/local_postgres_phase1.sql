-- ARCHIVE / REFERENCE ONLY — do not apply directly.
-- Canonical migrations: server/migrations/001_core_curriculum.sql (Issue #16)
--
-- Local PostgreSQL scaffold for ai-curriculum-spec Phase 1 (no RLS).
-- Use a fresh database or a separate schema to avoid conflicts with the existing local schema.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key
);

create extension if not exists "pgcrypto";
do $$
begin
  begin
    create extension if not exists "vector";
  exception
    when others then
      raise notice 'pgvector extension not available; skipping vector type';
  end;
end;
$$;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  big5 jsonb,
  learning_style jsonb,
  preferences jsonb,
  history jsonb,
  updated_at timestamptz not null default now()
);
create trigger user_profiles_updated_at
before update on user_profiles
for each row execute function set_updated_at();

create table if not exists curricula (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  description text,
  ui_template_id text not null default 'vibe_coding',
  current_version_id uuid,
  visibility text not null default 'private' check (visibility in ('private','shared','public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger curricula_updated_at
before update on curricula
for each row execute function set_updated_at();

create table if not exists curriculum_versions (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references curricula(id) on delete cascade,
  version int not null,
  status text not null default 'draft' check (status in ('draft','approved','published')),
  content_json jsonb not null default '{}'::jsonb,
  requirements jsonb,
  roadmap jsonb,
  content_mix jsonb,
  assessment_mix jsonb,
  ui_hints jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (curriculum_id, version),
  unique (curriculum_id, id)
);
create trigger curriculum_versions_updated_at
before update on curriculum_versions
for each row execute function set_updated_at();

alter table curricula
  add constraint curricula_current_version_fk
  foreign key (id, current_version_id) references curriculum_versions(curriculum_id, id)
  deferrable initially deferred;

create table if not exists learning_portals (
  id text primary key,
  title jsonb not null,
  subtitle jsonb not null,
  description jsonb not null,
  view_state text not null,
  icon_key text not null,
  color_class text not null,
  bg_class text not null,
  border_class text not null,
  image_url text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger learning_portals_updated_at
before update on learning_portals
for each row execute function set_updated_at();

create table if not exists learning_portal_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists ai_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  curriculum_id uuid references curricula(id) on delete set null,
  ui_template_id text not null default 'vibe_coding',
  state_json jsonb not null default '{}'::jsonb,
  state_version int not null default 0,
  pending_approval text not null default 'none' check (pending_approval in ('none','requirements','roadmap','curriculum')),
  status text not null default 'active' check (status in ('active','archived','closed')),
  last_message_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ai_sessions_updated_at
before update on ai_sessions
for each row execute function set_updated_at();

create table if not exists ai_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references ai_sessions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  role text not null check (role in ('user','assistant','system','tool')),
  content text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id uuid not null references curriculum_versions(id) on delete cascade,
  stage text not null check (stage in ('requirements','roadmap','curriculum')),
  decision text not null check (decision in ('approved','revise')),
  feedback_text text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz not null default now()
);

create table if not exists curriculum_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  curriculum_id uuid not null references curricula(id) on delete cascade,
  curriculum_version_id uuid not null references curriculum_versions(id) on delete cascade,
  module_id text not null,
  lesson_id text not null,
  doc_completed boolean not null default false,
  doc_completed_at timestamptz,
  min_read_time_sec int default 20,
  time_spent_sec int default 0,
  test_payload_ready boolean not null default false,
  test_started_at timestamptz,
  test_completed_at timestamptz,
  score numeric(5,2),
  attempts int not null default 0,
  status text not null default 'locked' check (status in ('locked','open','in_progress','done')),
  updated_at timestamptz not null default now(),
  unique (user_id, curriculum_version_id, module_id, lesson_id)
);
create trigger curriculum_progress_updated_at
before update on curriculum_progress
for each row execute function set_updated_at();

create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('pdf','audio','youtube','txt','db')),
  title text,
  source_url text,
  storage_path text,
  extracted_text_path text,
  extracted_summary text,
  extracted_excerpt text,
  extracted_text_hash text,
  extracted_text_bytes int,
  language text default 'ja',
  status text not null default 'uploaded' check (status in ('uploaded','processing','ready','error')),
  meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger materials_updated_at
before update on materials
for each row execute function set_updated_at();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute $sql$
      create table if not exists material_chunks (
        id uuid primary key default gen_random_uuid(),
        material_id uuid not null references materials(id) on delete cascade,
        chunk_index int not null,
        content text not null,
        embedding vector(768),
        embedding_model text,
        embedding_dim int,
        token_count int,
        metadata jsonb,
        created_at timestamptz not null default now()
      );
    $sql$;
  else
    execute $sql$
      create table if not exists material_chunks (
        id uuid primary key default gen_random_uuid(),
        material_id uuid not null references materials(id) on delete cascade,
        chunk_index int not null,
        content text not null,
        embedding float8[],
        embedding_model text,
        embedding_dim int,
        token_count int,
        metadata jsonb,
        created_at timestamptz not null default now()
      );
    $sql$;
  end if;
end;
$$;

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  type text not null check (type in ('ingest','embed','pdf','audio','generate')),
  status text not null default 'queued' check (status in ('queued','running','done','error')),
  progress int not null default 0,
  payload jsonb,
  result_ref text,
  error text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dedupe_key)
);
create trigger jobs_updated_at
before update on jobs
for each row execute function set_updated_at();

create index if not exists curriculum_versions_curriculum_idx on curriculum_versions (curriculum_id, version);
create index if not exists learning_portals_sort_idx on learning_portals (sort_order, created_at desc);
create index if not exists ai_sessions_user_idx on ai_sessions (user_id, status);
create index if not exists ai_session_events_session_idx on ai_session_events (session_id, created_at);
create index if not exists jobs_status_idx on jobs (status, created_at);
create index if not exists approvals_version_idx on approvals (curriculum_version_id, stage);
create index if not exists material_chunks_material_idx on material_chunks (material_id);
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute 'create index if not exists material_chunks_embedding_hnsw on material_chunks using hnsw (embedding vector_cosine_ops)';
  end if;
end;
$$;
