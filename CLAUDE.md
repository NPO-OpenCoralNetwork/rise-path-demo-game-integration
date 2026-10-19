@AGENTS.md

## Claude Code specifics

- Write or rework a lesson with `/author-lesson <course> <lesson-id> "<brief>"`. It drafts into
  `content/courses/<course>/drafts/`, validates, lints, gets independent reviews and screenshots.
- Review a lesson with `/review-lesson <path>`; it forks into the `pedagogy-reviewer` subagent.
  Never score your own draft. Other reviewers: `ja-editor` (Japanese text), `visual-qa` (screenshots).
  Merge and gate their JSON with `node .claude/skills/review-lesson/scripts/check-review.mjs <files>`.
  Round 1 is a full review; later rounds verify the fixes (`"mode": "verify"`) unless
  `review-scope.mjs <file> --since <rev>` exits 1. Rules: `.claude/skills/review-lesson/SKILL.md`.
- `.claude/rules/content.md` loads when you work under `content/`. Follow it.
- While `/author-lesson` runs, a PostToolUse hook (`.claude/hooks/validate-lesson.mjs`) validates
  every lesson write. When it reports errors, fix them before anything else.
- Screenshots: `npm run lessons:preview -- <course> <lesson>` writes PNGs and `metrics.json` to
  `.artifacts/preview/<course>/<lesson>/`. Open the PNGs with Read before calling a lesson done.
- After changing the gallery lesson, lint rules or rubric, regenerate the skill references:
  `node .claude/skills/author-lesson/scripts/build-references.mjs`.
- The `rise-path-learning` MCP server (`.mcp.json`) exposes the same lesson tools to any client.
- For code that calls Claude, use the `claude-api` skill; model IDs still go only in
  `server/llm/models.config.js`.
- `.claude/settings.example.json` shows the always-on hook and permissions; the owner decides
  whether to copy it to `.claude/settings.json`.
