# Connecting Claude Code and other LLMs to author great learning material (key: `research-claude`)

Scope: how Rise Path should use Claude Code, the Claude API and other LLMs (via MCP) to produce excellent 教材, plus the runtime tutor and generator. It covers repo-first authoring (content as code, reviewed in PRs) and in-app generation. Sibling reports cover the lesson schema (`code-content.md` §8), the LLM gateway internals (`code-llm.md` §9–11) and the reader UI (`ui-lessons.md`). This report reuses their schema and gateway and adds the authoring system around them.

Date of research: 2026-10-18. Model IDs used: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`.

---

## 0. TL;DR

1. **Claude Code has nothing project-specific to load today.** The repo has no `CLAUDE.md`/`AGENTS.md`, `.claude/`, `.mcp.json` or `.github/`. The six `skills/*/SKILL.md` files are Hermes/MCP runtime skills outside `.claude/skills`, so Claude Code never discovers them. Adding about 15 small files (layout in §4) turns Claude Code into a lesson-authoring workstation.
2. **Content must become data in `content/`, validated by one zod schema.** Today lessons are TS modules (`data/curricula/vibe_coding/chapter1.ts`) behind 12 near-identical wrapper components and routes (`App.tsx:415-426`). The JSON Schema in `doc/system_design/ai-curriculum-spec/schemas/doc_chapter.schema.json` has drifted from `types.ts:345-385`: it has no `fr`, no list style `key`, `image.src` required versus optional, and uses `oneOf`. An LLM cannot reliably target a contract that drifts like this.
3. **Authoring pipeline:** brief → research (sources.json) → outline (objectives with ids and Bloom levels) → draft blocks → **deterministic validate + lint (CLI and hook)** → **independent reviewer subagents score a pedagogy rubric (JSON)** → JP copy edit / localize → **preview screenshots that Claude itself inspects** → PR with a review report. CI repeats validate, lint, screenshots and the rubric score.
4. **Use Claude Code features for what each does best.** A skill (`/author-lesson`) holds the procedure. Subagents give isolated, unbiased review (this avoids self-preference). Hooks make validation non-optional. `.claude/rules/content.md` (path-scoped) holds content conventions. `.mcp.json` exposes the Rise Path MCP. `claude -p --json-schema` and `anthropics/claude-code-action@v1` run the rubric in CI. A GitHub issue template (`lesson-request`) lets `@claude` turn a request into a PR.
5. **One `SKILL.md` format runs in four places:** Claude Code, the Agent SDK, the Claude API Skills endpoint (custom skills) and Managed Agents. Write the authoring skill once and reuse it for an optional server-side "deep author" job, which can use a Managed Agents *outcome* graded against the same rubric.
6. **MCP is the common denominator for other LLMs**: ChatGPT (Responses API / Apps), Gemini CLI, Cursor, Codex, and local models through a host such as Hermes. AGENTS.md is the shared instruction file. The MCP server must move off the **deprecated HTTP+SSE transport** to stateless Streamable HTTP (MCP spec 2026-07-28), get real `inputSchema`/`outputSchema` (today `curriculum: z.object({}).passthrough()`, `mcp-server/index.js:388-389`), and add authoring tools. **MCP Apps** (`ui://` resources) would let Claude and ChatGPT render a live lesson preview inline.
7. **The runtime tutor should be grounded with Claude citations.** Pass the lesson as a `document` block with `citations.enabled` and map each citation back to a block id, so every answer carries a "根拠: §1-2" chip that scrolls the reader. Citations are incompatible with structured outputs, so the generator uses a two-pass "facts with citations → structured lesson that cites fact ids" design.
8. **Claude API 2026 gotchas to design around.** On Opus 5.5 and Sonnet 5.5, forced `tool_choice` (`any`/`tool`) returns a 400, so use `output_config.format` with zod. Opus 5.5 thinking is always on and effort defaults to **medium**, so set effort per task. Structured outputs reject recursive schemas and ignore `minLength`. `budget_tokens` is rejected, so use adaptive thinking. Server-side refusal fallbacks are opt-in.
9. **Security blocker for any LLM work:** `vite.config.ts:51-52` inlines `GEMINI_API_KEY` into the client bundle, and `services/geminiApiKey.ts` reads `VITE_GEMINI_API_KEY`. Every LLM call must go through the server gateway.
10. **Stale agent wiring:** `agents/rise-path-tutor.yaml` lists 12 tools, of which only 5 exist (`get-generation-kit`, `validate-intake`, `save-curriculum-draft`, `rag-search`, `request-tts`). Its resources (`learner://profile/{user_id}`, `content://lesson/...`, `analytics://...`) don't exist either. The model is `gemini-3-flash`. Generate this file from `mcp-server/tool-registry.json` or delete it.

---

## 1. What exists today (repo evidence)

### 1.1 Agent / LLM integration surface

| Area | Evidence | Assessment |
|---|---|---|
| Claude Code config | no `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.mcp.json`, `.github/` (ls at repo root) | Claude Code starts blind; there's no repeatable authoring workflow. |
| Other agent configs | `.gemini/settings.json` and `.grok/config.toml` hardcode a personal absolute path (a home folder under `/Users`); `mcp-server/claude_desktop_config.example.json` hardcodes a `/Volumes/…` path | Personal absolute paths are committed and break for anyone else. Use repo-relative paths or `${RISE_PATH_ROOT}`. |
| Runtime skills | `skills/{curriculum-generator,learning-coach,content-search,progress-tracker,life-habit-analyst,personal-memory-curator}/SKILL.md` | JP, written for Hermes and MCP clients. `curriculum-generator/SKILL.md` references the tool `learner-state` (the real ones are `learner-state-get`/`-update`) and a `version:` field that Claude Code ignores. Not discoverable by Claude Code (it reads `.claude/skills/`). |
| Agent persona | `agents/rise-path-tutor.yaml` (`model: gemini-3-flash`, 12 tools, 4 resources) | 7 of the 12 listed tools are not registered in `mcp-server/index.js`: `learner-state` (real: `learner-state-get`/`-update`), `journal` (real: `journal-log`/`-recent`/`-summary`), `derive-personalization`, `save-assessment`, `get-resume-card`, `publish-curriculum`, `learning-insights`. Resources don't match `content://domains` and `learner://profile/me` (`mcp-server/index.js:730-770`). |
| MCP server | `mcp-server/index.js` (1078 lines): `McpServer` + `server.tool()` (:167), stdio (:1016) and **`SSEServerTransport`** (:815); 22 tools, 2 resources, 1 prompt (`socratic-tutor`, :778) | Legacy API (`server.tool` rather than `registerTool` with `outputSchema`). SSE is deprecated by the 2026-07-28 spec. Authoring tools are coarse (`get-generation-kit`, `validate-intake`, `save-curriculum-draft` with passthrough objects, :329-416). There are no read-back, validate-lesson or preview tools. |
| MCP SDK dependency | `package.json` does not declare `@modelcontextprotocol/sdk` or `zod`. They come in only as an **optional peer** of `@google/genai` (`package-lock.json:807-812`, `:922-929` `"optional": true, "peer": true`) | Fragile: a dependency bump of `@google/genai` can silently remove the MCP server's runtime. Declare both explicitly. |
| Hermes | `hermes/README.md` and the `server/services/hermesAgentService.js` OpenAI-Responses-compatible proxy at `/api/v2/agent/chat` | Good provider-agnostic runtime for a tool-using coach. But the README cites npm scripts that don't exist in `package.json` (`setup:hermes-local`, `mcp:local`, `hermes:local`, `smoke:hermes-local`, README lines about 22-35). |
| Server generation | `server/services/aiGenerator.js:16` (`gemini-2.5-flash`, JSON mode, regex fallback for fenced JSON, :49-79), `aiPrompts.js` | No schema-constrained output, no validation or repair loop, no rubric. See `code-llm.md` §3–5. |
| Browser LLM | `services/geminiService.ts` (BYOK via localStorage + env), used by `RisePathConciergeView.tsx`, `PersonalAssessmentView.tsx`, `LessonView.tsx` | Must move server-side. |
| Key exposure | `vite.config.ts:51-52` `define: {'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)}`; `services/geminiApiKey.ts` `readEnvApiKey()` | The server key ships in the JS bundle. This is a P0 fix. |

### 1.2 Content representation (what authoring has to target)

- **Curated lessons are TypeScript modules.** For example, `data/curricula/vibe_coding/chapter1.ts` exports a `DocChapter` with `LocalizedText {en, jp, fr?}` (`types.ts:345-385`). Quizzes live in separate files (`chapter1_quiz.ts`, `types.ts:387-404`).
- **There are 12 wrapper components and 12 routes for one renderer.** `VibeChapterOneView.tsx` is a 28-line wrapper around `VibeDocView`, and `App.tsx:415-426` has one route per chapter. Adding a lesson today means editing three files plus App routing. Authoring tools need **one data-driven route**.
- **Two renderers have different block coverage.** `VibeDocView.tsx` (772 lines) handles `mindmap, text, image, code, callout, list, mermaid` and is **missing `table`** (cases at :667-764), even though the type exists. `GeneratedDocView.tsx` (1779 lines) does render `table` (:1686). A lesson that validates can still render blank, which is why the authoring loop needs a screenshot step.
- **Some assets are broken.** `VibeChapterOneView.tsx:23` sets `pdfUrl="/slides/chapter1.pdf"`, but `public/slides/` only contains `variables-memory/*.svg`.
- **The schema has drifted.** `doc_chapter.schema.json` requires `{en, jp}` with no `fr`, has no `key` list style, requires `image.src`, and uses `oneOf`. `types.ts` allows `fr`, list style `key` and optional `src`. One source of truth (zod → JSON Schema) is mandatory before any LLM targets it.
- **The multi-format block model** (`types.ts:245-291`, `doc/curricula/multi_format_curriculum_design.md`) is a third shape. The siblings propose merging all of these into `risepath.lesson/v1` (`code-content.md` §8.2) / `rp.lesson/v1` (`code-llm.md` §10). **Pick one id**; this report assumes `risepath.lesson/v1` and the superset block list in `code-content.md` §8.2.

---

## 2. Research findings (external)

### 2.1 Claude Code features relevant to authoring

| Feature | What matters for Rise Path | Source |
|---|---|---|
| **CLAUDE.md / AGENTS.md** | `./CLAUDE.md` or `.claude/CLAUDE.md` load every session. Target **under 200 lines**. `@path` imports (relative to the file, max depth 4). Claude Code reads `AGENTS.md` **only when no CLAUDE.md exists**, or when CLAUDE.md imports it, so put shared rules in AGENTS.md and have CLAUDE.md import `@AGENTS.md`. | code.claude.com/docs/en/memory |
| **Path-scoped rules** | `.claude/rules/*.md` with a `paths:` frontmatter glob load only when Claude reads or edits matching files. Use one for `content/**`. | same |
| **Skills** (`.claude/skills/<name>/SKILL.md`) | Frontmatter: `name`, `description` (+`when_to_use`, together truncated at 1,536 chars in the listing), `argument-hint`, `arguments` (named `$name`), `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork` + `agent`, `hooks`, `paths`. `` !`cmd` `` injects shell output before Claude sees the skill (if the command fails, the whole invocation aborts). `${CLAUDE_SKILL_DIR}`. Keep under 500 lines and move detail into supporting files. `.claude/commands/x.md` and skills both create `/x`; on a name clash the skill wins. | code.claude.com/docs/en/skills |
| **Subagents** (`.claude/agents/*.md`) | Fields: `name`, `description`, `tools`, `disallowedTools`, `model` (`sonnet`/`opus`/`haiku`/full ID/`inherit`), `permissionMode`, `maxTurns`, `skills` (preloaded), `mcpServers`, `hooks`, `memory` (`project` puts it in `.claude/agent-memory/<name>/`), `background`, `effort`, `isolation: worktree`. Each runs in **its own context** and returns only a summary, which is ideal for unbiased reviewers and for keeping research noise out of the main thread. | code.claude.com/docs/en/sub-agents |
| **Hooks** | Events include `PostToolUse`, `Stop`, `SubagentStop`, `SessionStart`, `UserPromptSubmit`. Handler `type`: `command`/`http`/`mcp_tool`/`prompt`/`agent`. **Exit 2** feeds stderr back to Claude (on `PostToolUse` the edit already happened, so Claude gets the error and fixes it; on `Stop` Claude keeps working). `CLAUDE_PROJECT_DIR` is available. Hooks can also live in skill or agent frontmatter. | code.claude.com/docs/en/hooks |
| **MCP** | Project scope is `.mcp.json` (approved per user), with `${VAR}` / `${VAR:-default}` expansion in `command/args/env/url/headers`. Transports: `http` (recommended), `stdio`, **SSE deprecated**. `MAX_MCP_OUTPUT_TOKENS` defaults to 25k; larger results are spilled to file. | code.claude.com/docs/en/mcp |
| **Headless** | `claude -p "<prompt>"` runs non-interactively. `--output-format json` returns `result`, `session_id` and `total_cost_usd`. **`--json-schema '<schema>'`** puts validated output in `structured_output`. Other flags: `--allowedTools`, `--permission-mode acceptEdits|dontAsk|auto`, `--permission-prompts none`, `--max-turns`, `--max-budget-usd`, `--append-system-prompt`, `--mcp-config`, `--resume`. `/skill-name` in the prompt is expanded. `--bare` skips skills/CLAUDE.md/hooks discovery, so **don't use bare for authoring runs** (or pass `--add-dir`). | code.claude.com/docs/en/headless |
| **Agent SDK** | `import { query } from "@anthropic-ai/claude-agent-sdk"`. Options: `allowedTools`, `permissionMode`, `settingSources: ["project"]` (loads `.claude/` skills, agents and CLAUDE.md), `model`, `maxTurns`, `cwd`, `systemPrompt: {type:'preset', preset:'claude_code', append}`, `outputFormat: {type:'json_schema', schema}`, `agents`, `mcpServers`, `hooks`, `maxBudgetUsd`. You host it (API key auth; claude.ai login not allowed for third-party products). | code.claude.com/docs/en/agent-sdk/overview, /typescript |
| **GitHub Actions** | `anthropics/claude-code-action@v1`. With no `prompt`, it answers `@claude` mentions. With `prompt`, it runs in automation mode (any event, including `schedule`). `prompt: "/skill-name ..."` runs a **project skill** after `actions/checkout`. `claude_args: "--model claude-opus-5-5 --max-turns 20 --allowedTools ..."`. Auth: `anthropic_api_key`, `claude_code_oauth_token`, or OIDC workload identity federation. | code.claude.com/docs/en/github-actions |
| **Dynamic workflows** | Claude writes a JS harness (`agent()`, `parallel()`, `pipeline()`, per-agent `model`/`schema`/`isolation`). Patterns: fan-out and synthesize, **adversarial verification against a rubric**, generate-and-filter, one verifier per claim. Saved workflows go in `~/.claude/workflows` or inside a skill. Good for bulk course migration. | claude.dev blog "A harness for every task" |

### 2.2 Claude API features (via the bundled `claude-api` skill, cached 2026-10-06)

| Feature | Use in Rise Path | Caveats |
|---|---|---|
| Models | `claude-opus-5-5` ($4/$20 per MTok, 1M context, 128K output): course outline, lesson authoring, judge for hard cases. `claude-sonnet-5-5` ($2/$10): rubric grading, writing feedback, high-volume authoring. `claude-haiku-5-5` ($0.10/$0.50 up to 100K-token prompts): in-lesson tutor, classification, translation. | Use exact IDs with no date suffix. |
| **Structured outputs** | `output_config: {format: zodOutputFormat(LessonLLM)}` with `client.messages.parse()`, or `strict: true` tools. | **Not supported:** recursive schemas, `minLength`/`maxLength`, numeric bounds (the TS SDK strips these and validates client-side). Supported: `anyOf`, `enum`, `const`, `$ref` (`oneOf` is not listed, so emit a discriminated `anyOf`). `additionalProperties:false` on all objects. **Incompatible with citations** (400). |
| Tool choice | — | **Forced `tool_choice` `any`/`tool` returns a 400 on Opus 5.5 / Sonnet 5.5.** Don't port Gemini-style forced function calling; use structured outputs. |
| Thinking / effort | `output_config.effort` per task (`low` tutor, `medium` lesson, `high` outline / judge). | Opus 5.5: thinking can't be disabled and `budget_tokens` returns a 400. The default effort is **medium**, so set it explicitly. Thinking `display` defaults to `"omitted"`; use `"summarized"` if you stream reasoning to users. No assistant prefill. |
| **Prompt caching** | The cached prefix is `tools → system (persona + style guide + schema + gold lesson) → lesson document`, with the learner question last. Up to 4 breakpoints and a `ttl: "1h"` option for batch generation. | Any byte change in the prefix invalidates the cache (timestamps, unsorted JSON). Verify with `usage.cache_read_input_tokens`. |
| **Citations** | Pass the lesson or user material as `document` blocks with `citations: {enabled: true}`. Responses carry `cited_text` and a location (`char_location`, `page_location` or `content_block_location`). | Can't be combined with `output_config.format`. |
| **Files API** (GA, `client.files.*`) | Upload learner or author source PDFs once and reference them by `file_id` across outline, lesson and tutor calls. | — |
| Batches (50% cost) | Bulk translation and bulk re-grading of the whole `content/` tree. | Results arrive in any order; key them by `custom_id`. |
| Server tools | `web_search_20260209` / `web_fetch_20260209` (dynamic filtering) for the research step, with `allowed_domains` limited to official docs (docs.blender.org, developer.mozilla.org, docs.unity3d.com, react.dev …). | Errors come back as 200 with error content. |
| Refusal fallbacks | `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"` on Opus 5.5. | Check `stop_reason` before reading content. |
| Mid-conversation system messages | `{role:"system"}` appended in `messages` for tutor "hint level" changes without breaking the cache (Opus/Sonnet/Haiku 5.5). | Must follow a user turn. |
| **Skills API / Managed Agents** | Custom skills use the **same SKILL.md format** as `.claude/skills/`. Managed Agents can mount them, and an *outcome* (`user.define_outcome` + rubric) has a separate grader iterate until the rubric passes, which maps directly onto "lesson must score ≥3 on every rubric line". | Beta (`managed-agents-2026-04-01`). Optional P3 path. |

### 2.3 MCP spec 2026-07-28 (final, released 2026-07-28)

- **Stateless core.** The `initialize`/`initialized` handshake and the **`Mcp-Session-Id` header are retired**. Each request carries version, client identity and capabilities in `_meta`, and `server/discover` is optional. State that a server needs comes back as a handle that the model passes in tool arguments.
- **Transports.** Streamable HTTP requests carry `Mcp-Method`/`Mcp-Name` headers. Server-to-client sampling and elicitation use Multi Round-Trip Requests. **Legacy HTTP+SSE is deprecated** with a 12-month off-ramp.
- **Extensions.** `io.modelcontextprotocol/tasks` covers long-running work (`tasks/get`, `tasks/update`), which fits "generate a 12-lesson course". **MCP Apps** lets servers declare `ui://` HTML resources (`text/html;profile=mcp-app`) that hosts render in sandboxed iframes, so a lesson preview could render inside Claude or ChatGPT.
- **Deprecated:** Roots, Sampling and Logging (they keep working for at least 12 months). `tools/list` and `resources/read` responses gain `ttlMs`/`cacheScope` hints. OAuth tightening: RFC 9207 `iss`, CIMD replaces DCR.
- **Impact on Rise Path.** `mcp-server/index.js:815-1003` (SSE plus per-connection server plus session-keyed auth, `sseMessagesAuth.js`, `server/migrations/005_mcp_sessions.sql`) is built around exactly what was retired. Plan a Streamable-HTTP, token-scoped endpoint (`/mcp`) and keep SSE only during migration.

### 2.4 Other LLMs: how they plug in

| Client | Mechanism | Notes |
|---|---|---|
| ChatGPT / OpenAI API | The Responses API hosted MCP tool reaches **remote** servers (Streamable HTTP or legacy SSE; it must be publicly reachable). The Agents SDK supports MCP. ChatGPT connectors and Apps use MCP plus OAuth. | `doc/system_design/ai-curriculum-spec/10_chatgpt_mcp_integration.md` already chose "ChatGPT generates, Rise Path validates and saves", which is the right split. It needs real schemas. |
| Gemini CLI | `mcpServers` in `.gemini/settings.json` (`command/args` or `httpUrl`; `includeTools`/`excludeTools`, `trust`). It reads `GEMINI.md`, and its context file name is configurable, so point it at AGENTS.md (verify the current key name). | One 2026 third-party post reports Gemini CLI access changes; unverified. |
| Cursor / Codex / other coding agents | `.cursor/mcp.json`; AGENTS.md is the de facto shared instruction file. | Keep AGENTS.md the canonical rules; CLAUDE.md imports it. |
| Local models (Ollama, LM Studio, vLLM, OpenRouter) | OpenAI-compatible `/v1/chat/completions` through the gateway's `openai-compatible` adapter. Tools via an MCP host (Hermes in this repo, or LM Studio/Open WebUI). | No guaranteed schema adherence: use JSON mode, then zod validation, then one repair turn. Restrict to tutor, translate and classify, not curated authoring. |
| Grok | `.grok/config.toml` stdio wrapper | Fix the absolute path. |

**Conclusion.** The portable contract is (a) the **JSON Schema** exported from zod, (b) a **validator + lint CLI** and the same logic as MCP tools, (c) a **rubric** in machine-readable form, and (d) AGENTS.md. Any model can author against that. Claude Code gets the richest loop (skills, subagents, hooks, screenshots), and the others get MCP tools plus the authoring guide as an MCP prompt or resource.

### 2.5 Competitor learning modes (for runtime tutor positioning)

- ChatGPT Study Mode (Jul 2025): Socratic, toggleable in chat. Gemini Guided Learning (Aug 2025): visual lessons with quizzes, pulls in YouTube and images. Claude Learning mode (Apr 2025): Socratic, on by default in Claude for Education, which connects to **Canvas (LTI)** and **Panopto/Wiley (MCP)**.
- **Implication.** Socratic chat is now a commodity in every assistant. Rise Path's moat is **curated, well-designed lesson artifacts**, personalization and the game layer. Invest in authoring quality and a tutor that is *grounded in the lesson on screen* (citations to blocks), not in a generic chatbot (the current `FloatingChatbot`).

### 2.6 Pedagogy basis for the rubric

- LearnLM (Google, arXiv 2412.16429) tutor-rubric categories: **inspire active learning, manage cognitive load, deepen metacognition, stimulate curiosity, adapt to the learner.**
- Mayer's multimedia principles: segmenting, signaling, coherence, pre-training, spatial and temporal contiguity, redundancy.
- Retrieval practice (testing effect), worked examples before practice (Sweller), constructive alignment (every objective is assessed), explicit misconception handling.
- House rules already written in `agents/rise-path-tutor.yaml` (禁止: 「簡単ですよ」等のプレッシャー表現, 一度に大量の情報) and `skills/curriculum-generator/SKILL.md` (whyItMatters, keyConcepts, actionStep, analogy, 15–20 min modules). Fold these into the rubric so they're enforced, not just suggested.

---

## 3. Authoring pipeline design (repo-first, PR-gated)

### 3.1 Principles

1. **Content is code.** `content/courses/<slug>/course.json` + `lessons/<id>.json` (schema `risepath.lesson/v1`) are imported by Vite via `import.meta.glob`, rendered by one `LessonReader` at `/learn/:course/:lesson` and reviewed in PRs.
2. **Deterministic gates before LLM judgement.** Schema validation and lint are scripts (cheap, exact). The LLM judges only what scripts can't: pedagogy quality, clarity and tone.
3. **The author never grades itself.** Review runs in separate subagents with their own context and an explicit "you did not write this" framing (self-preferential bias).
4. **Claude looks at what learners see.** Every lesson is screenshotted (desktop and mobile, JP and EN), and a visual-QA subagent reads the PNGs.
5. **Provenance on every lesson**: author, model, prompt or skill version, sources, review scores and a human reviewer.
6. **One procedure, many runtimes.** The same SKILL.md text drives Claude Code, CI, the Agent SDK, Managed Agents and (as an MCP prompt) other LLMs.

### 3.2 Pipeline

```
 /author-lesson <course> <lesson> "<brief or issue>"
   │
   ├─0 Brief          content/courses/<c>/briefs/<l>.md   (audience, prerequisite, outcome, minutes, locales, constraints)
   │                  missing essentials → ask once (interactive) / record assumptions (headless)
   ├─1 Research  ──►  [curriculum-researcher]  → briefs/<l>.sources.json + misconceptions list
   │                  (local first: data/curricula/blender manual, existing lessons; then official docs via WebFetch)
   ├─2 Outline        lesson JSON skeleton: objectives[{id,text,bloom}], sections[{id,role,title}], estMinutes
   │                  interactive: show outline, one go/no-go question
   ├─3 Draft          section by section, per references/block-cookbook.md
   ├─4 Validate  ──►  PostToolUse hook runs `content:validate` on every write (exit 2 → Claude fixes)
   │                  then `npm run content:lint` (pedagogy + rendering lint, warnings)
   ├─5 Review    ──►  parallel: [pedagogy-reviewer] [ja-editor] [fact-checker]  → rubric JSON
   │                  fix every criterion < 3; max 2 rounds; else stop and report
   ├─6 Preview   ──►  `npm run content:preview -- <c> <l>` → .artifacts/preview/<c>/<l>/*.png + metrics.json
   │                  [visual-qa] reads PNGs: overflow, walls of text, broken diagram, contrast
   ├─7 Localize       /localize-lesson for en/fr (sidecar or inline), re-validate
   └─8 Deliver        reports/<l>.review.md, course.json order, branch + PR (never publishes to DB)
 CI (content-ci.yml): validate → lint → screenshots (artifact) → rubric via claude -p --json-schema → PR comment
```

### 3.3 Minimum schema fields the pipeline relies on

These apply whichever sibling schema wins:

- `id` stable on lesson, section and block (needed for review comments, citations, progress and patching).
- `objectives[].id` + `bloom`; `quiz.questions[].objectiveId`, so the lint can check that every objective is assessed.
- `sections[].role` ∈ `hook|concept|example|practice|check|pitfalls|summary|reflection`.
- `sources[]` with `id`, and `cite: string[]` on blocks.
- `glossary[]` and `[[term]]` inline references.
- `provenance {author, model, skill, skillVersion, generatedAt, reviewedBy}` and `review {rubricVersion, scores, average, reviewedAt}`.
- `estMinutes`, `level`, `locale`/`locales`.

### 3.4 Rubric (machine-readable; the same file is used by subagents, CI and the runtime judge)

`content/schema/rubric.v1.json` (excerpt; scale 0–4. Pass rule: **every criterion ≥ 3 and mean ≥ 3.3**):

| id | Criterion | 4 = | Typical lint assist |
|---|---|---|---|
| `align` | Objectives measurable (Bloom verb), 2–4 of them, each assessed by ≥1 check | constructive alignment is perfect | objective ↔ `objectiveId` coverage |
| `hook` | Why it matters, tied to the learner's goal; sparks curiosity | concrete scenario in ≤3 sentences | hook section present |
| `prior` | Activates prior knowledge; key terms named before use (pre-training) | glossary terms introduced before first use | first-use vs glossary order |
| `load` | One idea per section; short paragraphs; ≤7 new terms; segmenting | no section over its budget | paragraph chars, new-term count |
| `worked` | Worked example (faded steps) before independent practice | example → partial → independent | `worked`/`steps` before `exercise` |
| `active` | Inline retrieval checks at least every 2 sections; per-option feedback; not only recall | mix of apply/analyze items | check density, feedback present |
| `miscon` | Names and corrects 1–3 likely misconceptions | each with why-it's-wrong | misconception callout present |
| `visual` | A visual where content is spatial or procedural; signaling; no decorative fluff; alt text | diagram ≤12 nodes, captioned | alt present, mermaid parses |
| `practice` | Authentic task with hints ladder and success criteria | transfer task | exercise rubric present |
| `meta` | Summary / key takeaways, reflection prompt, next step, flashcards for spaced review | all four | summary + reflection present |
| `accuracy` | Non-obvious claims cited; tool versions pinned; code runs | every claim traceable | cite coverage, code `lang`/`filename` |
| `voice` | JP です・ます, consistent terms, warm and non-pressuring (no 「簡単ですよ」), inclusive | reads like a good teacher | banned-phrase list |
| `a11y_l10n` | Locales complete, no text in images, links descriptive | all locales parity | locale completeness |

Reviewer output schema (`content/schema/review.v1.json`, also used with `claude -p --json-schema`):

```json
{
  "type": "object", "additionalProperties": false,
  "required": ["lessonId", "rubricVersion", "scores", "mustFix", "niceToHave", "verdict"],
  "properties": {
    "lessonId": {"type": "string"},
    "rubricVersion": {"const": "rubric.v1"},
    "scores": {"type": "array", "items": {"type": "object", "additionalProperties": false,
      "required": ["id", "score", "evidence"],
      "properties": {"id": {"type": "string"}, "score": {"type": "integer"},
                     "evidence": {"type": "string"}, "blockIds": {"type": "array", "items": {"type": "string"}}}}},
    "mustFix": {"type": "array", "items": {"type": "object", "additionalProperties": false,
      "required": ["blockId", "issue", "fix"], "properties": {"blockId": {"type": "string"}, "issue": {"type": "string"}, "fix": {"type": "string"}}}},
    "niceToHave": {"type": "array", "items": {"type": "string"}},
    "verdict": {"enum": ["pass", "revise", "reject"]}
  }
}
```

---

## 4. Concrete file layout

```
AGENTS.md                                   # canonical, tool-agnostic project rules (Codex/Cursor/Gemini/Claude)
CLAUDE.md                                   # @AGENTS.md + Claude-only notes (≤40 lines)
.mcp.json                                   # project-scoped Rise Path MCP (stdio, relative path)
.claude/
  settings.json                             # permissions + hooks (validate-on-edit, stop gate)
  hooks/validate-content.mjs                # PostToolUse: validate the edited lesson; exit 2 with errors
  hooks/stop-gate.mjs                       # Stop: block finishing while changed lessons are invalid
  rules/content.md                          # paths: content/** — schema/style rules loaded on demand
  rules/llm.md                              # paths: server/llm/**, mcp-server/** — model IDs, no browser keys
  skills/
    author-lesson/
      SKILL.md
      references/pedagogy-rubric.md         # human-readable rubric (mirrors content/schema/rubric.v1.json)
      references/style-guide.ja.md          # JP voice, lengths, terminology, banned phrases
      references/block-cookbook.md          # which block for which job + good/bad mini examples
      templates/brief.md
    review-lesson/SKILL.md                  # context: fork, agent: pedagogy-reviewer
    localize-lesson/SKILL.md
    preview-lesson/SKILL.md
    migrate-legacy-lesson/SKILL.md          # data/curricula/*.ts → content/*.json (uses scripts/content/migrate-v0)
  agents/
    curriculum-researcher.md
    pedagogy-reviewer.md
    ja-editor.md
    fact-checker.md
    visual-qa.md
content/
  schema/lesson.schema.json                 # generated from zod (do not edit)
  schema/lesson.llm.schema.json             # LLM profile: anyOf, no recursion, no embed/video
  schema/rubric.v1.json, review.v1.json
  courses/<slug>/course.json
  courses/<slug>/lessons/<id>.json
  courses/<slug>/briefs/<id>.md, <id>.sources.json
  courses/<slug>/reports/<id>.review.md
  examples/gold-vibe-ch1.json               # converted Vibe ch1, the exemplar
src/content/schema.ts                       # zod source of truth (see code-content.md §8.2)
scripts/content/
  validate.mjs   lint.mjs   preview.mjs   catalog.mjs   export-schema.mjs   pull.mjs   migrate-v0.mjs
.github/
  workflows/content-ci.yml
  workflows/claude.yml                      # @claude + lesson-request automation
  ISSUE_TEMPLATE/lesson-request.yml
  pull_request_template.md
```

`package.json` scripts to add:

```json
"content:validate": "node scripts/content/validate.mjs",
"content:lint":     "node scripts/content/lint.mjs",
"content:preview":  "node scripts/content/preview.mjs",
"content:schema":   "node scripts/content/export-schema.mjs",
"content:catalog":  "node scripts/content/catalog.mjs"
```

Also declare `"@modelcontextprotocol/sdk"` and `"zod"` as real dependencies.

### 4.1 CLI contracts (so hooks, skills, CI and MCP share them)

- `content:validate [paths… | --changed]`: zod parse, then `{ok, errors:[{file, path, message}]}`. With `--format json|text|github` (GitHub annotations). Exit 1 on errors.
- `content:lint [paths… | --changed]`: deterministic pedagogy and render checks (rubric "lint assist" column, mermaid parse via `mermaid.parse`, code `lang`, alt text, locale parity, paragraph length, banned phrases). Warnings only, exit 0, plus `--strict` for CI on new lessons.
- `content:preview <course> <lesson> [--locales jp,en] [--mobile]`: starts or reuses Vite on 3007, opens `/preview/<course>/<lesson>` (a dev-only route that hot-reloads from `content/`), writes `.artifacts/preview/<course>/<lesson>/{desktop-jp,mobile-jp,desktop-en}.png` and `metrics.json` (horizontal overflow at 390px, longest text block height, console errors, mermaid render errors, images 404). Reuse `.shots/shoot.mjs` and `ui-lessons` `probe.mjs`. Use `PLAYWRIGHT_CHROMIUM_PATH` instead of the hardcoded `/opt/pw-browsers/...`.
- `content:catalog`: prints courses and lessons with status. **Must always exit 0** because skills inject it with `` !`…` ``.
- `pull <curriculumId>`: exports a DB draft (authored by ChatGPT, Gemini or another MCP client) into `content/` for PR review. This bridges remote LLM authoring and repo curation.

---

## 5. File drafts

### 5.1 `AGENTS.md` (canonical, about 60 lines)

```markdown
# Rise Path — agent instructions

Experimental AI learning platform. React 19 + Vite + TS + Tailwind v4 (front, :3007), Express (server.js, :3006),
Phaser P-School, MCP server (mcp-server/), Hermes agent runtime (hermes/). UI locales: jp (primary), en, fr.

## Commands
- `npm run dev` (Express + Vite) · `npm test` (server tests, node --test) · `npm run typecheck`
- Content: `npm run content:validate|content:lint|content:preview <course> <lesson>|content:catalog`
- MCP: `npm run mcp` (stdio) — see .mcp.json

## Where things live
- Learning material (教材): `content/courses/<slug>/` as JSON, schema `risepath.lesson/v1`
  (zod source: src/content/schema.ts; generated JSON Schema: content/schema/). Legacy TS lessons in
  data/curricula/** are read-only and being migrated.
- One reader renders every lesson: components/lesson/LessonReader.tsx at /learn/:course/:lesson.
- All LLM calls go through server/llm (gateway). Never call an LLM or read an API key in browser code.

## Content rules (summary; details in .claude/rules/content.md and the author-lesson skill)
- Every lesson: 2–4 objectives with ids + Bloom level; every objective assessed by a quiz item (objectiveId).
- Section roles: hook → concept → example → check → practice → pitfalls → summary → reflection.
- JP first, です・ます, warm and non-pressuring (never 「簡単ですよ」). Keep terminology consistent with the glossary.
- Cite non-obvious facts (`cite: [sourceId]`); pin tool versions (Blender 5.0, Unity 6…).
- Never invent image URLs; use `image.gen.prompt` + `alt`.
- A lesson is done only when `content:validate` has 0 errors and the rubric passes (each ≥3, mean ≥3.3).

## Don'ts
- No secrets in code or config; no absolute personal paths (home folders under /Users, volumes under /Volumes).
- Don't publish to the DB from authoring flows; drafts + PR only.
- Don't add per-lesson React components or routes.
```

### 5.2 `CLAUDE.md`

```markdown
@AGENTS.md

## Claude Code specifics
- Author/revise 教材 with `/author-lesson <course> <lesson> "<brief>"`; review with `/review-lesson <path>`;
  localize with `/localize-lesson`; screenshot with `/preview-lesson`.
- Reviewers are subagents (.claude/agents). Never score your own draft; delegate to `pedagogy-reviewer`.
- A PostToolUse hook validates every edit under content/**. When it reports errors, fix them before anything else.
- Screenshots land in .artifacts/preview/…; open the PNGs with Read and look at them before saying a lesson is done.
- For LLM code use the claude-api skill; default model ids: claude-opus-5-5 / claude-sonnet-5-5 / claude-haiku-5-5.
```

### 5.3 `.claude/rules/content.md`

```markdown
---
paths:
  - "content/**"
  - "src/content/**"
---
# Lesson JSON rules
- Schema `risepath.lesson/v1`. Validate with `npm run content:validate -- <file>`; never hand-edit content/schema/*.json
  (regenerate with `npm run content:schema`).
- ids: kebab-case, stable. Never renumber existing ids (progress, citations and reviews reference them).
- Text: string = lesson.locale; `{jp,en,fr}` objects only when translating. Inline markdown subset only:
  **bold**, *em*, `code`, [link](url), [[glossary-term]], [^sourceId]. No raw HTML.
- Lengths: paragraph ≤ 160 JP chars (≈ 80 EN words); callout ≤ 3 sentences; list ≤ 7 items; ≤ 1 diagram per section;
  mermaid ≤ 12 nodes, `graph LR|TD|sequenceDiagram|flowchart` only.
- Code: always `lang` + `filename`; runnable as written; highlight the lines that matter.
- Prompts for AI tools are `prompt` blocks (not `code`), with `target` and `expect`.
- Quiz: 3–4 options, one plausible distractor per common misconception, `feedback` on every option, `explanation`, `objectiveId`.
```

### 5.4 `.claude/skills/author-lesson/SKILL.md`

```markdown
---
name: author-lesson
description: Create or substantially rework a Rise Path lesson (教材/レッスン/チャプター) as schema-valid JSON in content/courses/, with research, outline, drafting, validation, independent pedagogy review and screenshot QA. Use when asked to write, convert, redesign or improve learning material.
when_to_use: "教材を作って", "レッスンを書いて", "この資料をレッスンにして", "chapter N を作り直して", turning notes/docs/issues into lessons.
argument-hint: "<course-slug> <lesson-id> [brief text | path to brief | issue URL]"
arguments: [course, lesson]
allowed-tools: Read Grep Glob Write Edit WebSearch WebFetch Bash(npm run content:*) Bash(node scripts/content/*) Bash(git switch *) Bash(git add *) Bash(git commit *)
effort: high
---

# Author a lesson

Arguments: course=`$course`, lesson=`$lesson`. Full input: $ARGUMENTS

Current catalog (courses, lessons, status):
!`node scripts/content/catalog.mjs --short`

Read before drafting: [pedagogy rubric](references/pedagogy-rubric.md), [JP style guide](references/style-guide.ja.md),
[block cookbook](references/block-cookbook.md), the gold example `content/examples/gold-vibe-ch1.json`.

## 0. Brief
- Path: `content/courses/$course/briefs/$lesson.md` (create from [templates/brief.md](templates/brief.md)).
- Required: learner (who, prior knowledge), outcome (what they can do after), minutes (default 15–20), locales, constraints
  (tool versions, OS), links to source material.
- If anything required is missing: ask ONE consolidated question. If no one can answer (headless/CI), choose sensible
  defaults and list them under "Assumptions" in the brief.

## 1. Research (delegate)
- Ask the `curriculum-researcher` subagent for `briefs/$lesson.sources.json` (id, title, url, publisher, checkedAt,
  claims[]) and the 3–5 most likely learner misconceptions. Local material first (existing lessons, data/curricula/blender
  manual), then official docs. Do not research in the main thread.

## 2. Outline (checkpoint)
- Write `lessons/$lesson.json` with metadata, `objectives` (2–4, measurable Bloom verbs, ids `o1…`), `sections` with
  `role` and title only, `estMinutes`, `status: "outline"`.
- Shape: hook → concept(s) → worked example → check → practice → pitfalls → summary → reflection. One idea per section.
- Interactive session: show the outline as a short table and ask "この構成で進めますか？" once. Headless: continue.

## 3. Draft
- Fill sections in order with blocks from the cookbook. For every objective add at least one quiz item with `objectiveId`.
- Introduce each new term in the glossary before first use; mark it `[[term]]`.
- Cite non-obvious facts with `cite`. Never invent URLs or image paths: images get `gen.prompt` + `alt`.
- Keep the voice in the style guide (です・ます, encouraging, concrete analogies, no pressure phrases).
- Set `provenance` { author: "claude-code", model, skill: "author-lesson", skillVersion: "1", generatedAt }.

## 4. Validate
- The edit hook validates automatically. Then run `npm run content:validate -- content/courses/$course/lessons/$lesson.json`
  and `npm run content:lint -- <same path>` and resolve every error. Treat lint warnings as review input.

## 5. Independent review (max 2 rounds)
- In parallel, ask `pedagogy-reviewer`, `ja-editor` and (if sources exist) `fact-checker` to review the file.
  Do not paste your own opinion of the draft into their prompt; give them the path and the brief only.
- Apply every `mustFix`. Re-run validate. Re-review only the criteria that scored < 3.
- If still failing after 2 rounds, stop and report what blocks a pass. Do not lower the bar.

## 6. Preview and visual QA
- `npm run content:preview -- $course $lesson --locales jp,en --mobile`, then ask `visual-qa` to inspect the PNGs and
  metrics.json. Fix overflow, walls of text (> 1 screen without a visual or check), broken diagrams, unreadable tables.

## 7. Localize
- If the brief lists en/fr, run `/localize-lesson content/courses/$course/lessons/$lesson.json en,fr`.

## 8. Deliver
- Set `status: "review"`, write `review` scores into the lesson and `reports/$lesson.review.md` (scores, mustFix resolved,
  assumptions, sources, screenshots paths). Add the lesson to `course.json`.
- If asked to open a PR: branch `content/$course-$lesson`, commit, and summarize the review report in the PR body.
- Never publish to the database and never mark `status: "published"`; a human does that.

## Done means
validate: 0 errors · rubric: every criterion ≥ 3 and mean ≥ 3.3 · screenshots inspected · report written.
```

### 5.5 `.claude/skills/review-lesson/SKILL.md`

```markdown
---
name: review-lesson
description: Score a Rise Path lesson JSON against the pedagogy rubric and return must-fix items. Use for "レビューして", PR content review, or CI.
argument-hint: "<path-to-lesson.json | --changed> [--comment]"
context: fork
agent: pedagogy-reviewer
background: false
allowed-tools: Read Grep Glob Bash(npm run content:validate *) Bash(npm run content:lint *) Bash(git diff *)
---
Review $ARGUMENTS. If `--changed`, review every file under content/courses/**/lessons/ changed versus origin/main
(`git diff --name-only origin/main...`). Run validate and lint first and include their findings.
Return ONLY JSON matching content/schema/review.v1.json, one object per lesson, in an array.
```

### 5.6 Subagents

`.claude/agents/pedagogy-reviewer.md`

```markdown
---
name: pedagogy-reviewer
description: Independent instructional-design reviewer for Rise Path lessons. Use proactively after a lesson draft changes, and for /review-lesson. Read-only.
tools: Read, Grep, Glob, Bash
model: opus
effort: high
memory: project
skills:
  - review-lesson
