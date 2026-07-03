# DBスキーマ + RLS（v0.1）

## DDL
```sql
-- Extensions
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- updated_at trigger
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- user_profiles
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

-- curricula (meta)
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

-- curriculum_versions (body)
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

-- learning_portals (cards)
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

-- learning_portal_admins (write access)
create table if not exists learning_portal_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ai_sessions
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

-- ai_session_events
create table if not exists ai_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references ai_sessions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  role text not null check (role in ('user','assistant','system','tool')),
  content text,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- approvals (承認ログ)
create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id uuid not null references curriculum_versions(id) on delete cascade,
  stage text not null check (stage in ('requirements','roadmap','curriculum')),
  decision text not null check (decision in ('approved','revise')),
  feedback_text text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz not null default now()
);

-- curriculum_progress
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

-- materials
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

-- material_chunks
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

-- jobs
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

-- indexes
create index if not exists curriculum_versions_curriculum_idx on curriculum_versions (curriculum_id, version);
create index if not exists learning_portals_sort_idx on learning_portals (sort_order, created_at desc);
create index if not exists ai_sessions_user_idx on ai_sessions (user_id, status);
create index if not exists ai_session_events_session_idx on ai_session_events (session_id, created_at);
create index if not exists jobs_status_idx on jobs (status, created_at);
create index if not exists approvals_version_idx on approvals (curriculum_version_id, stage);
create index if not exists material_chunks_material_idx on material_chunks (material_id);
-- vector index (choose one)
create index if not exists material_chunks_embedding_hnsw
on material_chunks using hnsw (embedding vector_cosine_ops);
-- or
create index if not exists material_chunks_embedding_ivfflat
on material_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

## RLS（最小）
```sql
alter table user_profiles enable row level security;
alter table curricula enable row level security;
alter table curriculum_versions enable row level security;
alter table ai_sessions enable row level security;
alter table ai_session_events enable row level security;
alter table approvals enable row level security;
alter table curriculum_progress enable row level security;
alter table materials enable row level security;
alter table material_chunks enable row level security;
alter table jobs enable row level security;
alter table learning_portals enable row level security;
alter table learning_portal_admins enable row level security;

-- user_profiles
create policy "user_profiles_owner_select" on user_profiles
for select using (user_id = auth.uid());
create policy "user_profiles_owner_insert" on user_profiles
for insert with check (user_id = auth.uid());
create policy "user_profiles_owner_update" on user_profiles
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- curricula
create policy "curricula_owner_select" on curricula
for select using (user_id = auth.uid());
create policy "curricula_owner_insert" on curricula
for insert with check (user_id = auth.uid());
create policy "curricula_owner_update" on curricula
for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "curricula_owner_delete" on curricula
for delete using (user_id = auth.uid());

-- curriculum_versions (indirect)
create policy "curriculum_versions_owner_select" on curriculum_versions
for select using (
  exists (select 1 from curricula c
          where c.id = curriculum_versions.curriculum_id
            and c.user_id = auth.uid())
);
create policy "curriculum_versions_owner_insert" on curriculum_versions
for insert with check (
  exists (select 1 from curricula c
          where c.id = curriculum_versions.curriculum_id
            and c.user_id = auth.uid())
);
create policy "curriculum_versions_owner_update" on curriculum_versions
for update using (
  exists (select 1 from curricula c
          where c.id = curriculum_versions.curriculum_id
            and c.user_id = auth.uid())
) with check (
  exists (select 1 from curricula c
          where c.id = curriculum_versions.curriculum_id
            and c.user_id = auth.uid())
);

-- learning_portals (authenticated read, active only)
create policy "learning_portals_authenticated_select" on learning_portals
for select using (auth.uid() is not null and is_active = true);

-- learning_portal_admins (self select)
create policy "learning_portal_admins_self_select" on learning_portal_admins
for select using (user_id = auth.uid());

-- learning_portals (admin write)
create policy "learning_portals_admin_insert" on learning_portals
for insert with check (
  exists (select 1 from learning_portal_admins a
          where a.user_id = auth.uid())
);
create policy "learning_portals_admin_update" on learning_portals
for update using (
  exists (select 1 from learning_portal_admins a
          where a.user_id = auth.uid())
) with check (
  exists (select 1 from learning_portal_admins a
          where a.user_id = auth.uid())
);
create policy "learning_portals_admin_delete" on learning_portals
for delete using (
  exists (select 1 from learning_portal_admins a
          where a.user_id = auth.uid())
);

