-- Rise Path migration 011: Learning Hub card for the Claude Code course (idempotent seed)
-- The course is content/courses/claude-code (lesson reader); the card opens /claude-code
-- (view_state 'claude_code'). ON CONFLICT DO NOTHING keeps visibility or order an admin set later.

INSERT INTO learning_portals
  (id, title, subtitle, description, view_state, icon_key, color_class, bg_class, border_class, image_url, sort_order, is_active, updated_at)
VALUES
  (
    'claude-code',
    '{"en":"Claude Code in Practice","jp":"Claude Code 実践"}'::jsonb,
    '{"en":"AI agent","jp":"AIエージェント"}'::jsonb,
    '{"en":"11 lessons in Japanese. The exercises need a paid plan with Claude Code or a Console account.","jp":"全11回です。演習には、Claude Codeが使える有料プランかConsoleアカウントが必要です。"}'::jsonb,
    'claude_code',
    'terminal',
    'text-violet-500',
    'bg-violet-50',
    'border-violet-100',
    NULL,
    35,
    true,
    now()
  )
ON CONFLICT (id) DO NOTHING;
