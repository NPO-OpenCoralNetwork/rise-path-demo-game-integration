# Authoring lessons with Claude Code (short version)

The full guide, in Japanese, is [authoring-with-claude-code.ja.md](authoring-with-claude-code.ja.md).
This page is the summary for English readers.

## The loop

```
request → brief → outline (one check-in) → draft JSON in content/courses/<course>/drafts/
→ validate hook + lessons:validate + lessons:lint --strict
→ independent review (pedagogy-reviewer + ja-editor) → fix → verification review (max 2 rounds)
→ lessons:preview (3 screenshots + metrics.json) → visual-qa → fix
→ translate (en) → report → the owner publishes
```

- The author never grades itself. Reviewers are separate subagents that score
  `content/schema/rubric.v1.json` (13 criteria, 0–4). Pass = every criterion ≥ 3, mean ≥ 3.3, no
  open must-fix item; `check-review.mjs` computes it. Every review records `lessonHash`, the
  version it read (`review-scope.mjs <file> --hash`); the gate refuses a review of another version
  (stale) and one without it, with no flag to accept it.
- Round 1 is a full review. A later round is a fix-verification review (`"mode": "verify"`): each
  previous must-fix is marked resolved or unresolved, every changed block is reviewed in full,
  new must-fix items only for changed blocks or regressions, unaffected scores carried over. The
  bar is the same. A full review is required again when sections were added, removed, reordered
  or changed role, the objectives changed, or more than 30% of the lesson's parts (each block,
  each section's own fields, each lesson field, each glossary and source entry) or of its blocks
  changed (`review-scope.mjs` decides; `check-review.mjs` recomputes it and loads the previous
  review, a recorded round given as `<commit id>:<reports path>` or its snapshot copy; commits are
  named by id, never `HEAD` or a branch). The gate follows a previous verification back to its
  full review and refuses a chain with an invalid round; every reviewer of the verified round (the
  reviews recorded next to it that read the same version) is gated together; a must-fix marked
  resolved stays open unless its block, or a `fixedIn` block, changed since the round that last had
  it open, and a lesson-wide must-fix needs a changed lesson-level field or a `fixedIn` whose
  blocks all changed. Rules: `.claude/skills/review-lesson/SKILL.md`.
- Agents write `drafts/` only. Moving a lesson to `lessons/` and `course.json` is publishing, done
  only when the owner asks.
- Before publishing (moving to `lessons/`, or opening a PR to publish), every verification on the
  lesson's chain names a committed previous round (`<commit id>:<reports path>`, with a commit id
  as `reviewedRevision`), or that reviewer reviews in full: a snapshot copy exists only in the
  checkout that made it, so the gate fails in any other clone.
  `server/tests/reviewChainsDurable.test.js` enforces this for published lessons.
- After the PR is merged, rebuild and redeploy the front end: lessons are bundled at build time,
  so a merge alone does not reach learners (VM: [risepath_vm_deployment.md](risepath_vm_deployment.md),
  §4.2; Vercel: [deploy/vercel/README.md](../../deploy/vercel/README.md)). A new course also needs
  the seed migration for its Learning Hub card (e.g. `server/migrations/011_seed_claude_code_portal.sql`).

## Migrated chapters and `lessons:lint --strict`

Chapters that were machine-migrated from `data/curricula/**` and not reworked yet do not meet the
current lesson rules (as of 2026-10-19: every Vibe Coding chapter except ch1). The owner accepted
this as a known state on 2026-10-19; it is not part of the done criteria.

- **Rule**: a lesson is *migrated-unreviewed* when `provenance.migratedFrom` is set,
  `provenance.author` is `migration` or starts with `migration+` (e.g. `migration+claude-code` for
  spot fixes), and there is no `reviewedBy`.
- **`--strict`** prints their warnings labelled advisory, with a count, and exits 0 for them.
  Validation errors always fail.
- **Still strict**: drafts in `drafts/` and every other lesson fail on any warning.
- **Reworking flips it**: `/author-lesson` on a migrated chapter keeps `migratedFrom` and records a
  new `provenance.author` (`claude-code`, or `human+claude-code`), so the lesson is strict from then
  on, also after publishing.
- **Everything strict**: `npm run lessons:lint -- --strict --include-migrated` gates the migrated
  chapters too; use it to list what is left to rework.

## Commands

```bash
npm run dev                                         # API :3006 + Vite :3007 (needed for previews)
claude                                              # start Claude Code at the repo root
/author-lesson vibe-coding vibe-ch1-practice "Practice for chapter 1, 15 minutes"
/review-lesson content/courses/vibe-coding/lessons/vibe-ch3.lesson.json
npm run lessons:catalog                             # courses, lessons, drafts, status (always exit 0)
npm run lessons:validate -- <file>                  # schema + semantic checks
npm run lessons:lint -- <file> --strict             # pedagogy and readability rules
npm run lessons:lint -- --strict --include-migrated # also gate migrated, not reworked chapters
npm run lessons:preview -- <course> <lesson>        # .artifacts/preview/<course>/<lesson>/
node .claude/skills/review-lesson/scripts/check-review.mjs <review.json>…   # merged verdict (2 = invalid or stale)
node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --hash        # lessonHash of the version a review reads
node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --since <rev> --expect-hash <previous lessonHash> # verification allowed? (exit 0) / full review (exit 1)
node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --snapshot    # record an uncommitted reviewed revision (one folder per round)
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
| `.claude/skills/review-lesson/` | Forked review by `pedagogy-reviewer`; `scripts/check-review.mjs` (gate), `scripts/review-scope.mjs` (full or verification round) |
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

- **Claude Desktop**: start from `mcp-server/claude_desktop_config.example.json` (it already passes
  `"--profile", "curriculum-builder"`) and replace `/path/to/rise-path` with the repository's path.
- **Codex**: reads `AGENTS.md`; add `[mcp_servers.rise-path-learning]` with `command = "node"` and
  `args = ["/path/to/rise-path/mcp-server/index.js", "--profile", "curriculum-builder"]` to
  `~/.codex/config.toml`.
- **Cursor**: reads `AGENTS.md`; add the same server to `.cursor/mcp.json` or `~/.cursor/mcp.json`.
- **Gemini CLI**: already configured in `.gemini/settings.json` (loads `AGENTS.md`, starts the
  server with the `curriculum-builder` profile). Run `gemini` at the repo root and check `/mcp`.
- **ChatGPT**: needs a public HTTPS server. Run `npm run mcp:sse` (port 3100, `/sse`) with
  `RISE_PATH_MCP_PROFILE=curriculum-builder` and `RP_LESSON_STORE=db`, authenticate with a
  Supabase JWT, and add the URL as a custom MCP connector. (With `RISE_PATH_BRIDGE_TOKEN` the
  server cannot tell which user is calling, so in production the tools that need a user, such as
  drafts, answer `session_binding_required`.) Bring the drafts into a PR and run validation and
  review before publishing.
