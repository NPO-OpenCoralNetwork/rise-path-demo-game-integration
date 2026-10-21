# Verified facts for cc-05-context (checked 2026-10-20)

### [practice-1] [Official] Mental model: context is the scarce resource (verified, high)
- Claim: Anthropic's best-practices page says most Claude Code best practices follow from one constraint: the context window fills up fast and performance degrades as it fills.
- Detail: The page says the context window holds every message, file read and command output, and that 'LLM performance degrades as context fills', with Claude 'forgetting' earlier instructions. It recommends tracking usage with a custom status line and /context. The Sep 29 2025 engineering post 'Effective context engineering for AI agents' names this 'context rot', calls context a finite 'attention budget', and states the principle: 'find the smallest set of high-signal tokens that maximize the likelihood of your desired outcome.' It describes Claude Code as hybrid: CLAUDE.md loaded up front, glob/grep for just-in-time retrieval, compaction and to-do lists or NOTES.md as memory for long tasks.
- Use: Lesson 1 (how Claude Code thinks): a frame for why /clear, subagents, a short CLAUDE.md and scoped prompts work. Exercise: run /context before and after reading a large file.
- Sources: Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>; Effective context engineering for AI agents <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>

### [practice-10] [Official] Context hygiene commands and course-correction (verified, high)
- Claim: The docs advise /clear between unrelated tasks and, after two failed corrections on the same issue, a /clear and a better initial prompt rather than more corrections.
- Detail: Tools: Esc stops Claude mid-action and keeps context. Esc+Esc or /rewind restores conversation, code or both to a checkpoint, or picks 'Summarize from here' / 'Summarize up to here' (partial compaction). /clear resets context; '/clear [name]' labels the old conversation for /resume. '/compact <instructions>' (e.g. '/compact Focus on the API changes') controls the summary. /btw asks a side question that never enters history. /context shows usage as a grid. You can add a compaction instruction to CLAUDE.md, e.g. 'When compacting, always preserve the full list of modified files and any test commands'. Checkpoints are created per prompt and saved with the conversation, but 'only track changes made through Claude's file editing tools. Changes made through Bash commands or external processes are not captured. This isn't a replacement for git.' Name sessions with /rename and resume with claude --continue / claude --resume. Prompt-caching tip: compact at natural breaks between tasks, and use /rewind to abandon a path, since rewinding reuses the cached prefix.
- Use: Context-hygiene lesson with a 'kitchen sink' scenario. Learners choose between /clear, /compact, /rewind and /btw for each situation.
- Sources: Best practices for Claude Code (Manage your session) <https://code.claude.com/docs/en/best-practices>; Commands <https://code.claude.com/docs/en/commands>; How Claude Code uses prompt caching <https://code.claude.com/docs/en/prompt-caching>

### [practice-11] [Official] What survives compaction (verified, high)
- Claim: After compaction, the project-root CLAUDE.md, unscoped rules, auto memory and the plan-mode plan are re-injected from disk, while instructions given only in conversation are summarized and can be lost.
- Detail: Per the docs table: system prompt and output style still apply. Project-root CLAUDE.md and unscoped rules are re-injected from disk, as is auto memory. Skill descriptions are rebuilt (v2.1.304+). The plan written in plan mode is re-injected. Rules with paths: frontmatter and nested CLAUDE.md files reload on demand. Up to five recently modified files Claude read or edited are re-read; a file over 5,000 tokens comes back as a path reference. Invoked skill bodies are re-injected, capped at 5,000 tokens per skill and 25,000 total, oldest dropped first; truncation keeps the start of the file, so put key instructions near the top of SKILL.md. SessionStart hooks matching 'compact' run and add their output. Fix for lost instructions: move conversation-only instructions into CLAUDE.md, or use a SessionStart 'compact' hook. Other levers: '/autocompact 500k' sets how full the window gets before auto-compaction, and 1M-token context is available on several models.
- Use: Context lesson. Quiz: which of these survives compaction? (chat instruction / root CLAUDE.md / paths-scoped rule / plan file).
- Sources: Explore the context window <https://code.claude.com/docs/en/context-window>; How Claude remembers your project (Instructions seem lost after /compact) <https://code.claude.com/docs/en/memory>; Automate actions with hooks (Re-inject context after compaction) <https://code.claude.com/docs/en/hooks-guide>

