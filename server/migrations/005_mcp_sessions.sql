-- Rise Path migration 005: MCP session and tool call audit logs

CREATE TABLE IF NOT EXISTS mcp_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  client_type VARCHAR(50) NOT NULL DEFAULT 'unknown',
  transport VARCHAR(10) NOT NULL DEFAULT 'stdio',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  tools_used TEXT[]
);

CREATE TABLE IF NOT EXISTS mcp_tool_calls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES mcp_sessions(id) ON DELETE CASCADE,
  tool_name VARCHAR(100) NOT NULL,
  input_summary JSONB,
  output_summary JSONB,
  is_error BOOLEAN DEFAULT FALSE,
  error_type VARCHAR(50),
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_sessions_user ON mcp_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_started ON mcp_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_session ON mcp_tool_calls (session_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_tool ON mcp_tool_calls (tool_name);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_created ON mcp_tool_calls (created_at DESC);