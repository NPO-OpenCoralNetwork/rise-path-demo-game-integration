# Verified facts for cc-07-skills-subagents (checked 2026-10-20)

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

### [docs-25] Skill frontmatter and invocation control (verified, high)
- Claim: Every SKILL.md frontmatter field is optional; only `description` is recommended. `disable-model-invocation: true` means only you can run the skill, and its description stays out of context. `user-invocable: false` means only Claude can run it.
- Detail: Fields:
- `name`, `description`, `when_to_use`
- `argument-hint`, `arguments`
- `disable-model-invocation`, `user-invocable`
- `allowed-tools`: pre-approved tools for the turn that invokes the skill.
- `disallowed-tools`
- `model`, `effort`
- `context: fork`: run in a subagent; with `agent` to pick the type and `background`.
- `hooks`, `paths`, `shell`
- `metadata`, `license`, `compatibility`

Use `disable-model-invocation` for side-effect workflows such as `/deploy` or `/commit`.

Outside Claude Code (claude.ai uploads and the Skills API), only `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools` are allowed. Other keys cause an upload error.

`/skill-doctor` shows each skill's context cost and how often it is used. `/skills` lists them, and pressing `t` sorts by token count.
- Use: Exercise: convert a risky deploy procedure into a user-only skill; quiz on which field to set.
- Sources: Extend Claude with skills <https://code.claude.com/docs/en/skills>

### [docs-26] Subagents (verified, high)
- Claim: A subagent is a Markdown file in `.claude/agents/` (project) or `~/.claude/agents/` (user) with YAML frontmatter; `name` and `description` are required. It runs in its own context window with its own system prompt, tools and permissions, and returns only a summary.
- Detail: Built-in subagents:
- Explore: read-only and fast.
- Plan: research during plan mode.
- general-purpose.
- Helpers: statusline-setup, claude-code-guide.

Frontmatter fields:
- `tools`, `disallowedTools`
- `model` (sonnet/opus/haiku/fable/full ID/inherit)
- `permissionMode`, `maxTurns`
- `skills` (preloaded), `mcpServers`, `hooks`
- `memory` (user/project/local)
- `background`, `effort`
- `isolation: worktree`
- `color`, `omitClaudeMd`, `initialPrompt`

Scope priority: managed > `--agents` JSON > project > user > plugin.

Behavior:
- Subagents Claude spawns from the main conversation start in the background by default, and their permission prompts appear in the main session.
- Subagents can spawn their own subagents.
- Combined descriptions over 15,000 tokens trigger a warning.
- Use: Lesson: create a read-only code-reviewer subagent on haiku; compare context usage vs doing it inline.
- Sources: Create custom subagents <https://code.claude.com/docs/en/sub-agents>

### [docs-27] Forks and /subtask (verified, high)
- Claim: A fork is a subagent that inherits the whole conversation, system prompt, tools and model, and shares the parent's prompt cache. Start one with `/subtask <task>`. Fork mode, which lets Claude start forks on its own, is on by default (from v2.1.302; in interactive terminals from v2.1.232).
- Detail: Running forks appear in a panel below the prompt:
- ↑/↓ moves between rows.
- Enter opens a fork's transcript.
- `x` stops the selected fork.

A fork's result arrives as a message in the main conversation.

Related commands:
- `/fork` copies the whole session into a separate background session.
- `/branch` switches you into a copy of the conversation.

To turn forks off, add `"Agent(fork)"` to `permissions.deny`, or set `CLAUDE_CODE_FORK_SUBAGENT=0`.

Naming confusion: a skill with `context: fork` does NOT inherit the conversation. It starts a fresh subagent with the skill content as its prompt.
- Use: Advanced delegation lesson; misconception check on context: fork vs /subtask.
- Sources: Create custom subagents <https://code.claude.com/docs/en/sub-agents>; Extend Claude with skills <https://code.claude.com/docs/en/skills>

