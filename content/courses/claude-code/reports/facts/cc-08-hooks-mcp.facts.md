# Verified facts for cc-08-hooks-mcp (checked 2026-10-20)

### [docs-28] Hooks: events and configuration (verified, high)
- Claim: Hooks are defined in settings JSON at three levels of nesting: event → matcher group → handlers. There are about 30 events, including SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop, SubagentStop, PreCompact and SessionEnd. Handlers can be `command`, `http`, `mcp_tool`, `prompt` or `agent`.
- Detail: Example from the docs (auto-format after edits) in `.claude/settings.json`:
`{"hooks":{"PostToolUse":[{"matcher":"Edit|Write","hooks":[{"type":"command","command":"jq -r '.tool_input.file_path' | xargs npx prettier --write"}]}]}}`

Where hooks can be defined:
- `~/.claude/settings.json`
- `.claude/settings.json`
- `.claude/settings.local.json`
- Managed policy
- Plugin `hooks/hooks.json`
- Skill or subagent frontmatter

Matchers:
- An exact name, or names separated by `|` or `,`.
- Any other characters make it a JavaScript regex.

Behavior:
- Input arrives as JSON on stdin.
- Matching hooks run in parallel.
- Hooks merge across levels instead of replacing each other.

Use `/hooks` to view them. Hooks are for things that must happen every time; CLAUDE.md is only advisory.
- Use: Hands-on lesson: add a PostToolUse formatter and a Notification hook; diagram the lifecycle.
- Sources: Hooks reference <https://code.claude.com/docs/en/hooks>; Automate actions with hooks <https://code.claude.com/docs/en/hooks-guide>

### [docs-29] Hooks: exit codes (verified, high)
- Claim: Exit 0 is success; any JSON on stdout is applied. Exit 2 is a blocking error: on events that can block, the action stops, and stderr becomes the reason Claude sees. Any other exit code, including 1, is a non-blocking error and the action continues.
- Detail: Example: a PreToolUse hook on Bash that exits 2 for commands starting with `rm` blocks them. Claude sees `PreToolUse:Bash hook error: [...]: Blocked: rm commands are not allowed`.

The docs warn that exit 1 without valid JSON is only a non-blocking error, even though 1 is the usual Unix failure code. Policy hooks must use `exit 2`, or set `onFailure: "block"`.

Stdout handling:
- On UserPromptSubmit, UserPromptExpansion, SessionStart and PostModelSwitch, plain-text stdout is added as context for Claude.
- On other events, stdout goes only to the debug log.

To surface a warning to Claude after a tool has already run, exit 2 from PostToolUse.
- Use: Quiz item (common misconception: exit 1 blocks); exercise writing a blocking guard hook.
- Sources: Hooks reference <https://code.claude.com/docs/en/hooks>

### [docs-30] MCP (verified, high)
- Claim: Add MCP servers with `claude mcp add`:
- Remote HTTP (recommended): `claude mcp add --transport http <name> <url>`.
- Local stdio: `claude mcp add [options] <name> -- <command> [args...]`.
- SSE: `--transport sse`, which is deprecated.
- Detail: Scopes:
- Local (the default): stored in `~/.claude.json` for the current project.
- Project: `.mcp.json` at the repository root, committed. It needs approval in interactive sessions.
- User: `~/.claude.json`, available in every project.

Precedence: local > project > user > plugin > claude.ai connectors.

Management:
- `claude mcp list`, `claude mcp get <name>`, `claude mcp remove <name>`.
- `/mcp` in a session.
- `claude mcp login <name>` / `logout` for OAuth.

In `.mcp.json`:
- `${VAR}` and `${VAR:-default}` expansion is supported.
- An entry with a `url` must also have a `type`.

Tool search defers tool definitions, so only tool names and server instructions use context until a tool is needed. Claude Code can itself run as an MCP server.
- Use: Lesson connecting a remote HTTP server (e.g., an issue tracker) at project scope; discuss scope choice and secrets.
- Sources: Connect Claude Code to tools via MCP <https://code.claude.com/docs/en/mcp>; CLI reference <https://code.claude.com/docs/en/cli-reference>

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

