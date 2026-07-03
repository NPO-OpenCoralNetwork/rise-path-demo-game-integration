-- Rise Path migration 001: curricula, materials, jobs, portals, AI sessions

CREATE TABLE IF NOT EXISTS curricula (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  ui_template_id TEXT NOT NULL DEFAULT 'vibe_coding',
  current_version_id UUID,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared', 'public')),
  category TEXT,
  thumbnail TEXT,
  color TEXT,
  model_used TEXT,
  total_lessons INT NOT NULL DEFAULT 0,
  content JSONB,
  status TEXT,
  intake_json JSONB,
  modules_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  CREATE TRIGGER curricula_updated_at
    BEFORE UPDATE ON curricula
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS curriculum_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id UUID NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  version INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'published')),
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  requirements JSONB,
  roadmap JSONB,
  content_mix JSONB,
  assessment_mix JSONB,
  ui_hints JSONB,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (curriculum_id, version),
  UNIQUE (curriculum_id, id)
);

DO $$ BEGIN
  CREATE TRIGGER curriculum_versions_updated_at
    BEFORE UPDATE ON curriculum_versions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE curricula
    ADD CONSTRAINT curricula_current_version_fk
    FOREIGN KEY (id, current_version_id) REFERENCES curriculum_versions(curriculum_id, id)
    DEFERRABLE INITIALLY DEFERRED;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS learning_portals (
  id TEXT PRIMARY KEY,
  title JSONB NOT NULL,
  subtitle JSONB NOT NULL,
  description JSONB NOT NULL,
  view_state TEXT NOT NULL,
  icon_key TEXT NOT NULL,
  color_class TEXT NOT NULL,
  bg_class TEXT NOT NULL,
  border_class TEXT NOT NULL,
  image_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  CREATE TRIGGER learning_portals_updated_at
    BEFORE UPDATE ON learning_portals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS learning_portal_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  curriculum_id UUID REFERENCES curricula(id) ON DELETE SET NULL,
  ui_template_id TEXT NOT NULL DEFAULT 'vibe_coding',
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  state_version INT NOT NULL DEFAULT 0,
  pending_approval TEXT NOT NULL DEFAULT 'none' CHECK (pending_approval IN ('none', 'requirements', 'roadmap', 'curriculum')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'closed')),
  last_message_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  CREATE TRIGGER ai_sessions_updated_at
    BEFORE UPDATE ON ai_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ai_session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_version_id UUID NOT NULL REFERENCES curriculum_versions(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('requirements', 'roadmap', 'curriculum')),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'revise')),
  feedback_text TEXT,
  decided_by UUID REFERENCES auth.users(id),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curriculum_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  curriculum_id UUID NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  curriculum_version_id UUID NOT NULL REFERENCES curriculum_versions(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  doc_completed BOOLEAN NOT NULL DEFAULT FALSE,
  doc_completed_at TIMESTAMPTZ,
  min_read_time_sec INT DEFAULT 20,
  time_spent_sec INT DEFAULT 0,
  test_payload_ready BOOLEAN NOT NULL DEFAULT FALSE,
  test_started_at TIMESTAMPTZ,
  test_completed_at TIMESTAMPTZ,
  score NUMERIC(5,2),
  attempts INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'open', 'in_progress', 'done')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, curriculum_version_id, module_id, lesson_id)
);

DO $$ BEGIN
  CREATE TRIGGER curriculum_progress_updated_at
    BEFORE UPDATE ON curriculum_progress
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('pdf', 'audio', 'youtube', 'txt', 'db')),
  title TEXT,
  source_url TEXT,
  storage_path TEXT,
  extracted_text_path TEXT,
  extracted_summary TEXT,
  extracted_excerpt TEXT,
  extracted_text_hash TEXT,
  extracted_text_bytes INT,
  language TEXT DEFAULT 'ja',
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'ready', 'error')),
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  CREATE TRIGGER materials_updated_at
    BEFORE UPDATE ON materials
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE $sql$
      CREATE TABLE IF NOT EXISTS material_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
        chunk_index INT NOT NULL,
        content TEXT NOT NULL,
        embedding vector(768),
        embedding_model TEXT,
        embedding_dim INT,
        token_count INT,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    $sql$;
  ELSE
    EXECUTE $sql$
      CREATE TABLE IF NOT EXISTS material_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
        chunk_index INT NOT NULL,
        content TEXT NOT NULL,
        embedding FLOAT8[],
        embedding_model TEXT,
        embedding_dim INT,
        token_count INT,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    $sql$;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  type TEXT NOT NULL CHECK (type IN ('ingest', 'embed', 'pdf', 'audio', 'generate')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
  progress INT NOT NULL DEFAULT 0,
  payload JSONB,
  result_ref TEXT,
  error TEXT,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dedupe_key)
);

DO $$ BEGIN
  CREATE TRIGGER jobs_updated_at
    BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS curriculum_versions_curriculum_idx ON curriculum_versions (curriculum_id, version);
CREATE INDEX IF NOT EXISTS curricula_user_created_idx ON curricula (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS learning_portals_sort_idx ON learning_portals (sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_sessions_user_idx ON ai_sessions (user_id, status);
CREATE INDEX IF NOT EXISTS ai_session_events_session_idx ON ai_session_events (session_id, created_at);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status, created_at);
CREATE INDEX IF NOT EXISTS approvals_version_idx ON approvals (curriculum_version_id, stage);
CREATE INDEX IF NOT EXISTS material_chunks_material_idx ON material_chunks (material_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS material_chunks_embedding_hnsw ON material_chunks USING hnsw (embedding vector_cosine_ops)';
  END IF;
END;
$$;