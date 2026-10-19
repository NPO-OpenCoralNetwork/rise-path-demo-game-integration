# Authoring lessons with Claude Code (short version)

The full guide, in Japanese, is [authoring-with-claude-code.ja.md](authoring-with-claude-code.ja.md).
This page is the summary for English readers.

## The loop

```
request → brief → outline (one check-in) → draft JSON in content/courses/<course>/drafts/
→ validate hook + lessons:validate + lessons:lint --strict
→ independent review (pedagogy-reviewer + ja-editor) → fix (max 2 rounds)
→ lessons:preview (3 screenshots + metrics.json) → visual-qa → fix
→ translate (en) → report → the owner publishes
```

- The author never grades itself. Reviewers are separate subagents that score
  `content/schema/rubric.v1.json` (13 criteria, 0–4). Pass = every criterion ≥ 3, mean ≥ 3.3, no
  open must-fix item; `check-review.mjs` computes it.
- Agents write `drafts/` only. Moving a lesson to `lessons/` and `course.json` is publishing, done
  only when the owner asks.

## Commands

```bash
npm run dev                                         # API :3006 + Vite :3007 (needed for previews)
claude                                              # start Claude Code at the repo root
/author-lesson vibe-coding vibe-ch1-practice "Practice for chapter 1, 15 minutes"
/review-lesson content/courses/vibe-coding/lessons/vibe-ch3.lesson.json
npm run lessons:catalog                             # courses, lessons, drafts, status (always exit 0)
npm run lessons:validate -- <file>                  # schema + semantic checks
npm run lessons:lint -- <file> --strict             # pedagogy and readability rules
npm run lessons:preview -- <course> <lesson>        # .artifacts/preview/<course>/<lesson>/
node .claude/skills/review-lesson/scripts/check-review.mjs <review.json>…   # merged verdict
node .claude/skills/author-lesson/scripts/build-references.mjs              # regenerate cookbook + rubric.md
npm run lessons:mcp-smoke                           # MCP lesson tools, no database needed
```

`lessons:preview` signs in as the guest, opens `/preview/<course>/<lesson>` (drafts win), and writes
`desktop-jp.png`, `mobile-jp.png`, `desktop-en.png`, per-screen `pages/*.png` and `metrics.json`
(`overflowX`, `consoleErrors`, `mermaidErrors`, `charsPerLine`, `textOnlyScreens`). Failed `/api/`
requests (503 without a database) are recorded separately, not counted as console errors.
Chromium: `PLAYWRIGHT_CHROMIUM_PATH`, else `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`,
else Playwright's default.

## Files

| File | Purpose |
|---|---|
| `AGENTS.md` / `CLAUDE.md` | Shared agent rules / Claude Code notes (imports `@AGENTS.md`) |
| `.claude/rules/content.md` | Lesson rules, loaded when working under `content/` |
| `.claude/skills/author-lesson/` | The authoring procedure; `references/` holds the lesson contract, block cookbook, JP style guide and rubric |
| `.claude/skills/review-lesson/` | Forked review by `pedagogy-reviewer`; `scripts/check-review.mjs` |
| `.claude/agents/` | `pedagogy-reviewer`, `ja-editor`, `visual-qa` (read-only, fixed JSON output) |
| `.claude/hooks/validate-lesson.mjs` | PostToolUse validation (exit 2 with JSON paths on errors) |
| `.claude/settings.example.json` | Always-on hook and permissions — the owner decides whether to copy it to `.claude/settings.json` |
| `.mcp.json` | `rise-path-learning` MCP server, `curriculum-builder` profile |

The skill's pre-approved tools (edits under `content/courses/`, `lessons:*`, `check-review.mjs`)
apply only to the turn that invoked `/author-lesson`. For a headless run, load the project rules
for that run only:
`claude -p '/author-lesson <course> <lesson> "<brief>"' --settings .claude/settings.example.json`
(start `npm run dev` first).

The validation hook is active while `/author-lesson` runs (registered in the skill's frontmatter).
To run it for every edit, copy `.claude/settings.example.json` to `.claude/settings.json` (whole
team, commit it after agreeing in a PR) or `.claude/settings.local.json` (just you).

## Other agents (MCP)

Tools: `lesson-schema-get`, `lesson-validate`, `lesson-get`, `lesson-upsert-draft`,
`lesson-preview-url`; resource `rp://schema/lesson/v1`; prompt `author-lesson`. They are exposed in
the `curriculum-builder` and `admin` profiles.

- **Claude Desktop**: start from `mcp-server/claude_desktop_config.example.json`; set the absolute
  path to `mcp-server/index.js` and add `"--profile", "curriculum-builder"`.
- **Codex**: reads `AGENTS.md`; add `[mcp_servers.rise-path-learning]` with `command = "node"` and
  `args = ["/path/to/rise-path/mcp-server/index.js", "--profile", "curriculum-builder"]` to
  `~/.codex/config.toml`.
- **Cursor**: reads `AGENTS.md`; add the same server to `.cursor/mcp.json` or `~/.cursor/mcp.json`.
- **Gemini CLI**: already configured in `.gemini/settings.json` (loads `AGENTS.md`, starts the
  server with the `curriculum-builder` profile). Run `gemini` at the repo root and check `/mcp`.
- **ChatGPT**: needs a public HTTPS server. Run `npm run mcp:sse` (port 3100, `/sse`) with
  `RISE_PATH_MCP_PROFILE=curriculum-builder` and `RP_LESSON_STORE=db`, authenticate with
  `RISE_PATH_BRIDGE_TOKEN` or a Supabase JWT, and add the URL as a custom MCP connector. Bring the
  drafts into a PR and run validation and review before publishing.