### [practice-19] [Official] Subagents for research and isolation (verified, high)
- Claim: Subagents run in their own context window and return only a summary, so the docs recommend 'use subagents to investigate X' to keep exploration out of the main conversation.
- Detail: Built-ins: Explore (read-only, fast search, starts without CLAUDE.md or git status), Plan (read-only research in plan mode), and general-purpose. Custom subagents are markdown files in .claude/agents/ (project, check in) or ~/.claude/agents/. Required frontmatter: name and description. Optional: tools (allowlist), disallowedTools, model (sonnet/opus/haiku/fable/inherit), isolation: worktree, memory (user/project/local), skills (preloaded), omitClaudeMd (v2.1.271+), background, permissionMode, maxTurns. Subagents Claude spawns run in the background by default (Ctrl+B backgrounds a running task). Fork mode, on by default, lets a forked subagent inherit the full conversation; start one yourself with '/subtask <task>'. Nesting goes up to 3 levels (CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH). The default concurrent limit is 20 (CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS). /tasks lists background work. Keep work in the main conversation for frequent back-and-forth or quick targeted edits.
- Use: Subagents lesson. Exercise: write a read-only 'security-reviewer' agent with tools: Read, Grep, Glob and run it on a diff.
- Sources: Create custom subagents <https://code.claude.com/docs/en/sub-agents>; Best practices for Claude Code (Use subagents for investigation) <https://code.claude.com/docs/en/best-practices>

### [practice-27] [Official] Skills as reusable team knowledge (verified, high)
- Claim: Skills are SKILL.md folders (.claude/skills/<name>/SKILL.md) whose name and description load every session while the body loads only when invoked or relevant, which makes them the place for procedures and reference material that would otherwise bloat CLAUDE.md.
- Detail: Frontmatter: description (key use case first; the listing truncates at 1,536 characters), disable-model-invocation: true (only you can invoke it, for side effects such as deploys; also keeps it out of context), user-invocable: false (background knowledge), allowed-tools, context: fork with agent: (run in a subagent), paths (globs). Substitutions: $ARGUMENTS, $0/$1, ${CLAUDE_SKILL_DIR}. !`git diff HEAD` injects command output before Claude sees the skill. Keep SKILL.md under 500 lines and put detail in sibling files (progressive disclosure: metadata -> SKILL.md -> linked files, per the Oct 16 2025 Agent Skills post, published as an open standard Dec 18 2025). Custom commands were merged into skills: .claude/commands/x.md and .claude/skills/x/SKILL.md both create /x. Bundled skills include /code-review, /batch, /debug, /loop, /verify, /run, /simplify, /doctor. Authoring advice: start from evaluation (where Claude struggles), watch how Claude uses the skill, test triggering against a baseline in fresh sessions. The skill-creator plugin automates evals. Install only trusted skills, since malicious ones can exfiltrate data. Official example: a /fix-issue skill that runs 'gh issue view', fixes, tests, commits and opens a PR, invoked as '/fix-issue 1234'.
- Use: Skills lesson. Exercise: turn a repeated prompt into .claude/skills/fix-issue/SKILL.md with disable-model-invocation, then test that it triggers.
- Sources: Extend Claude with skills <https://code.claude.com/docs/en/skills>; Equipping agents for the real world with Agent Skills <https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills>; Best practices for Claude Code (Create skills) <https://code.claude.com/docs/en/best-practices>

### [practice-28] [Official] Plugins, marketplaces and onboarding packs for teams (verified, high)
- Claim: Plugins bundle skills, hooks, subagents, MCP servers and workflows into one installable unit with namespaced skills (/plugin-name:skill), and are how teams share a working setup across repositories.
- Detail: Browse with /plugin. Code intelligence plugins add LSP navigation and type errors after edits, e.g. '/plugin install typescript-lsp@claude-plugins-official'. Enable a plugin for a whole repo with the enabledPlugins project setting. Organizations can host private marketplaces. /team-onboarding generates an onboarding guide from your last 30 days of usage that a teammate can paste as a first message (with a share link on Team/Enterprise). Plugins can be tested with 'claude plugin eval'. Community example (ARM techblog, Jun 2026): a team distributes common skills through an internal marketplace and uses official plugins (superpowers, code-simplifier) plus a Codex review plugin. The large-codebases blog warns that bottom-up adoption 'can fragment without someone to centralize what works'.
- Use: Team-adoption lesson. Exercise: package an existing .claude/ setup (one skill, one hook) as a plugin and install it in a second repo.
- Sources: Extend Claude Code (Plugins) <https://code.claude.com/docs/en/features-overview>; Set up Claude Code in a monorepo or large codebase (code intelligence) <https://code.claude.com/docs/en/large-codebases>; Commands (/team-onboarding) <https://code.claude.com/docs/en/commands>; 2026年6月現在の Claude Code 開発フロー <https://zenn.dev/arm_techblog/articles/7712cde19988c8>

