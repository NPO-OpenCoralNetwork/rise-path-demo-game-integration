# Rise Path — agent instructions

AI learning platform. React 19 + Vite 6 + TypeScript + Tailwind v4 (front, :3007), Express `server.js`
(API, :3006), MCP server `mcp-server/`, Hermes agent runtime `hermes/`, Phaser P-School. UI locales:
`jp` (primary), `en`. Shared by Claude Code, Codex, Cursor, Gemini CLI and other agents.

## Commands
- `npm run dev` (API + Vite) · `npm test` (node:test, `server/tests/`) · `npm run typecheck` (tsc, keep 0 errors)
- Build check: `npx vite build --outDir <tmp dir>` (not `dist/` while others work in the tree)
- Lessons: `npm run lessons:validate|lint|catalog|schema` · `npm run lessons:preview -- <course> <lesson>` (needs the dev server) · `npm run lessons:mcp-smoke`
- MCP: `npm run mcp` (stdio; profile via `--profile` or `RISE_PATH_MCP_PROFILE`) — see `.mcp.json`
- VM checks: `deploy/risepath-vm/scripts/preflight.sh` (事前チェック; `deploy-stack.sh` runs it before sourcing `stack.env`; never as root; rules `scripts/deploy/preflight-rules.mjs`, built-ins only) and `postdeploy-check.sh`; backups `backup.sh` + systemd timers; runbook `doc/guides/first-launch.ja.md`. On the VM, deploy from a plain login shell: never export the CI's `COMPOSE_PROJECT_NAME=risepath-ci` there (F12).
- CI (`.github/workflows/ci.yml`, PRs and pushes to main): typecheck, tests (`lint:arch` included), `lessons:validate`,
  `lessons:lint -- --strict`, `lessons:schema -- --check`, skill references `--check`, change guards
  (`node scripts/ci/scan-secrets.mjs --diff origin/main`, same for `check-assets.mjs`: credits in `assets/credits.json` for assets over
  1 MiB), and `build:prod` with dummy keys that must not appear in the bundle, nor any legal text (`VITE_FEATURE_LEGAL_PAGES` unset). Run them before opening a PR.
- `e2e.yml` (Docker; PRs, main, nightly): checks `Database checks`, `Server stack deploy`, `Learner end-to-end`, required on main once the owner sets the branch rule (ai-access-plan §11). Locally: `npm run ci:stack|e2e:local` need Docker; `npm run ci:db` also runs with `-- --existing-url <url>` on a throwaway local PG16+pgvector cluster (§11.1); otherwise the PR run is the proof. Run `ci:stack`/`e2e:local` as a non-root user in the docker group (the preflight refuses root, X5).

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
- Legal texts: edit the drafts `doc/legal/*.draft.ja.md`, then `node scripts/legal/build-legal-text.mjs`
  (writes `content/legal/`, prints the version and hash for `shared/legal/versions.js`); `/terms` and
  `/privacy` publish only with `VITE_FEATURE_LEGAL_PAGES=true` (the build refuses drafts). `doc/legal/README.md`. Server switch `LEGAL_TERMS_REQUIRED=true` (off by default; turn on after that flag, ignored in production while texts are drafts) refuses signed-in learners' API and remote MCP calls with `terms_required` until they accept: every route is gated except those listed in `TERMS_EXEMPT` (`server/middleware/termsGate.js`); exempt a new route there only when the UI exempts its page or the app shell calls it there.
- Account data: learner data deletion goes through `server/services/accountDeletion.js` (staff:
  `scripts/delete-account-data.mjs`); account ids go through `canonicalUserId` and the `rp:account:`
  lock key is built from `<id>::uuid::text` (`tools/core/accountDeletions.js`). Retention: `server/services/retention.js`.