### [practice-19] [Official] Subagents for research and isolation (verified, high)
- Claim: Subagents run in their own context window and return only a summary, so the docs recommend 'use subagents to investigate X' to keep exploration out of the main conversation.
- Detail: Built-ins: Explore (read-only, fast search, starts without CLAUDE.md or git status), Plan (read-only research in plan mode), and general-purpose. Custom subagents are markdown files in .claude/agents/ (project, check in) or ~/.claude/agents/. Required frontmatter: name and description. Optional: tools (allowlist), disallowedTools, model (sonnet/opus/haiku/fable/inherit), isolation: worktree, memory (user/project/local), skills (preloaded), omitClaudeMd (v2.1.271+), background, permissionMode, maxTurns. Subagents Claude spawns run in the background by default (Ctrl+B backgrounds a running task). Fork mode, on by default, lets a forked subagent inherit the full conversation; start one yourself with '/subtask <task>'. Nesting goes up to 3 levels (CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH). The default concurrent limit is 20 (CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS). /tasks lists background work. Keep work in the main conversation for frequent back-and-forth or quick targeted edits.
- Use: Subagents lesson. Exercise: write a read-only 'security-reviewer' agent with tools: Read, Grep, Glob and run it on a diff.
- Sources: Create custom subagents <https://code.claude.com/docs/en/sub-agents>; Best practices for Claude Code (Use subagents for investigation) <https://code.claude.com/docs/en/best-practices>

### [docs-7] Sessions (verified, high)
- Claim: Each session is saved locally as a plaintext JSONL transcript under `~/.claude/projects/`. Every new session starts with a fresh context window. `claude --continue` (`-c`) and `claude --resume` (`-r`) reopen a session under the same ID; `--fork-session` and `/branch` copy it to a new ID.
- Detail: Commands:
- `claude -c` continues the most recent conversation in the current directory.
- `claude -r "<id or name>" "query"` resumes a specific session.
- `/resume` opens a picker; it defaults to the current worktree, and background sessions are marked `bg`.
- `/branch [name]` tries a different direction without losing the original.
- `/clear` starts an empty conversation; the old one can be resumed.

Behavior:
- Sessions are tied to the working directory. Switching git branches changes the files Claude sees but keeps the conversation.
- Knowledge carries across sessions only through CLAUDE.md and auto memory.
- Use: Lesson on session hygiene: resume vs fork vs clear; exercise naming and resuming sessions.
- Sources: How Claude Code works <https://code.claude.com/docs/en/how-claude-code-works>; CLI reference <https://code.claude.com/docs/en/cli-reference>; Commands <https://code.claude.com/docs/en/commands>

### [docs-38] Context management (verified, high)
- Claim: Context commands:
- `/context` shows context use as a colored grid, including which memory files loaded.
- `/compact [instructions]` summarizes the conversation, optionally around a focus you give.
- `/clear` starts empty.
- `/autocompact <size>` (100K–1M, e.g. `500k`) sets when auto-compaction runs.
Claude Code compacts automatically as the window fills: it clears old tool outputs first, then summarizes.
- Detail: What survives compaction:
- The system prompt and output style still apply.
- Project-root CLAUDE.md, unscoped rules, auto memory and the plan-mode plan are re-injected.
- Up to 5 recently modified files are re-read.
- Invoked skill bodies come back, capped at 5,000 tokens each and 25,000 in total.
- Path-scoped rules and nested CLAUDE.md files reload only on demand.

Ways to shape what is kept:
- Add a 'Compact Instructions' section to CLAUDE.md.
- Rewind's 'Summarize from/up to here' compacts only part of the conversation.

Auto-compaction thresholds: models with a native 1M window compact at about 967K by default.

MCP tool definitions are deferred by default.

The docs present the context window as the most important resource. To keep it small: `/clear` between tasks, delegate large reads to subagents, and keep CLAUDE.md short.
- Use: Lesson 'manage the context window': run /context before/after reading files and after /compact.
- Sources: Explore the context window <https://code.claude.com/docs/en/context-window>; Model configuration <https://code.claude.com/docs/en/model-config>; How Claude Code works <https://code.claude.com/docs/en/how-claude-code-works>