### [practice-29] [Official] Hooks for deterministic guardrails (verified, high)
- Claim: Hooks are scripts (or HTTP, MCP tool, prompt or agent handlers) that Claude Code runs at lifecycle events. A PreToolUse hook that exits with code 2 blocks the action and returns its stderr to Claude as feedback.
- Detail: Configure them in the 'hooks' object of .claude/settings.json (project) or ~/.claude/settings.json, and browse with /hooks. Official recipes: (1) auto-format: PostToolUse, matcher 'Edit|Write', command "jq -r '.tool_input.file_path' | xargs npx prettier --write"; (2) protect files: PreToolUse, matcher 'Edit|Write', running "$CLAUDE_PROJECT_DIR"/.claude/hooks/protect-files.sh, which exits 2 with 'Blocked: ...' for .env, package-lock.json or .git/; (3) re-inject context after compaction: SessionStart with matcher 'compact' that echoes reminders; (4) Notification hook for a desktop alert when Claude needs input. Handler types: command, http, mcp_tool, prompt, agent (experimental). A Stop hook can gate the end of a turn on a check (with a cap on consecutive blocks). Claude can write hooks for you: 'Write a hook that runs eslint after every file edit'. Hooks cost zero context unless they return output. Use them for 'actions that must happen every time with zero exceptions'.
- Use: Hooks lesson. Exercise: implement protect-files.sh, test that editing .env is blocked, and read the feedback Claude receives.
- Sources: Automate actions with hooks <https://code.claude.com/docs/en/hooks-guide>; Best practices for Claude Code (Set up hooks) <https://code.claude.com/docs/en/best-practices>

### [practice-30] [Community] A Japanese team's end-to-end flow: plan by default plus a Stop-hook quality gate (verified, medium)
- Claim: A Japanese team blog (ARM techblog, Jun 16 2026) describes a ticket-to-PR flow that makes plan mode the default (`permissions.defaultMode: plan`) and uses a Stop hook to verify that the plan and the code agree, simplify, review and open a draft PR.
- Detail: Flow: create a worktree (git-worktree-runner), have Claude read the ticket through a Backlog MCP, plan in plan mode with a requirements checklist (REQ-1...) and test cases as done criteria, optionally review the plan with another agent, implement, then a Stop hook 'dev-flow-gate.sh' (timeout 180) runs 5 phases: plan-file validation, checklist vs code sync, /simplify, an external review, and /commit + /pr for a draft PR, with hash-based state and a max-retry safety valve. A PreToolUse hook 'skill-guard.sh' blocks direct 'git commit' and 'gh pr' so they go through skills, and 'terraform-guard.sh' blocks terraform apply/destroy. Frontend changes are checked with a /browser-check skill driving playwright-cli. Humans own planning and the final self-review. A similar Zenn post (May 2026) recommends '"permissions": {"defaultMode": "plan"}' and /clear after two failed fixes. Community practice; settings names match the official docs.
- Use: Japanese case study for the capstone lesson that composes plan mode, skills, hooks and verification into a team flow.
- Sources: 2026年6月現在の Claude Code 開発フロー <https://zenn.dev/arm_techblog/articles/7712cde19988c8>; Plan Mode 中心の Claude Code 開発手法 — 計画→実装→検証の4フェーズで AI を味方につける <https://zenn.dev/ino_h/articles/2026-05-01-claude-code-plan-mode-workflow>

