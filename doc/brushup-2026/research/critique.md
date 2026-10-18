# Critique of PLAN.ja.md §9 backlog (principal-engineer review)

Reviewer key: `critique` / date 2026-10-18 / repo `/home/user/rise-path-demo-game-integration` @ `6f9cc1d` (clean tree; `.shots/` ignored via `.git/info/exclude`).

Verdict: the plan is directionally right and most file/line citations check out. It is **not executable as written**. Five problems would make WPs fail their own acceptance tests or ship broken behaviour:

1. WP-04 cannot reach "0 UnknownBlock" because it has no Code or Diagram renderer, and the Vibe data contains 14 code blocks and 13 mermaid blocks.
2. The AI-tutor context that WP-02 sends is silently dropped by the Hermes server path.
3. The `/api/v2/llm` mount position is unspecified. Mounted after the blanket `/api/v2` auth middlewares, it 401s guests in strict mode.
4. WP-01's Tailwind v4 token mapping silently restyles more than 340 existing elements, and unlayered base CSS would override utilities across the whole app.
5. The WP-09 acceptance grep fails on legitimate Big5 strings.

The sections below give the evidence and a re-sequenced backlog.

---

## 1. Baseline (measured 2026-10-18 in this container)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **PASS, exit 0, 0 errors** (`error TS` count = 0), 16.5 s, 387 non-node_modules files. Note: tsconfig has **no `strict`**, so this is a weak gate |
| Build | `npx vite build --outDir scratchpad/dist-check` | **PASS** in 53.7 s. 3 chunk-size warnings (>600 kB): `PSchoolView` 4,267 kB (932 kB gz), `GlossaryText` 1,040 kB (275 kB gz; this is actually the mermaid core shared chunk), `wardley` 615 kB. Entry `index` 495 kB (152 kB gz). `recharts` 540 kB (159 kB gz) is **modulepreloaded from index.html** because `MissionControlDashboard` (eager import in App.tsx) uses it. `genai` 253 kB chunk present |
| Unit tests | `npm test` | **PASS 333/333**, 121 suites, 0 fail/skip, 2.2 s |
| MCP stdio smoke | SDK Client → `node mcp-server/index.js` with `RISE_PATH_MCP_PROFILE=curriculum-builder` | Works without DB. Lists 5 tools: `rag-search, get-generation-kit, validate-intake, save-curriculum-draft, request-tts` |
| Playwright | `playwright@1.61.0` | Expects chromium rev **1228**, but only `/opt/pw-browsers/chromium-1194` is installed (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`). So `chromium.launch()` without `executablePath` **fails** here |

Node is v22.22.0. Installed: `mermaid 11.15.0`, `react-markdown 10.1.0`, `@tailwindcss/typography 0.5.20`, `tailwindcss 4.3.1`, `vite 6.4.3`, `esbuild 0.25.12` (transitive via vite), `dompurify 3.4.11` and `katex 0.16.27` (transitive via mermaid).
`zod 3.25.76` and `@modelcontextprotocol/sdk 1.29.0` are **only transitive via `@google/genai`** (`npm ls` confirms).
**Missing:** `remark-gfm`, `shiki`, `@anthropic-ai/sdk`, any YAML parser, `ts-fsrs`.
Registry now: `shiki@4.5.0`, `@anthropic-ai/sdk@0.135.0` (peer `zod ^3.25 || ^4`), `zod@4.6.7` latest, `remark-gfm@4.0.1`.

## 2. Plan claims verified as correct (spot list)

- Layout mobile bug: `Layout.tsx:280-284` has a trailing `relative` after `fixed md:relative`. `main` is the scroll container (`Layout.tsx:505-508`, `overflow-y-auto h-full`). `mainRef` scroll-reset already exists (`:72-78`).
- Key leak: `vite.config.ts:51-54` `define`.
- `req.user?.id`: `server/routes/ai.js:45,275`.
- `curriculum_data` write: `ai.js:155`, `tools/core/curriculum.js:248,274`. The column does not exist in `001_core_curriculum.sql:3-22`. `curriculum_versions.content_json` exists (`:31-47`).
- Mermaid `securityLevel:'loose'`: `VibeDocView.tsx:73`, `GeneratedDocView.tsx:338`.
- Hardcoded "Chapter 1": `VibeDocView.tsx:218`. Numbered `li` flex: `VibeDocView.tsx:750`, `GeneratedDocView.tsx:1669`.
- `VibeChapterOneView.tsx:19-25` passes no `language`, so the reader falls back to `'en'` (`VibeDocView.tsx:41`).
- `*.pdf` in `.gitignore:34`. `public/slides` contains only `variables-memory`.
- Navigation falls to `default → '/'` (`App.tsx:279`). Chapter cards call `onNavigate(chapter.view)` (`VibePathView.tsx:371`, `UnityPathView.tsx:234`), and `BLENDER_PATH` has no case (`BlenderCurriculum.tsx:126`). Logout button has no handler (`Layout.tsx:484-500`).
- Fake data: `MissionControlDashboard.tsx:96,115,198-201,342,395,818`; `MyContent.tsx:195` (¥4,500; the plan says 194) and `:120+` (simulated "Gemini 3 Pro" log).
- Tables: 6 in Vibe (ch2, 3, 4, 7, 9, 11) plus 6 in Unity (ch0-2) = 12. Correct.
- `index.html:8` loads only Inter and Playfair. `index.css:5-7` is the only token. Italic JP at `ExperienceLandingView.tsx:171`. `text-slate-400` appears exactly 310 times.
- `<html lang>` is set to `ja` dynamically (`LanguageContext.tsx:39-47`), so `:lang(ja)` rules will work. `Language` type is `'en'|'jp'`, and FR resolves to EN (`:27`).
- `open-rise-path-chat` is dispatched at `GlossaryText.tsx:67` and listened to at `FloatingChatbot.tsx:174`.
- Anthropic facts (claude-api skill, cached 2026-10-06, plus SDK 0.135 tarball):
  - Prices: Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50.
  - Opus 5.5 thinking cannot be disabled (`disabled` and `budget_tokens` both return 400).
  - Effort defaults to `medium`.
  - Forced `tool_choice` `any`/`tool` returns 400.
  - Citations together with `output_config.format` returns 400.
  - Schema limits: no recursion, no `minLength/maxLength`, no `minimum/maximum`, `additionalProperties:false` required. The SDK helpers strip unsupported constraints.
  - `zodOutputFormat` imports `zod/v4`, which exists in zod 3.25.76.
  - `z.toJSONSchema` works (tested).
- Competitors:
  - Learn Your Way 78% vs 67% is correct. It is an arXiv preprint 2509.13348 with n=60, retention measured 3-5 days later, a small sample.
  - Duolingo +0.38% relative DAU from 2 equipable freezes is correct (Duolingo blog).
  - NotebookLM was renamed Gemini Notebook on 2026-07-16. Correct.
  - `gemini-3.8-flash` exists and is the current Flash.
  - `gemini-2.0-flash` was shut down 2026-06-01; `text-embedding-004` was shut down 2026-01-14.

## 3. Corrections

### 3.1 Blockers (a WP fails its own acceptance or ships broken)

**C1. WP-04 cannot pass "12 chapters, UnknownBlock = 0".**
- Vibe data contains `code` ×14, `mermaid` ×13 and `mindmap` ×2 (ch0, ch11).
- WP-04's core blocks are Markdown, Callout, List, Definitions, Table, Image, Summary and Unknown. Code and Diagram arrive in WP-05.
- `mindmap` is in WP-03's 16-type union, but **no WP renders it**.
- Fix:
  - WP-04 ships a baseline `CodeBlock` (plain `pre`, filename, copy) and a baseline `DiagramBlock` (lazy mermaid, `strict`). WP-05 upgrades them in place (Shiki, zoom, details).
  - WP-03 migrates `mindmap` to `diagram` using mermaid's native `mindmap` syntax, and drops `mindmap` from the MVP union.

**C2. The AI-tutor lesson context is dropped server-side.**
- `FloatingChatbot` posts to Hermes `/api/v2/agent/chat` (`FloatingChatbot.tsx:100-107` via `services/agentApi.ts:131,148`).
- `buildHermesInput` only reads `from/to/timezone/ui_language` (`server/services/hermesAgentService.js:51-60`).
- So WP-02's `context.lesson/anchor` reaches the server and is discarded. WP-02's acceptance test (it only checks the fetch payload) passes anyway.
- In this container Hermes is not configured, so the chat errors regardless.
- The design target (`mock-desktop-1.png`) shows an **inline margin tutor panel**, and no WP builds it. WP-08 builds `/llm/tutor`, but nothing consumes it.
- Fix:
  - WP-02 adds bounded lesson and anchor lines (with delimiter tags) to `buildHermesInput`, with a unit test.
  - A **new WP-11 TutorPanel** consumes `/api/v2/llm/tutor` (works with the mock provider and no keys).

**C3. `/api/v2/llm` mount order (WP-08).**
- `server.js:106` `app.use('/api/v2', requireBridgeOrAuth, aiLimiter, agentRoutes)` and `:107` `app.use('/api/v2', requireAuth, contentRoutes)` run for **every** `/api/v2/*` request that reaches them.
- If `llmRoutes` is mounted after them, strict-mode guests get 401 (`authPolicy.js:8-17`), and `aiLimiter` counts twice.
- Fix: mount `/api/v2/llm` immediately after `healthRoutes` (`server.js:99`).

**C4. WP-01 Tailwind v4 mapping collides with existing utilities.**
- Mapping new radii onto `rounded-sm/md/lg/xl` changes 14 + 28 + 123 + 217 existing usages (for example `rounded-lg` goes from 8 px to 14 px, and `rounded-xl` from 12 px to 20 px). That breaks WP-01's own "no breakage besides fonts" criterion. Use new names such as `rounded-chip|control|card|hero` (`--radius-chip` and so on).
- Global element rules (`:lang(ja) p`, `em/i`, `body`, `:focus-visible`) must be inside `@layer base`. Unlayered CSS beats Tailwind v4's `@layer utilities`, so it would override every `leading-*`/`tracking-*` utility app-wide, including P-School.
- The proposed `:lang(ja) :is(.uppercase,[class*="tracking-"])` also matches `tracking-tight`. Restrict it to `.uppercase, [class*="tracking-wide"], [class*="tracking-wider"], [class*="tracking-widest"], [class*="tracking-[0."]`.

**C5. The WP-09 acceptance grep has false positives.**
- `Neuro` matches "Neuroticism" (`assessment/ComprehensiveResults.tsx:578`, `profile/ProfileDiagnosisView.tsx:158`).
- `Cognitive` matches "Cognitive Structure" (`ComprehensiveResults.tsx:152,190`).
- Those files are not owned by WP-09.
- Fix: grep only the three owned files, for the exact phrases `Neuro-Adaptive|Cognitive Fingerprinting|2\.5h|¥4,500|ミリ秒`.

### 3.2 Significant

**C6. Contrast: "all text pairs AA-checked" is false for World accents used as text** (`text-world` is in the `@theme` list).
- Contrast on white / canvas `#F7F7F4`:

| World | Accent | Contrast |
|---|---|---|
| vibe | `#22C55E` | 2.28 / 2.12 |
| sonic | `#06B6D4` | 2.43 / 2.26 |
| pschool | `#F97316` | 2.80 / 2.61 |
| blender | `#EA7600` | 2.96 / 2.76 |
| web | `#0EA5E9` | 2.77 / 2.58 |
| unity/ai | `#8B5CF6` | 4.23 / 3.95 |

- `--rp-sun` `#F59E0B` measures 2.15 / 2.00. That is acceptable only as a fill, never as a 3:1 UI graphic. The 3 px progress line in vibe green also fails 3:1.
- Add `--world-accent-text` (measured):

| World | Value | On white / canvas |
|---|---|---|
| vibe | `#15803D` | 5.02 / 4.67 |
| sonic | `#0E7490` | 5.36 / 4.99 |
| pschool | `#C2410C` | 5.18 / 4.82 |
| blender | `#B45309` | 5.02 / 4.68 |
| web | `#0369A1` | 5.93 / 5.53 |
| unity | `#7C3AED` | 5.70 / 5.31 |

- Map `text-world` to the `-text` value. Note that vibe, blender and art drop to about 4.4 on `--rp-sunken`, so don't put accent text on sunken surfaces.

**C7. Anthropic fallbacks are beta-only.**
- In SDK 0.135, the `fallbacks?:` field exists only on `resources/beta/messages` (`messages.d.ts:6980`).
- WP-08 must use `client.beta.messages.parse/stream` + `betaZodOutputFormat` (from `@anthropic-ai/sdk/helpers/beta/zod`) + `betas:['server-side-fallback-2026-07-01']` + `fallbacks:'default'`.
- Do not use `client.messages.parse` + `zodOutputFormat`, as §6.2 and WP-08 imply.
- If raw JSON Schema is passed (the "direct" fallback path), strip `$schema`, `pattern`, `minLength/maxLength`, `minimum/maximum` and `minItems/maxItems`. `z.toJSONSchema` emits these (verified).

**C8. Zod version.** `npm install zod` would install **4.6.7**, and MCP SDK 1.29's `server.tool` path is built on zod v3 and `zod-to-json-schema`. Pin exactly with `npm i zod@3.25.76 @modelcontextprotocol/sdk@1.29.0`, and use `zod/v4` only via the subpath in `shared/lesson/*`.

**C9. The WP-03 migration test cannot import the legacy `.ts` data under the `npm test` runtime.**
- `npm test` uses `node --experimental-strip-types`.
- The chapter files `import { DocChapter } from '../../../types'` (no extension), and `types.ts:103` has `export enum ViewState`. Strip-types supports neither.
- Fix: export a `loadLegacyChapter(path)` (esbuild in-memory) from `scripts/lessons/migrate-legacy.mjs` and call it from the test, or record source counts in `provenance.migratedFrom`.

**C10. Parallel waves share one working tree.**
- Wave 1 runs WP-01, 03, 08 and 10 concurrently. Three of them `npm install`, and every WP's DoD runs `npm run build` (writes `dist/`) and `tsc` over half-edited sibling files.
- Concurrent `npm install` races `package-lock.json`.
- Fix:
  - Add **WP-00** to install all dependencies once and add all scripts.
  - Give each agent its own git worktree (with node_modules symlinked), or serialize verification.
  - Build with `npx vite build --outDir <scratch>/dist-<wp>`.

**C11. Deployment images omit new directories.**
- `deploy/risepath-vm/Dockerfile:33-38` (API) and `:55-61` (MCP) COPY explicit directories. `shared/` and `content/` are missing, so the server-side or MCP import of `shared/lesson/*` crashes in production.
- The root `Dockerfile:34-41` already omits `tools/`. That is a pre-existing break, since `server/routes/ai.js:11` imports `../../tools/core/curriculum.js`.
- Assign these fixes to WP-00.

**C12. Preview tooling.**
- (a) Chromium: use the fallback chain `PLAYWRIGHT_CHROMIUM_PATH` → `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` → default (see §1).
- (b) Logged-out users get `LandingView` for every path (`App.tsx:310-320`). `preview.mjs` and `readercheck.mjs` must seed `localStorage.rp_auth_user` the way `.shots/shoot.mjs` does.
- (c) If `content/index.ts` globs `content/courses/**`, it will bundle `drafts/` into production. Exclude drafts outside `import.meta.env.DEV`, and load the zod validator through a DEV-only dynamic import.

**C13. WP-07 details.**
- Registry entries need the full shape (`tool-registry.json:7-22`): `tool_id`, `category`, `data_class`, `requires_approval` and `annotations{title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint}`, not just exposure/risk/audit.
- `curricula` also lacks `intake` and `generation_meta`. It has `content`, `intake_json`, `modules_json` and `model_used`.
- Reuse the working version-insert at `server/routes/chatgptCurriculum.js:387`, and test via `setPoolForTests` (`server/db.js`).
- The `author-lesson` MCP prompt "same as the skill" depends on WP-06, which runs later. Read `.claude/skills/author-lesson/SKILL.md` at runtime if present, and fall back to a built-in short prompt.
- Keep the server name `rise-path-learning` (`mcp-server/index.js:158`, `.gemini/settings.json`). WP-06's `.mcp.json` key should match.

**C14. WP-08 guest impact.** In strict mode, `requireAuth` on `/api/v2/ai` turns guest generation into 401. In this env it already 503s without a DB (`ai.js:39`). `CourseGeneratorView` needs a login-required/unavailable state. Also extend the leak test to `VITE_GEMINI_API_KEY` (`services/geminiApiKey.ts:16`). The `ai.js:155` write to `curriculum_data` is in WP-08's file, so fix it there or mark it deferred.

**C15. Fonts.** The UD reading font (`BIZ UDPGothic`, §4.2/§5.8) is not in WP-01's font list, and WP-04 may not touch `index.html`. Have `ReaderSettings` inject the font `<link>` lazily when UD is selected. Consider lazy-loading Newsreader, Noto Serif JP and JetBrains Mono too; five families site-wide is heavy.

**C16. WP-01 font acceptance is vacuous.** `document.fonts.check('16px "Noto Sans JP"')` returns true when no matching face needs loading. Use instead: `await document.fonts.load('16px "Noto Sans JP"','あ')` returns a non-empty array, **and** some `FontFace` with family `Noto Sans JP` has `status === 'loaded'`.

### 3.3 Minor

- `RisePathConciergeView.tsx` is unused but **compiles** (it is in tsc's file list and tsc reports 0 errors). Keep the deletion, but the reason is "dead code and an extra `@google/genai` importer", not "syntax error".
- WP-10 paths: the wrappers live in `components/wrappers/` (`GeneratedLessonViewWrapper.tsx:49,53`, `GeneratedCourseViewWrapper.tsx:28`), not `components/features/ai/`.
- Layout's "学習コンテンツ" item is `ViewState.COURSES` → `/courses` (`Layout.tsx:177`). Keep the `art` and `vibe` dark sidebar variants (`Layout.tsx:56-106`); tokenize only `default`.
- `tutorBridge` must accept the legacy `{message, context: string}` from `GlossaryText.tsx:67`.
- WP-09: `loginAsGuest()` throws when Supabase auth is active (`AuthContext.tsx:241-243`), so the "ゲストで第1章を読む" CTA needs a fallback to login. Dropping recharts from the dashboard removes 159 kB gz from the critical path; add that as an acceptance check. `components/ui/` would sit next to the existing `components/common/ui/`; pick one.
- Embeddings: `gemini-embedding-2` is the current GA model. `gemini-embedding-001` is deprecated (shutdown 2028-05-14). `gemini-3-pro-image` is not listed on Google's deprecations page, so verify the image model ID before writing it into `models.config.js`.
- `.gemini/settings.json` hardcodes `/Users/2005nk/...` and the `admin` profile. WP-06 should fix it to a relative path and `curriculum-builder`. The existing Hermes skill `skills/curriculum-generator/SKILL.md` still prescribes Big5 "learning style", which contradicts §2.2. Flag it as a follow-up.
- A second client-exposed secret: `VITE_NEXLOOM_WORLDS_BEARER_TOKEN` (`services/nexloomWorldsBridge.ts:291`). Flag it to the owner.
- `.page-transition` animates `transform` (`index.css:300-310`). Reader drawers and bottom sheets should portal to `body`, otherwise they mis-position during the 0.5 s animation.
- Competitor claims I could **not** verify: the Progate prices (¥990/¥2,490) and the existence of a Progate Claude Code/Codex course. They are not load-bearing for the backlog, but mark them "unverified" in the deck.

## 4. Missing from the plan

- **i18n convention.** §4.3 #10 promises "one dictionary", but no WP creates one. For this session, adopt the existing per-component `copy = {en, jp}` pattern (as in `FloatingChatbot.tsx:40-66`) with `useLanguage().language`. Every new learner-facing string needs EN and JP. When a content block falls back to another locale, set `lang` on that block.
- **a11y gaps:**
  - No skip-to-content link.
  - Dialogs and drawers need a focus trap, Esc to close and focus return (ReaderSettings, Outline drawer, TutorPanel, zoom dialog).
  - Hover-only ✦ fails touch and keyboard. Show it on `:focus-within`, show it on tap on touch, and limit tab stops to markdown blocks.
  - Quiz: prefer native radios with arrow keys. Bind the 1–4 shortcuts only while focus is inside the quiz, to avoid conflicts with screen readers.
- **P-School untouched.** Add `/p-school` and `/art` to WP-01/WP-02 screenshot diffs. Add `git diff --stat -- components/features/PSchool data/curricula/p_school public/p_school` must be empty to the global DoD.
- **Existing routes regression.** Run the default 20-route list in `.shots/shoot.mjs` plus `/unity/chapter-0`, `/generated-lesson/demo-curr-001`, `/vibe/prologue` and `/blender/lesson/1` before and after the final integration, with no `page errors`.
- **Baseline gates stated numerically:** tsc 0 errors (stays 0), build passes, `npm test` at least 333 passing and 0 failing.

## 5. Revised, sequenced backlog

Unchanged parts of each WP stay as in PLAN.ja.md §9. Only deltas are listed. The global DoD from §9.0 still applies, with these amendments:
- Build to a per-WP outDir.
- Each agent works in its own worktree.
- tsc stays at 0 errors; tests at least 333 pass.
- The P-School diff is empty.
- Screenshots include `/p-school` when global CSS or the shell is touched.
- New UI copy exists in EN and JP.
- No new `[#hex]`, `rounded-[…]`, `text-[9-11px]` or `text-slate-400`.

### Wave 0 (serial, ~0.25 day)

**WP-00 Dependencies, scripts, deploy plumbing**
- Size: S. Deps: none. Conflicts: owns `package.json`, `package-lock.json`, both Dockerfiles. **No other WP may run `npm install` afterwards without the orchestrator's approval.**
- Run one install: `npm i zod@3.25.76 @modelcontextprotocol/sdk@1.29.0 @anthropic-ai/sdk@0.135.0 shiki@4.5.0 remark-gfm@4.0.1` (optionally `dompurify@3.4.11`).
- Add the scripts `lessons:validate|lint|schema|migrate|preview|catalog|mcp-smoke` pointing at `scripts/lessons/*.mjs`, which the owning WPs create later.
- In `deploy/risepath-vm/Dockerfile`, add `COPY shared/ ./shared/` and `COPY content/ ./content/` to the API stage (after `:35`) and the MCP stage (after `:56`). In the root `Dockerfile`, add `tools/`, `shared/` and `content/` after `:35`.
- Write `<session-scratchpad>/scripts/pw.mjs`, which exports `launch()` with the Chromium fallback chain and `seedGuest(ctx)`.
- Acceptance: `npm ls zod` shows a single 3.25.76; tsc 0, build passes, 333 tests pass; `docker build` is optional.

### Wave 1 (parallel, separate worktrees)

**WP-01 Tokens and JP typography (S–M)**
Same as the plan, plus C4, C6, C15 and C16:
- Radii use new names. `text-world` maps to `--world-accent-text`.
- All element and global rules go in `@layer base`; the tracking neutralizer is narrowed.
- Fonts: Inter, Noto Sans JP and JetBrains Mono eagerly; Newsreader and Noto Serif JP may stay eager, but justify it. No BIZ UDPGothic.
- Acceptance adds:
  - `/p-school` and `/art` screenshots unchanged except for fonts.
  - Count of `rounded-lg` computed `border-radius` on `/` unchanged (8 px).

**WP-03 Schema, CLI, migration (L)**
Same as the plan, plus C1 (mindmap → `diagram` mermaid-mindmap; union drops `mindmap`), C8 and C9:
- The LLM schema export strips unsupported keywords (C7 list).
- Remove the decorative Unsplash image (`chapter1.ts:147`) in the polished ch1.
- New EN copy for all ch1 additions.
- Keep the `jp|en|fr` keys.

**WP-08 LLM gateway and key-leak fix (L)**
Same as the plan, plus C3, C7, C14 and the embedding/image ID checks:
- Owns `server/routes/ai.js`, including the `:155` fix or an explicit TODO.
- Keep `@google/genai` (server uses it).
- Acceptance adds:
  - `VITE_GEMINI_API_KEY=SENTINEL npx vite build --outDir <tmp>`, then `! grep -r SENTINEL <tmp>`.
  - Strict-mode test (`RISEPATH_STRICT_AUTH=true`): `GET /api/v2/llm/status` without a token returns 200.

**WP-10 Legacy reader hardening (S)**
As in the plan, with the corrected wrapper paths. Plus: hide the Slides tab when `pdfUrl` is missing or HEAD returns not-ok.

### Wave 2

**WP-02 Shell and navigation (M)** (after WP-01)
As in the plan, plus:
- Skip link and Esc on the mobile menu.
- Keep the art/vibe themes.
- `tutorBridge` is legacy-compatible.
- **Owns `server/services/hermesAgentService.js`**: `buildHermesInput` appends `<lesson>` and `<excerpt ≤1500>` data blocks (C2).
- Acceptance replaces the fetch-mock check with a `server/tests/hermesLessonContext.test.js` unit test.

**WP-07 MCP lesson tools (M)** (after WP-03)
As in the plan, plus C13 (full registry shape; DB mode via the `chatgptCurriculum.js:387` pattern and `setPoolForTests`; runtime-loaded prompt; name `rise-path-learning`).

### Wave 3

**WP-04 LessonReader (L)** (after WP-01, 02, 03)
As in the plan, plus:
- Baseline `CodeBlock` and `DiagramBlock` (C1); `remark-gfm` in MarkdownBlock.
- DEV-only drafts glob and validator (C12c).
- `/preview` is DEV-only; checker scripts seed a guest.
- Drawers portal to `body`.
- ✦ affordance per §4 a11y.
- Lazy UD font link in ReaderSettings.
- Margin column: glossary card plus an "AI先生" card that calls `openTutor` (placeholder for WP-11).
- Acceptance unchanged. "UnknownBlock 0" is now achievable.

### Wave 4 (parallel)

**WP-05 Rich blocks + `/dev/blocks` (L)** (after WP-04)
As in the plan, plus:
- Shiki via `shiki/core` + `createJavaScriptRegexEngine` + explicit langs/themes. Acceptance: no `.wasm` asset in the build; `index-*.js` grows by less than 20 kB.
- Upgrade (do not create) Code and Diagram. Sanitize mermaid SVG output with DOMPurify (`svg`+`html` profiles).
- POSIX single-quote escaping for "Claude Codeで使う".
- Quiz uses native radios; 1–4 keys are focus-scoped.

**WP-09 Dashboard and landing (M–L)** (after WP-01, 02, 04)
As in the plan, plus:
- Fixed grep (C5).
- Guest CTA falls back to login.
- Acceptance: `dist/index.html` has no `recharts-` modulepreload.
- Choose `components/ui/` and document it.

**WP-11 Inline TutorPanel (NEW, M)** (after WP-04, WP-08)
- Files:
  - `components/lesson/TutorPanel.tsx` (margin ≥1280 px, right drawer 1024–1279 px, bottom sheet <1024 px).
  - `components/lesson/useTutorStream.ts` (SSE from `/api/v2/llm/tutor` via `services/llmApi.ts`).
- Behaviour:
  - Shows the quoted excerpt.
  - Chips [もっと簡単に][別の例][クイズを出して].
  - A "根拠 §n" chip scrolls to the `blockId`.
  - Socratic mode when `learner.attemptsOnBlock < 2`.
- Integration: on `/learn` and `/preview` routes, `openTutor` events with `detail.lesson` go to the TutorPanel. FloatingChatbot ignores them on those routes; WP-11 owns that small `FloatingChatbot.tsx` edit after WP-02.
- Acceptance, with `LLM_PROVIDER=mock`:
  - Clicking ✦ streams the mock answer into the margin panel at 1440 px and into the bottom sheet at 390 px.
  - Esc closes the panel and focus returns.
  - No `page errors`.
  - JP and EN copy.

### Wave 5

**WP-06 Claude Code authoring kit (M)** (after WP-03, 04, 05, 07)
As in the plan, plus:
- `.mcp.json` key is `rise-path-learning`.
- Fix `.gemini/settings.json`.
- `preview.mjs` uses the Chromium fallback chain and seeds the guest.
- The block cookbook is generated from `content/examples/blocks-gallery.lesson.json`.
- The guide mentions `mcp-server/claude_desktop_config.example.json`.

### Final integration (serial)

1. Merge the worktrees in wave order.
2. Run `npm run typecheck && npx vite build --outDir <scratch>/dist-final && npm test && npm run lessons:validate`.
3. Take before/after screenshots of the full route list, desktop and 390 px, JP and EN, with no page errors.
4. Check that the P-School diff is empty.

### Dependency summary

```
WP-00 → {WP-01, WP-03, WP-08, WP-10}
WP-01 → WP-02
WP-03 → WP-07
{WP-01, WP-02, WP-03} → WP-04
WP-04 → {WP-05, WP-09*, WP-11*}   (*WP-09 also needs WP-01, 02; WP-11 also needs WP-08)
{WP-03, WP-04, WP-05, WP-07} → WP-06
```

Shared-file ownership changes vs the plan:
- `package.json`, `package-lock.json` and the Dockerfiles go to **WP-00 only**.
- `server/services/hermesAgentService.js` goes to WP-02.
- `FloatingChatbot.tsx` is edited by WP-02, then WP-11.
- `components/lesson/blocks/{CodeBlock,DiagramBlock}.tsx` are created by WP-04 and enhanced by WP-05.
- `App.tsx` is edited in order by WP-02, WP-04, WP-05 (`/dev/blocks`) and WP-09 (none).