### [learning-19] Misconception: Claude remembers everything across sessions (verified, high)
- Claim: 'Each Claude Code session begins with a fresh context window.' Knowledge carries over only through CLAUDE.md files (which you write) and auto memory (notes Claude writes, stored machine-locally at ~/.claude/projects/<project>/memory/ and loaded each session up to the first 200 lines or 25KB of MEMORY.md).
- Detail: CLAUDE.md scopes: user `~/.claude/CLAUDE.md`; project `./CLAUDE.md` or `./.claude/CLAUDE.md`; local `./CLAUDE.local.md` (gitignored); plus `.claude/rules/` (rules can be path-scoped). Target under 200 lines per CLAUDE.md, because longer files reduce adherence. `@path` imports load at launch too, so they don't reduce context cost. Instructions are treated as context, not enforced; to block an action, use a PreToolUse hook. Auto memory is on by default in local sessions; toggle it with `/memory` (the `autoMemoryEnabled` setting) or with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. It is not shared across machines. Claude can read AGENTS.md when no CLAUDE.md exists (v2.1.277+). Conversations can be resumed (`claude --continue`, `claude --resume`), but a new session does not carry old chat history. `/init` generates a starter CLAUDE.md.
- Use: A dedicated 'memory' lesson. Misconception check: 'Yesterday's chat is remembered automatically' (false; only CLAUDE.md and auto memory carry over). Exercise: run /init, cut the result to the essentials, and verify with /context.
- Sources: How Claude remembers your project <https://code.claude.com/docs/en/memory>; How Claude Code works - Work with sessions <https://code.claude.com/docs/en/how-claude-code-works>

### [learning-20] Documented beginner failure patterns (official) (verified, high)
- Claim: The official best-practices page names five common failure patterns: the kitchen sink session, correcting over and over, the over-specified CLAUDE.md, the trust-then-verify gap, and the infinite exploration.
- Detail: Fixes: kitchen sink, `/clear` between unrelated tasks. Correcting over and over, 'After two failed corrections, `/clear` and write a better initial prompt incorporating what you learned.' Over-specified CLAUDE.md, 'Ruthlessly prune' or convert rules to hooks. Trust-then-verify gap, 'Always provide verification (tests, scripts, screenshots). If you can't verify it, don't ship it.' Infinite exploration, 'Scope investigations narrowly or use subagents.' Underlying constraint: 'Claude's context window fills up fast, and performance degrades as it fills.'
- Use: The backbone of a 'common mistakes' lesson: give each pattern a short scenario and have the learner pick the fix (an inline check with feedback on each wrong option). Also good material for flashcards and the final exam.
- Sources: Best practices for Claude Code - Avoid common failure patterns <https://code.claude.com/docs/en/best-practices>

### [learning-21] Context management (context overload) (corrected, high)
- Claim: Same as claimed, but fix the cost note. The docs do not say 'a one-hour session' is expensive. They say every request re-sends the whole conversation, which is read at the cached rate, so long-running sessions draw more usage. They also say that your first message after a break longer than the prompt-cache lifetime misses the cache and reprocesses the full context. That lifetime is 1 hour on a subscription, and 5 minutes on usage credits or, by default, on an API key or cloud provider.
- Detail: `/clear [name]` starts a new conversation with empty context (and costs nothing); `/compact Focus on the API changes` summarizes with a focus; `/context` shows a colored grid of usage; `/btw` asks a side question that never enters history; `Esc Esc` or `/rewind` -> 'Summarize from here' or 'Summarize up to here'. Name sessions with `/rename` and resume with `/resume`. Put persistent rules in CLAUDE.md, not in early chat. Use subagents for research so that only summaries come back. MCP tool definitions are deferred by default (tool search). A one-hour session or a cache miss after a break can cost a lot of plan usage.
- Use: A context-management lesson with an exercise: watch `/context` before and after a large file read, then decide between /clear and /compact for given scenarios.
- Sources: Best practices - Manage context aggressively <https://code.claude.com/docs/en/best-practices>; How Claude Code works - The context window <https://code.claude.com/docs/en/how-claude-code-works>; Commands <https://code.claude.com/docs/en/commands>
- Verifier evidence: How Claude Code works: 'Claude compacts automatically, but instructions from early in the conversation can get lost'. MCP tool definitions are deferred by default (tool search). Commands: '/clear [name] Start a new conversation with empty context'; '/btw ... without adding to the conversation'; '/context ... colored grid'. Best practices covers '/compact Focus on the API changes', 'Summarize from here' / 'Summarize up to here', and /rename. Costs > 'Why usage climbs': 'Cache misses: your first message after a break longer than the cache lifetime ... The lifetime is an hour on a subscription and drops to five minutes once you're drawing on usage credits'. <https://code.claude.com/docs/en/costs>

