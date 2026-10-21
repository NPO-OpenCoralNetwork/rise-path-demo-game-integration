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
    '{"en":"Hand research, planning, fixes and checks to an AI agent in your terminal. 11 lessons, in Japanese.","jp":"調べる・計画する・直す・確かめるを、ターミナルのAIエージェントに任せる方法を11回で学びます。"}'::jsonb,
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