### [learning-30] Skill progression: when to add each extension (verified, high)
- Claim: The docs advise new users to 'Start with CLAUDE.md for project conventions, then add other extensions as specific triggers come up', and give a trigger table for the order most teams follow.
- Detail: Triggers: Claude gets a convention or command wrong twice -> CLAUDE.md. You keep asking for shorter or more explanatory answers -> an output style. You keep typing the same prompt -> a user-invocable skill. You paste the same playbook a third time -> a skill. You keep copying data from a browser tab -> an MCP server. Claude reads many files to find a symbol -> a code intelligence plugin. A side task floods the conversation -> a subagent. Something must happen every time -> a hook. A second repo needs the same setup -> a plugin. Key distinction: CLAUDE.md and skills are instructions ('a request, not a guarantee'), while hooks are deterministic ('Put guardrails in hooks'). Context cost: CLAUDE.md on every request; skills are low (descriptions only); subagents are isolated; hooks cost zero unless they return output.
- Use: The spine of the intermediate track: one lesson per trigger. A matching exercise (scenario -> feature) assesses an 'analyze'-level objective. Good for the final exam.
- Sources: Extend Claude Code - Build your setup over time <https://code.claude.com/docs/en/features-overview>

### [releases-15] Subagents: background by default, /agents wizard removed (verified, high)
- Claim: In v2.1.198 (2026-07-01) subagents began running in the background by default, and the interactive `/agents` wizard was removed.
- Detail: Claude keeps working while subagents run and still uses the foreground when it needs a result first. A subagent's frontmatter field `background` pins the behavior. To create or manage subagents now, ask Claude or edit `.claude/agents/` or `~/.claude/agents/` directly; typing `/agents` only prints that reminder. Related: subagents can spawn subagents, up to five levels deep for background chains (2.1.172, June 2026); the 200-subagent-per-session cap was removed in 2.1.224; the Task tool's `mode` parameter was deprecated in 2.1.212 (subagents inherit the parent's permission mode). The docs name the spawning tool `Agent`.
- Use: Subagents lesson. Older tutorials ('run /agents to create one', 2025-07 v1.0.60) need updating.
- Sources: Week 27 · June 29 – July 3, 2026 <https://code.claude.com/docs/en/whats-new/2026-w27>; Commands (/agents row) <https://code.claude.com/docs/en/commands>; Claude Code CHANGELOG.md (2.1.198, 2.1.212, 2.1.224) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-16] Fork subagents, /fork, /branch and /subtask (verified, high)
- Claim: Fork mode, where a subagent inherits the full conversation and prompt cache, became the default in interactive sessions in v2.1.232 (2026-08-13), and in `claude -p`, the Agent SDK, Desktop and VS Code in v2.1.302 (2026-10-16).
- Detail: Command history that confuses learners: in 2.1.77 (2026-03-16) `/fork` was renamed `/branch`, with `/fork` kept as an alias. In 2.1.212 (2026-07-16) `/fork` was repurposed to copy the conversation into a new background session (its own row in `claude agents`), and the old in-session forked subagent became `/subtask <task>`. Since 2.1.221 (2026-08-03) a forked session gets its own worktree. `CLAUDE_CODE_FORK_SUBAGENT=0` turns fork subagents off.
- Use: Context-management lesson: 'side task without losing context'. Use a comparison table of /branch vs /fork vs /subtask.
- Sources: Week 33 · August 10–14, 2026 <https://code.claude.com/docs/en/whats-new/2026-w33>; Commands (/fork, /subtask, /branch) <https://code.claude.com/docs/en/commands>; Claude Code CHANGELOG.md (2.1.77, 2.1.212, 2.1.221, 2.1.232, 2.1.302) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [practice-13] [Official] Build your setup over time: trigger -> feature (verified, high)
- Claim: The docs advise starting with CLAUDE.md alone and adding each extension only when its trigger appears, for example a CLAUDE.md line when Claude gets a convention wrong twice.
- Detail: The official trigger table: Claude gets a convention or command wrong twice -> CLAUDE.md. You keep asking for shorter or longer answers -> output style. You keep typing the same prompt to start a task -> user-invocable skill. You paste the same playbook a third time -> skill. You keep copying data from a browser tab -> MCP server. Claude reads many files to find a symbol -> code intelligence plugin. A side task floods the conversation -> subagent. Something must happen every time -> hook. A second repository needs the same setup -> plugin. The memory page lists when to add to CLAUDE.md: Claude makes the same mistake a second time, a code review catches something Claude should have known, you type the same correction as last session, or a new teammate would need the context. 'A repeated mistake or a recurring review comment is a CLAUDE.md edit, not a one-off correction in chat.'
- Use: A capstone 'design your setup' lesson. A matching exercise pairs symptoms with the right extension.
- Sources: Extend Claude Code (Build your setup over time) <https://code.claude.com/docs/en/features-overview>; How Claude remembers your project (When to add to CLAUDE.md) <https://code.claude.com/docs/en/memory>

### [docs-31] Plugins and marketplaces (verified, high)
- Claim: A plugin is a directory, with a manifest at `.claude-plugin/plugin.json`, that bundles skills, agents, hooks, MCP servers or a hooks module ('mod') and installs as one unit. A marketplace is a catalog: a repository with `.claude-plugin/marketplace.json`.
- Detail: Commands:
- `/plugin` opens the menu; the Discover tab lists available plugins.
- `/plugin marketplace add owner/repo` adds a marketplace; pin a ref with `#v1.2.0`.
- `/plugin install <plugin>@<marketplace>`, for example `commit-commands@claude-plugins-official`.
- From a shell: `claude plugin install ... --scope project`, `claude plugin disable`.

Anthropic's official marketplace (`claude-plugins-official`) is added on your first interactive session.

Install scopes: user, project (committed in `.claude/settings.json`), local.

Things to know:
- Plugin skills are namespaced, e.g. `/my-plugin:review`.
- An enabled plugin's skill and agent descriptions use context on every turn.
- A plugin runs code with your privileges, so review it first.
- Cloud sessions do not load plugins from local settings.
- `--plugin-dir` loads a plugin during development.
- Use: Lesson 'share your setup': package the course's skill+hook as a plugin; security review checklist.
- Sources: Plugins overview <https://code.claude.com/docs/en/plugins/overview>; Install and manage plugins <https://code.claude.com/docs/en/plugins/install>

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
### [repro-yaml] Multi-line descriptions with `description: >-` load (checked 2026-10-21, Claude Code 2.1.306)
- Claim: A SKILL.md or agent file whose `description` is a YAML folded block (`description: >-` and indented lines) loads, and Claude gets the description as one string.
- How it was checked: a throwaway git project held the lesson's three files as they are (`s2-skill` as `.claude/skills/commit-message/SKILL.md`, `pr-model` as `.claude/skills/update-readme/SKILL.md`, `s3-file` as `.claude/agents/researcher.md`). One `claude -p` run with an empty config folder listed `commit-message` and `update-readme` as skills and slash commands, and `researcher` as an agent type. The session's command list gave `commit-message` the description 「変更を要約し、 コミットメッセージの案を出す。 何を変えたかを聞かれたときや、 コミット前に使う。」, and Claude quoted the same text for the skill and 「コードを変えずに調べものをし、 要点だけを報告する。 原因の調査や、 影響範囲の洗い出しに使う。」 for the agent.
- Note: YAML folds the line breaks into spaces, so the Japanese description gets a space at each break. Claude reads it the same; nothing in the lesson depends on it.