### [releases-30] Context management: idle compaction, /cd, Summarize up to here (verified, high)
- Claim: In v2.1.299 (2026-10-14), the terminal gained idle compaction: a conversation of 200K+ tokens left idle for about 54 minutes is compacted before its one-hour prompt cache expires.
- Detail: Turn it off with `"idleCompaction": false` or the 'Idle compaction' row in `/config` (2.1.302). `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` changes the 200K minimum. Other recent context tools: the Rewind menu's 'Summarize up to here' (Week 20); `/cd` moves a session to a new directory without rebuilding the cache (Week 24); `/rewind` can resume from before `/clear` (Week 26); `/btw` asks a side question without adding to the conversation. New models default to a 1M-token context window.
- Use: Context-window lesson: /context, /compact, /clear, /rewind, plus how prompt caching affects cost.
- Sources: Claude Code CHANGELOG.md (2.1.299, 2.1.302) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>; Week 24 · June 8–12, 2026 <https://code.claude.com/docs/en/whats-new/2026-w24>

### [safety-30] Reducing token use (verified, high)
- Claim: The official cost guidance: `/clear` between unrelated tasks, `/compact [instructions]`, Sonnet for most coding and Opus for complex reasoning, lower effort for simple tasks, CLAUDE.md under 200 lines (move specialised instructions into skills), and verbose work delegated to subagents.
- Detail: Other points from the docs: MCP tool definitions are deferred by default; CLI tools such as gh or aws use less context than MCP; `/context` shows what fills the context window; plan mode avoids costly rework; Esc and /rewind let you correct course early. Agent teams use about 7x more tokens when teammates run in plan mode. Prompt-cache lifetime is 1 hour on a subscription but 5 minutes on API keys or once you're on usage credits, so the first message after a break re-processes the full context. Long sessions keep growing because the full history is resent each turn; `/clear` costs nothing, while `/compact` is itself a large request. Thinking tokens are billed as output. Thinking can't be turned off on Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable models; use `/effort` instead.
- Use: Lesson 8: a cost-habits checklist plus a 'why did my long session burn usage?' scenario.
- Sources: Manage costs effectively — Reduce token usage <https://code.claude.com/docs/en/costs>; Best practices for Claude Code — Avoid common failure patterns <https://code.claude.com/docs/en/best-practices>

### [practice-15] [Official] Gotcha: CLAUDE.md edits and mid-session switches (verified, high)
- Claim: Edits to project-root or user CLAUDE.md made mid-session do not apply until the next /clear, /compact or restart, and switching model mid-session makes the next turn reprocess the whole history uncached.
- Detail: The prompt-caching page says root and user CLAUDE.md files 'are read once at session start and held in memory... the edit also doesn't apply... The new content loads on the next /clear, /compact, or restart.' Nested CLAUDE.md and paths-scoped rules that have not loaded yet do take effect when edited. Actions that invalidate the cache: switching models, changing effort on most models (not on Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable 5.1 with an API key or subscription), turning on fast mode, connecting MCP servers when tools load up front, denying a whole tool without tool search, compacting, and upgrading Claude Code. Tip: 'Pick your model and effort level at the top of a session, then save /compact for natural breaks between tasks.' /usage shows a 'Prompt cache (main)' line with the hit ratio and the likely cause of the last miss (v2.1.251+, cause text v2.1.260+).
- Use: 'Why didn't my rule work?' troubleshooting box in the CLAUDE.md lesson, plus a cost-awareness note in the session-management lesson.
- Sources: How Claude Code uses prompt caching <https://code.claude.com/docs/en/prompt-caching>

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