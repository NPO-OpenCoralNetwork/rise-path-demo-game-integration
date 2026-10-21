# Verified facts for cc-06-claude-md (checked 2026-10-20)

### [docs-18] CLAUDE.md memory and /init (verified, high)
- Claim: CLAUDE.md files load at session start from four scopes: managed policy, user (`~/.claude/CLAUDE.md`), project (`./CLAUDE.md` or `./.claude/CLAUDE.md`), and local (`./CLAUDE.local.md`, kept out of git). They are concatenated rather than overriding each other. `/init` generates a starter CLAUDE.md.
- Detail: Loading:
- Files in the working directory and every directory above it load at launch.
- Files in subdirectories load on demand, when Claude touches files there.

Writing guidance:
- Aim for under 200 lines per file.
- Write concrete, checkable rules ('Run `npm test` before committing').
- Block-level HTML comments are stripped before injection.
- Confirm what loaded with `/context` (under Memory files) and edit with `/memory`.

`/init`:
- If a CLAUDE.md already exists, it suggests improvements instead of overwriting.
- With `CLAUDE_CODE_NEW_INIT=1`, it runs an interactive flow that can also set up skills and hooks.
- It folds in `.cursor/rules`, `.cursorrules` and `.github/copilot-instructions.md`.

`/doctor prompt-audit` (v2.1.283+) finds outdated or conflicting instructions.

CLAUDE.md is context, not enforcement. Use hooks for hard rules.
- Use: Lesson 'Teach Claude your project': run /init, prune, add a rule after a repeated mistake.
- Sources: How Claude remembers your project <https://code.claude.com/docs/en/memory>

### [docs-19] @imports (verified, high)
- Claim: CLAUDE.md files can import other files with `@path/to/file` syntax. Relative paths resolve from the importing file, and imports can nest at most four hops deep.
- Detail: Example: `See @README for project overview and @package.json for available npm commands`.

Behavior:
- Imported files also load at launch, so imports organize a file but do not reduce its context cost.
- Imports that resolve outside the project trigger a one-time approval dialog.
- For personal notes shared across worktrees, import `@~/.claude/my-project-instructions.md`.

Syntax details:
- Wrap a path in backticks to mention it without importing it.
- Escape spaces with a backslash: `@Design\ Docs/api.md`.
- Use: Short exercise in the CLAUDE.md lesson: split a long file with imports and compare /context.
- Sources: How Claude remembers your project <https://code.claude.com/docs/en/memory>

### [docs-20] .claude/rules (verified, high)
- Claim: Markdown files under `.claude/rules/` are discovered recursively. Rules without frontmatter load at launch. A rule with `paths:` frontmatter (glob patterns) loads only when Claude reads, writes or edits a matching file.
- Detail: Example frontmatter: `---\npaths:\n  - "src/api/**/*.ts"\n---`.

Patterns:
- Brace expansion works: `src/**/*.{ts,tsx}`.
- `paths` is the only frontmatter field read; any other field is ignored.

Scopes and sharing:
- User-level rules live in `~/.claude/rules/`.
- Symlinks can share rules across projects.

After compaction, path-scoped rules are summarized away and reload on demand. Unscoped rules are re-injected.

Use rules for part-of-codebase conventions, and skills for procedures.
- Use: Lesson on scaling instructions in monorepos; exercise writing a path-scoped test rule.
- Sources: How Claude remembers your project <https://code.claude.com/docs/en/memory>; Explore the context window <https://code.claude.com/docs/en/context-window>

### [docs-21] AGENTS.md (verified, high)
- Claim: Since v2.1.277 (Sep 18, 2026), Claude Code reads `AGENTS.md` as the project instructions when there is no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the working directory or above it. When a CLAUDE.md exists, only CLAUDE.md files load by default.
- Detail: Change the behavior with `/config` → **Project instructions**:
- `claude-md-or-agents-md` (default)
- `claude-md-and-agents-md`
- `claude-md`
- `managed-only`

To keep one file for every tool, put `@AGENTS.md` at the top of CLAUDE.md and add Claude-specific notes below it. This never loads AGENTS.md twice.

Adding a CLAUDE.local.md stops Claude from reading AGENTS.md under the default setting.

Not read: `AGENTS.local.md`, `AGENTS.override.md`, and anything under `.agents/`.