### [safety-21] MCP servers and plugins (verified, high)
- Claim: Anthropic reviews connectors against listing criteria for its directory, but "does not security-audit or manage any MCP server". Reviewing `.mcp.json` doesn't show every server a session can load, because user-scope servers, claude.ai connectors and plugins add more.
- Detail: Advice: write your own MCP servers or use ones from trusted providers, and set permissions for MCP tools (e.g. deny `mcp__*`, or allow only `mcp__<server>__*`). Organisations can restrict servers with managed MCP configuration (`managed-mcp.json`, `allowedMcpServers`/`deniedMcpServers`, `allowManagedMcpServersOnly`). Data handled by MCP servers and other third-party integrations is not covered by ZDR. The docs index also has a dedicated page, 'Plugin security and trust'.
- Use: Lesson 4 or 6: a supply-chain discussion (MCP and plugins as trust decisions).
- Sources: Security — MCP security <https://code.claude.com/docs/en/security>; Zero data retention <https://code.claude.com/docs/en/zero-data-retention>

### [practice-14] [Official] CLAUDE.md is advisory; guardrails belong in hooks and permissions (corrected, high)
- Claim: Claim is correct, but the Jun 18, 2026 steering post (Michael Segner) lists FIVE anti-patterns, not seven: (1) 'Every time X, always do Y' in CLAUDE.md, (2) 'Never do this' in CLAUDE.md, (3) a 30-line procedure in CLAUDE.md, (4) an API-specific rule without paths, (5) personal preferences in a project-level CLAUDE.md. The output-style and appended-system-prompt points appear only as cautions in body text ('By default, a custom output style drops all of this'; appending the system prompt 'has diminishing returns for adherence', 'particularly if any contradict').
- Detail: The memory docs say Claude treats CLAUDE.md 'as context, not enforced configuration', and to use a PreToolUse hook to block an action regardless of what Claude decides. The Jun 18 2026 steering post (Michael Segner) lists seven anti-patterns: expecting CLAUDE.md to guarantee automatic actions; relying on it for 'never do this' constraints; a 30-line runbook in CLAUDE.md (use a skill); unscoped rules for area-specific instructions; personal preferences in project files; a custom output style that drops the default engineering instructions; stacking contradictory appended system prompt text. Quotes: 'A real guardrail needs to be deterministic.' 'The model choosing to run a formatter is different from the formatter running automatically.' Features-overview: 'an instruction like "never edit `.env`" in CLAUDE.md or a skill is a request, not a guarantee.'
- Use: Bridge lesson between CLAUDE.md and hooks. Sorting exercise: request (CLAUDE.md/skill) vs guarantee (hook/permission).
- Sources: How Claude remembers your project <https://code.claude.com/docs/en/memory>; Steering Claude Code: when to use CLAUDE.md, skills, hooks, and subagents <https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more>; Extend Claude Code (Hook vs Skill) <https://code.claude.com/docs/en/features-overview>
- Verifier evidence: Memory: 'CLAUDE.md content is delivered as a user message after the system prompt ... there's no guarantee of strict compliance'; 'Claude treats them as context, not enforced configuration. To block an action regardless of what Claude decides, use a PreToolUse hook'. Features overview: 'An instruction like "never edit .env" in CLAUDE.md or a skill is a request, not a guarantee.' Steering post quotes 'A real guardrail needs to be deterministic' and 'The model choosing to run a formatter is different from the formatter running automatically.' <https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more>

### [practice-28] [Official] Plugins, marketplaces and onboarding packs for teams (verified, high)
- Claim: Plugins bundle skills, hooks, subagents, MCP servers and workflows into one installable unit with namespaced skills (/plugin-name:skill), and are how teams share a working setup across repositories.
- Detail: Browse with /plugin. Code intelligence plugins add LSP navigation and type errors after edits, e.g. '/plugin install typescript-lsp@claude-plugins-official'. Enable a plugin for a whole repo with the enabledPlugins project setting. Organizations can host private marketplaces. /team-onboarding generates an onboarding guide from your last 30 days of usage that a teammate can paste as a first message (with a share link on Team/Enterprise). Plugins can be tested with 'claude plugin eval'. Community example (ARM techblog, Jun 2026): a team distributes common skills through an internal marketplace and uses official plugins (superpowers, code-simplifier) plus a Codex review plugin. The large-codebases blog warns that bottom-up adoption 'can fragment without someone to centralize what works'.
- Use: Team-adoption lesson. Exercise: package an existing .claude/ setup (one skill, one hook) as a plugin and install it in a second repo.
- Sources: Extend Claude Code (Plugins) <https://code.claude.com/docs/en/features-overview>; Set up Claude Code in a monorepo or large codebase (code intelligence) <https://code.claude.com/docs/en/large-codebases>; Commands (/team-onboarding) <https://code.claude.com/docs/en/commands>; 2026年6月現在の Claude Code 開発フロー <https://zenn.dev/arm_techblog/articles/7712cde19988c8>