- Phase 5: one-lesson reset `POST /api/v2/user/lesson-progress/lesson-reset` (per-lesson generation in
  `lesson_progress_lesson_resets`, kept until the account is deleted, and in each local record's `lessonGen`;
  never move `lesson_progress_resets` for one lesson); XP, badges and streak `GET /api/v2/user/achievements`
  (`tools/core/achievements.js`, tables `xp_awards`, `learning_days`, migration 019, none granted to the MCP role).
- Phase 6: flashcard reviews: FSRS-6 `shared/review/fsrs.js`, queue `tools/core/reviewQueue.js` (`review_cards`, `review_log`, migration 020),
  `/api/v2/user/review`, page `/review`. Cards enter only from server lesson records; lesson resets and delete-all delete them; no XP; MCP reviews write no learning day. Card ids: `server/tests/fixtures/published-card-ids.json`.
- Phase 9: sign-up is closed in the app until `VITE_FEATURE_LEGAL_PAGES=true` (`ExperienceLoginView`, `AuthContext.signUp`); pilot list `PILOT_ACCOUNT_IDS` (`server/middleware/pilotGate.js`, before the stub write, fail closed); launch record `deploy/risepath-vm/launch-record.env` (git-ignored, owner attestations); TTS text ≤ 1,000 characters and a self-pruning cache (`tools/core/kokoroTts.js`); a restore replays account deletions, progress resets and one-lesson resets and stops on consent or grant rows (`scripts/replay-deletions.mjs`).

## Lesson rules (details: `.claude/skills/author-lesson/references/lesson-contract.md`)
- 2–4 objectives with ids and a Bloom level; every objective is assessed by a question (`objectiveId`).
- Shape: hook (problem + ungraded predict) → segments (concept → worked example → inline check)
  → practice → check (exam over every objective) → summary + 4–8 flashcards; `level: "beginner"` adds an everyday analogy before each new term.
- An inline check at least every 2 sections; feedback on every wrong option (≤ 2 sentences).
- Budgets: sentence ≤ 60 JP chars, paragraph ≤ 160; ≤ 3 new terms per segment; no decorative images.
- Japanese: です・ます, warm, no 「簡単です」「誰でも」; katakana terms with English on first use.
- No fabricated facts, URLs, images or commands: write only what cited sources support (`sources` + `cite`; repo first, then official docs; UI only as the pinned version's official docs show it).
- Done = `lessons:validate` 0 errors, `lessons:lint --strict` clean, rubric pass
  (`content/schema/rubric.v1.json`: every criterion ≥ 3, mean ≥ 3.3), screenshots checked.
  Exceptions, a known state `--strict` lists as advisory: machine-migrated lessons not yet reworked (`provenance.migratedFrom`,
  author `migration` or `migration+…`, no `reviewedBy`), and the `steps-cite` blocks in `KNOWN_UNCITED_STEPS` (`shared/lesson/lint.js`).
  Drafts are always strict; a rework records a new author and becomes strict (`--include-migrated` gates them all).
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
- Don't edit generated files (`content/schema/lesson*.schema.json`, `course.schema.json`, `content/legal/*.ja.md`, `content/legal/archive/`) by hand.
- Don't touch P-School (`components/features/PSchool`, `data/curricula/p_school`, `public/p_school`).
- No secrets, `.env` contents or absolute personal paths (macOS home folders under `/Users`, volumes under `/Volumes`, a local checkout path) in commits.
- No new dependencies without the owner's approval; never hand-merge `package-lock.json`.
- No `git push --force`, and no rewriting shared history.
- Don't compute XP or badges in the browser, award XP or learning days from `POST /user/events`, or write XP inside a lesson-progress save transaction (reconcile from server records instead).
- Don't point a development `.env.local` at the production database or change the shared Supabase project's settings from development; production look-ups and deletions run on the VM (runbook 18 章).
- Don't print an env value from a deploy or check script; names and codes only.
- Don't merge, cherry-pick or patch in anything from the private personal repository; rebuild a
  feature as new commits on `main`. What not to port and why: `doc/brushup-2026/integration/do-not-port.ja.md`.