v2.1.281 extended support to Bedrock, Vertex, Foundry, gateways, and telemetry-disabled sessions.
- Use: Lesson for multi-tool teams (this repo itself uses CLAUDE.md with @AGENTS.md); exercise predicting which file loads.
- Sources: How Claude remembers your project <https://code.claude.com/docs/en/memory>; Claude Code CHANGELOG.md <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [docs-22] Auto memory (verified, high)
- Claim: Auto memory is on by default in local sessions. Claude writes its own notes to `~/.claude/projects/<project>/memory/`: a `MEMORY.md` index plus topic files. Only the first 200 lines or 25KB of MEMORY.md, whichever comes first, load at each session start.
- Detail: Note types: `user`, `feedback`, `project`, `reference`.

Claude skips anything it can derive from the code or that CLAUDE.md already covers.

Scope: one memory directory per git repository, shared across its worktrees. It is machine-local and not synced.

Controls:
- Toggle in `/memory`, which saves `autoMemoryEnabled`.
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` turns it off.
- `autoMemoryDirectory` relocates it.

What you see:
- 'Saved 2 memories' or 'Recalled 2 memories' messages.
- Saying 'remember that…' saves to auto memory.
- To add something to CLAUDE.md instead, ask for that explicitly.
- Use: Concept contrast in the memory lesson: CLAUDE.md (you write, rules) vs auto memory (Claude writes, learnings).
- Sources: How Claude remembers your project <https://code.claude.com/docs/en/memory>

### [practice-11] [Official] What survives compaction (verified, high)
- Claim: After compaction, the project-root CLAUDE.md, unscoped rules, auto memory and the plan-mode plan are re-injected from disk, while instructions given only in conversation are summarized and can be lost.
- Detail: Per the docs table: system prompt and output style still apply. Project-root CLAUDE.md and unscoped rules are re-injected from disk, as is auto memory. Skill descriptions are rebuilt (v2.1.304+). The plan written in plan mode is re-injected. Rules with paths: frontmatter and nested CLAUDE.md files reload on demand. Up to five recently modified files Claude read or edited are re-read; a file over 5,000 tokens comes back as a path reference. Invoked skill bodies are re-injected, capped at 5,000 tokens per skill and 25,000 total, oldest dropped first; truncation keeps the start of the file, so put key instructions near the top of SKILL.md. SessionStart hooks matching 'compact' run and add their output. Fix for lost instructions: move conversation-only instructions into CLAUDE.md, or use a SessionStart 'compact' hook. Other levers: '/autocompact 500k' sets how full the window gets before auto-compaction, and 1M-token context is available on several models.
- Use: Context lesson. Quiz: which of these survives compaction? (chat instruction / root CLAUDE.md / paths-scoped rule / plan file).
- Sources: Explore the context window <https://code.claude.com/docs/en/context-window>; How Claude remembers your project (Instructions seem lost after /compact) <https://code.claude.com/docs/en/memory>; Automate actions with hooks (Re-inject context after compaction) <https://code.claude.com/docs/en/hooks-guide>

### [practice-12] [Official] Writing an effective CLAUDE.md (verified, high)
- Claim: Official guidance is to keep each CLAUDE.md under about 200 lines, write concrete, verifiable instructions, and cut any line whose removal would not cause Claude to make mistakes.
- Detail: Include: Bash commands Claude can't guess, style rules that differ from defaults, test instructions, repo etiquette, project-specific architecture decisions, environment quirks and non-obvious gotchas. Exclude: anything Claude can learn by reading the code, standard conventions, detailed API docs (link instead), frequently changing info, tutorials, file-by-file descriptions, and self-evident rules like 'write clean code'. Be concrete: 'Use 2-space indentation' not 'Format code properly'; 'Run `npm test` before committing' not 'Test your changes'. Use emphasis ('IMPORTANT') on one line at a time, not many. Tools: /init generates a starter, and suggests improvements if a file exists. CLAUDE_CODE_NEW_INIT=1 gives an interactive /init that also sets up skills and hooks. /doctor proposes cuts for a checked-in CLAUDE.md. '/doctor prompt-audit' (v2.1.283+) finds stale or conflicting instructions across CLAUDE.md, AGENTS.md, rules, skills and agents. @path imports organize a file but do not reduce context cost. Run /context to confirm the file loaded. The Jun 18 2026 steering post adds: 'Keep CLAUDE.md under 200 lines, give it an owner, and review changes to it like code.'
- Use: CLAUDE.md lesson. Exercise: prune a bloated 300-line sample CLAUDE.md with the include/exclude table and the 'would removing this cause mistakes?' test.
- Sources: Best practices for Claude Code (Write an effective CLAUDE.md) <https://code.claude.com/docs/en/best-practices>; How Claude remembers your project <https://code.claude.com/docs/en/memory>; Steering Claude Code: when to use CLAUDE.md, skills, hooks, and subagents <https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more>

### [practice-13] [Official] Build your setup over time: trigger -> feature (verified, high)
- Claim: The docs advise starting with CLAUDE.md alone and adding each extension only when its trigger appears, for example a CLAUDE.md line when Claude gets a convention wrong twice.
- Detail: The official trigger table: Claude gets a convention or command wrong twice -> CLAUDE.md. You keep asking for shorter or longer answers -> output style. You keep typing the same prompt to start a task -> user-invocable skill. You paste the same playbook a third time -> skill. You keep copying data from a browser tab -> MCP server. Claude reads many files to find a symbol -> code intelligence plugin. A side task floods the conversation -> subagent. Something must happen every time -> hook. A second repository needs the same setup -> plugin. The memory page lists when to add to CLAUDE.md: Claude makes the same mistake a second time, a code review catches something Claude should have known, you type the same correction as last session, or a new teammate would need the context. 'A repeated mistake or a recurring review comment is a CLAUDE.md edit, not a one-off correction in chat.'
- Use: A capstone 'design your setup' lesson. A matching exercise pairs symptoms with the right extension.
- Sources: Extend Claude Code (Build your setup over time) <https://code.claude.com/docs/en/features-overview>; How Claude remembers your project (When to add to CLAUDE.md) <https://code.claude.com/docs/en/memory>

### [practice-14] [Official] CLAUDE.md is advisory; guardrails belong in hooks and permissions (corrected, high)
- Claim: Claim is correct, but the Jun 18, 2026 steering post (Michael Segner) lists FIVE anti-patterns, not seven: (1) 'Every time X, always do Y' in CLAUDE.md, (2) 'Never do this' in CLAUDE.md, (3) a 30-line procedure in CLAUDE.md, (4) an API-specific rule without paths, (5) personal preferences in a project-level CLAUDE.md. The output-style and appended-system-prompt points appear only as cautions in body text ('By default, a custom output style drops all of this'; appending the system prompt 'has diminishing returns for adherence', 'particularly if any contradict').
- Detail: The memory docs say Claude treats CLAUDE.md 'as context, not enforced configuration', and to use a PreToolUse hook to block an action regardless of what Claude decides. The Jun 18 2026 steering post (Michael Segner) lists seven anti-patterns: expecting CLAUDE.md to guarantee automatic actions; relying on it for 'never do this' constraints; a 30-line runbook in CLAUDE.md (use a skill); unscoped rules for area-specific instructions; personal preferences in project files; a custom output style that drops the default engineering instructions; stacking contradictory appended system prompt text. Quotes: 'A real guardrail needs to be deterministic.' 'The model choosing to run a formatter is different from the formatter running automatically.' Features-overview: 'an instruction like "never edit `.env`" in CLAUDE.md or a skill is a request, not a guarantee.'
- Use: Bridge lesson between CLAUDE.md and hooks. Sorting exercise: request (CLAUDE.md/skill) vs guarantee (hook/permission).
- Sources: How Claude remembers your project <https://code.claude.com/docs/en/memory>; Steering Claude Code: when to use CLAUDE.md, skills, hooks, and subagents <https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more>; Extend Claude Code (Hook vs Skill) <https://code.claude.com/docs/en/features-overview>
- Verifier evidence: Memory: 'CLAUDE.md content is delivered as a user message after the system prompt ... there's no guarantee of strict compliance'; 'Claude treats them as context, not enforced configuration. To block an action regardless of what Claude decides, use a PreToolUse hook'. Features overview: 'An instruction like "never edit .env" in CLAUDE.md or a skill is a request, not a guarantee.' Steering post quotes 'A real guardrail needs to be deterministic' and 'The model choosing to run a formatter is different from the formatter running automatically.' <https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more>

### [practice-15] [Official] Gotcha: CLAUDE.md edits and mid-session switches (verified, high)
- Claim: Edits to project-root or user CLAUDE.md made mid-session do not apply until the next /clear, /compact or restart, and switching model mid-session makes the next turn reprocess the whole history uncached.
- Detail: The prompt-caching page says root and user CLAUDE.md files 'are read once at session start and held in memory... the edit also doesn't apply... The new content loads on the next /clear, /compact, or restart.' Nested CLAUDE.md and paths-scoped rules that have not loaded yet do take effect when edited. Actions that invalidate the cache: switching models, changing effort on most models (not on Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable 5.1 with an API key or subscription), turning on fast mode, connecting MCP servers when tools load up front, denying a whole tool without tool search, compacting, and upgrading Claude Code. Tip: 'Pick your model and effort level at the top of a session, then save /compact for natural breaks between tasks.' /usage shows a 'Prompt cache (main)' line with the hit ratio and the likely cause of the last miss (v2.1.251+, cause text v2.1.260+).
- Use: 'Why didn't my rule work?' troubleshooting box in the CLAUDE.md lesson, plus a cost-awareness note in the session-management lesson.
- Sources: How Claude Code uses prompt caching <https://code.claude.com/docs/en/prompt-caching>

### [practice-16] [Official] Scoped instructions: .claude/rules/, CLAUDE.local.md, AGENTS.md (verified, high)
- Claim: Rules in .claude/rules/*.md with a `paths` frontmatter glob load only when Claude works on matching files, and Claude Code reads AGENTS.md natively (v2.1.277+) only when no CLAUDE.md or CLAUDE.local.md exists in the working directory or above it.
- Detail: Load order runs from broad to specific: managed policy (/etc/claude-code/CLAUDE.md on Linux), ~/.claude/CLAUDE.md, ./CLAUDE.md or ./.claude/CLAUDE.md, then ./CLAUDE.local.md (personal, gitignored). Rules without paths load at launch. Rules with paths: (YAML list or comma-separated globs such as src/api/**) load on demand. ~/.claude/rules/ holds personal rules for all projects. claudeMdExcludes skips other teams' files in monorepos. AGENTS.md: by default it is read only if there is no CLAUDE.md. To share one file across tools, keep a CLAUDE.md that imports @AGENTS.md (the pattern this repo uses), or set Project instructions to 'claude-md-and-agents-md' in /config. CLAUDE.local.md counts as a CLAUDE.md, so adding one stops AGENTS.md from loading. Rules for choosing between them: per-directory CLAUDE.md for owners who maintain their area, central .claude/rules/ for scattered paths.
- Use: Organizing-instructions lesson. Exercise: split a monolithic CLAUDE.md into root + rules/api.md with paths + a skill.
- Sources: How Claude remembers your project <https://code.claude.com/docs/en/memory>; Set up Claude Code in a monorepo or large codebase <https://code.claude.com/docs/en/large-codebases>

### [practice-17] [Official] Auto memory (verified, high)
- Claim: Auto memory, on by default in local sessions, has Claude save notes of four types (user, feedback, project, reference) under ~/.claude/projects/<project>/memory/, and loads the first 200 lines or 25KB of the MEMORY.md index each session.
- Detail: Claude skips what it can derive from the code or what CLAUDE.md already says. The directory holds MEMORY.md (one line per memory, loaded every session) plus topic files that are read on demand. It is machine-local and shared across worktrees of the same repo. Toggle it in /memory (saves autoMemoryEnabled to ~/.claude/settings.json). Disable per project with {"autoMemoryEnabled": false}, or with CLAUDE_CODE_DISABLE_AUTO_MEMORY=1. Messages like 'Saved 2 memories' show when it writes. You can audit and edit everything via /memory, since it is plain markdown. Subagents don't get the main auto memory (forks do); a subagent can have its own via the `memory` field. The docs contrast it with CLAUDE.md: you write CLAUDE.md (instructions), Claude writes auto memory (learnings).
- Use: Memory lesson. Learners inspect MEMORY.md after a session and decide what should be promoted into the team CLAUDE.md.
- Sources: How Claude remembers your project (Auto memory) <https://code.claude.com/docs/en/memory>

### [practice-18] [Community] Japanese CLAUDE.md anti-patterns (corrected, medium)
- Claim: The convergence holds, but the line budgets are misreported: hoppii's Zenn post (2026-03-23) gives no line budget (it describes cutting a 400+ line file to under half and keeping about three must-follow rules), and the imohuke Zenn post (2026-02-08) says '目安は 300 行以下' plus about 150-200 instructions (not 150 lines). The phrase 'CLAUDE.md = 助言、Hooks = 確定的' was not found in the cited posts; do not attribute it. Teach the official 'under 200 lines' as the norm.
- Detail: Example: Zenn 'CLAUDE.md を1ヶ月毎日書き直して気づいた「書いてはいけないこと」10選' (hoppii, 2026-03-23) lists: (1) the whole project structure, write intent instead; (2) step-by-step procedures, keep only rules; (3) tech stack with versions, since package.json has them, write why instead; (4) trying to cover every case, keep about 3 key rules and link details; (5) vague 'write good code', use numbers or type names; (6) contradictions left in place; (7) prohibitions without alternatives; (8) stale rules, record the reason so you can tell when to delete; (9) no review cadence, e.g. a monthly audit; (10) everything in one file, split into subdirectory CLAUDE.md. Other Japanese posts frame it as 'CLAUDE.md = 助言、Hooks = 確定的'. Community opinion; teach the official numbers as the norm.
- Use: Japanese-language worked examples and a 'spot the anti-pattern' exercise in the CLAUDE.md lesson.
- Sources: CLAUDE.md を1ヶ月毎日書き直して気づいた「書いてはいけないこと」10選 <https://zenn.dev/hoppii007/articles/claude-md-anti-patterns>; 【Claude Code】CLAUDE.md運用のベストプラクティス：失敗しないための7つの原則 <https://zenn.dev/imohuke/articles/claude-code-best-practices-2026>
- Verifier evidence: hoppii article exists with the ten headings (#1 プロジェクト構成を全部書く ... #10 1 ファイルに全部詰め込む). imohuke article: '目安は 300 行以下', '指示としては 150〜200 個程度'; the title says 7 principles but the body has 8. <https://zenn.dev/hoppii007/articles/claude-md-anti-patterns>

### [learning-30] Skill progression: when to add each extension (verified, high)
- Claim: The docs advise new users to 'Start with CLAUDE.md for project conventions, then add other extensions as specific triggers come up', and give a trigger table for the order most teams follow.
- Detail: Triggers: Claude gets a convention or command wrong twice -> CLAUDE.md. You keep asking for shorter or more explanatory answers -> an output style. You keep typing the same prompt -> a user-invocable skill. You paste the same playbook a third time -> a skill. You keep copying data from a browser tab -> an MCP server. Claude reads many files to find a symbol -> a code intelligence plugin. A side task floods the conversation -> a subagent. Something must happen every time -> a hook. A second repo needs the same setup -> a plugin. Key distinction: CLAUDE.md and skills are instructions ('a request, not a guarantee'), while hooks are deterministic ('Put guardrails in hooks'). Context cost: CLAUDE.md on every request; skills are low (descriptions only); subagents are isolated; hooks cost zero unless they return output.
- Use: The spine of the intermediate track: one lesson per trigger. A matching exercise (scenario -> feature) assesses an 'analyze'-level objective. Good for the final exam.
- Sources: Extend Claude Code - Build your setup over time <https://code.claude.com/docs/en/features-overview>

### [releases-19] AGENTS.md support (verified, high)
- Claim: Since v2.1.277 (2026-09-18), Claude Code reads AGENTS.md as project instructions when the project has no CLAUDE.md.
- Detail: If a CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md exists in the working directory or above it, only CLAUDE.md files load, unless CLAUDE.md imports AGENTS.md (e.g. `@AGENTS.md`). You can change this under 'Project instructions' in `/config`. `/doctor prompt-audit` (2.1.283) audits CLAUDE.md, AGENTS.md, rules, skills and agents for prompting patterns written for older models. Auto memory, where Claude writes its own notes, works alongside these files.
- Use: Project memory lesson: CLAUDE.md vs AGENTS.md vs .claude/rules vs auto memory, with an exercise writing a shared AGENTS.md plus a CLAUDE.md that imports it (the Rise Path repo does exactly this).
- Sources: How Claude remembers your project <https://code.claude.com/docs/en/memory>; Claude Code CHANGELOG.md (2.1.277, 2.1.283) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [docs-24] Skills basics (verified, high)
- Claim: A skill is a `SKILL.md` file: YAML frontmatter followed by markdown instructions, in a folder such as `.claude/skills/<name>/` or `~/.claude/skills/<name>/`. Claude loads it when relevant, or you run it with `/<name>`. Custom commands have been merged into skills: `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both create `/deploy`.
- Detail: Where skills load from:
- Enterprise (managed)
- Personal (`~/.claude/skills`)
- Project (`.claude/skills`)
- Nested subdirectories
- `--add-dir` directories
- Plugins, namespaced as `/plugin:skill`
- Your claude.ai account