### [releases-20] Claude Mods (verified, high)
- Claim: Claude Mods shipped on 2026-10-01 (v2.1.287): plugins can now include mods, which are JavaScript/TypeScript event handlers that run inside Claude Code and can change how it looks and behaves.
- Detail: A mod can draw panes and bands, restyle built-in UI, guard or rewrite tool calls and prompts, approve or deny permissions, and add `/commands` that run without a Claude turn. Mods install as plugins (`/plugin install <name>@<marketplace>` or `claude plugin install`), then `/reload-plugins`. Built-in examples: `/diff` is now a mod; `sec-default` loads first on Team/Enterprise or managed machines to restrict risky mod actions; 'You should know' (`/plugin enable cc-plugin-you-should-know@builtin`) is a side agent that flags things you or Claude might miss. Mods are NOT sandboxed and run with your permissions. Sample mods live in anthropics/claude-code-playground. Mods run in the CLI, Desktop's Code tab and the VS Code extension. The docs call settings-file hooks 'settings hooks' to tell them apart.
- Use: Advanced extension lesson, after hooks and plugins. Include a strong trust/safety section.
- Sources: Customize Claude Code with mods <https://claude.com/resources/articles/claude-code-mods>; Mods overview <https://code.claude.com/docs/en/plugins/mods/overview>; Claude Code CHANGELOG.md (2.1.287) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

