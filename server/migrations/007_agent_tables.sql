-- Rise Path migration 007: Hermes agent proxy cross-process state

CREATE TABLE IF NOT EXISTS agent_chat_consent (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  include_diary_excerpts BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_chat_consent_expires
  ON agent_chat_consent (expires_at);

CREATE TABLE IF NOT EXISTS agent_session_binding (
  session_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_session_binding_expires
  ON agent_session_binding (expires_at);

CREATE INDEX IF NOT EXISTS idx_agent_session_binding_updated
  ON agent_session_binding (updated_at DESC);