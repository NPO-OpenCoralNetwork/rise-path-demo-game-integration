# Rise Path — agent instructions

AI learning platform. React 19 + Vite 6 + TypeScript + Tailwind v4 (front, :3007), Express `server.js`
(API, :3006), MCP server `mcp-server/`, Hermes agent runtime `hermes/`, Phaser P-School. UI locales:
`jp` (primary), `en`. Shared by Claude Code, Codex, Cursor, Gemini CLI and other agents.

## Commands
- `npm run dev` (API + Vite) · `npm test` (node:test, `server/tests/`) · `npm run typecheck` (tsc, keep 0 errors)
- Build check: `npx vite build --outDir <tmp dir>` (not `dist/` while others work in the tree)
- Lessons: `npm run lessons:validate|lint|catalog|schema` · `npm run lessons:preview -- <course> <lesson>`
  (needs the dev server) · `npm run lessons:mcp-smoke`
- MCP: `npm run mcp` (stdio; profile via `--profile` or `RISE_PATH_MCP_PROFILE`) — see `.mcp.json`

## Where things live
- Learning material (教材): `content/courses/<slug>/course.json` + `lessons/<id>.lesson.json`
  (`risepath.lesson/v1`). Drafts: `drafts/`, briefs: `briefs/`, review output: `reports/`.
  Schema source: `shared/lesson/schema.js` (zod); generated JSON Schema in `content/schema/`.
- Reader: `components/lesson/` at `/learn/:course/:lesson`; dev-only `/preview/:course/:lesson`
  (prefers drafts) and `/dev/blocks?dev=1` (every block type). Loader: `content/index.ts`.
- Legacy lessons in `data/curricula/**` are read-only; migrate with `npm run lessons:migrate`.
- LLM calls: `server/llm/` gateway behind `/api/v2/llm/*`; browser code uses `services/llmApi.ts`.
- Design: tokens in `styles/tokens.css`, rules in `doc/design/design-system.md`, shared UI in
  `components/ui/`. Routes: `navigation/viewPaths.ts`; flags: `config/features.ts`.
- Plan and research: `doc/brushup-2026/`. Authoring guide: `doc/guides/authoring-with-claude-code.ja.md`.

## Lesson rules (details: `.claude/skills/author-lesson/references/lesson-contract.md`)
- 2–4 objectives with ids and a Bloom level; every objective is assessed by a question (`objectiveId`).
- Shape: hook (problem + ungraded predict) → segments (concept → worked example → inline check)
  → practice → check (exam over every objective) → summary + 4–8 flashcards.
- An inline check at least every 2 sections; feedback on every wrong option (≤ 2 sentences).
- Budgets: sentence ≤ 60 JP chars, paragraph ≤ 160; ≤ 3 new terms per segment; no decorative images.
- Japanese: です・ます, warm, no 「簡単です」「誰でも」; katakana terms with English on first use.
- No fabricated facts, URLs, images or commands. Cite non-obvious claims (`sources` + `cite`).
- Done = `lessons:validate` 0 errors, `lessons:lint --strict` clean, rubric pass
  (`content/schema/rubric.v1.json`: every criterion ≥ 3, mean ≥ 3.3), screenshots checked.
  Exception: machine-migrated lessons not yet reworked (`provenance.migratedFrom`, author `migration`
  or `migration+…`, no `reviewedBy`) are a known state; `--strict` lists their warnings as advisory.
  Drafts are always strict; a rework records a new author and becomes strict (`--include-migrated`
  gates them all).
- Write new lessons to `drafts/`. Moving one to `lessons/` + `course.json` is publishing: owner only.

## Code conventions
- Learner-facing strings in EN and JP: `const copy = { en, jp }` + `useLanguage().language`.
- Design tokens only: no `[#hex]`, `rounded-[…]`, `text-[9-11px]` or `text-slate-400` in new code.
- Accessibility: semantic elements, labels, visible focus, keyboard paths, Esc closes dialogs and
  returns focus, `prefers-reduced-motion` respected.
- The app scrolls inside `<main id="main-content">`, not `window`.
- Add `node:test` tests under `server/tests/` for testable logic.

## Don'ts
- No API keys in browser code or `VITE_*` variables; model keys live on the server only.
- Model IDs appear only in `server/llm/models.config.js`; never hard-code them elsewhere.
- Don't publish to the database or mark lessons published from an authoring flow; drafts + PR.
- Don't edit generated files (`content/schema/lesson*.schema.json`, `course.schema.json`) by hand.
- Don't touch P-School (`components/features/PSchool`, `data/curricula/p_school`, `public/p_school`).
- No secrets, `.env` contents or absolute personal paths (macOS home folders under `/Users`, volumes under `/Volumes`, a local checkout path) in commits.
- No new dependencies without the owner's approval; never hand-merge `package-lock.json`.
- No `git push --force`, and no rewriting shared history.
