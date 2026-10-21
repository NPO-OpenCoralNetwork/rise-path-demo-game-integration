-- Rise Path migration 012: new description for the Claude Code Learning Hub card (idempotent update)
-- Databases that already ran 011 keep its seed text, so this replaces it with the copy the hub
-- fallback shows (paid-plan note). Matching the old text keeps a description an admin set later.

UPDATE learning_portals
SET
  description = '{"en":"11 lessons in Japanese. The exercises need a paid plan with Claude Code or a Console account.","jp":"全11回です。演習には、Claude Codeが使える有料プランかConsoleアカウントが必要です。"}'::jsonb,
  updated_at = now()
WHERE id = 'claude-code'
  AND description = '{"en":"Hand research, planning, fixes and checks to an AI agent in your terminal. 11 lessons, in Japanese.","jp":"調べる・計画する・直す・確かめるを、ターミナルのAIエージェントに任せる方法を11回で学びます。"}'::jsonb;