-- ai_sessions
create policy "ai_sessions_owner_select" on ai_sessions
for select using (user_id = auth.uid());
create policy "ai_sessions_owner_insert" on ai_sessions
for insert with check (user_id = auth.uid());
create policy "ai_sessions_owner_update" on ai_sessions
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ai_session_events (indirect)
create policy "ai_session_events_owner_select" on ai_session_events
for select using (
  exists (
    select 1 from ai_sessions s
    where s.id = ai_session_events.session_id
      and s.user_id = auth.uid()
  )
);
create policy "ai_session_events_owner_insert" on ai_session_events
for insert with check (
  exists (
    select 1 from ai_sessions s
    where s.id = ai_session_events.session_id
      and s.user_id = auth.uid()
  )
);

-- approvals (indirect)
create policy "approvals_owner_select" on approvals
for select using (
  exists (
    select 1 from curriculum_versions v
    join curricula c on c.id = v.curriculum_id
    where v.id = approvals.curriculum_version_id
      and c.user_id = auth.uid()
  )
);
create policy "approvals_owner_insert" on approvals
for insert with check (
  exists (
    select 1 from curriculum_versions v
    join curricula c on c.id = v.curriculum_id
    where v.id = approvals.curriculum_version_id
      and c.user_id = auth.uid()
  )
);

-- curriculum_progress
create policy "curriculum_progress_owner_select" on curriculum_progress
for select using (user_id = auth.uid());
create policy "curriculum_progress_owner_insert" on curriculum_progress
for insert with check (user_id = auth.uid());
create policy "curriculum_progress_owner_update" on curriculum_progress
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- materials
create policy "materials_owner_select" on materials
for select using (user_id = auth.uid());
create policy "materials_owner_insert" on materials
for insert with check (user_id = auth.uid());
create policy "materials_owner_update" on materials
for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "materials_owner_delete" on materials
for delete using (user_id = auth.uid());

-- material_chunks (indirect)
create policy "material_chunks_owner_select" on material_chunks
for select using (
  exists (select 1 from materials m
          where m.id = material_chunks.material_id
            and m.user_id = auth.uid())
);
create policy "material_chunks_owner_insert" on material_chunks
for insert with check (
  exists (select 1 from materials m
          where m.id = material_chunks.material_id
            and m.user_id = auth.uid())
);

-- jobs
create policy "jobs_owner_select" on jobs
for select using (user_id = auth.uid());
create policy "jobs_owner_insert" on jobs
for insert with check (user_id = auth.uid());
create policy "jobs_owner_update" on jobs
for update using (user_id = auth.uid()) with check (user_id = auth.uid());
```

## RPC (admin)
```sql
create or replace function learning_portals_reorder(order_payload jsonb)
returns void
language plpgsql
as $$
declare
  item jsonb;
  portal_id text;
  order_value int;
begin
  if order_payload is null or jsonb_typeof(order_payload) <> 'array' then
    raise exception 'order_payload must be an array';
  end if;

  for item in select * from jsonb_array_elements(order_payload)
  loop
    portal_id := item->>'id';
    order_value := (item->>'sort_order')::int;
    if portal_id is null or order_value is null then
      raise exception 'Invalid order item';
    end if;

    update learning_portals
    set sort_order = order_value
    where id = portal_id;
  end loop;
end;
$$;

create or replace function learning_portals_set_active(portal_id text, active boolean)
returns void
language sql
as $$
  update learning_portals
  set is_active = active
  where id = portal_id;
$$;
```

## Seed (admin)
```sql
insert into learning_portal_admins (user_id)
values
  ('00000000-0000-0000-0000-000000000000'),
  ('11111111-1111-1111-1111-111111111111')
on conflict do nothing;
```

## 運用メモ
- `curriculum_versions` は `requirements_draft` 生成時に作成し、以降は同一 version を更新する
- `curricula.current_version_id` は `curriculum` 承認時に更新（トランザクション推奨）
- `ai_sessions.state_version` で楽観ロック（更新時に +1）
- `ai_sessions.expires_at` をTTL掃除の基準にする
- `jobs` のclaimは `FOR UPDATE SKIP LOCKED` で単一取得する
- ベクトル索引は `hnsw` / `ivfflat` のどちらかを採用して統一する
- `embedding vector(768)` は採用モデルに合わせて固定
- 長文抽出は `extracted_text_path` を基本とし、DBは要約/抜粋のみ
- `learning_portal_admins` はseedで初期登録し、以後は管理API（service role）で運用する

### jobs claim例（トランザクション内）
```sql
with next as (
  select id
  from jobs
  where status = 'queued'
  order by created_at asc
  for update skip locked
  limit 1
)
update jobs
set status = 'running', updated_at = now()
where id in (select id from next)
returning *;
```