Context cost:
- Only descriptions sit in context at the start; the body loads when the skill is used.
- `description` plus `when_to_use` is truncated at 1,536 characters in the listing.

Skills follow the Agent Skills open standard (agentskills.io); Claude Code adds its own extensions.

Inside a skill body:
- Dynamic context injection: a line like `` !`git diff HEAD` `` runs before Claude reads the skill and is replaced by its output.
- Substitutions: `$ARGUMENTS`, `$0`/`$1`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}`.

When to make a skill: you keep pasting the same playbook, or a CLAUDE.md section has turned into a procedure.
- Use: Hands-on lesson: build the docs' `summarize-changes` skill, test auto vs explicit invocation.
- Sources: Extend Claude with skills <https://code.claude.com/docs/en/skills>

## Missed items (learning)
- Official interactive learning aid: 'Explore the context window' is an interactive simulation of how the context window fills (system prompt, auto memory, deferred MCP tools, file reads, rules and hooks). Use it directly in the context-management lesson. https://code.claude.com/docs/en/context-window
- Official Glossary page defining agentic loop, compaction, CLAUDE.md, hooks, subagents, MCP, surface and system reminder. Use it as the term source for the Japanese course's katakana/English pairs. https://code.claude.com/docs/en/glossary (Japanese pages under /docs/ja/)
- Official blog 'Steering Claude Code: when to use CLAUDE.md, skills, hooks, and subagents' (claude.com blog, June 18, 2026), linked from Extend Claude Code. A ready-made reading for the 'which feature?' discrimination exercise. https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more
- Dynamic workflows: scripts Claude writes to orchestrate many subagents and cross-check findings. Now part of the official verification ladder ('a verification subagent or a dynamic workflow') and the features overview. An advanced-track topic missing from the sweep. https://code.claude.com/docs/en/workflows
- /goal: set a completion condition and a separate evaluator re-checks it each turn. This is the 'across a session' rung of the verification ladder, and idle goal check-ins count toward usage. Deserves its own exercise in the verification/automation unit. https://code.claude.com/docs/en/goal
- CLAUDE.md maintenance tools: '/doctor prompt-audit' (v2.1.283+) proposes cuts to CLAUDE.md, rules, skills and output styles, and CLAUDE_CODE_NEW_INIT=1 makes /init an interactive multi-phase flow that can also set up skills and hooks. /import brings another agent's config (e.g. AGENTS.md, MCP servers) into Claude Code. All of these fit the memory lesson's 'prune your CLAUDE.md' exercise. https://code.claude.com/docs/en/memory
- Claude Code answers questions about itself from the current docs ('It looks up the answers in the current Claude Code documentation, so they aren't limited to the version you're running'). Teach this as the learner's first self-help habit, alongside /powerup. https://code.claude.com/docs/en/common-workflows
- Cost-lesson update in v2.1.304 (npm 2026-10-19): Pro and Max now warn when resuming an inactive conversation would use a noticeable share of the 5-hour usage limit, and offer to start a new conversation instead. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- More Claude Academy courses next to the Claude Code ones: 'Introduction to Claude Cowork', 'AI Capabilities and Limitations', 'AI Fluency for Builders' and 'Claude Platform 101'. Useful as further-study links or prerequisites for non-engineers. https://anthropic.skilljar.com/
- Artifacts: Claude Code can publish session output as private or shareable interactive pages on claude.ai. Now listed as an extension in the features overview, so it may belong in a 'sharing results' lesson. https://code.claude.com/docs/en/artifacts
- The official weekly 'What's new' digest (latest in the index: Week 37, September 7–11, 2026). Recommend it in the course as the learner's channel for keeping up with changes, alongside the CHANGELOG. https://code.claude.com/docs/en/whats-new/index