color: purple
---
You are a senior instructional designer reviewing a lesson someone else wrote. You did not write it and have no stake
in it. Judge it the way a strict editor at a top learning publisher would.

1. Read the lesson JSON, its brief, content/schema/rubric.v1.json and .claude/skills/author-lesson/references/pedagogy-rubric.md.
2. Score each rubric criterion 0–4 with one sentence of evidence that quotes or points to block ids. A 4 is rare.
3. List mustFix items as {blockId, issue, fix}; fixes must be specific enough to apply without guessing.
4. verdict: pass (all ≥3 and mean ≥3.3) | revise | reject (wrong audience/outcome; would need a rewrite).
Return only JSON matching content/schema/review.v1.json. Record recurring problems you see across lessons in your
memory file (MEMORY.md) as short bullets, so later reviews and authors can learn from them.
```

`.claude/agents/curriculum-researcher.md`

```markdown
---
name: curriculum-researcher
description: Gathers authoritative sources, facts and common misconceptions for a lesson brief. Use before outlining a new lesson.
tools: Read, Grep, Glob, WebSearch, WebFetch, Write
model: sonnet
effort: medium
maxTurns: 30
---
Given a brief path, produce <brief>.sources.json: [{id, title, url, publisher, checkedAt, claims:[{text, quote}]}]
and a "misconceptions" array [{text, whyWrong, sourceId?}]. Prefer, in order: material already in this repo
(content/, data/curricula/**), official documentation and specs, then reputable textbooks/papers. Pin product versions.
Quote the exact sentence supporting each claim. Max 8 sources. Write only that file; return a 5-line summary.
```

`.claude/agents/ja-editor.md`

```markdown
---
name: ja-editor
description: Japanese copy editor for lesson text (tone, clarity, terminology, length budgets). Use after drafting and after localization.
tools: Read, Grep, Edit
model: sonnet
effort: medium
---
Edit only string values in the given lesson JSON; never change ids, structure or code. Apply
.claude/skills/author-lesson/references/style-guide.ja.md: です・ます; one idea per sentence; ≤160 chars per paragraph;
consistent glossary terms; natural (not translated-sounding) Japanese; no pressure phrases; furigana-free.
Return a short list of what you changed and anything you could not fix without changing structure.
```

`.claude/agents/fact-checker.md`

```markdown
---
name: fact-checker
description: Verifies factual claims, shortcuts, versions and code snippets in a lesson against its sources. Use when a lesson cites sources or contains tool-specific instructions.
tools: Read, Grep, WebFetch, Bash
model: sonnet
effort: medium
---
For each factual claim, keyboard shortcut, UI path, version-specific statement and code snippet: find support in
<brief>.sources.json (or fetch the cited URL). Run small code snippets when a runtime is available. Return JSON
[{blockId, claim, status: supported|unsupported|outdated|unverifiable, evidence, fix}]. Do not edit files.
```

`.claude/agents/visual-qa.md`

```markdown
---
name: visual-qa
description: Inspects lesson preview screenshots and metrics for layout and readability problems. Use after content:preview.
tools: Read, Glob, Bash
model: sonnet
effort: low
---
Open every PNG under the given .artifacts/preview/<course>/<lesson>/ directory with Read and read metrics.json.
Report issues as [{screenshot, blockId?, issue, severity: high|medium|low, fix}]: horizontal overflow, clipped or
overlapping text, a screen with no visual/check/heading, unreadable tables or diagrams on mobile, broken images,
mermaid errors, low contrast, untranslated strings in the EN shots. Do not edit files.
```

### 5.7 `.claude/settings.json`

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run content:*)",
      "Bash(node scripts/content/*)",
      "Edit(content/**)",
      "Write(content/**)"
    ],
    "deny": [
      "Read(./.env)", "Read(./.env.*)",
      "Bash(git push --force*)"
    ]
  },
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/validate-content.mjs\"", "timeout": 30 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/stop-gate.mjs\"", "timeout": 60 }] }
    ]
  }
}
```

`.claude/hooks/validate-content.mjs` (sketch):

```js
#!/usr/bin/env node
// PostToolUse: validate the lesson Claude just edited; exit 2 sends stderr back to Claude.
import { readFileSync } from 'node:fs';
import { validateFile } from '../../scripts/content/validate.mjs';
const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path ?? '';
if (!/\/content\/courses\/.+\/lessons\/.+\.json$/.test(file)) process.exit(0);
const { ok, errors } = await validateFile(file);
if (ok) process.exit(0);
process.stderr.write(`Lesson invalid (${errors.length}):\n` +
  errors.slice(0, 20).map(e => `- ${e.path}: ${e.message}`).join('\n'));
process.exit(2);
```

`stop-gate.mjs` runs `validate --changed`. If there are errors and `stop_hook_active` is false in the hook input, it exits 2 with the list. Otherwise it exits 0, which prevents loops.

### 5.8 `.mcp.json`

```json
{
  "mcpServers": {
    "rise-path": {
      "type": "stdio",
      "command": "node",
      "args": ["mcp-server/index.js", "--profile", "curriculum-builder"],
      "env": { "DATABASE_URL_PHASE1": "${DATABASE_URL_PHASE1:-}" }
    }
  }
}
```

The relative path resolves from the project root. Without a DB, DB tools return `db_connection` errors. The new file-based authoring tools (§6.3) don't need a DB.

### 5.9 GitHub

`.github/workflows/content-ci.yml`:

```yaml
name: Content CI
on:
  pull_request:
    paths: ["content/**", "src/content/**", "components/lesson/**"]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run content:validate -- --changed --format github
      - run: npm run content:lint -- --changed --strict --format github
      - run: npx playwright install --with-deps chromium
      - run: npm run content:preview -- --changed --locales jp,en --mobile
      - uses: actions/upload-artifact@v4
        with: { name: lesson-previews, path: .artifacts/preview }
  rubric:
    needs: validate
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write, issues: read, id-token: write }
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: "/review-lesson --changed --comment ${{ github.repository }}/pull/${{ github.event.pull_request.number }}"
          claude_args: >-
            --model claude-opus-5-5 --max-turns 20
            --allowedTools "Read,Grep,Glob,Bash(npm run content:*),Bash(git diff *),mcp__github_inline_comment__create_inline_comment"
```

A local or scripted alternative that gates on scores:

```bash
claude -p "/review-lesson content/courses/vibe-coding/lessons/ch01.json" \
  --output-format json --json-schema "$(cat content/schema/review.v1.json)" \
  --max-turns 15 --max-budget-usd 2 | jq '.structured_output'
```

`.github/ISSUE_TEMPLATE/lesson-request.yml` has fields for course, lesson id, learner, outcome, minutes, locales, sources and notes, plus the label `lesson-request`. `.github/workflows/claude.yml` has two jobs: (1) the standard `@claude` interactive job, and (2) `on: issues: types: [labeled]`, `if: github.event.label.name == 'lesson-request'`, with `prompt: "/author-lesson <course> <id> from issue #${{ github.event.issue.number }}: ${{ github.event.issue.body }}"`, `claude_args: --model claude-opus-5-5 --max-turns 60 --allowedTools "...,Bash(git *),Bash(gh pr create *)"`, and `contents/pull-requests/issues: write`. Check the PR-creation path against the action's usage docs before relying on it.

### 5.10 Bulk authoring and migration

- **Dynamic workflow** (interactive): "Migrate all `data/curricula/vibe_coding/*.ts` to content/ and bring each lesson to rubric pass". It fans out one agent per lesson running `/migrate-legacy-lesson` then `/author-lesson` (revise mode), with one adversarial `pedagogy-reviewer` per lesson and a final synthesizer that writes a course-level report. Save it inside the `migrate-legacy-lesson` skill so it can be rerun.
- **Agent SDK script** (repeatable, CI or cron), sketch:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
for (const id of lessonIds) {               // bounded concurrency in practice
  for await (const m of query({
    prompt: `/author-lesson ${course} ${id} "revise to rubric pass"`,
    options: { settingSources: ["project"], permissionMode: "acceptEdits",
               allowedTools: ["Read","Grep","Glob","Write","Edit","Bash(npm run content:*)"],
               model: "claude-opus-5-5", maxTurns: 60, maxBudgetUsd: 5 } })) {
    if (m.type === "result") report.push({ id, m });
  }
}
```

---

## 6. Runtime: in-app tutor and generator through a provider-agnostic gateway

Use the gateway layout and task routing from `code-llm.md` §9 (`server/llm/{providers,structured,stream,budget,prompts,pipelines}`). Below are the Claude-specific designs and how the authoring assets are reused at runtime.

### 6.1 Grounded lesson tutor ("この段落について聞く")

- **Model:** `claude-haiku-5-5` at effort `low` (latency), escalating to `claude-sonnet-5-5` for "explain differently" or code questions.
- **Request layout** (cache-friendly):
  1. `system` (cached, 1h): Lumina persona (from `agents/rise-path-tutor.yaml`, cleaned), Socratic hint-ladder policy, safety, locale.
  2. `messages[0].content[0]`: the **lesson as a `document`** with `source.type: "content"` and one content block per lesson block (text rendered from JSON, prefixed with `[block:<id>]`), `citations: {enabled: true}`, `cache_control: {type: "ephemeral"}`.
  3. Learner profile summary (consented), the selected block id, and the question last.
- **Response:** text with `citations[]` of type `content_block_location`. The server maps the block index to a lesson block id, and the UI renders "根拠: §2 第3段落" chips that scroll and highlight the reader.
- **Hint ladder:** append a mid-conversation `{role:"system"}` message ("Hint level 2: give a partial hint, no final answer") instead of editing `system`, which keeps the cache.
- **Why:** it's grounded in the material the learner is reading, cheap with cache reads, and visibly different from generic Socratic chat.

### 6.2 Lesson generator (in-app "AIで教材を作る")

1. **Intake → outline:** `claude-opus-5-5`, effort `high`, `output_config.format` = `CourseOutline` (objectives with Bloom levels, lessons, minutes, prerequisites).
2. **Source facts (optional):** if the user uploaded material (Files API `file_id`) or web research is allowed (`web_search_20260209` / `web_fetch_20260209` with `allowed_domains`), make a **citations-enabled** call that returns `facts[]` with cited spans. These are stored as `sources`.
3. **Per-lesson authoring:** `claude-opus-5-5` effort `medium` (or `claude-sonnet-5-5` for volume), **streamed**, `output_config.format = zodOutputFormat(LessonLLM)`. The prompt carries the cached prefix: style guide, cookbook, schema and gold example (the same files the Claude Code skill uses). Facts are referenced by id in `cite`.
   - LLM profile schema rules: a discriminated `anyOf` on `type` with `const`, `additionalProperties:false` everywhere, no recursion (mindmap depth fixed at 2), no `minLength` (validated afterwards by zod).
   - Never use forced `tool_choice` (400 on 5.5 models); never prefill.
4. **Validate and repair:** zod validation, then `lint`. On errors, one repair turn with the path-precise error list.
5. **Judge:** `claude-sonnet-5-5` effort `low`, structured output `review.v1.json`. For criteria scoring < 3, make one targeted revise call on just those blocks.
6. **Save** as a `curriculum_versions` draft with `provenance` and `review`. Emit SSE progress per lesson. The user previews, then publishes.
7. **Translate** with `claude-haiku-5-5` through the **Batches API** (50% cost) for bulk, keeping block ids stable.
8. **Safety and cost:** opt into refusal `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) on Opus 5.5 and check `stop_reason`. Use a per-user budget ledger recording usage, including `cache_read_input_tokens`.

**Other providers:** the same `LessonLLM` JSON Schema goes to OpenAI (`text.format: json_schema, strict`) and Gemini (`responseJsonSchema`). Local OpenAI-compatible models use JSON mode plus zod plus repair and are tagged lower-tier. The **same validator and rubric judge** make outputs comparable across providers. Build a 10-brief eval (briefs × rubric scores × cost) before changing defaults.

### 6.3 MCP server v3 (for Claude Desktop/claude.ai, ChatGPT, Gemini CLI, Cursor and Claude Code)

- **Transport:** stateless Streamable HTTP at `/mcp` (2026-07-28) with OAuth scopes (`lessons:read`, `lessons:write`, `lessons:publish`, `learner:read`), plus stdio for local. Keep SSE behind a flag until removal.
- **API:** `server.registerTool(name, {title, description, inputSchema, outputSchema, annotations}, handler)` returning `structuredContent`. Inputs derive from the shared zod schema, with no `passthrough()`.
- **Authoring tools** (align names with `code-llm.md` §11.2): `rp_get_authoring_guide` (returns the skill body plus rubric plus cookbook, so non-Claude clients follow the same procedure), `rp_get_lesson_schema`, `rp_list_lessons`, `rp_get_lesson`, `rp_validate_lesson` (dry run), `rp_lint_lesson`, `rp_review_lesson` (server-side judge), `rp_upsert_lesson` (draft only, optimistic concurrency), `rp_preview_lesson`, `rp_publish_curriculum` (destructiveHint, scope-gated).
- **Prompts:** `author-lesson` and `review-lesson`, generated from the same SKILL.md bodies at build time (one source).
- **MCP Apps:** `rp_preview_lesson` declares `_meta.ui.resourceUri: "ui://risepath/lesson-preview"`. The resource is the reader bundle (`text/html;profile=mcp-app`) rendering the lesson JSON in the host's sandboxed iframe, so ChatGPT and Claude users see the real lesson design while authoring. Degrade to a preview URL when the host lacks the capability.
- **Tasks extension:** whole-course generation becomes a task (`tasks/get` polling) instead of a long tool call.
- **Remote-to-repo bridge:** remote clients write DB drafts; `npm run content:pull <id>` brings curated ones into `content/` for PR review.

### 6.4 "Deep author" (optional, P3)

Upload `.claude/skills/author-lesson` as a **custom skill** (Skills API) and run it in a **Managed Agents** session with an *outcome* whose rubric is `rubric.v1.json`. Anthropic's grader iterates until the rubric passes, and the session returns the lesson JSON and report. This is the premium "最高品質で作る" button, using the same skill as Claude Code and no extra harness code. The alternative is running the Agent SDK on our own worker (`server/jobWorker.js`).

---

## 7. Add / cut (authoring and LLM-integration scope)

**Add**
- `AGENTS.md` + `CLAUDE.md` + `.claude/{settings.json, rules, skills, agents, hooks}` + `.mcp.json` (§4–5).
- `content/` JSON, zod schema to generated JSON Schema, `content:*` CLIs, dev `/preview/:course/:lesson` route.
- Machine-readable rubric and review schema; review scores and provenance stored in each lesson.
- Content CI (validate, lint, screenshots, rubric) and a `lesson-request` issue-to-PR flow.
- Citation-grounded tutor with block-anchored evidence chips.
- MCP authoring toolset with Streamable HTTP, `outputSchema` and an MCP Apps preview.
- An eval set (10 briefs) to choose providers and effort with data.

**Cut / fix**
- Browser-side LLM calls and key inlining (`vite.config.ts:51-52`, `services/geminiApiKey.ts`, `services/geminiService.ts` call sites). If BYOK must stay, store keys server-side, encrypted per user.
- `agents/rise-path-tutor.yaml` stale tool and resource list: generate it from `tool-registry.json` in a test, or delete it in favor of Hermes profile and skills.
- Absolute personal paths in `.gemini/settings.json`, `.grok/config.toml` and `mcp-server/claude_desktop_config.example.json`.
- `passthrough()` inputs on `save-curriculum-draft`/`validate-intake`; the legacy `server.tool()` API; the SSE transport (after migration).
- `doc_chapter.schema.json` and the other hand-written schemas in `doc/` (generate them from zod instead).
- Hermes README commands that don't exist in `package.json` (add the scripts or fix the doc).
- Per-chapter wrapper components and routes (`VibeChapter*View.tsx`, `App.tsx:415-426`).

---

## 8. Phased plan

| Phase | Work | Effort | Exit criteria |
|---|---|---|---|
| P0 | Remove key inlining; declare `@modelcontextprotocol/sdk` + `zod`; AGENTS.md/CLAUDE.md/.mcp.json; fix example configs; zod schema + `content:validate` + `content:schema`; migrate Vibe ch1 into `content/examples/gold-vibe-ch1.json`; dev preview route + `content:preview` | 2–3 days | `npm run content:validate` green on gold lesson; preview screenshots generated |
| P1 | `author-lesson`/`review-lesson`/`localize-lesson`/`preview-lesson` skills, five subagents, hooks, rules, `content:lint`; Content CI; lesson-request flow; migrate the Vibe course with a dynamic workflow | 4–6 days | All Vibe lessons pass rubric (each ≥3, mean ≥3.3) in CI; reviewer memory has recurring issues |
| P2 | Gateway Claude adapter: structured lesson generation + validate/repair + judge; citations tutor; Batches translation; per-user budget ledger; MCP v3 tools on Streamable HTTP | 1–2 weeks | Generated lessons pass validate 100%, rubric ≥3.0 mean; tutor answers carry ≥1 block citation ≥90% |
| P3 | MCP Apps preview; Tasks for course generation; Managed Agents "deep author" with outcome rubric; provider eval dashboard | 1–2 weeks | ChatGPT/Claude render lesson preview inline; eval picks defaults per task |

---

## 9. Sources

- Claude Code docs: [Skills](https://code.claude.com/docs/en/skills), [Subagents](https://code.claude.com/docs/en/sub-agents), [Hooks](https://code.claude.com/docs/en/hooks), [MCP](https://code.claude.com/docs/en/mcp), [Memory / CLAUDE.md / AGENTS.md / rules](https://code.claude.com/docs/en/memory), [Headless (`claude -p`)](https://code.claude.com/docs/en/headless), [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Agent SDK TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript), [GitHub Actions](https://code.claude.com/docs/en/github-actions)
- [Dynamic workflows in Claude Code (blog)](https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/)
- Claude API (via the bundled `claude-api` skill, cached 2026-10-06, and platform.claude.com docs): models and pricing, structured outputs, prompt caching, citations, Files API, adaptive thinking/effort, refusal fallbacks, Skills API, Managed Agents outcomes. [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Citations](https://platform.claude.com/docs/en/build-with-claude/citations), [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Files](https://platform.claude.com/docs/en/build-with-claude/files)
- MCP: [2026-07-28 specification post](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [RC post](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/), [SEP-1865 MCP Apps](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)
- OpenAI: [New tools and features in the Responses API (remote MCP)](https://openai.com/index/new-tools-and-features-in-the-responses-api)
- Gemini CLI MCP (third-party): [Tembo guide](https://www.tembo.io/blog/gemini-cli-mcp)
- Learning modes: [Pearson on Guided Learning and Study mode](https://pearson.com/international-schools/international-schools-blog/2026/02/what-is-gemini_s-guided-learning-and-chatgpts-study-mode-.html), [Glasp comparison](https://glasp.ai/articles/ai-study-modes-compared), [Engadget: Claude connects to Canvas, Panopto, Wiley](https://engadget.com/ai/claude-can-now-connect-to-learning-apps-like-canvas-panopto-and-wiley-150038075.html)
- Pedagogy: [LearnLM: Improving Gemini for Learning (arXiv 2412.16429)](https://arxiv.org/pdf/2412.16429), [Mayer principles checklist (Pitt)](https://teaching.pitt.edu/wp-content/uploads/2023/03/multimedia-principles-checklist.pdf)