## Missed items (safety)
- Critical paths circuit breaker: rm/rmdir targeting the filesystem root, home directory or working directory is never approved by an allow rule or PreToolUse hook in any mode (denied in dontAsk, still prompts in bypassPermissions); good for a 'why did this still prompt?' lesson. https://code.claude.com/docs/en/permission-modes#critical-paths
- Mods (plugins that run JavaScript inside Claude Code with your permissions) can approve tool calls via tool.check. Without managed settings or a Team/Enterprise login, a mod can even approve a call a deny rule refuses or a PreToolUse hook blocked. v2.1.304 (Oct 19, 2026) added decider: "person" so a mod can force a human approval. https://code.claude.com/docs/en/permissions#precedence-among-rules-hooks-and-mods and https://code.claude.com/docs/en/plugins/mods/overview
- Plugin supply-chain risk: 'A Claude Code plugin you install can execute arbitrary code on your machine with your user privileges'. Plugin hooks, monitors, MCP/LSP servers and mod-started processes run outside the sandbox and outside permission rules, and marketplace auto-update can change files you reviewed. https://code.claude.com/docs/en/plugins/security
- autoMode.classifyAllShell: true suspends every Bash/PowerShell allow rule in auto mode so the classifier sees every shell command (narrow rules like Bash(npm test) otherwise bypass it). https://code.claude.com/docs/en/auto-mode-config
- permissions.blockReadsOutsideWorkingDirectories (v2.1.257+) and auto mode's 'first read outside the working directories' prompt, which can turn the block on for every later session. https://code.claude.com/docs/en/permission-modes#first-read-outside-the-working-directories
- --restricted flag (v2.1.248+) for evaluation harnesses on shared machines: removes command-running tools and WebFetch unless named, confines file tools to working directories, loads only managed settings and --settings, refuses bypassPermissions, and the classifier can't approve protected-path writes. https://code.claude.com/docs/en/cli-reference
- HIPAA configuration (v2.1.285+): eligible sessions start in Manual instead of auto and show 'Auto mode isn't the default for your organization'. HIPAA config vs ZDR as the two BAA paths. https://code.claude.com/docs/en/permission-modes#hipaa-configuration and https://code.claude.com/docs/en/legal-and-compliance
- How auto mode handles subagents: the classifier checks the delegated task at spawn, each subagent action, and the final report (flagged reports arrive with a security warning). Subagent frontmatter permissionMode is ignored. https://code.claude.com/docs/en/permission-modes
- Server-side classifier review: the server reviews actions within the session's own model requests. /status shows an 'Auto mode server' row, and when no verdict arrives the action is denied, not run unreviewed. https://code.claude.com/docs/en/permission-modes#server-side-classifier-review
- Boundaries stated in conversation ('don't push') are a classifier block signal but can be lost to compaction; use deny/ask rules for durable guarantees. CLAUDE.md content is read by the classifier too. https://code.claude.com/docs/en/auto-mode-config
- Auditing auto mode: the PermissionDenied hook captures the exact tool_input of denials. Since v2.1.301 (Oct 15, 2026), OpenTelemetry tool_decision events carry classifier_verdict and permission_mode, plus classifier_category with OTEL_LOG_TOOL_DETAILS=1. https://code.claude.com/docs/en/auto-mode-config#review-denials and https://code.claude.com/docs/en/changelog
- Cross-session messaging (v2.1.224) and its safeguards: the classifier reviews SendMessage content, and isolatePeerMachines / crossSessionInbound hold messages for approval even in bypassPermissions. https://code.claude.com/docs/en/cross-session-messaging and https://code.claude.com/docs/en/whats-new/2026-w32
- Network-path reads (Windows UNC, /net automounts) always prompt (v2.1.292+): allow rules, hook allows and the auto mode classifier can't approve them, because the lookup can leak Windows credentials. https://code.claude.com/docs/en/permissions#network-paths
- Sandbox per-command allowed domains in auto mode: Claude names the hosts on the command, the classifier reviews them together, and the approved list opens those hosts for that command only. https://code.claude.com/docs/en/sandboxing#per-command-allowed-domains-in-auto-mode
- Security plugins: security-guidance (Claude reviews its own changes for vulnerabilities during the session) and claude-security (scan a codebase and turn findings into patches). https://code.claude.com/docs/en/security-guidance and https://code.claude.com/docs/en/claude-security
- Exec wrappers (watch, setsid, flock) and find -exec/-delete can't be auto-approved by prefix rules; redirect targets (v2.1.257+) and tee targets (v2.1.269+) are checked against Edit/Read rules and protected paths. https://code.claude.com/docs/en/permissions
- Week 32 safety changes: worktree isolation now blocks Bash commands and git redirects that reach the main checkout; a repository's checked-in settings can no longer turn on Remote Control auto-connect; Bash commands can't hide parts from permission checks via tab or invisible-Unicode padding. https://code.claude.com/docs/en/whats-new/2026-w32
- Self-hosted environments (public beta on Team/Enterprise, v2.1.224): cloud sessions run on the org's own runners, so isolation, egress control and git credentials become the deployment's responsibility. https://code.claude.com/docs/en/security#cloud-execution-security

## Missed items (docs)
- Feature-selection guide: the official 'Extend Claude Code' page explains when to use CLAUDE.md, skills, subagents, hooks, MCP or plugins. It is the natural backbone for an 'extension decision' lesson. https://code.claude.com/docs/en/features-overview
- Mods: a plugin with a JavaScript/TypeScript hooks module that runs inside Claude Code. It can draw panes and bands, redraw built-in UI, add commands and approve or deny tool calls (`tool.check`). The docs now call settings-file hooks 'settings hooks' to tell them apart. Most of the v2.1.304 changelog is mod work, so this is a current trend. https://code.claude.com/docs/en/plugins/mods/overview
- Artifacts: Claude Code publishes live interactive pages to a private claude.ai URL that you can share. Available on Pro/Max/Team/Enterprise and requires `/login`; `/artifacts` manages them. https://code.claude.com/docs/en/artifacts
- Claude in Chrome integration: browser automation from the CLI or VS Code through the Claude in Chrome extension (v1.0.36+). Works with Chrome, Edge and other Chromium browsers and can test web apps and read console logs. https://code.claude.com/docs/en/chrome
- Channels (research preview): MCP-server plugins that push Telegram, Discord, iMessage, CI or webhook messages into a running session so Claude can react while you're away. Needs Bun and Anthropic auth; not on Bedrock, Agent Platform or Foundry. https://code.claude.com/docs/en/channels
- Advisor tool (experimental, Anthropic API only): `/advisor` pairs the main model with a stronger advisor model that Claude consults before committing to an approach, when stuck, or before finishing. https://code.claude.com/docs/en/advisor
- Prompt caching behavior, which matters for cost lessons. Switching model, and on most models switching effort, mid-task recomputes the whole request. CLAUDE.md edits don't apply mid-session. The page shows how to check the cache hit rate. https://code.claude.com/docs/en/prompt-caching
- `/import [codex|gemini|cursor]`: migrates instruction files, MCP servers, commands, subagents and skills from OpenAI Codex, Gemini CLI or Cursor. This is key for learners switching tools. https://code.claude.com/docs/en/commands
- Auto mode configuration: `autoMode.environment` trusted repos, buckets and domains; overriding the default block and allow rules; the auto-mode CLI subcommands for inspecting the effective config. https://code.claude.com/docs/en/auto-mode-config
- Code intelligence (LSP) plugins: language-server plugins let Claude see type errors after edits and navigate by symbol. This is the prerequisite for the 'Code intelligence' tool category. https://code.claude.com/docs/en/plugins/code-intelligence
- Beginner-oriented official pages useful for a Japanese course: the Terminal guide for first-time terminal users, and the Glossary of core terms (agentic loop, compaction, surface and so on), both translated under /docs/ja/. https://code.claude.com/docs/en/terminal-guide and https://code.claude.com/docs/en/glossary
- Feature availability matrix: which features exist on each plan (Pro/Max/Team/Enterprise), on Console, and on Bedrock/Agent Platform/Foundry/Claude Platform on AWS. Needed so lessons don't promise features a learner's plan lacks. https://code.claude.com/docs/en/feature-availability
- Security and prompt-injection guidance: Claude Code's built-in safeguards (network request approval, trust dialog and others) and best practices. Belongs alongside the permissions and sandbox lessons. https://code.claude.com/docs/en/security
- Session management page: naming sessions, `claude --from-pr <number>` (picker filtered to a PR's sessions), exporting transcripts, and where transcripts are stored. https://code.claude.com/docs/en/sessions
- Slack integration is now the 'earlier version' (Pro/Max only, workspaces not connected to Claude Tag). Team/Enterprise teams use Claude Tag, a shared `@Claude` identity in Slack with admin-configured access. https://code.claude.com/docs/en/slack
- `--bare` 'is the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release'. CI lessons should teach it now. https://code.claude.com/docs/en/headless
- Desktop Code tab extras missing from the surface overview: the iOS Simulator pane, computer use (research preview, Pro/Max, macOS/Windows), side chats, and moving a local session to the cloud from 'Open in'. https://code.claude.com/docs/en/desktop
- `/run-skill-generator` records a per-project run recipe as `.claude/skills/run-<name>/` that `/run` and `/verify` then follow. It makes self-verification reproducible, a core best-practice theme. https://code.claude.com/docs/en/skills
- Managed Code Review update in v2.1.304: Owners pick review levels Quick, Standard (default) or Deep per organization or per repository, and can review every repository in a GitHub org automatically. https://code.claude.com/docs/en/changelog
- MCP quickstart, an end-to-end first-server walkthrough, and the official `mcp-server-dev` plugin that scaffolds a server (`/plugin install mcp-server-dev@claude-plugins-official`). Good hands-on material for the MCP lesson. https://code.claude.com/docs/en/mcp-quickstart