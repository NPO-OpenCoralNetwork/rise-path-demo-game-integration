
# Angle: docs

## Summary
I read the official Claude Code docs at code.claude.com/docs on 2026-10-20. docs.claude.com/en/docs/claude-code/* now redirects there with a 301. I also read the official changelog, which is mirrored at github.com/anthropics/claude-code CHANGELOG.md. The newest release is v2.1.304, dated October 19, 2026.
What has changed since older material: auto mode, where a classifier reviews actions, is now the built-in starting permission mode for interactive terminal and VS Code sessions (v2.1.283+). The mode that asks before every action is now called "Manual"; its config value is still `default`. `claude -p` and Agent SDK runs start in Manual and deny any call that needs approval (v2.1.302+).
Current models on the Anthropic API: the aliases resolve to Opus 5.5, Sonnet 5.5 and Haiku 5.5, and `default` resolves to Opus 5.5 on every subscription plan. Fable 5.1 is the most capable model, but you have to pick it with `/model fable`. Effort levels are low, medium, high, xhigh and max; the 5.5 models default to medium. `ultracode` is a separate setting that makes Claude plan a dynamic workflow for each substantive task.
Claude Code reads AGENTS.md when a project has no CLAUDE.md (v2.1.277+). Custom commands are now part of skills; skills follow the Agent Skills open standard. Subagents run in the background by default, and fork mode, where a subagent inherits the whole conversation, is on by default (`/subtask`).
Ways to run work in parallel: subagents; agent view (`claude agents`, research preview); agent teams (experimental, needs CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1); dynamic workflows (JavaScript scripts that run dozens to hundreds of subagents; `ultracode` keyword; `/deep-research`); and Projects (cloud, public beta on Pro and Max). Worktrees (`--worktree`) and cross-session messaging support these.
Scheduling has three options: `/loop` inside a session, Desktop scheduled tasks, and cloud scheduled tasks (formerly "routines", created with `/schedule`). `/goal` keeps Claude working toward a stated condition.
Ways to reach Claude Code: terminal CLI, VS Code and Cursor extension, JetBrains plugin (needs the CLI installed separately), the Desktop app's Code tab, cloud sessions at claude.ai/code (`claude --cloud`, `--teleport`), Remote Control, and the Code tab of the Claude mobile app. All of them share CLAUDE.md, settings and MCP.
Settings precedence, highest first: managed, then `--settings`, then `.claude/settings.local.json`, then `.claude/settings.json`, then `~/.claude/settings.json`. List settings merge across files. Hooks have about 30 events. Exit code 2 blocks the action; exit code 1 is only a non-blocking error.
MCP has three scopes: local and user (both stored in ~/.claude.json) and project (`.mcp.json`). Tool definitions are deferred through tool search by default.
Context and cost commands: `/context`, `/compact [focus]`, `/clear`, `/autocompact`, `/rewind`. `/cost` is now an alias of `/usage`. The docs give an enterprise average of about $13 per developer per active day.
Some things will date course material quickly: the version numbers, preview-status features (agent view, scheduled tasks, ultrareview, fast mode, Projects), and plan gating (Remote Control and cloud features need a claude.ai login and are not available with API keys or Bedrock, Vertex or Foundry). Japanese translations of every page are at code.claude.com/docs/ja/..., which suits a Japanese course.

### [docs-1] Installation (verified, high)
- Claim: The recommended install is the native installer: `curl -fsSL https://claude.ai/install.sh | bash` on macOS/Linux/WSL, or `irm https://claude.ai/install.ps1 | iex` in Windows PowerShell. Native installs update themselves in the background.
- Detail: Windows CMD: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`.
Alternatives:
- Homebrew: `brew install --cask claude-code` tracks the stable channel, about a week behind; `claude-code@latest` tracks the latest channel.
- `winget install Anthropic.ClaudeCode`.
- apt/dnf/apk.
- npm: `npm install -g @anthropic-ai/claude-code` needs Node.js 22+ and installs the same native binary. Never use sudo.
Homebrew and WinGet installs do not auto-update.
To verify, open a new terminal and run `claude --version`, then `cd your-project && claude`. Login is prompted on first use.
System requirements: macOS 13.0+, Windows 10 1809+, Ubuntu 20.04+, Debian 10+, Alpine 3.19+; 4 GB+ RAM; x64 or ARM64.
The release channel is set with `autoUpdatesChannel` ("latest", the default, or "stable") or under `/config` → Auto-update channel.
On native Windows, Git for Windows is recommended. Without it, Claude Code uses PowerShell as its shell tool.
- Use: Lesson 1 (setup): install per OS, verify with `claude --version`, fix PATH problems; explain stable vs latest channels.
- Sources: Overview <https://code.claude.com/docs/en/overview>; Advanced setup <https://code.claude.com/docs/en/setup>

### [docs-2] Surfaces (corrected, high)
- Claim: The docs do not say 'six places'. The platforms page compares the CLI, Desktop, VS Code, JetBrains, web and mobile, plus integrations (Chrome, Slack, CI/CD, Claude Tag). Every surface uses the same engine, so CLAUDE.md, settings and MCP servers carry over. The overview says the Terminal CLI, VS Code and JetBrains 'also support' third-party providers, but it is not 'only' them: Enterprise Desktop supports Google Cloud's Agent Platform and gateway providers, and 'Claude Desktop on 3P' runs the Code tab on Bedrock/Foundry. `/desktop` (alias `/app`) needs macOS or x64 Windows and a claude.ai subscription. The Desktop app requires a paid subscription.
- Detail: Desktop app:
- Downloads for macOS (universal), Windows x64 and ARM64, and Linux (beta, apt on Ubuntu/Debian).
- Click the **Code** tab. The app includes Claude Code and needs a paid subscription.
- Offers parallel sessions with git isolation, visual diff review, an integrated terminal and editor, app preview, PR monitoring, computer use, Dispatch, and desktop scheduled tasks.

Moving between surfaces:
- `/desktop` (alias `/app`) hands a terminal session to Desktop (macOS and x64 Windows, subscription required).
- `claude --teleport` pulls a cloud session into the terminal.
- Mentioning `@Claude` in Slack routes a bug report into a PR.

Accounts: most surfaces need a Claude subscription or an Anthropic Console account. Only the Terminal CLI, VS Code and JetBrains also support third-party providers (Bedrock, Google Cloud's Agent Platform, Microsoft Foundry).
- Use: Lesson 1 overview map: 'one engine, many windows'. Exercise: pick the right surface for 5 scenarios.
- Sources: Overview <https://code.claude.com/docs/en/overview>; Desktop application <https://code.claude.com/docs/en/desktop>; Platforms and integrations <https://code.claude.com/docs/en/platforms>
- Verifier evidence: overview: 'Each surface connects to the same underlying Claude Code engine, so your repo's CLAUDE.md files, settings, and MCP servers work across all of them'; 'The Terminal CLI, VS Code, and JetBrains also support third-party providers'; 'A paid subscription is required' (Desktop). platforms: 'Enterprise Desktop deployments support Google Cloud's Agent Platform, and Desktop supports gateway providers'. commands: '`/desktop` ... Requires macOS or x64 Windows and a Claude subscription. Alias: `/app`'. <https://code.claude.com/docs/en/platforms>

### [docs-3] IDE extensions (verified, high)
- Claim: The VS Code extension (also installs in Cursor) needs VS Code 1.94.0+ and bundles its own CLI. The JetBrains plugin does not bundle the CLI: it runs `claude` in the IDE terminal, so the CLI must be installed separately.
- Detail: VS Code:
- Lets you review and edit plans, auto-accept edits, @-mention files with line ranges, browse history, and open multiple conversations in tabs or windows.
- Install from Extensions by searching "Claude Code", then Command Palette → "Claude Code: Open in New Tab".
- To run `claude` in the integrated terminal you still need the standalone CLI.
- To make plan mode the starting mode in VS Code, set `claudeCode.initialPermissionMode`.

JetBrains (IntelliJ, PyCharm, Android Studio, WebStorm, PhpStorm, GoLand):
- Quick launch with Cmd+Esc (Mac) or Ctrl+Esc.
- Diffs open in the IDE diff viewer; the current selection is shared automatically.
- Insert file references such as `@src/auth.ts#L1-99` with Cmd+Option+K or Alt+Ctrl+K.
- Claude reads IDE diagnostics through the `getDiagnostics` tool.
- Use: Lesson on IDE workflow: inline diffs, @-mentions with line ranges, plan review in the editor.
- Sources: Use Claude Code in VS Code <https://code.claude.com/docs/en/vs-code>; JetBrains IDEs <https://code.claude.com/docs/en/jetbrains>

### [docs-4] Cloud sessions (Claude Code on the web) (verified, high)
- Claim: `claude --cloud "<task>"` starts a new cloud session on claude.ai. It clones your repository's GitHub remote at the current branch, not your local checkout, so push local commits first. `claude --teleport` (or `/teleport`, `/tp`) pulls a cloud session and its branch into your terminal.
- Detail: Cloud sessions:
- Run on Anthropic-managed VMs or an org's self-hosted environment, and keep running with the laptop closed.
- Available on Pro, Max and Team, and on Enterprise with premium or Chat + Claude Code seats.
- Count toward plan usage limits.
- Each runs in a cloud environment that sets network access, environment variables and setup scripts.
- Can be started from claude.ai/code, the mobile Code tab, Desktop (choose Cloud), the terminal, or scheduled tasks.

Moving work between terminal and cloud:
- Handoff from the CLI is one-way: you can teleport a cloud session in, but you cannot push an existing terminal session to the cloud.
- `--remote` is a deprecated alias of `--cloud`.
- `--teleport` is different from `--resume`, which only lists local history.
- Auto-fix for pull requests is available.
- Use: Lesson on async/cloud work: start a long task in the cloud, check it from your phone, teleport it back.
- Sources: Use Claude Code in the cloud <https://code.claude.com/docs/en/claude-code-on-the-web>

### [docs-5] Remote Control and mobile (verified, high)
- Claim: Remote Control lets claude.ai/code or the Claude iOS/Android app steer a Claude Code session that keeps running on your own machine. There is no separate mobile app: cloud sessions and Remote Control both live in the **Code** tab of the Claude app.
- Detail: How to start it:
- `claude remote-control` runs a server with no local interactive session.
- `claude --remote-control` (or `--rc`) starts an interactive session with Remote Control on.
- `/remote-control` (or `/rc`) turns it on inside a running session.

Requirements:
- A Pro, Max, Team or Enterprise plan. On Team and Enterprise, an Owner must enable it.
- API keys are not supported.
- Not available on Bedrock, Vertex or Foundry, or with a non-Anthropic `ANTHROPIC_BASE_URL`.

While connected:
- Files, MCP servers and tools stay local.
- Subagent and workflow progress syncs to every device.
- The machine has to stay on.

Mobile:
- From the phone you can use cloud sessions, Projects, Remote Control, and Dispatch (Desktop, Pro/Max only).
- `/mobile` shows a QR code for claude.ai/mobile.
- Use: Lesson on 'work from anywhere': when to choose cloud vs Remote Control vs Dispatch.
- Sources: Continue local sessions from any device with Remote Control <https://code.claude.com/docs/en/remote-control>; Claude Code on mobile <https://code.claude.com/docs/en/mobile>

### [docs-6] Agentic loop (verified, high)
- Claim: Claude Code works in a loop of three blended phases: gather context, take action, verify results. The loop is powered by a model that reasons and tools that act. The docs call the layer around the model the 'agentic harness'.
- Detail: Built-in tool categories:
- File operations
- Search
- Execution (shell, git, tests)
- Web
- Code intelligence (needs code-intelligence plugins)

There are also orchestration tools: Agent (subagents), AskUserQuestion, Skill, TaskCreate/TaskUpdate, Monitor, EnterWorktree, Workflow, and others.

Example: 'fix the failing tests' becomes run tests → read errors → search → read files → edit → rerun.

You are part of the loop:
- `Esc` stops Claude immediately.
- Typing a correction and pressing Enter queues it; Claude reads it after its current tool calls, within the same turn.
- 'Delegate, don't dictate': give context and the goal, not individual file paths.

On startup Claude has access to your project files, terminal, git state, CLAUDE.md/AGENTS.md, auto memory, and any extensions you configured.
- Use: Foundational concept lesson; exercise: label each step of a sample transcript as gather/act/verify.
- Sources: How Claude Code works <https://code.claude.com/docs/en/how-claude-code-works>; Tools reference <https://code.claude.com/docs/en/tools-reference>

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

### [docs-8] Models and /model (corrected, high)
- Claim: Same as claimed, with one precision fix: `default` appears in the alias table but the docs call it a 'special value that clears any model override and reverts to the runtime default for your account. Not itself a model alias.' `best` resolves to what `fable` resolves to where Fable is available, otherwise to the same model as `opus`. Bedrock and Google Cloud's Agent Platform resolve `sonnet` to Sonnet 4.5 and `haiku` to Haiku 4.5. Microsoft Foundry resolves `opus` to Opus 4.6 and defaults to Sonnet 4.5.
- Detail: Where to set the model, highest priority first:
1. `/model <alias|name>` in a session.
2. `claude --model <alias|name>`.
3. The `ANTHROPIC_MODEL` environment variable.
4. The `model` key in settings.
5. `ANTHROPIC_DEFAULT_MODEL`.

In the `/model` picker, Enter switches and saves the model as your default; `s` switches for this session only. Left and right arrows adjust effort.

Other aliases:
- `opusplan` uses Opus in plan mode and Sonnet for execution.
- `best` resolves to Fable where it is available, otherwise to Opus.
- Fable 5.1 (`/model fable`) is never the default on any plan. It suits long autonomous tasks; on some plans it bills to usage credits, with a consent prompt first.

Aliases resolve to older models on some providers. For example, on Bedrock and Vertex, `sonnet` resolves to Sonnet 4.5. Pin a version with a full ID such as `claude-opus-5-5`. A `/model` switch also applies to subagents that inherit the session model.
- Use: Lesson on choosing a model; exercise: when to use haiku for subagents, opusplan for planning, fable for long autonomous work.
- Sources: Model configuration <https://code.claude.com/docs/en/model-config>
- Verifier evidence: model-config alias table verbatim; provider table: 'Anthropic API | Opus 5.5 | Sonnet 5.5 | Haiku 5.5'; '`default` model setting... Pro, Max, Team, Enterprise, and Anthropic API: defaults to Opus 5.5'; priority list 1–5 matches; '`Enter`: switch model and save as your default; `s`: switch model for this session only'; 'use left/right arrow keys to adjust the effort slider'; 'Neither Fable model is the account-type default on any plan or provider'. <https://code.claude.com/docs/en/model-config>

### [docs-9] Current model lineup (changelog) (corrected, high)
- Claim: All versions, dates and base prices are confirmed. Haiku 5.5 has a second price tier: $0.10/$0.50 per MTok, and $0.50/$2.50 for prompts over 100K tokens. Cache reads: Opus 5.5 $0.20/MTok, Fable 5.1 $0.25/MTok. Sonnet 5.5 cache reads were later repriced from $0.20 to $0.10/MTok in the changelog.
- Detail: Minimum versions: Sonnet 5.5 needs v2.1.284+, Opus 5.5 needs v2.1.280+, Haiku 5.5 needs v2.1.293+, Fable 5.1 needs v2.1.257+. Run `claude update` to upgrade.

The weekly digest also records:
- Opus 5 (Week 30, July 20–24, 2026).
- Sonnet 5 (Week 27).
- Opus 4.8 (Week 22).
- Opus 4.7 (Week 16).

The latest CLI release seen was v2.1.304 on October 19, 2026.
- Use: Reference sidebar; teach learners to check `claude --version` and the changelog rather than memorize model names.
- Sources: Claude Code CHANGELOG.md <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>; Claude Code changelog <https://code.claude.com/docs/en/changelog>; What's new <https://code.claude.com/docs/en/whats-new>
- Verifier evidence: docs changelog: 2.1.280 Sep 22 'Added Claude Opus 5.5 (`claude-opus-5-5`), now the default Opus model — 1M context, $4/$20'; 2.1.284 Sep 28 'Added Claude Sonnet 5.5... $2/$10'; 2.1.293 Oct 7 'Added Claude Haiku 5.5... $0.10/$0.50 per Mtok ($0.50/$2.50 for prompts over 100K)'; 2.1.257 Sep 1 'Added Claude Fable 5.1... $10/$50'; top entry '2.1.304 October 19, 2026'. whats-new lists Week 30 Opus 5, Week 27 Sonnet 5, Week 22 Opus 4.8, Week 16 Opus 4.7. <https://code.claude.com/docs/en/changelog>

### [docs-10] Effort levels, ultrathink, fast mode (verified, high)
- Claim: Effort levels are `low`, `medium`, `high`, `xhigh` and `max`. Opus 5.5, Sonnet 5.5 and Haiku 5.5 default to `medium`; most other supported models default to `high`, and Opus 4.7 defaults to `xhigh`.
- Detail: Ways to set effort:
- `/effort` opens a slider; `/effort <level>` sets it directly; `/effort auto` clears your saved level; `/effort status` shows the current one.
- `claude --effort <level>`.
- The `CLAUDE_CODE_EFFORT_LEVEL` environment variable.
- Settings: `effortLevel`, or per-model `modelSettings`.
- `effort` frontmatter in a skill or subagent.

`max` applies to the current session only, unless it is set through the environment variable.

Ultrathink and ultracode:
- The keyword `ultrathink` anywhere in a prompt asks for deeper reasoning on that one turn. Phrases like 'think hard' are passed through as ordinary text, not keywords.
- `ultracode` is not an effort level. It is a toggle that makes Claude plan a dynamic workflow for each substantive task.

Fast mode (research preview):
- `/fast` makes Opus up to 2.5x faster at a higher per-token price: $8/$40 per MTok on Opus 5.5.
- Supported on Opus 5.5, Opus 5 and Opus 4.8.
- On subscription plans it bills to usage credits only.
- Use: Lesson on speed/cost/quality trade-offs; exercise: choose an effort level for 4 task types.
- Sources: Model configuration <https://code.claude.com/docs/en/model-config>; Speed up responses with fast mode <https://code.claude.com/docs/en/fast-mode>

### [docs-11] Permission modes (verified, high)
- Claim: There are six permission modes:
- `default`, shown in the UI as **Manual** and also accepted as `manual`: only reads run without asking.
- `acceptEdits`: file edits and common filesystem commands such as mkdir, touch, mv, cp and sed run without asking.
- `plan`: Claude researches and proposes, without editing.
- `auto`: a classifier reviews actions in the background.
- `dontAsk`: only pre-approved tools run; anything else is denied.
- `bypassPermissions`: everything runs.
- Detail: In the CLI, `Shift+Tab` cycles the modes. Starting from auto: Manual → acceptEdits → plan → auto.

Not every mode is in the cycle:
- `bypassPermissions` appears only if the session started with it (for example `--dangerously-skip-permissions`) or with `--allow-dangerously-skip-permissions`.
- `dontAsk` never appears in the cycle; set it with `--permission-mode dontAsk`.

The status bar shows the active mode: `⏸ manual mode on`, `⏵⏵ accept edits on`, `⏸ plan mode on`, `⏵⏵ auto mode on`.

To set a mode:
- At start: `claude --permission-mode <mode>`.
- As a default: `permissions.defaultMode` in settings. `auto` and `bypassPermissions` do not take effect from project or local settings files.

Rules that apply in every mode:
- Deny rules block even in `bypassPermissions`.
- Explicit ask rules, AskUserQuestion, and `rm` of critical paths are never auto-approved.
- Use: Core safety lesson; exercise: map 6 scenarios (sensitive repo, CI, container, exploration...) to a mode.
- Sources: Choose a permission mode <https://code.claude.com/docs/en/permission-modes>

### [docs-12] Auto mode default and -p behavior (corrected, high)
- Claim: Everything is confirmed except the version of `/auto-mode-setup`. That command has existed since v2.1.228 (v2.1.233 on native Windows) and needs a Pro, Max or Team plan. v2.1.304 extended it to Bedrock, Vertex, Foundry, the Claude apps gateway and telemetry-disabled sessions. The command drafts `autoMode.environment` entries.
- Detail: Auto mode:
- A separate classifier model reviews actions and blocks anything that escalates beyond your request, targets unrecognized infrastructure, or seems driven by hostile content.
- Blocked by default: `curl | bash`, sending sensitive data out, production deploys, force push, `git reset --hard`, `git clean -fd`, IAM changes, and mass deletion.
- If it blocks 3 actions in a row or 20 in total, it pauses and Claude Code goes back to prompting. These thresholds are not configurable.
- Blocked actions appear under `/permissions` → **Recently denied**; press `r` to retry with a manual approval.
- Supported models on the Anthropic API: Opus 4.6+, Sonnet 4.6+, Haiku 5.5, and Fable.
- Admins can remove it with `permissions.disableAutoMode: "disable"`.
- The docs warn that auto mode reduces prompts but does not guarantee safety.

For headless runs, either add allow rules (`--allowedTools`) or pass `--permission-mode auto`. `/auto-mode-setup` (v2.1.304) teaches the classifier about your environment.
- Use: Lesson on autonomy vs oversight; contrast interactive defaults with CI defaults; misconception check: 'auto mode = safe'.
- Sources: Choose a permission mode <https://code.claude.com/docs/en/permission-modes>; Claude Code changelog <https://code.claude.com/docs/en/changelog>
- Verifier evidence: permission-modes: 'With Claude Code v2.1.283 or later, auto mode is the built-in starting permission mode for interactive terminal and VS Code sessions'; 'In Claude Code v2.1.302 or later, `claude -p` and Agent SDK runs with no permission mode set start in Manual mode'; the blocked-by-default list; 'The thresholds of 3 blocks in a row and 20 blocks total are not configurable'; 'press `r` to retry it with a manual approval'; 'Auto mode reduces permission prompts but does not guarantee safety'. commands: '`/auto-mode-setup` ... Requires a Pro, Max, or Team plan and Claude Code v2.1.228 or later'. changelog 2.1.304: '...now also available on Bedrock, Vertex, Foundry, Claude apps gateway and telemetry-disabled sessions'. settings-reference: `disableAutoMode` is 'Also accepted under `permissions`'. <https://code.claude.com/docs/en/permission-modes>

### [docs-13] Plan mode (verified, high)
- Claim: In plan mode Claude reads files, explores and writes a plan without editing your source. Edits stay blocked until you approve the plan. Enter it with `Shift+Tab`, by starting a prompt with `/plan`, or with `claude --permission-mode plan`.
- Detail: Approval options when the plan is ready:
- 'Yes, and use auto mode' (or 'Yes, auto-accept edits' where auto mode is unavailable).
- 'Yes, manually approve edits'.
- 'No, keep planning'.

Other controls:
- `Ctrl+G` opens the plan in your editor so you can change it directly.
- Commands run during planning go through the classifier when auto mode is available and `useAutoModeDuringPlan` is on, which is the default.
- The plan is re-injected after compaction.

Best-practice workflow: Explore (plan mode) → Plan → Implement → Commit.

Skip planning when the diff can be described in one sentence.
- Use: Hands-on lesson: explore-plan-implement-commit loop on a small repo; edit a plan with Ctrl+G.
- Sources: Choose a permission mode <https://code.claude.com/docs/en/permission-modes>; Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>

### [docs-14] bypassPermissions and dontAsk (corrected, high)
- Claim: In `bypassPermissions`, writes to protected paths ARE auto-approved. The mode 'disables permission prompts and safety checks so tool calls execute immediately, including writes to protected paths.' What still prompts: explicit ask rules, AskUserQuestion and interaction-required MCP tools, `rm`/`rmdir` of critical paths, and the cross-session messaging safeguards. Claude Code refuses to start in bypass mode as root or under sudo on Linux/macOS, except inside a recognized sandbox. The rest of the claim is correct.
- Detail: A CI example from the docs: `claude -p "run the test suite" --permission-mode dontAsk --allowedTools "Bash(npm test)" "Read"`.

In `bypassPermissions`:
- Allow rules have no effect.
- Deny rules still apply.
- Writes to protected paths are not auto-approved.
- `rm` of critical paths still prompts.

Cloud sessions ignore `dontAsk` and `bypassPermissions` when they come from settings files.
- Use: Security lesson: why 'YOLO mode' belongs in a sandbox; exercise building a CI allowlist.
- Sources: Choose a permission mode <https://code.claude.com/docs/en/permission-modes>
- Verifier evidence: permission-modes: '`bypassPermissions` mode disables permission prompts and safety checks so tool calls execute immediately, including writes to protected paths'; 'Writes to protected paths are never auto-approved except in `bypassPermissions` mode'; CI example `claude -p "run the test suite" --permission-mode dontAsk --allowedTools "Bash(npm test)" "Read"` verbatim; 'Allow rules have no effect in `bypassPermissions`'; '--dangerously-skip-permissions cannot be used with root/sudo privileges'; 'Cloud sessions don't honor `defaultMode: "bypassPermissions"` or `"dontAsk"` from your settings files'. <https://code.claude.com/docs/en/permission-modes>

### [docs-15] Permission rules (verified, high)
- Claim: Permission rules are `allow`, `ask` or `deny`, written as `Tool` or `Tool(specifier)`, and evaluated in the order deny → ask → allow. The first match wins, and a narrower allow cannot carve an exception out of a broader deny.
- Detail: Examples:
- `Bash(npm run *)`
- `Bash(git commit *)`
- `Read(./.env)`
- `WebFetch(domain:example.com)`
- `mcp__*`
- Deny or ask rules can match parameters, as in `Agent(model:opus)`.

Wildcards:
- Put the `*` after the subcommand: `Bash(git log *)` allows only git log, while `Bash(git *)` allows every git command.
- `Bash(ls *)` does not match `lsof`.

Managing rules:
- Use `/permissions`, or `permissions.allow`/`ask`/`deny` in settings.json.
- Choosing 'Yes, and don't ask again' on a prompt saves the rule to `.claude/settings.local.json`.

Rules are enforced by Claude Code, not by the model. Instructions in CLAUDE.md do not change what is allowed.
- Use: Exercise: write a settings.json allowing npm scripts and commits but denying git push; explain why it still prompts for `git -C . push`.
- Sources: Configure permissions <https://code.claude.com/docs/en/permissions>

### [docs-16] Workspace trust (verified, high)
- Claim: `permissions.allow` rules in a project's `.claude/settings.json` apply only after you accept the workspace trust dialog. `claude -p` and SDK runs never show that dialog, yet they still run the project's settings hooks and connect its `.mcp.json` servers without asking.
- Detail: Before running `claude -p` in a repository you did not write:
- Pass `--setting-sources user` so project settings and `.mcp.json` are not read.
- Or start with `--bare`.
- Or pass `--settings '{"disableAllHooks": true}'`.
- Or reject a specific server with `disabledMcpjsonServers`.

In interactive sessions, project MCP servers from `.mcp.json` need approval. Reset those choices with `claude mcp reset-project-choices`.
- Use: Security lesson on untrusted repos and prompt-injection surface; checklist exercise.
- Sources: Configure permissions <https://code.claude.com/docs/en/permissions>; Connect Claude Code to tools via MCP <https://code.claude.com/docs/en/mcp>

### [docs-17] Checkpoints and /rewind (verified, high)
- Claim: Claude Code takes a checkpoint of your code before each prompt that starts a turn and keeps snapshots for the 100 most recent checkpoints. Press `Esc` twice on an empty prompt, or run `/rewind` (aliases `/checkpoint`, `/undo`), to open the rewind menu.
- Detail: Rewind options:
- Restore code and conversation
- Restore conversation
- Restore code
- Summarize from here
- Summarize up to here
- Never mind

Checkpoints survive `/resume`. The retention sweep deletes snapshots about 30 days after the session last saved one (setting: `cleanupPeriodDays`).

Limitations:
- Files changed by Bash commands (rm, mv, cp) are not tracked.
- Edits by background subagents are not restored.
- External edits are not tracked.
- Symlinked and hard-linked files are skipped.
- Remote side effects (databases, APIs, deploys) cannot be undone.

Checkpoints do not replace git. If you ran `/clear`, the rewind menu can restore the earlier conversation.
- Use: Practice lesson: make a bad change, rewind code only vs conversation only; quiz on what is NOT restorable.
- Sources: Checkpointing <https://code.claude.com/docs/en/checkpointing>

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

### [docs-23] Slash commands (verified, high)
- Claim: Built-in commands include `/init`, `/memory`, `/context`, `/compact`, `/clear`, `/model`, `/effort`, `/permissions`, `/rewind`, `/resume`, `/mcp`, `/plugin`, `/hooks`, `/config`, `/usage`, `/plan`, `/goal`, `/loop`, `/schedule`, `/tasks`, `/btw` and `/statusline`. `/cost` and `/stats` are now aliases of `/usage`.
- Detail: Bundled skills, which are prompt-based rather than fixed logic:
- `/doctor`: setup checkup that can apply fixes.
- `/code-review`, alias `/review`.
- `/batch`: splits a large change into 5–30 worktree-isolated subagents.
- `/debug`, `/loop`, `/claude-api`, `/run`, `/verify`, `/simplify`.

Changes from older material:
- `/agents` only prints a reminder now (v2.1.198+); you create subagents by asking Claude or by editing `.claude/agents/`.
- `/ultraplan` was removed.

Other useful commands:
- `/btw`: a side question that is not added to the conversation.
- `/add-dir`, `/cd`, `/diff`, `/export`, `/insights`.

Input prefixes:
- `/` runs a command or skill.
- `!` runs a shell command directly and adds its output to context.
- `@` mentions a file.
- Use: Cheat-sheet/flashcards; exercise: pick the right command for 8 situations.
- Sources: Commands <https://code.claude.com/docs/en/commands>; Interactive mode <https://code.claude.com/docs/en/interactive-mode>

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

### [docs-32] Output styles and status line (verified, high)
- Claim: Besides Default there are four built-in output styles: Proactive, Concise, Explanatory and Learning. Switch with `/output-style [style]`. The status line is a shell command, set as `statusLine` in settings or generated with `/statusline <description>`, that receives session JSON on stdin.
- Detail: Built-in styles:
- Explanatory adds `★ Insight` blocks.
- Learning also leaves `TODO(human)` spots for you to write the code yourself.
- Concise leads with the result.

Custom styles:
- Markdown files in `~/.claude/output-styles` or `.claude/output-styles`.
- Set `keep-coding-instructions: true` to keep Claude's coding behavior.

Status line example: `{"statusLine":{"type":"command","command":"~/.claude/statusline.sh","padding":2}}`. It can show model, context %, cost and git branch.

An output style is an instruction to Claude, not a guarantee.
- Use: Learning style is directly useful for the course (learner writes the TODO(human) parts); statusline exercise to watch context %.
- Sources: Output styles <https://code.claude.com/docs/en/output-styles>; Customize your status line <https://code.claude.com/docs/en/statusline>

### [docs-33] settings.json hierarchy (verified, high)
- Claim: Settings precedence, highest first:
1. Managed (`managed-settings.json`, MDM, or server-managed from the claude.ai console)
2. Command line (`claude --settings <file-or-json>`)
3. Project local (`.claude/settings.local.json`)
4. Shared project (`.claude/settings.json`)
5. User (`~/.claude/settings.json`)
- Detail: List keys such as `permissions.allow` merge across files instead of overriding.

Environment variables are not a level in this stack; each variable/key pair has its own rule.

`~/.claude.json` is a separate file Claude Code writes for itself: login, MCP configs, trust decisions.

Claude Code adds `.claude/settings.local.json` to your global git excludes when it creates the file.

Ways to change settings:
- `/config`
- `/config key=value`, which also works in `-p`

Cloud sessions do not read your local `~/.claude/settings.json`; only server-managed settings reach them.
- Use: Diagram + exercise: decide which file a team rule, a personal preference, and a secret-free env var go in.
- Sources: Settings files and precedence <https://code.claude.com/docs/en/settings>

### [docs-34] Sandboxing (verified, high)
- Claim: The Bash sandbox is an OS-enforced boundary on the files and network hosts that shell commands (Bash, PowerShell, Monitor) can reach. It is off by default; turn it on with `/sandbox` or `sandbox.enabled: true`. It runs on macOS (Seatbelt), Linux and WSL2 (bubblewrap + socat), but not native Windows.
- Detail: Default limits while sandboxed:
- Writes go only to the working directory, a temp directory, and added directories.
- The network goes through a proxy whose allowed-domains list starts empty.

What the sandbox does not cover:
- Built-in Read/Edit/WebFetch tools follow permission rules instead.
- Hooks, MCP servers and the status line run with full access.

Modes:
- Auto-allow mode runs sandboxed commands without prompting.
- Claude can ask to retry a command unsandboxed; strict mode turns that retry off.

It is built on `@anthropic-ai/sandbox-runtime`.

For full isolation, run Claude Code itself in a container or VM.
- Use: Security lesson: layering sandbox + permission mode + container; exercise enabling /sandbox auto-allow.
- Sources: Configure the sandboxed Bash tool <https://code.claude.com/docs/en/sandboxing>

### [docs-35] Headless mode (verified, high)
- Claim: `claude -p "<prompt>"` (or `--print`) runs non-interactively and exits with 0 on success. `--output-format` can be `text` (default), `json` (result, session_id and metadata) or `stream-json`. Combining `--output-format json` with `--json-schema '<schema>'` returns the validated result in `structured_output`.
- Detail: Useful flags:
- `--allowedTools "Read,Edit,Bash"`
- `--permission-mode`
- `--max-turns`, `--max-budget-usd` (print mode only)
- `--continue` / `--resume <session_id>`
- `--append-system-prompt`
- `--mcp-config`

`--bare` skips discovery of hooks, skills, subagents, plugins, MCP, auto memory and CLAUDE.md for reproducible CI runs. It does not use your subscription login, so `ANTHROPIC_API_KEY` must be set.

For live output: `--output-format stream-json --verbose --include-partial-messages`.

Piping works too, e.g. `git diff main --name-only | claude -p "review these changed files..."`.
- Use: Lesson 'Claude in scripts': pipe logs, extract JSON with jq, chain --resume.
- Sources: Run Claude Code programmatically <https://code.claude.com/docs/en/headless>; CLI reference <https://code.claude.com/docs/en/cli-reference>

### [docs-36] Agent SDK (verified, high)
- Claim: The Claude Agent SDK gives you Claude Code's own tools, agent loop and context management as a library. It ships for TypeScript as `npm install @anthropic-ai/claude-agent-sdk` and for Python as `pip install claude-agent-sdk` or `uv add claude-agent-sdk`, both used through `query()`.
- Detail: Capabilities: built-in tools, hooks, subagents, MCP, permissions, sessions, skills/commands/memory loaded from `.claude/`, and plugins.

How it compares:
- The CLI is for interactive use.
- The Client SDK calls the Claude API directly.
- Managed Agents is an agent harness Anthropic hosts.

Terms:
- Third-party developers may not offer claude.ai login or rate limits unless previously approved; use API keys.
- Branding must not call your product 'Claude Code'.
- Since v2.1.302, SDK runs with no permission mode set start in `default` (Manual).
- Use: Capstone/advanced lesson: build a minimal bug-fixing agent; compare SDK vs `claude -p` vs Managed Agents.
- Sources: Agent SDK overview <https://code.claude.com/docs/en/agent-sdk/overview>; Agent SDK quickstart <https://code.claude.com/docs/en/agent-sdk/quickstart>

### [docs-37] GitHub Actions (verified, high)
- Claim: Claude Code GitHub Actions uses `anthropics/claude-code-action@v1`. The quick setup is `/install-github-app`, which installs the Claude GitHub App, stores a secret (`ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN` generated with `claude setup-token`), and opens a workflow PR. It works only for github.com repositories.
- Detail: Two modes:
- Interactive: no `prompt` input; Claude responds to `@claude` in an issue or PR comment.
- Automation: a `prompt` input runs on any event; results go to the run log by default.

Common inputs:
- `prompt`, `claude_args` (e.g. `--max-turns 5 --model ... --allowedTools`)
- `anthropic_api_key` / `claude_code_oauth_token`
- `trigger_phrase`, `settings`, `plugins`
- `use_bedrock`, `use_vertex`, `use_foundry`

The example workflow needs permissions `contents/pull-requests/issues: write`, `id-token: write` and `actions: read`.

Safety checks: only users with write access can trigger runs, and bot actors are rejected unless listed in `allowed_bots`.

Organizations can use OIDC workload identity federation instead of a stored secret.

Related products: managed Code Review (Team/Enterprise) and GitLab CI/CD.
- Use: Team-automation lesson: set up @claude on a sandbox repo; write a review workflow.
- Sources: Claude Code GitHub Actions <https://code.claude.com/docs/en/github-actions>

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

### [docs-39] Costs and usage (verified, high)
- Claim: `/usage` (aliases `/cost` and `/stats`) shows session cost, plan usage limits and activity stats. Pro, Max, Team and Enterprise plans also get a breakdown of usage by skill, subagent, plugin and MCP server. Across enterprise deployments the docs give an average of about $13 per developer per active day and $150–250 per developer per month.
- Detail: The docs also say 90% of users stay below $30 per active day.

The Session block's dollar figure is computed locally from list prices. It matters for API users; subscription usage is covered by the plan.

`/insights` writes an HTML report on your usage patterns.

Ways to reduce tokens:
- `/clear` between tasks.
- Compact with focus instructions.
- Use Sonnet or Haiku where possible, and `model: haiku` for simple subagents.
- Reduce MCP overhead.
- Move CLAUDE.md procedures into skills.
- Delegate verbose work to subagents.
- Write specific prompts.

Running many sessions or agent teams multiplies usage. The `--max-budget-usd` flag caps a `-p` run.
- Use: Lesson on cost awareness; exercise reading /usage and choosing optimizations.
- Sources: Manage costs effectively <https://code.claude.com/docs/en/costs>; Commands <https://code.claude.com/docs/en/commands>

### [docs-40] Background tasks and agent view (verified, high)
- Claim: `Ctrl+B` moves a running Bash command into the background; tmux users press it twice. `/tasks` lists and manages background work. Whole sessions can run as background agents with `claude --bg` or `/background` (`/bg`), and `claude agents` opens agent view (research preview) to dispatch and watch them.
- Detail: Background Bash:
- Output goes to a file Claude can read.
- A command that hits its timeout moves to the background instead of being killed.
- `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` turns the feature off.
- `!` shell mode runs your command and Claude responds to its output.

Agent view:
- Each prompt you type starts a new background session.
- Space peeks at a session; Enter or → attaches; ← on an empty prompt detaches.
- From the shell: `claude attach`, `claude logs`, `claude stop`, `claude respawn`, `claude rm`.
- Each session uses quota independently.
- `/agents` (in-session) is unrelated to `claude agents`.
- Use: Lesson on parallel personal work: run dev server in background, dispatch two tasks in agent view.
- Sources: Interactive mode <https://code.claude.com/docs/en/interactive-mode>; Manage multiple agents with agent view <https://code.claude.com/docs/en/agent-view>; CLI reference <https://code.claude.com/docs/en/cli-reference>

### [docs-41] Worktrees (verified, high)
- Claim: `claude --worktree <name>` (`-w`) creates an isolated git worktree at `<repo>/.claude/worktrees/<name>/` on a new branch `worktree-<name>` and starts Claude in it. You can also ask Claude to 'work in a worktree', and it uses the `EnterWorktree` tool.
- Detail: Setup:
- Add `.claude/worktrees/` to `.gitignore`.
- A `.worktreeinclude` file copies gitignored files such as `.env` into new worktrees.
- Interactive runs require workspace trust.

On exit:
- A clean unnamed worktree is removed automatically.
- A worktree with changes prompts you to keep or remove it; resume with `claude --worktree <name> --resume`.
- `-p` runs do not clean up.

Subagents can use `isolation: worktree`.

A worktree accepts a PR number (`#123`), a PR URL, or a GitLab MR URL.

Subagents and sessions can each get their own worktree, but agent teams do not.
- Use: Lesson on running two features in parallel without collisions.
- Sources: Run parallel sessions with worktrees <https://code.claude.com/docs/en/worktrees>

### [docs-42] Scheduled tasks, /loop and /goal (verified, high)
- Claim: There are three ways to schedule work:
- Cloud scheduled tasks (formerly 'routines', research preview): run in the cloud with your machine off, can be triggered by schedule, API or GitHub events, minimum interval 1 hour.
- Desktop scheduled tasks: run on your machine with local file access, minimum 1 minute.
- `/loop [interval] [prompt]`: session-scoped, minimum 1 minute.
- Detail: Cloud scheduled tasks:
- Create them at claude.ai/code/routines, in Desktop, or with `/schedule` (alias `/routines`).
- Available on Pro, Max, Team and Enterprise.
- They run autonomously with no permission prompts; what they can reach depends on the repositories, environment and connectors you choose.

`/loop`:
- `/loop 5m check the deploy` runs on a fixed interval.
- Omitting the interval lets Claude self-pace.
- Tasks expire after 7 days.

`/goal <condition>`:
- Keeps Claude working turn after turn; a separate model checks the condition after each turn.
- Clear it with `/goal clear`.
- Pair it with auto mode to run unattended.

When the condition should be checked by a script instead, use a Stop hook.
- Use: Lesson on automation: choose cloud vs desktop vs /loop vs /goal; write a measurable goal condition.
- Sources: Run prompts on a schedule <https://code.claude.com/docs/en/scheduled-tasks>; Automate work with scheduled tasks <https://code.claude.com/docs/en/routines>; Keep Claude working toward a goal <https://code.claude.com/docs/en/goal>

### [docs-43] Multi-agent approaches (corrected, high)
- Claim: The five approaches and how each coordinates work are confirmed. Cross-session messaging is not limited to macOS/Linux. It requires v2.1.224+ on macOS/Linux (including WSL 2) and v2.1.234+ on native Windows, and it is on by default once those requirements are met. It reaches your sessions on this machine, on other machines, and in the cloud. `@` session mentions require v2.1.232+.
- Detail: How to choose, by who coordinates the work:
- Subagents: Claude coordinates within one turn.
- Agent view: you dispatch and check back.
- Agent teams: a lead session supervises teammates who message each other and share a task list.
- Workflows: a script holds the plan.
- Projects: Claude coordinates cloud threads over days.

Costs and caveats:
- Agent teams use significantly more tokens, and teammates are not isolated in worktrees, so give each one separate files.
- Cross-session messaging lets your own sessions pass findings to each other (macOS/Linux; `@` mentions other sessions).
- Every approach multiplies token usage.
- Use: Advanced chapter overview; decision-tree exercise.
- Sources: Run agents in parallel <https://code.claude.com/docs/en/agents>; Orchestrate teams of Claude Code sessions <https://code.claude.com/docs/en/agent-teams>; Let Claude coordinate ongoing work with Projects <https://code.claude.com/docs/en/claude-projects>
- Verifier evidence: agents: 'Claude Code has five ways to work on several tasks at once: subagents, agent view, agent teams, dynamic workflows, and projects'; 'Experimental and disabled by default'; 'Public beta on Pro and Max'; 'Cross-session messaging lets Claude list and message your other Claude Code sessions on this machine, on another machine, or in the cloud'. cross-session-messaging: 'requires Claude Code v2.1.224 or later on macOS and Linux, including Linux inside WSL 2. On native Windows, it requires Claude Code v2.1.234 or later'. agent-teams: 'use significantly more tokens'. <https://code.claude.com/docs/en/agents>

### [docs-44] Dynamic workflows (verified, high)
- Claim: A dynamic workflow is a JavaScript script that Claude writes and a runtime runs in the background, orchestrating dozens to hundreds of subagents. You trigger one with the keyword `ultracode` in a prompt you type, by asking for 'a workflow', or with `/effort ultracode`. The bundled workflow is `/deep-research`, and `/workflows` shows progress.
- Detail: Availability: all paid plans, the Anthropic API, Bedrock, Vertex and Foundry. On Pro, turn it on in `/config`.

Why the plan moves into code: intermediate results live in script variables, a run is resumable, and runs can be saved as commands for reuse.

Script functions, per the Anthropic engineering post:
- `agent(prompt, opts)`
- `parallel()`
- `pipeline()`

The post names six patterns:
- classify-and-act
- fan-out-and-synthesize
- adversarial verification
- generate-and-filter
- tournament
- loop until done

It also warns that workflows use more tokens and are best for complex, high-value tasks.

The `ultracode` keyword does not trigger from `-p` prompts, scheduled tasks or relayed webhook payloads.
- Use: Advanced lesson: run /deep-research, then an ultracode audit; discuss when NOT to use workflows.
- Sources: Orchestrate subagents at scale with dynamic workflows <https://code.claude.com/docs/en/workflows>; A harness for every task: dynamic workflows in Claude Code <https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/>

### [docs-45] Best practices (corrected, high)
- Claim: The best-practice content is confirmed. One correction to the commit rule: from v2.1.286 Claude runs a skill named `verify` or `simplify` before each commit only when that skill is YOUR enterprise, personal, project or additional-directory skill, or a `.claude/commands/` file, that Claude can invoke. The bundled `/verify` and `/simplify`, plugin skills and claude.ai-synced skills don't count. Docs-only and test-only changes are skipped, and turning off `includeGitInstructions` removes the instruction.
- Detail: Common failure patterns and their fixes:
- Kitchen-sink session → `/clear` between unrelated tasks.
- Correcting the same thing over and over → after 2 failed corrections, `/clear` and write a better first prompt.
- Over-specified CLAUDE.md → prune it, or move rules into hooks.
- Trusting without verifying → always give Claude a way to verify.
- Unscoped investigation → scope it, or use subagents.

Other tips:
- Let Claude interview you with AskUserQuestion.
- Add an adversarial review step.
- Use `/verify` to check a change against the running app.
- If a skill named `verify` or `simplify` exists, Claude runs it before each commit (v2.1.286+).
- Use: Synthesis lesson + rubric for the capstone; quiz on failure patterns.
- Sources: Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>; Extend Claude with skills <https://code.claude.com/docs/en/skills>
- Verifier evidence: best-practices: 'The context window is the most important resource to manage'; '## Give Claude a way to verify its work'; Explore/Plan/Implement/Commit steps; 'After two failed corrections, `/clear` and write a better initial prompt'; failure-pattern names verbatim; 'Interview me in detail using the AskUserQuestion tool'; 'Add an adversarial review step'. skills: 'When a session starts with a skill named `verify` or `simplify` in place... run it right before each commit, except for changes to docs or tests. This requires Claude Code v2.1.286'; 'The bundled `/verify` and `/simplify`, plugin skills, and skills from your claude.ai account don't count.' <https://code.claude.com/docs/en/skills>

### [docs-46] Code review features (verified, high)
- Claim: `/code-review` (alias `/review`) reviews the current diff, a PR number, a branch or a path for correctness bugs. `--fix` applies the findings and `--comment` posts them to the PR. `/code-review ultra` (ultrareview, research preview) runs a fleet of reviewer agents in a cloud sandbox and independently reproduces each finding.
- Detail: Ultrareview:
- Needs a claude.ai login; not available on Bedrock, Vertex, Foundry or under ZDR.
- Includes 3 free runs on Pro and Max, then needs usage credits.
- `claude ultrareview [target]` runs it from CI or scripts.

Other review tools:
- `/security-review` checks the branch diff against origin's default branch for vulnerabilities.
- `/simplify` runs four cleanup agents and does not look for bugs.
- Managed GitHub Code Review, which reviews every PR automatically, is for Team and Enterprise.
- Use: Lesson on review-before-merge; exercise running /code-review on a seeded bug.
- Sources: Review locally with /code-review <https://code.claude.com/docs/en/code-review-local>; Find bugs with ultrareview <https://code.claude.com/docs/en/ultrareview>; Commands <https://code.claude.com/docs/en/commands>

### [docs-47] Official learning resources (Japanese) (verified, high)
- Claim: The official docs are fully translated into Japanese at `https://code.claude.com/docs/ja/<page>`, with a Japanese index at code.claude.com/docs/_llms/jp.txt (228 pages). Claude Code also ships `/powerup`, interactive lessons with animated demos, and the overview page links to free Claude Academy courses.
- Detail: The Claude Academy courses linked from the overview are 'Claude Code 101' and 'Claude Code in Action' at academy.claude.com.

The weekly 'What's new' digest (code.claude.com/docs/en/whats-new) summarizes notable features by week. The most recent digest listed when fetched was Week 37 (Sept 7–11, 2026), while the changelog continues through v2.1.304 (Oct 19, 2026).
- Use: Cite Japanese doc pages as lesson sources; assign /powerup as warm-up; point learners to changelog/what's-new for staying current.
- Sources: Claude Code Docs: Japanese index <https://code.claude.com/docs/_llms/jp.txt>; Commands <https://code.claude.com/docs/en/commands>; Overview <https://code.claude.com/docs/en/overview>


## Missed by the sweep (from the verifier)
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

## Open questions
- The 'What's new' digest index lists nothing after Week 37 (Sept 7–11, 2026), but the changelog continues to v2.1.304 (Oct 19, 2026). It is unclear whether weekly digests for late September and October exist or were not yet indexed.
- The Claude Tag page (code.claude.com/docs/en/claude-tag) returned no readable content, so Claude Tag is not covered.
- Subscription prices and plan limits on claude.com/pricing were not checked. The only prices verified are the per-MTok API prices in the changelog and the fast mode prices.
- I did not read the Chrome integration, computer use, channels, cross-session messaging or code-intelligence (LSP) plugins in depth. Add them later if the course needs them.
- Several features are research preview, experimental or beta (agent view, cloud scheduled tasks, ultrareview, fast mode, agent teams, Projects, /design). Their names, keys and limits may change before the course ships, so recheck them at publish time.
- Availability depends on account type. Remote Control, cloud sessions, teleport, ultrareview and Projects need a claude.ai login and do not work with Console API keys or Bedrock, Vertex or Foundry. Lessons should say which learner setup each exercise assumes.
- The tools reference says the Glob and Grep tools are 'absent by default on macOS, Linux, and WSL', but I did not confirm why. Avoid teaching Glob or Grep as always-present tool names until this is checked.
- The version thresholds in the docs (v2.1.277 for AGENTS.md, v2.1.283 for auto mode default, v2.1.302 for Manual mode in -p) are exact. Learners on older installs will see different behavior, so the course should tell them to run `claude update` and check `claude --version`.

# Angle: releases

## Summary
WHAT CHANGED RECENTLY, Claude Code as of 2026-10-20. The CHANGELOG headings carry no dates, so every date below is the npm publish time of that version (registry.npmjs.org/@anthropic-ai/claude-code), cross-checked against the official weekly digests (code.claude.com/docs/en/whats-new, Weeks 13–37) and Anthropic/claude.com posts.
Versions: 1.0.0 went GA on 2025-05-22 and 2.0.0 shipped on 2025-09-29. The 2.1.x line began on 2026-01-07 and is still current: the latest is 2.1.304 (2026-10-19), and npm's stable, latest and next tags all point to it. There have been about 152 releases since 2026-05-01, almost every weekday, so lessons should name features and minimum versions, not a 'current version'.
Models (May–Oct 2026): Opus 4.8 (2.1.154, May 28), Fable 5 (June 9), Sonnet 5 (2.1.197, June 30), Opus 5 (2.1.219, July 24), Fable 5.1 (2.1.257, Sept 1), Opus 5.5 (2.1.280, Sept 22), Sonnet 5.5 (2.1.284, Sept 28) and Haiku 5.5 (2.1.293, Oct 7). Today the 'default' setting resolves to Opus 5.5 on Pro, Max, Team, Enterprise and the Anthropic API, and the opus/sonnet/haiku aliases resolve to the 5.5 models on the Anthropic API.
New ways of working: agent view (`claude agents`, May 11), `/goal` (May 11), dynamic workflows with the `ultracode` keyword (May 28 / June 1), artifacts (beta June 15–19), Claude in Chrome GA (July 1), cross-session messaging (Aug 7), `/design` (Aug 17), mods (Oct 1), AGENTS.md support (Sept 18), idle compaction (Oct 14) and Code Review GA (Oct 15).
Now on by default: auto mode is the starting permission mode (Pro/Max/Team new sessions from Aug 14; every plan and provider for interactive terminal and VS Code since 2.1.283/2.1.284, late Sept). Subagents run in the background (July 1), fork subagents are on (interactive Aug 13; -p/SDK/Desktop/VS Code Oct 16), new models have a 1M context window, and the native binary is the install path.
Renamed or removed, which older tutorials will still show: the 'default' permission mode is now called 'Manual' (config value still `default`); 'Claude Code on the web' is now 'cloud sessions'; routines are now 'scheduled tasks' (`/schedule`); headless mode is now non-interactive mode; custom/slash commands are now skills/commands; the Claude Code SDK is now the Claude Agent SDK; Claude Code Security is now Claude Security. `/simplify` became `/code-review` and then came back as a cleanup-only skill, and `/review` is now an alias of `/code-review`. `/fork` was renamed `/branch` in March, then reused in July for copying a session (the old behavior is `/subtask`). Removed: the `/agents` wizard, `/ultraplan` (removed 2026-08-04), the TaskOutput tool, `/vim`, `/pr-comments` and the `#` memory shortcut. TodoWrite/Task* tools are off on new models, and Glob/Grep are absent on native macOS/Linux builds.
Coverage gaps: no weekly digest exists for Week 31 or for Sept 14–Oct 19, so that period comes from the CHANGELOG plus claude.com posts.

### [releases-1] Version range and release cadence (verified, high)
- Claim: The current Claude Code version is 2.1.304 (published 2026-10-19). The 2.1.x line started with 2.1.0 on 2026-01-07, after 2.0.0 (2025-09-29) and the 1.0.0 GA (2025-05-22).
- Detail: npm dist-tags show stable=latest=next=2.1.304. Roughly 152 versions were published between 2026-05-01 and 2026-10-19, almost daily on weekdays. CHANGELOG.md headings carry only version numbers, so dates must come from npm publish times or the weekly digest pages, which give week ranges and version spans (e.g. Week 37 = v2.1.263–v2.1.269). Native installs auto-update and support a `latest` or `stable` release channel. Homebrew uses the cask names `claude-code` (stable) and `claude-code@latest`.
- Use: Intro lesson: 'Claude Code changes weekly'. Teach `claude --version`, `/release-notes` and the What's new digest, and that lessons name a minimum version instead of a 'current' one.
- Sources: @anthropic-ai/claude-code package metadata (time, dist-tags) <https://registry.npmjs.org/@anthropic-ai/claude-code>; Claude Code CHANGELOG.md <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>; Advanced setup (release channels) <https://code.claude.com/docs/en/setup>

### [releases-2] Installation: native binary is the default path (verified, high)
- Claim: Since April 2026 (Week 16, v2.1.105–v2.1.113) the claude CLI runs a native per-platform binary instead of bundled JavaScript, and the docs recommend the native installer.
- Detail: Native install: `curl -fsSL https://claude.ai/install.sh | bash` (macOS/Linux/WSL) or `irm https://claude.ai/install.ps1 | iex` (Windows PowerShell). Alternatives: `brew install --cask claude-code` and `winget install Anthropic.ClaudeCode`; neither auto-updates by default. The npm package still exists but pulls a platform binary such as @anthropic-ai/claude-code-darwin-arm64 through an optional dependency. Since 2.1.15 (2026-01-21) npm installs show a deprecation notice pointing to `claude install`. Since 2.1.120 (2026-04-24), Git for Windows is optional: without it Claude Code uses PowerShell as the shell tool.
- Use: Setup lesson: show one install command per OS. Warn that older tutorials use `npm install -g @anthropic-ai/claude-code` as the main route. Use `claude doctor` / `/doctor` as the check step.
- Sources: Advanced setup <https://code.claude.com/docs/en/setup>; Week 16 · April 13–17, 2026 <https://code.claude.com/docs/en/whats-new/2026-w16>; Claude Code CHANGELOG.md (2.1.15, 2.1.120) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-3] Auto mode becomes the default permission mode (verified, high)
- Claim: Auto mode, where a classifier reviews actions instead of the user, moved from research preview (March 23–27, 2026) to the default starting mode: for new sessions on Pro, Max and Team from 2026-08-14, and for interactive terminal and VS Code sessions on every plan and provider in v2.1.284 (2026-09-28).
- Detail: Timeline: research preview Week 13 (Mar 23–27); Max with Opus 4.7 in 2.1.111 (Apr 16); Pro plan and Sonnet 4.6 in Week 21 (May 18–22); Bedrock, Vertex and Foundry with an opt-in in 2.1.158 (May 30); default for new sessions on Pro, Max and Team from Aug 14 (announced Week 32); third-party providers and telemetry-off sessions in 2.1.283 (Sept 25); every plan and provider in 2.1.284 (Sept 28). `permissions.defaultMode` still overrides it. Since 2.1.278 (Sept 19) the server-side classifier is the default for API/Enterprise and cloud providers. `/auto-mode-setup` (2.1.304, Oct 19) teaches auto mode about your environment. The docs list the modes as `default` (Manual), `acceptEdits`, `plan`, `auto`, `dontAsk` and `bypassPermissions`, and switch them with Shift+Tab.
- Use: Core lesson on permission modes and safety. Exercise: compare Manual, plan and auto on the same task, then add a deny rule and see that deny rules apply in every mode.
- Sources: Choose a permission mode <https://code.claude.com/docs/en/permission-modes>; Week 32 · August 3–7, 2026 <https://code.claude.com/docs/en/whats-new/2026-w32>; Week 13 · March 23–27, 2026 <https://code.claude.com/docs/en/whats-new/2026-w13>; Claude Code CHANGELOG.md (2.1.278, 2.1.283, 2.1.284, 2.1.304) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-4] Rename: 'default' permission mode is now 'Manual' (verified, high)
- Claim: In v2.1.200 (2026-07-03) the 'default' permission mode was renamed 'Manual' in the CLI, `--help`, VS Code and JetBrains. The config value stays `default`, and `manual` is accepted as an alias.
- Detail: Use `claude --permission-mode manual` or `"defaultMode": "manual"`. Hooks and the SDK still see `default`. In Manual mode only reads run without asking.
- Use: Old-vs-new names table. A quiz item: 'An older tutorial says default mode; what is it called in the UI now?'
- Sources: Claude Code CHANGELOG.md (2.1.200) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>; Choose a permission mode <https://code.claude.com/docs/en/permission-modes>

### [releases-5] Models: Opus 4.8 and the effort levels (corrected, high)
- Claim: Everything checks out except the last point: 2.1.154 did not deprecate fast mode on Opus 4.6. It deprecated the CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE environment variable (removed/no-op in 2.1.160) and told users to reach Opus 4.6 fast mode with `/model claude-opus-4-6[1m]` then `/fast on`. (Opus 4.7 was later removed from fast mode in 2.1.219; current docs list fast mode only on Opus 5.5, Opus 5 and Opus 4.8.)
- Detail: The `xhigh` effort level came with Opus 4.7 in 2.1.111 (2026-04-16) and sits between `high` and `max`. `/effort` with no argument opens a slider, whose labels were renamed 'Speed'/'Intelligence' → 'Faster'/'Smarter' in 2.1.154. The same release made fast mode on Opus 4.8 cost 2x the standard rate for about 2.5x the speed, and deprecated fast mode on Opus 4.6.
- Use: Models and effort lesson: when to raise effort, and how effort trades speed for cost.
- Sources: Week 22 · May 25–29, 2026 <https://code.claude.com/docs/en/whats-new/2026-w22>; Claude Code CHANGELOG.md (2.1.111, 2.1.154) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>
- Verifier evidence: CHANGELOG 2.1.154: 'Opus 4.8 is here! Now defaults to high effort · /effort xhigh for your hardest tasks'; 'Fast mode on Opus 4.8 is now available at a fraction of its previous cost: 2x the standard rate for 2.5x the speed'; 'Renamed the /effort slider labels from "Speed"/"Intelligence" to "Faster"/"Smarter"'; 'Deprecated CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE (will be removed on 06/01). To use fast mode on Opus 4.6, switch with /model claude-opus-4-6[1m] and then /fast on'. 2.1.160: 'Removed CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE'. Week 22 digest: default for 'Max, Team Premium, Enterprise pay-as-you-go, and Anthropic API accounts', fast mode on Opus 4.8 at $10/$50 per MTok. 2.1.111: xhigh 'sitting between high and max'. <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-6] Models: Claude Fable 5 / Fable 5.1 (verified, high)
- Claim: Claude Fable 5, described as 'a Mythos-class model that we've made safe for general use', launched on 2026-06-09 (Claude Code 2.1.170). Fable 5.1 (`claude-fable-5-1`) became the default Fable model in 2.1.257 (2026-09-01).
- Detail: Fable 5 costs $10/$50 per MTok; its API ID is `claude-fable-5`. Banners on the announcement page say access was suspended on 2026-06-12 and the models were redeployed on 2026-07-01. Fable 5.1 has a 1M context window and costs $10/$50 per MTok with $0.25 cache reads. In Claude Code you select it with `/model fable` or `--model fable`; the `best` alias resolves to Fable where it is available, otherwise to `opus`. Fable is never the account default. Subscription use bills usage credits after a consent prompt, which Enterprise organizations with org billing don't see. Mythos 5 is limited to Project Glasswing partners.
- Use: Model selection lesson: aliases (`default`, `best`, `fable`, `opus`, `sonnet`, `haiku`, `opusplan`) and cost awareness.
- Sources: Claude Fable 5 and Claude Mythos 5 <https://www.anthropic.com/news/claude-fable-5-mythos-5>; Model configuration <https://code.claude.com/docs/en/model-config>; Claude Code CHANGELOG.md (2.1.170, 2.1.257) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-7] Models: Sonnet 5 and Opus 5 (summer 2026) (verified, high)
- Claim: Claude Sonnet 5 shipped in v2.1.197 (2026-06-30) as the default for Pro, Team Standard and Enterprise subscription seats. Claude Opus 5 (`claude-opus-5`) shipped in v2.1.219 (2026-07-24) as the default Opus model.
- Detail: Sonnet 5 has a native 1M context window, adaptive thinking on by default, and promotional API pricing of $2/$10 per MTok through Aug 31. Opus 5 has a 1M context window on the API and on Max/Team/Enterprise, and fast mode at $10/$50 per MTok. 2.1.219 also removed Opus 4.7 from fast mode.
- Use: Background for the models lesson. Shows learners why screenshots in older material show different default models.
- Sources: Week 27 · June 29 – July 3, 2026 <https://code.claude.com/docs/en/whats-new/2026-w27>; Week 30 · July 20–24, 2026 <https://code.claude.com/docs/en/whats-new/2026-w30>; Claude Code CHANGELOG.md (2.1.197, 2.1.219) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-8] Models: the Claude 5.5 family is now the default (verified, high)
- Claim: Opus 5.5 (`claude-opus-5-5`, 2.1.280, 2026-09-22), Sonnet 5.5 (`claude-sonnet-5-5`, 2.1.284, 2026-09-28) and Haiku 5.5 (`claude-haiku-5-5`, 2.1.293, 2026-10-07) are now the newest models. `default` resolves to Opus 5.5 on Pro, Max, Team, Enterprise and the Anthropic API.
- Detail: Pricing from the changelog: Opus 5.5 $4/$20 per MTok ($0.20 cache reads); Sonnet 5.5 $2/$10 ($0.20 cache reads); Haiku 5.5 $0.10/$0.50 ($0.50/$2.50 above 100K-token prompts); all have 1M context. Opus 5.5 fast mode costs $8/$40, and 2.1.304 removed the '(research preview)' label from the `/fast` dialog on Opus 5.5. On the Anthropic API the aliases resolve to opus→Opus 5.5, sonnet→Sonnet 5.5 and haiku→Haiku 5.5. Bedrock and Agent Platform resolve sonnet to Sonnet 4.5 and haiku to Haiku 4.5; Microsoft Foundry resolves opus to Opus 4.6 and `default` to Sonnet 4.5. Before 2.1.280, `default` was Sonnet 5 on Pro and Team Standard.
- Use: Models lesson: teach aliases rather than version numbers, and how to pin a version with the full ID or `ANTHROPIC_DEFAULT_OPUS_MODEL`.
- Sources: Introducing Claude Opus 5.5 <https://www.anthropic.com/claude-opus-5-5>; Model configuration (alias table, default model, version history) <https://code.claude.com/docs/en/model-config>; Claude Code CHANGELOG.md (2.1.280, 2.1.284, 2.1.293, 2.1.304) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-9] Agent view and background sessions (corrected, high)
- Claim: Same as stated, with one fix: `claude attach <id>` and `claude logs <id>` existed before 2.1.290; v2.1.290 added the ability to pass part of a session name in place of the id. Also, Enter or → attaches to a row, and ← on an empty prompt detaches/backgrounds (Esc leaves agent view). Agent view is still labeled a research preview in the docs.
- Detail: Press ← on an empty prompt to open it and → to return; Enter attaches to a row. `/bg` or `/background` sends the current session to the background, and `claude --bg [task]` starts a new background session. Before editing files, a background session moves into its own git worktree under `.claude/worktrees/`. Later additions: `claude agents --json` (2.1.145), `claude attach <name>` / `claude logs <name>` (2.1.290), and a Ctrl+F search (2.1.288). Available on Pro, Max, Team, Enterprise and the Claude API. Admins can turn it off with `disableAgentView`.
- Use: Parallel-work lesson. Exercise: send a bug fix and a test investigation to the background, then triage them in agent view.
- Sources: Agent view in Claude Code <https://claude.com/blog/agent-view-in-claude-code>; Manage multiple agents with agent view <https://code.claude.com/docs/en/agent-view>; Claude Code CHANGELOG.md (2.1.139) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>
- Verifier evidence: CHANGELOG 2.1139 (npm 2026-05-11): 'Added agent view (Research Preview): a single list of every Claude Code session — running, blocked on you, or done. Run `claude agents`'. 2.1.145: 'Added claude agents --json'. 2.1.288: 'Added Ctrl+F to find a session by name'. 2.1.290: 'Added claude attach <name> and claude logs <name>: part of a session name works in place of the id' (earlier entries already fix bugs in `claude attach <id>` and `claude logs <id>`). Blog (May 11, 2026): 'available today as a Research Preview on Pro, Max, Team, Enterprise, and Claude API plans'. Agent-view doc: 'Press Enter or → on a row to attach'; 'Before editing files, Claude moves the session into an isolated git worktree under .claude/worktrees/'; 'set the disableAgentView setting to true or set CLAUDE_CODE_DISABLE_AGENT_VIEW'. <https://code.claude.com/docs/en/agent-view>

### [releases-10] /goal (verified, high)
- Claim: `/goal` (v2.1.139, 2026-05-11) sets a completion condition, and Claude keeps working across turns until that condition holds.
- Detail: After every turn a fast model checks the condition; if it doesn't hold, Claude starts another turn instead of handing control back. The goal clears once it is met. It works in interactive mode, `-p` and Remote Control, and `/goal clear` removes it. It suits tasks with a verifiable end state, e.g. 'every call site compiles and tests pass'.
- Use: Practice lesson on writing verifiable success criteria. Pairs naturally with test-driven prompts.
- Sources: Week 20 · May 11–15, 2026 <https://code.claude.com/docs/en/whats-new/2026-w20>; Keep Claude working toward a goal <https://code.claude.com/docs/en/goal>

### [releases-11] Dynamic workflows and the `ultracode` keyword (verified, high)
- Claim: Dynamic workflows were introduced in v2.1.154 (2026-05-28): Claude writes an orchestration script and runs tens to hundreds of subagents in the background. In v2.1.160 (2026-06-01) the trigger keyword was renamed from `workflow` to `ultracode`.
- Detail: You can ask in your own words ('use a workflow') or put `ultracode:` in the prompt. `/workflows` shows progress. `/effort ultracode` (or `claude --effort ultracode`, which also sets xhigh) lets Claude plan a workflow for every substantive task in the session; `/effort ultracode off` turns it off. You can save runs to `.claude/workflows/`. Bundled workflows include `/deep-research`. On Pro, dynamic workflows are turned on from `/config`. Each request uses more tokens.
- Use: Advanced lesson on large migrations and audits. Teach cost awareness and when NOT to use a workflow.
- Sources: Orchestrate subagents at scale with dynamic workflows <https://code.claude.com/docs/en/workflows>; Claude Code CHANGELOG.md (2.1.154, 2.1.160) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-12] Code review commands: /simplify → /code-review → /review (verified, high)
- Claim: `/simplify` was renamed `/code-review` in v2.1.147 (2026-05-21). `/simplify` came back as a cleanup-only review in v2.1.154 (2026-05-28), and `/review` became an alias of `/code-review` in v2.1.223 (2026-08-05).
- Detail: Usage: `/code-review [low|medium|high|xhigh|max|ultra] [--fix] [--comment] [--max-findings n|all|default] [pr#|branch|path]`. `--comment` posts inline PR comments, `--fix` applies findings, `ultra` runs a deep cloud review (ultrareview), and `--max-findings` was added in 2.1.288 (2026-10-02). `/simplify` now looks only at reuse, simplification, efficiency and abstraction level, not correctness bugs. Separate tools: `/security-review` (one pass over your branch) and `claude ultrareview` for CI (2.1.120, 2026-04-24).
- Use: Review lesson: the self-review loop before a PR. Old tutorials that use `/review` or `/simplify` mean different things today.
- Sources: Commands <https://code.claude.com/docs/en/commands>; Claude Code CHANGELOG.md (2.1.147, 2.1.152, 2.1.154, 2.1.223, 2.1.288) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-13] Code Review (managed PR review) GA (verified, high)
- Claim: Code Review, the automatic pull-request review service, left research preview and became generally available for Claude Team and Enterprise on 2026-10-15.
- Detail: An admin turns it on in Claude Code admin settings, installs the GitHub App and selects repositories; developers need no setup, and reviews run on new PRs. Per-repository depth is Quick, Standard (default) or Deep. Anthropic says most reviews finish about 3x faster than in the preview (6–10 minutes instead of about 20).
- Use: Team workflow lesson: local `/code-review` vs managed Code Review vs ultrareview.
- Sources: Code Review is now generally available <https://claude.com/resources/articles/code-review-is-now-generally-available>; Code Review <https://code.claude.com/docs/en/code-review>

### [releases-14] Security tooling and the Claude Security rename (verified, high)
- Claim: Claude Code Security was renamed Claude Security and went into public beta for Claude Enterprise on 2026-04-30. In July 2026 (Week 30) a local Claude Security plugin arrived for Claude Code sessions.
- Detail: Layers now in the docs: the security-guidance plugin reviews code as Claude writes it (Week 22; `/plugin install security-guidance@claude-plugins-official`); `/security-review` makes one pass over the branch; the Claude Security plugin (`/claude-security`) runs a multi-agent scan and writes patches you apply yourself; Code Review covers PRs; and the managed Claude Security product runs on Enterprise. The plugin needs dynamic workflows and Python 3.9+.
- Use: Security lesson: a defense-in-depth map. Names in older articles ('Claude Code Security') point to the renamed product.
- Sources: Claude Security is now in public beta <https://claude.com/blog/claude-security-public-beta>; Scan your codebase for vulnerabilities <https://code.claude.com/docs/en/claude-security>; Week 30 · July 20–24, 2026 <https://code.claude.com/docs/en/whats-new/2026-w30>

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

### [releases-17] Todo/Task tracking tools off on new models; TaskOutput removed (verified, high)
- Claim: Since v2.1.233 (2026-08-14), the to-do tools (TodoWrite, TaskCreate/Get/Update/List) are no longer offered on Opus 4.8, Sonnet 5, Fable 5, Mythos 5 and newer models. The deprecated TaskOutput tool was removed in v2.1.277 (2026-09-18).
- Detail: `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` brings the to-do tools back. TaskOutput was deprecated in 2.1.83 (March); Claude now reads a background task's output file with Read, and `taskOutputMaxChars` / `TASK_MAX_OUTPUT_LENGTH` no longer have any effect. Also, on native macOS/Linux/WSL builds the Glob and Grep tools are absent by default, replaced by embedded `bfs` and `ugrep` run through Bash (2.1.117, 2026-04-21).
- Use: 'How Claude Code works: the tools' lesson. Explains why older screenshots show a to-do checklist and Glob/Grep tool calls.
- Sources: Tools reference <https://code.claude.com/docs/en/tools-reference>; Claude Code CHANGELOG.md (2.1.117, 2.1.233, 2.1.277) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-18] Ultraplan removed (verified, high)
- Claim: The Ultraplan feature (`/ultraplan`), introduced as an early preview in Week 15 (April 6–10, 2026), was removed in v2.1.222 (2026-08-04). The docs now say to use plan mode.
- Detail: Ultraplan drafted a plan in a cloud session for review in a browser. The commands page lists `/ultraplan` as 'Removed. Use plan mode instead'. Plan mode (`claude --permission-mode plan`, or Shift+Tab) blocks edits until you approve a plan.
- Use: Planning lesson: teach plan mode. Mark Ultraplan as obsolete if learners find it in April–July 2026 articles.
- Sources: Commands (/ultraplan row) <https://code.claude.com/docs/en/commands>; Week 15 · April 6–10, 2026 <https://code.claude.com/docs/en/whats-new/2026-w15>; Claude Code CHANGELOG.md (2.1.222) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-19] AGENTS.md support (verified, high)
- Claim: Since v2.1.277 (2026-09-18), Claude Code reads AGENTS.md as project instructions when the project has no CLAUDE.md.
- Detail: If a CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md exists in the working directory or above it, only CLAUDE.md files load, unless CLAUDE.md imports AGENTS.md (e.g. `@AGENTS.md`). You can change this under 'Project instructions' in `/config`. `/doctor prompt-audit` (2.1.283) audits CLAUDE.md, AGENTS.md, rules, skills and agents for prompting patterns written for older models. Auto memory, where Claude writes its own notes, works alongside these files.
- Use: Project memory lesson: CLAUDE.md vs AGENTS.md vs .claude/rules vs auto memory, with an exercise writing a shared AGENTS.md plus a CLAUDE.md that imports it (the Rise Path repo does exactly this).
- Sources: How Claude remembers your project <https://code.claude.com/docs/en/memory>; Claude Code CHANGELOG.md (2.1.277, 2.1.283) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-20] Claude Mods (verified, high)
- Claim: Claude Mods shipped on 2026-10-01 (v2.1.287): plugins can now include mods, which are JavaScript/TypeScript event handlers that run inside Claude Code and can change how it looks and behaves.
- Detail: A mod can draw panes and bands, restyle built-in UI, guard or rewrite tool calls and prompts, approve or deny permissions, and add `/commands` that run without a Claude turn. Mods install as plugins (`/plugin install <name>@<marketplace>` or `claude plugin install`), then `/reload-plugins`. Built-in examples: `/diff` is now a mod; `sec-default` loads first on Team/Enterprise or managed machines to restrict risky mod actions; 'You should know' (`/plugin enable cc-plugin-you-should-know@builtin`) is a side agent that flags things you or Claude might miss. Mods are NOT sandboxed and run with your permissions. Sample mods live in anthropics/claude-code-playground. Mods run in the CLI, Desktop's Code tab and the VS Code extension. The docs call settings-file hooks 'settings hooks' to tell them apart.
- Use: Advanced extension lesson, after hooks and plugins. Include a strong trust/safety section.
- Sources: Customize Claude Code with mods <https://claude.com/resources/articles/claude-code-mods>; Mods overview <https://code.claude.com/docs/en/plugins/mods/overview>; Claude Code CHANGELOG.md (2.1.287) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-21] Plugins ecosystem growth in 2026 (corrected, high)
- Claim: All dates and commands check out, but `claude plugin eval` writes each run's report to a timestamped folder: `evals/results/<timestamp>/report.html` (with `aggregate-result.json`), and `--output-dir` changes it. Also note `/plugin list` (2.1.163) shipped 2026-06-04 and takes `--enabled`/`--disabled` filters; 2.1.275 sync can be turned off with `syncClaudeAiSkills: false` / `syncClaudeAiPlugins: false`. The third-party claim that plugins 'went official' in 2.1.302 is contradicted by the 2.0.12 entry.
- Detail: `claude plugin eval init` drafts test cases and graders; `claude plugin eval .` scores the plugin against a no-plugin baseline and writes `evals/results/report.html`. Other additions: `--plugin-dir` accepts a .zip or a folder of plugins; `--plugin-url` fetches an archive; `claude plugin install --marketplace <source>` (2.1.292); `claude plugin configure` (2.1.285). The official marketplace is `claude-plugins-official`. A third-party post claiming the plugin system first 'went official' in 2.1.302 contradicts the changelog.
- Use: Plugins lesson: install from the official marketplace, then measure value with plugin eval.
- Sources: Week 37 · September 7–11, 2026 <https://code.claude.com/docs/en/whats-new/2026-w37>; Week 19 · May 4–8, 2026 <https://code.claude.com/docs/en/whats-new/2026-w19>; Claude Code CHANGELOG.md (2.0.12, 2.1.275, 2.1.285, 2.1.292) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>
- Verifier evidence: CHANGELOG 2.0.12: 'Plugin System Released'. Week 19: '--plugin-dir now accepts .zip files, and --plugin-url fetches a plugin archive'. 2.1.163: 'Added /plugin list command ... with --enabled/--disabled filters'. 2.1.269: 'Added claude plugin eval ... (JSON + HTML report)'. 2.1.275: 'Added syncing of the skills and plugins enabled on your claude.ai account to terminal sessions'. 2.1.285: 'Added claude plugin configure <plugin>'. 2.1.292: 'Added --marketplace <source> to claude plugin install'. Plugin-evals doc example output: 'Report: .../evals/results/2026-09-10T17-02-11-482Z/report.html'; '--output-dir <dir> | <eval dir>/results/<timestamp>/ | Where aggregate-result.json and report.html go'. <https://code.claude.com/docs/en/plugin-evals>

### [releases-22] Artifacts (corrected, high)
- Claim: Artifacts launched in beta on Team and Enterprise in Week 25, then became generally available and included on Pro and Max plans in Week 27 (June 29 – July 3, 2026). Current docs: available on Pro, Max, Team and Enterprise, require a /login session, and are not available on Bedrock, Agent Platform, Foundry or Claude Platform on AWS. Week 29 added MCP-connector data, public sharing links and editor roles (Team/Enterprise). `/artifacts` requires v2.1.208+.
- Detail: Use them when terminal text is the wrong medium: a PR walkthrough, a dashboard or a report. Week 29 (July 13–17) added live data through each viewer's MCP connectors, public sharing links, and editor roles on Team/Enterprise. `/artifacts` lists them.
- Use: Communication lesson: turning a session's output into a shareable report.
- Sources: Week 25 · June 15–19, 2026 <https://code.claude.com/docs/en/whats-new/2026-w25>; Week 29 · July 13–17, 2026 <https://code.claude.com/docs/en/whats-new/2026-w29>; Share session output as artifacts <https://code.claude.com/docs/en/artifacts>
- Verifier evidence: Week 25: 'Artifacts ... now in beta on Team and Enterprise plans'. Week 27 digest: 'Artifacts are now generally available and included on Pro and Max plans, joining Team and Enterprise'. Week 29: 'a published artifact can pull live data and take actions through each viewer's own MCP connectors ... adds public sharing links, editor roles on Team and Enterprise'. Artifacts doc: 'Artifacts are available on Pro, Max, Team, and Enterprise plans and require a session signed in with /login'. Commands doc: '/artifacts ... Requires Claude Code v2.1.208 or later'. <https://code.claude.com/docs/en/whats-new/2026-w27>

### [releases-23] /design and the Claude Design shutdown (verified, high)
- Claim: `/design` arrived as a research preview in v2.1.234 (Week 34, 2026-08-17): it brings Claude Design's artboard workflow into the CLI and Desktop. A notice added in v2.1.302 (2026-10-16) says standalone Claude Design (claude.ai/design) closes by 2026-12-14.
- Detail: Run `/design [brief]`: Claude publishes a canvas of editable artboards built on artifacts; you pick one, and Claude implements it. Available on Pro, Max, Team and Enterprise. `/design-sync` and `/design-login` carry the closure notice.
- Use: Optional UI/front-end lesson. Warn that tutorials pointing to claude.ai/design will stop working.
- Sources: Week 34 · August 17–21, 2026 <https://code.claude.com/docs/en/whats-new/2026-w34>; Claude Code CHANGELOG.md (2.1.302) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-24] Cloud sessions (renamed from 'Claude Code on the web') (verified, high)
- Claim: Claude Code on the web launched as a research preview on 2025-10-20. An update dated 2026-09-23 says 'cloud sessions (previously known as Claude Code on the web)' are generally available for Pro, Max and Team users and some Enterprise seats.
- Detail: The docs glossary now uses 'cloud session' for any cloud-run session and keeps 'Claude Code on the web' only for the browser surface at claude.ai/code. The admin label 'Web' became 'Cloud sessions' in 2.1.277 (2026-09-18). `/teleport` (alias `/tp`) pulls a cloud session into the terminal, and `claude --cloud` starts one. Self-hosted environments, which run cloud sessions on your own infrastructure, entered public beta on Team/Enterprise in v2.1.224 (Week 32).
- Use: Cloud and async lesson: delegate a task to a cloud session, then teleport it back.
- Sources: Claude Code on the web (with 2026-09-23 update) <https://claude.com/blog/claude-code-on-the-web>; Glossary (Deprecated and renamed terms) <https://code.claude.com/docs/en/glossary>; Week 32 · August 3–7, 2026 <https://code.claude.com/docs/en/whats-new/2026-w32>

### [releases-25] Scheduled tasks (formerly Routines) (verified, medium)
- Claim: Routines, cloud agents that fire on a schedule, a GitHub event or an API call, launched in Week 16 (April 13–17, 2026). The current docs call them 'scheduled tasks, formerly routines' and manage them with `/schedule` (alias `/routines`).
- Detail: A scheduled task bundles a saved prompt, repositories and connectors, and runs in Anthropic's cloud or a self-hosted environment. Triggers are Schedule, API (HTTP POST with a bearer token) or GitHub events. Available on Pro, Max, Team and Enterprise; it is still a research preview. The web address (claude.ai/code/routines), the CLI and the API still use the name 'routines'. Separately, `/loop` runs a prompt repeatedly in a local session (it self-paces when no interval is given, Week 15).
- Use: Automation lesson: a nightly PR-review task. Explain both names.
- Sources: Automate work with scheduled tasks <https://code.claude.com/docs/en/routines>; Week 16 · April 13–17, 2026 <https://code.claude.com/docs/en/whats-new/2026-w16>

### [releases-26] Projects redesigned (beta) (corrected, high)
- Claim: The Sept 17, 2026 announcement said threads ran only in the cloud, but the current docs describe Projects as a public beta on Pro and Max (rolling out, not on Team or Enterprise yet, waitlist at claude.com/form/projects) and already let you ask Claude to run a thread on your own computer as a local Claude Code session connected through Remote Control (runs only while that machine is awake; starts with project instructions but not project memory). Teach 'cloud threads by default, local threads via Remote Control', not 'cloud only'.
- Detail: Threads share a project memory and a library of files and artifacts. You configure the cloud environment, connectors, plugins, instructions and model. Threads run only in the cloud for now; local threads are planned. Team, Enterprise and Claude overall come later, and there is a waitlist.
- Use: Forward-looking lesson or sidebar on goal-driven multi-agent work. Mark it as a beta.
- Sources: Projects redesigned: from folder to conversation <https://claude.com/resources/articles/projects-redesigned>; Let Claude coordinate ongoing work with Projects <https://code.claude.com/docs/en/claude-projects>
- Verifier evidence: claude.com article (September 17, 2026): 'Projects have threads that do the work and a coordinator that directs them'; beta for 'select Claude Pro and Max subscribers'; 'Threads run in the cloud today'. Claude-projects doc: 'Projects are in public beta on Pro and Max plans and rolling out gradually ... They aren't available on Team or Enterprise plans yet'; 'Each thread is usually a cloud session ... you can ask Claude to run that thread on your computer instead of in the cloud, through Remote Control'; section 'Run a thread on your own computer'. <https://code.claude.com/docs/en/claude-projects>

### [releases-27] Cross-session messaging (corrected, high)
- Claim: Cross-session messaging (ListAgents + SendMessage) arrived in v2.1.224 on macOS and Linux (incl. Linux in WSL 2), and on native Windows in v2.1.234. It is not limited to one machine: the 2.1.224 entry says 'on any of your machines', and the docs say a session can also reach your cloud sessions and Remote Control sessions on other machines while it is connected to Remote Control. The rest holds: text only, /list-agents (alias /peers), a '› Message from @name' preview expandable with Ctrl+O, @-mentions from v2.1.232, and messages never count as your approval.
- Detail: A message is text Claude writes for the other session, never your conversation history or files. `/list-agents` shows the sessions Claude can reach. The receiving session shows a 'Message from' row (expand it with Ctrl+O). Since Week 33 you can also mention another session by typing `@` in the prompt. Cross-session safeguards are never auto-approved, even in bypassPermissions mode.
- Use: Parallel-work lesson, extension exercise: pass a finding from a review session to an implementation session.
- Sources: Week 32 · August 3–7, 2026 <https://code.claude.com/docs/en/whats-new/2026-w32>; Message your other Claude Code sessions <https://code.claude.com/docs/en/cross-session-messaging>
- Verifier evidence: CHANGELOG 2.1.224: 'Added cross-session SendMessage: Claude Code sessions can now message each other, on any of your machines, with ListAgents to discover them (macOS and Linux)'. Cross-session doc: 'requires Claude Code v2.1.224 or later on macOS and Linux, including Linux inside WSL 2. On native Windows, it requires Claude Code v2.1.234'; 'reach your sessions on other machines or in the cloud'; 'A message is a piece of text one Claude writes to another, never the sender's conversation history or files'; '@ ... Requires Claude Code v2.1.232'; preview '› Message from @api-worker: ... (ctrl+o to expand)'. Permission-modes doc lists 'The cross-session messaging safeguards' among things never auto-approved in any mode, including bypassPermissions. <https://code.claude.com/docs/en/cross-session-messaging>

### [releases-28] Remote Control, mobile and Desktop surfaces (verified, high)
- Claim: Remote Control (`claude remote-control` / `/remote-control`, alias `/rc`; external builds since 2.1.51, 2026-02-23) left research preview in Week 34 (Aug 17–21, 2026). Any machine running it now shows up as a device card in the Claude app's Code tab.
- Detail: Mobile push notifications arrived in Week 16 (enable 'Push when Claude decides' in `/config`). Claude Desktop on Linux (Ubuntu 22.04+/Debian 12+) entered beta in Week 27. Desktop added an in-app browser (Week 28), an iOS Simulator pane in public beta (Week 30, macOS), `/resume` of terminal sessions (Week 35), pop-out panes (Week 37) and background computer use (Week 36). `claude --desktop` / `/desktop` hands a session to the Desktop app (2.1.285, 2026-09-29).
- Use: Surfaces lesson: where to run Claude Code (terminal, VS Code, Desktop Code tab, web/cloud, mobile) and how to move a session between them.
- Sources: Week 34 · August 17–21, 2026 <https://code.claude.com/docs/en/whats-new/2026-w34>; Week 27 · June 29 – July 3, 2026 <https://code.claude.com/docs/en/whats-new/2026-w27>; Continue local sessions from any device with Remote Control <https://code.claude.com/docs/en/remote-control>

### [releases-29] Claude in Chrome GA (verified, high)
- Claim: The Claude in Chrome integration, a beta since v2.0.72 (2025-12-17), became generally available on all direct Anthropic plans in v2.1.198 (Week 27, 2026-07-01).
- Detail: Claude Code drives Chrome through the Claude in Chrome extension: it opens tabs, clicks, fills forms, reads console logs and shares your login state, so it can test the app it builds. Commands: `claude --chrome` and `/chrome`, which can pick among several connected browsers (2.1.154). It complements computer use (CLI research preview in Week 14, March 30 – April 3, 2026).
- Use: Verification lesson: close the loop by letting Claude check the UI in a real browser.
- Sources: Week 27 · June 29 – July 3, 2026 <https://code.claude.com/docs/en/whats-new/2026-w27>; Use Claude Code with Chrome <https://code.claude.com/docs/en/chrome>

### [releases-30] Context management: idle compaction, /cd, Summarize up to here (verified, high)
- Claim: In v2.1.299 (2026-10-14), the terminal gained idle compaction: a conversation of 200K+ tokens left idle for about 54 minutes is compacted before its one-hour prompt cache expires.
- Detail: Turn it off with `"idleCompaction": false` or the 'Idle compaction' row in `/config` (2.1.302). `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` changes the 200K minimum. Other recent context tools: the Rewind menu's 'Summarize up to here' (Week 20); `/cd` moves a session to a new directory without rebuilding the cache (Week 24); `/rewind` can resume from before `/clear` (Week 26); `/btw` asks a side question without adding to the conversation. New models default to a 1M-token context window.
- Use: Context-window lesson: /context, /compact, /clear, /rewind, plus how prompt caching affects cost.
- Sources: Claude Code CHANGELOG.md (2.1.299, 2.1.302) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>; Week 24 · June 8–12, 2026 <https://code.claude.com/docs/en/whats-new/2026-w24>

### [releases-31] Setup diagnostics: /doctor, --safe-mode, --restricted, /skill-doctor (verified, high)
- Claim: In v2.1.205 (2026-07-08) `/doctor` became a full setup checkup that diagnoses issues and proposes fixes, with `/checkup` as an alias. `/doctor prompt-audit` followed in v2.1.283 (2026-09-25).
- Detail: Other recent tools: `--safe-mode` starts with all customizations disabled (Week 24, 2.1.169); `--restricted` starts without command-running tools or user and project settings (Week 35, 2.1.248); `/skill-doctor` shows each skill's context cost and how often it is used (Week 36); `/usage` breaks down plan usage by skill, subagent, plugin and MCP server (Week 21).
- Use: Troubleshooting lesson and checklist: what to run when Claude Code misbehaves.
- Sources: Week 28 · July 6–10, 2026 <https://code.claude.com/docs/en/whats-new/2026-w28>; Week 36 · August 31 – September 4, 2026 <https://code.claude.com/docs/en/whats-new/2026-w36>; Claude Code CHANGELOG.md (2.1.205, 2.1.283) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-32] Settings and permissions syntax additions (verified, high)
- Claim: In June 2026, deny and ask rules gained tool-parameter matching with `Tool(param:value)` (v2.1.178, Week 25), and `/config key=value` (v2.1.181, 2026-06-17) began setting any setting directly from the prompt.
- Detail: Examples: `Agent(model:opus)` and `Agent(isolation:*)`. `/config thinking=false` works in interactive mode, `-p` and Remote Control. Other recent settings: `ANTHROPIC_DEFAULT_MODEL` sets the model new sessions start on (v2.1.236); `modelPicker` (Week 35); `maxEffortLevel` (Week 37); `"attribution": false` hides commit/PR attribution (2.1.281); `maxProseWidth` (2.1.282). Hooks gained a conditional `if` field (Week 13) and `onFailure: "block"` (2.1.295, 2026-10-08).
- Use: Configuration lesson: settings.json layers and permission rules, with a fail-closed hook exercise.
- Sources: Week 25 · June 15–19, 2026 <https://code.claude.com/docs/en/whats-new/2026-w25>; Claude Code CHANGELOG.md (2.1.181, 2.1.281, 2.1.295) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-33] Output styles: Concise added, /output-style history (verified, high)
- Claim: A built-in Concise output style was added in v2.1.237 (Week 34, Aug 2026): Claude leads with the result and skips preamble.
- Detail: History: output styles were released in 1.0.81 (2025-08-14) with 'Explanatory' and 'Learning'; deprecated in 2.0.30 (2025-10-30); un-deprecated in 2.0.32 (2025-11-03). The `/output-style` command was deprecated in favor of `/config` in 2.1.73 (2026-03-11); then `/output-style [name]` returned for listing and switching in 2.1.269 (2026-09-11). The 'Learning' style is relevant for an education platform.
- Use: Personalization lesson: pick Learning or Explanatory style for study, Concise for daily work.
- Sources: Week 34 · August 17–21, 2026 <https://code.claude.com/docs/en/whats-new/2026-w34>; Claude Code CHANGELOG.md (1.0.81, 2.0.30, 2.0.32, 2.1.73, 2.1.269) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-34] Official renamed-terms list (for reading older tutorials) (verified, high)
- Claim: The docs glossary lists these renames: Headless mode → Non-interactive mode (same `-p`); 'Claude Code on the web' for any cloud session → Cloud session; Custom commands → Skills (`.claude/commands/` still works); Slash commands → Commands.
- Detail: Slash commands and skills were merged in 2.1.3 (2026-01-09). Other renames from the changelog and docs: Claude Code SDK → Claude Agent SDK (2.0.0, 2025-09-29; legacy entrypoint removed 2.0.25); `/allowed-tools` → `/permissions` (1.0.7, 2025-05-30); `/extra-usage` → `/usage-credits` (2.1.144, 2026-05-18); Vertex AI → 'Google Cloud's Agent Platform' in the docs; Windsurf → Devin Desktop in `/ide` (2.1.162). Removed: the `#` quick-memory shortcut (2.0.70, 2025-12-15), `/vim` (2.1.92), `/pr-comments` (2.1.91), and Opus 4/4.1 on the first-party API (2.1.68, 2026-03-04).
- Use: A dedicated 'old vs new names' reference card and flashcards. Also a lint list for the course's own text.
- Sources: Glossary — Deprecated and renamed terms <https://code.claude.com/docs/en/glossary>; Commands <https://code.claude.com/docs/en/commands>; Claude Code CHANGELOG.md <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

### [releases-35] 2025 foundation timeline (verified, high)
- Claim: In 2025 Claude Code went GA on 2025-05-22 (1.0.0, with Sonnet 4 / Opus 4), then shipped hooks (1.0.38, 2025-06-30), custom subagents (1.0.60, 2025-07-24), 2.0.0 (2025-09-29), plugins (2.0.12, 2025-10-09) and Skills (2.0.20, 2025-10-16).
- Detail: 2.0.0 brought the native VS Code extension, `/rewind` checkpoints, `/usage`, the rename to the Claude Agent SDK and the `--agents` flag. The rest of 2025: Haiku 4.5 and the Explore subagent (2.0.17, 2025-10-15); Bash sandbox mode on Linux/Mac (2.0.24, 2025-10-20); Claude Code on the web (2025-10-20); Opus 4.5 and Claude Code for Desktop (2.0.51, 2025-11-24); Claude in Chrome beta (2.0.72, 2025-12-17); the LSP tool (2.0.74, 2025-12-19).
- Use: Course intro: a 'how we got here' timeline. Concepts from 2025 (hooks, subagents, skills, plugins, MCP) are still the core of the curriculum.
- Sources: Claude Code CHANGELOG.md <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>; @anthropic-ai/claude-code package metadata (time) <https://registry.npmjs.org/@anthropic-ai/claude-code>

### [releases-36] Early-2026 timeline (Jan–Apr) leading into the May–Oct changes (verified, high)
- Claim: January to April 2026 brought: 2.1.0 (2026-01-07: skill hot-reload, `context: fork` in skills, a `language` setting); Opus 4.6 and the agent-teams research preview (2.1.32, 2026-02-05); Sonnet 4.6 (2.1.45, 2026-02-17); channels (2.1.80, 2026-03-19); auto mode research preview (Week 13, March 23–27); computer use in the CLI (Week 14); and Opus 4.7 with `xhigh` plus `/ultrareview` (2.1.111, 2026-04-16).
- Detail: Agent teams needed `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` at launch. The `language` setting (e.g. `language: "japanese"`) sets Claude's response language, which is useful for Japanese learners. `/powerup` interactive in-product lessons arrived in 2.1.90 (2026-04-01), and `/team-onboarding` in Week 15.
- Use: Context for the timeline lesson. The `language` setting and `/powerup` fit an onboarding lesson for Japanese learners.
- Sources: Claude Code CHANGELOG.md (2.1.0, 2.1.32, 2.1.45, 2.1.80, 2.1.90, 2.1.111) <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>; What's new (weekly digest index) <https://code.claude.com/docs/en/whats-new>


## Missed by the sweep (from the verifier)
- Opus 5.5, Sonnet 5.5 and Haiku 5.5 default to `medium` effort, not `high` (Opus 4.7 defaults to xhigh, most others high). A top-level `effortLevel` in user settings no longer applies to Opus 5.5, and thinking can't be turned off on Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable. Anthropic advises starting Opus 5.5 at medium instead of carrying over the level used on Opus 5. This matters for the effort lesson. https://code.claude.com/docs/en/model-config
- Non-interactive runs differ from interactive ones: since v2.1.302, `claude -p` and Agent SDK runs with no permission mode set start in Manual (`default`), and calls that need approval are denied unless an allow rule, hook, canUseTool or --permission-prompt-tool approves them. Interactive terminal and VS Code sessions start in auto. Setting "auto" in a project's .claude/settings.json has no effect. https://code.claude.com/docs/en/permission-modes
- Automatic content-based model fallback (v2.1.219+): Fable 5.1, Fable 5, Opus 5.5, Sonnet 5.5 and Opus 5 run with safety classifiers. Fable and Opus 5.5 requests flagged for biology re-run on Opus 5, and cyber-flagged ones on Opus 4.8. Sonnet 5.5 cyber flags fall back to Sonnet 5, and its biology flags end in a refusal. Since 2.1.287 the switch keeps your effort level. This matters for security and CTF exercises. https://code.claude.com/docs/en/model-config
- The official weekly digest (What's new) currently ends at Week 37 (Sept 7–11, 2026, v2.1.263–v2.1.269), and Week 31 has no digest; the 2026-w31 and w38–w42 pages return 404. Changes in v2.1.270–v2.1.304 (Opus/Sonnet/Haiku 5.5, mods, AGENTS.md, idle compaction) are documented only in the changelog and feature pages, so lessons should cite those. https://code.claude.com/docs/en/whats-new
- Fast mode is still documented as a research preview. It works on Opus 5.5 ($8/$40 per MTok), Opus 5 and Opus 4.8 ($10/$50) only, not on Sonnet or Haiku, and Opus 5.5 has been the fast-mode default since v2.1.280. https://code.claude.com/docs/en/fast-mode
- Install and update channels the sweep omitted: signed apt, dnf and apk repositories, each with stable and latest channels. The `autoUpdatesChannel` setting (latest by default, stable about a week behind) and the `minimumVersion` floor. `DISABLE_AUTOUPDATER` vs `DISABLE_UPDATES`, and npm needing Node.js 22+. https://code.claude.com/docs/en/setup
- Built-in Proactive output style, alongside Concise, Explanatory and Learning: Claude starts work at once and makes reasonable assumptions on routine decisions. It doesn't change the permission mode. https://code.claude.com/docs/en/output-styles
- Accessibility: screen reader mode (v2.1.208, Week 29) renders plain linear text for VoiceOver and NVDA. Turn it on with `claude --ax-screen-reader`, `CLAUDE_AX_SCREEN_READER=1` or `"axScreenReader": true`. https://code.claude.com/docs/en/whats-new
- Availability fallback: the `fallbackModel` setting (v2.1.166, Week 24) sets up to three fallback models, tried in order when the primary is overloaded or unavailable. `--fallback-model` now also applies to interactive sessions. https://code.claude.com/docs/en/whats-new/2026-w24
- `claude mcp login` and `claude mcp logout` (Week 26, June 22–26) authenticate a configured MCP server from the shell instead of the /mcp menu. https://code.claude.com/docs/en/whats-new
- Usage-limit awareness features: 2.1.304 warns Pro and Max users when resuming an inactive conversation would use a noticeable share of the 5-hour limit. 2.1.299 added /usage warnings for max effort, workflows, always-on context and large tool results. Week 33 added Desktop 'Auto-continue when limits reset'. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- Background commands: 2.1.285 made background Bash and PowerShell commands stop after a time limit (default 30 min, max 2 h). 2.1.288 then limited this to unattended sessions (-p, Agent SDK, CI, cloud), so terminal, desktop and VS Code sessions have no limit. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- Subagent controls: a session runs up to 20 subagents concurrently by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, Week 30). /code-review now runs as a background subagent (Week 30). The Agent tool gained an `effort` parameter (2.1.292), and subagent frontmatter supports `effort`, `isolation: worktree` and `autoCompactWindow` (2.1.296). https://code.claude.com/docs/en/sub-agents
- Week 23 safety change: in `acceptEdits` mode Claude Code now prompts before writing files that can run code. Managed deployments can also require an approved Claude Code version range. https://code.claude.com/docs/en/whats-new
- Week 15 additions not in the sweep: the Monitor tool streams background events (such as logs) into the conversation, and `/autofix-pr` turns on PR auto-fix from the terminal. https://code.claude.com/docs/en/whats-new

## Open questions
- The weekly digest stops at Week 37 (Sept 7–11, 2026), and Week 31 (July 27–31) is missing. Everything from Sept 14 to Oct 19 comes from the CHANGELOG plus claude.com posts, so there is no official 'headline' ranking for that period.
- CHANGELOG.md headings have no dates. All dates are npm publish times (UTC), which can differ by a day from Anthropic's announcement dates.
- When the docs renamed Routines to 'scheduled tasks' was not found in the changelog. The docs (read 2026-10-20) say 'formerly routines', and the CLI, URL and API still say routines.
- When the docs started calling the Task tool 'Agent' was not pinned down. The changelog still says 'Task tool' in 2.1.212 (July 2026), while the tools reference lists `Agent`.
- `/import [codex|gemini|cursor]` appears in the commands docs, but no changelog entry was found, so it has no date. Verify it before teaching it.
- The Claude Tag (Slack) docs page returned empty when fetched, so its launch date and scope are unverified here.
- A tech-insider.org article says plugins 'went official' in 2.1.302. That conflicts with the changelog (plugins released in 2.0.12, Oct 2025), so treat it as unreliable.
- Plan availability, regional (Japan) availability and prices (fast mode, Fable usage credits, Code Review credits) change often. Re-check them right before publishing.
- Auto mode's starting-mode version differs slightly between sources: the docs say v2.1.283, while the changelog shows 2.1.283 for third-party providers and telemetry-off sessions and 2.1.284 for every plan and provider.

# Angle: practice

## Summary
Angle: how practitioners use Claude Code well as of 2026-10-20 (best practices and trends). Official sources read directly: code.claude.com docs (best-practices, common-workflows, memory, features-overview, agents, workflows, goal, worktrees, hooks-guide, skills, sub-agents, agent-teams, headless, github-actions, commands, context-window, prompt-caching, large-codebases, prompt-library), Anthropic engineering posts (context engineering Sep 2025, long-running harnesses Nov 2025, C compiler Feb 2026, harness design Mar 2026, auto mode Mar 2026, Apr 23 2026 postmortem, Agent Skills Oct 2025), claude.com blog (steering Jun 2026, large codebases May 2026, Anthropic teams Jul 2025, Cowork page) and claude.dev blog (code review Oct 15 2026, effort Sep 25 2026, Opus 5.5 playbook Sep 22 2026, agent automations Oct 8 2026, cloud field guide Oct 6 2026).
Core thesis the official docs now state outright: the context window is the scarce resource, and verification is the biggest lever ("give Claude a check it can run"). The canonical loop is explore -> plan (plan mode, Ctrl+G) -> implement with tests -> commit/PR, then an independent fresh-context review (subagent, /code-review). Verification can be gated at four levels: in-prompt, /goal (separate evaluator each turn), Stop hook, verification subagent or dynamic workflow.
Trends since 2025: spec/plan-first work (AskUserQuestion interview -> SPEC.md -> fresh session; community research.md/plan.md annotation cycles; cc-sdd and Spec Kit); separating builder from judge (planner/generator/evaluator harnesses, Code Review with verifier voting, risk-tiered human approval); auto mode as the default permission mode (v2.1.283+), with hooks/permissions, not CLAUDE.md, for hard guardrails; parallelism ladder from subagents (background by default, forks via /subtask) to worktrees (--worktree), agent view (claude agents, research preview), agent teams (experimental), dynamic workflows (ultracode, /deep-research, /workflows) and cloud sessions/projects; skills and plugins as packaged team knowledge (progressive disclosure, internal marketplaces, /team-onboarding); headless and CI via claude -p with --bare, --output-format json, --json-schema, --permission-mode dontAsk/auto, claude-code-action@v1.
CLAUDE.md guidance is now precise: under 200 lines, concrete and verifiable, add only after repeated mistakes, prune with /doctor and /doctor prompt-audit, move procedures to skills and scoped rules to .claude/rules/ paths frontmatter; edits do not apply mid-session until /clear, /compact or restart; AGENTS.md is read natively (v2.1.277+) only when no CLAUDE.md exists. Japanese community (Zenn/Qiita) largely mirrors the official guidance and adds concrete team flows (plan as default mode, Stop-hook quality gates, worktree per ticket) plus non-engineer automation stories with self-reported numbers.
Documented failure modes for lessons: kitchen-sink sessions, correcting over and over, over-specified CLAUDE.md, trust-then-verify gap, infinite exploration, self-approval/declaring victory early, stubbed features, reviewer over-engineering, unreviewed PRs, and silent failures in unattended automations. Each finding below is tagged [Official] or [Community].

### [practice-1] [Official] Mental model: context is the scarce resource (verified, high)
- Claim: Anthropic's best-practices page says most Claude Code best practices follow from one constraint: the context window fills up fast and performance degrades as it fills.
- Detail: The page says the context window holds every message, file read and command output, and that 'LLM performance degrades as context fills', with Claude 'forgetting' earlier instructions. It recommends tracking usage with a custom status line and /context. The Sep 29 2025 engineering post 'Effective context engineering for AI agents' names this 'context rot', calls context a finite 'attention budget', and states the principle: 'find the smallest set of high-signal tokens that maximize the likelihood of your desired outcome.' It describes Claude Code as hybrid: CLAUDE.md loaded up front, glob/grep for just-in-time retrieval, compaction and to-do lists or NOTES.md as memory for long tasks.
- Use: Lesson 1 (how Claude Code thinks): a frame for why /clear, subagents, a short CLAUDE.md and scoped prompts work. Exercise: run /context before and after reading a large file.
- Sources: Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>; Effective context engineering for AI agents <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>

### [practice-2] [Official] Verification first (verified, high)
- Claim: Official guidance says giving Claude a runnable check (tests, build, linter, screenshot comparison) is what lets a session finish without you, and says to ask for evidence rather than claims of success.
- Detail: Before/after prompts from the docs: 'write a validateEmail function. example test cases: ... run the tests after implementing'; '[paste screenshot] implement this design. take a screenshot of the result and compare it to the original. list differences and fix them'; 'fix it and verify the build succeeds. address the root cause, don't suppress the error'. Four ways to gate the stop: (1) in one prompt; (2) across a session with /goal; (3) deterministically with a Stop hook; (4) a second opinion from a verification subagent or a dynamic workflow, so 'the agent doing the work isn't the one grading it'. Run /verify yourself after Claude's check passes. Bundled /verify builds, runs and observes the app; /run-skill-generator writes a per-project skill teaching /run and /verify how to launch it. In the Oct 15 2026 code-review post, Boris Cherny calls verification 'probably the most important thing' and says it makes results 'two to three times better'.
- Use: A core lesson on verification loops. Exercise: rewrite three vague prompts into ones with pass/fail checks, then compare runs with and without a test command.
- Sources: Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>; Commands (/verify, /run, /run-skill-generator) <https://code.claude.com/docs/en/commands>; How the Claude Code team does code review <https://claude.dev/blog/solving-code-review-at-anthropic/>

### [practice-3] [Official] /goal completion conditions (verified, high)
- Claim: /goal <condition> keeps Claude working across turns until a separate small fast model judges the condition met or impossible, or an error you have to fix clears it.
- Detail: Syntax: '/goal all tests in test/auth pass and the lint step is clean'. '/goal' alone shows status (turns, token spend, last reason); '/goal clear' removes it (aliases stop, off, reset, none, cancel); /clear also removes it. The evaluator does not run commands or read files. It judges only what Claude surfaced in the transcript, so a condition needs one measurable end state, a stated check (e.g. '`npm test` exits 0') and constraints (e.g. 'no other test file is modified'). Bound it with a clause such as 'or stop after 20 turns'. Max 4,000 characters. It is a session-scoped prompt-based Stop hook. Pair it with auto mode for unattended runs, since auto mode removes per-tool prompts and /goal removes per-turn prompts. It works in -p: claude -p "/goal CHANGELOG.md has an entry for every PR merged this week" (add --output-format stream-json --verbose to watch progress). If Claude makes no progress (no tool use for several turns), the loop stops with the goal still set.
- Use: Advanced verification lesson. Exercise: write a good and a bad goal condition for the same task and predict how the evaluator will judge each.
- Sources: Keep Claude working toward a goal <https://code.claude.com/docs/en/goal>

### [practice-4] [Official] Explore -> Plan -> Implement -> Commit with plan mode (verified, high)
- Claim: The recommended workflow has four phases (Explore, Plan, Implement, Commit), with plan mode used to separate read-only exploration and planning from execution.
- Detail: Enter plan mode by pressing Shift+Tab until the status bar shows '⏸ plan mode on', by starting with 'claude --permission-mode plan', or with '/plan [description]' (e.g. '/plan fix the auth bug'). In plan mode Claude reads files and makes no edits. Press Ctrl+G to edit the plan in your editor before approving. Implement: approve the plan or press Shift+Tab, then e.g. 'implement the OAuth flow from your plan. write tests for the callback handler, run the test suite and fix any failures.' Commit: 'commit with a descriptive message and open a PR'. Skip planning for small, clear changes: 'If you could describe the diff in one sentence, skip the plan.' Plan mode writes the plan to a file, and Claude Code re-injects that file after compaction, so it survives long sessions where conversation history may not. /ultraplan is listed as Removed (use plan mode instead).
- Use: Foundational workflow lesson with a hands-on exercise: run the four phases on a small feature in a sample repo, editing the plan with Ctrl+G.
- Sources: Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>; Common workflows <https://code.claude.com/docs/en/common-workflows>; Explore the context window (What survives compaction) <https://code.claude.com/docs/en/context-window>; Set up Claude Code in a monorepo or large codebase <https://code.claude.com/docs/en/large-codebases>; Commands <https://code.claude.com/docs/en/commands>

### [practice-5] [Official] Spec-driven work: interview, SPEC.md, fresh session (verified, high)
- Claim: For larger features the docs recommend having Claude interview you with the AskUserQuestion tool, write a complete spec to SPEC.md, then execute it in a fresh session.
- Detail: Official prompt: 'I want to build [brief description]. Interview me in detail using the AskUserQuestion tool. Ask about technical implementation, UI/UX, edge cases, concerns, and tradeoffs. Don't ask obvious questions, dig into the hard parts I might not have considered. Keep interviewing until we've covered everything, then write a complete spec to SPEC.md.' Then start a new session, which gets clean context focused on implementation. The most useful specs are self-contained: they name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step. The Sep 25 2026 effort post (Thariq Shihipar) adds an 'interview-then-build loop': interview about gaps, implement and iterate at low effort, then verify and test at high effort. The Opus 5.5 playbook (Sep 22 2026) says to 'define done and let it run', e.g. 'Done means: ... the test suite passes. Stop and ask me only if a test fails for a reason you can't explain.'
- Use: Spec-writing lesson. Exercise: learners run the interview prompt for a small app, then grade the SPEC.md against the three self-containment criteria.
- Sources: Best practices for Claude Code (Let Claude interview you) <https://code.claude.com/docs/en/best-practices>; Using Claude Code: Spending your effort <https://claude.dev/blog/spending-your-effort/>; Getting the most out of Opus 5.5 in Claude and Claude Code <https://claude.dev/blog/getting-the-most-out-of-opus-5-5/>

### [practice-6] [Community] Research -> Plan -> Annotate -> Implement with markdown files (verified, medium)
- Claim: A widely shared practitioner workflow (Boris Tane, Feb 2026, also covered in Japanese on Zenn) keeps research and plans in research.md and plan.md files and forbids implementation until the human has annotated and approved the plan.
- Detail: Steps: (1) have Claude read the relevant code 'deeply' and write findings to research.md, which you review for misunderstandings; (2) have it write plan.md with file paths, code snippets and trade-offs, with an explicit 'don't implement yet'; (3) add inline notes to plan.md and send it back, 1 to 6 times, supplying domain knowledge (e.g. 'use PATCH not PUT'); (4) add a granular todo list to the plan; (5) implement everything with a standard prompt that marks tasks done in plan.md, runs typecheck continuously and does not stop midway. Core rule: 'never let Claude write code until you've reviewed and approved a written plan.' Tane prefers his own plan.md to built-in plan mode. The Zenn write-up adds a failure pattern: when an approach fails, `git revert` and narrow the scope instead of stacking patches. This is community opinion, not official guidance.
- Use: Compare with official plan mode in the planning lesson. Exercise: annotate a flawed plan.md, practising the annotation cycle.
- Sources: How I Use Claude Code <https://boristane.com/blog/how-i-use-claude-code/>; Claude Codeを9ヶ月使い込んだエンジニアの実践ワークフロー ── Research → Plan → Implement <https://zenn.dev/kosk_t/articles/claude-code-research-plan-workflow>

### [practice-7] [Community] Spec-driven development toolkits: cc-sdd and Spec Kit (corrected, medium)
- Claim: cc-sdd (MIT, Kiro-inspired, installs Agent Skills; 'Claude Code and Codex are stable') installs with `npx cc-sdd@latest` (`--lang ja` for Japanese) and uses /kiro-discovery -> /kiro-spec-init -> /kiro-spec-requirements -> /kiro-spec-design -> /kiro-spec-tasks -> /kiro-impl (plus kiro-steering; legacy /kiro:* deprecated). GitHub Spec Kit (Python 3.11+, uv) installs with `uv tool install specify-cli`; Claude Code IS an official integration: `specify init <project> --integration claude` installs skills in `.claude/skills`. The hyphenated /speckit-* names are documented for Copilot's default skills syntax; Spec Kit's docs do not state the invocation form for Claude Code, so check after install. The Classmethod 'Claude Code × 仕様駆動開発' event was only seen as a title in an event listing (5/26), not read; treat as low confidence.
- Detail: cc-sdd (gotalab, MIT, inspired by Kiro IDE) installs Agent Skills and lists Claude Code and Codex as stable. Flow: /kiro-discovery -> /kiro-spec-init -> /kiro-spec-requirements -> /kiro-spec-design -> /kiro-spec-tasks -> /kiro-impl, plus /kiro-steering for existing systems. Legacy /kiro:* commands are deprecated. GitHub Spec Kit (Python 3.11+, uv): `specify init my-project --integration <agent>`, then /speckit-constitution (once per project), then /speckit-specify, /speckit-plan, /speckit-tasks, /speckit-implement and /speckit-converge per feature, reviewing each result before continuing. The README example uses Copilot. Claude Code support is via its integrations reference, which I did not open. Classmethod has run 'Claude Code × 仕様駆動開発' seminars, a sign that SDD is a Japanese trend. These are third-party tools, not Anthropic guidance, and command names change between versions.
- Use: Optional advanced lesson or sidebar, 'spec-driven development tools', after learners know the manual SPEC.md method. Have them compare the phases with the official interview -> spec -> fresh session pattern.
- Sources: gotalab/cc-sdd README <https://github.com/gotalab/cc-sdd>; github/spec-kit README <https://github.com/github/spec-kit>; spec-kit vs cc-sdd comparison <https://ai-heartland.com/explain/spec-kit-vs-ccsd-aidlc/>
- Verifier evidence: cc-sdd README: 'Kiro-inspired', 'One command installs an agentic SDLC workflow as Agent Skills', 'Claude Code and Codex are stable', legacy /kiro:* deprecated. Spec Kit README: 'You need Python 3.11+', `uv tool install specify-cli`, `specify init my-project --integration copilot`. Spec Kit integrations reference lists key `claude`: 'Skills-based integration; installs skills in .claude/skills'. <https://github.github.com/spec-kit/reference/integrations.html>

### [practice-8] [Official] Writing specific prompts and giving rich context (verified, high)
- Claim: The docs recommend scoping the task, pointing to sources, referencing existing patterns and describing the symptom, and giving context with @file references, pasted images, URLs or piped data.
- Detail: Before/after pairs: 'add tests for foo.py' -> 'write a test for foo.py covering the edge case where the user is logged out. avoid mocks.'; 'why does ExecutionFactory have such a weird api?' -> 'look through ExecutionFactory's git history and summarize how its api came to be'; 'fix the login bug' -> '...check the auth flow in src/auth/, especially token refresh. write a failing test that reproduces the issue, then fix it'. Rich input: @src/utils/auth.js includes the file when it fits the Read tool's limit (25,000 tokens by default; text files over 256KB are not included), and @-references also pull in CLAUDE.md files from that directory and its parents. Paste images with Ctrl+V (Alt+V on Windows/WSL). Pipe data: `cat error.log | claude -p "explain this error"`. Tell Claude to use CLIs ('Use foo-cli-tool --help to learn about foo tool'), since CLIs like gh are 'the most context-efficient way' to reach external services. Vague prompts are fine for exploration ('what would you improve in this file?').
- Use: Prompting lesson with a rewrite drill: learners turn the four 'before' prompts into 'after' prompts, then check them against the docs' versions.
- Sources: Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>; Common workflows (Reference files and directories) <https://code.claude.com/docs/en/common-workflows>

### [practice-9] [Official + Community] Test-driven development with agents (verified, high)
- Claim: Official sources support test-first work ('write tests for {feature} first, then implement it until they pass') and separate test-writer and implementer sessions, and Anthropic's harness research says agents must not remove or edit tests to make them pass.
- Detail: Official: the prompt library includes 'write tests for {feature} first, then implement it until they pass' and 'write tests for {path}, run them, and fix any failures'. Best practices: 'have one Claude write tests, then another write code to pass them' and, for bugs, 'write a failing test that reproduces the issue, then fix it'. The Nov 2025 long-running harness post's prompt says: 'It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality.' Anthropic's Security Engineering team (Jul 2025) moved from 'design doc → janky code → refactor → give up on tests' to pseudocode plus TDD with Claude. Community (Simon Willison, Agentic Engineering Patterns, 2026): the prompt 'Use red/green TDD' works as shorthand for writing tests, confirming they fail, then implementing; watching tests fail first proves they exercise the new code. His 'First run the tests' chapter is a related pattern I did not read.
- Use: TDD lesson. Exercise: red/green on a small function, then a two-session variant where one session writes the tests and another implements, with a rule that test files are read-only (optionally enforced with a PreToolUse hook).
- Sources: Prompt library <https://code.claude.com/docs/en/prompt-library>; Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>; Effective harnesses for long-running agents <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>; How Anthropic teams use Claude Code <https://claude.com/blog/how-anthropic-teams-use-claude-code>; Red/green TDD - Agentic Engineering Patterns <https://simonwillison.net/guides/agentic-engineering-patterns/red-green-tdd/>

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

### [practice-19] [Official] Subagents for research and isolation (verified, high)
- Claim: Subagents run in their own context window and return only a summary, so the docs recommend 'use subagents to investigate X' to keep exploration out of the main conversation.
- Detail: Built-ins: Explore (read-only, fast search, starts without CLAUDE.md or git status), Plan (read-only research in plan mode), and general-purpose. Custom subagents are markdown files in .claude/agents/ (project, check in) or ~/.claude/agents/. Required frontmatter: name and description. Optional: tools (allowlist), disallowedTools, model (sonnet/opus/haiku/fable/inherit), isolation: worktree, memory (user/project/local), skills (preloaded), omitClaudeMd (v2.1.271+), background, permissionMode, maxTurns. Subagents Claude spawns run in the background by default (Ctrl+B backgrounds a running task). Fork mode, on by default, lets a forked subagent inherit the full conversation; start one yourself with '/subtask <task>'. Nesting goes up to 3 levels (CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH). The default concurrent limit is 20 (CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS). /tasks lists background work. Keep work in the main conversation for frequent back-and-forth or quick targeted edits.
- Use: Subagents lesson. Exercise: write a read-only 'security-reviewer' agent with tools: Read, Grep, Glob and run it on a diff.
- Sources: Create custom subagents <https://code.claude.com/docs/en/sub-agents>; Best practices for Claude Code (Use subagents for investigation) <https://code.claude.com/docs/en/best-practices>

### [practice-20] [Official] Adversarial review in a fresh context, and its over-engineering trap (verified, high)
- Claim: The docs recommend that, before treating a task as done, a subagent reviews the diff in a fresh context against the plan, and warn that a reviewer told to find gaps will find some even in sound work.
- Detail: Example prompt: 'Use a subagent to review the rate limiter diff against PLAN.md. Check that every requirement is implemented, the listed edge cases have tests, and nothing outside the task's scope changed. Report gaps, not style preferences.' For correctness, run bundled '/code-review [low|medium|high|xhigh|max|ultra] [--fix] [--comment] [pr#|branch|path]' (alias /review). '/simplify' runs four cleanup agents and does not look for bugs. '/security-review' reviews the branch diff against origin's default branch. The Writer/Reviewer pattern uses two sessions (Session B reviews @src/middleware/rateLimiter.ts). Warning: 'Chasing every finding leads to over-engineering: extra abstraction layers, defensive code, and tests for cases that can't happen. Tell the reviewer to flag only gaps that affect correctness or the stated requirements.' The Opus 5.5 playbook suggests: 'List only problems you'd block the merge for. For each one, give the file and line, why it's wrong, and how to show it fails.'
- Use: Review lesson. Exercise: run a review subagent, then triage its findings into must-fix vs optional.
- Sources: Best practices for Claude Code (Add an adversarial review step) <https://code.claude.com/docs/en/best-practices>; Commands <https://code.claude.com/docs/en/commands>; Getting the most out of Opus 5.5 in Claude and Claude Code <https://claude.dev/blog/getting-the-most-out-of-opus-5-5/>

### [practice-21] [Official] Separate the builder from the judge (harness design) (verified, high)
- Claim: Anthropic's Mar 24 2026 harness study found agents 'reliably skew positive when grading their own work', and that a separate, skeptically tuned evaluator agent with browser QA produced much better long-running app builds.
- Detail: The setup used planner, generator and evaluator agents. The evaluator clicked through the running app with Playwright MCP. Graded criteria were design quality, originality, craft and functionality, with the evaluator calibrated by few-shot examples. Earlier versions used 'sprint contracts', where the builder proposes what done means and how it will be tested and the evaluator reviews it. Agents communicated through files. Cost/time: solo run 20 min/$9 with a broken core feature; full harness 6 hr/$200. Failure modes: context anxiety, self-approval, shallow testing, stubbed features, under-scoping. Lesson: 'every component in a harness encodes an assumption about what the model can't do on its own'. Re-audit and remove harness pieces after model upgrades, and 'find the simplest solution possible, and only increase complexity when needed'.
- Use: Advanced lesson on multi-agent quality patterns. Discussion: when is an evaluator worth its cost?
- Sources: Harness design for long-running application development <https://www.anthropic.com/engineering/harness-design-long-running-apps>

### [practice-22] [Official] Long tasks across context windows: progress files and one feature at a time (verified, high)
- Claim: For multi-session work, Anthropic recommends an initializer session that sets up a feature list (JSON with pass/fail), a progress log and an init script, after which each later session completes one feature, tests it end to end and leaves a clean, committed state.
- Detail: From 'Effective harnesses for long-running agents' (Justin Young, Nov 26 2025): a feature list JSON (over 200 features in the claude.ai-clone example, all initially failing; agents may change only the `passes` field; JSON resists inappropriate overwrites better than Markdown), claude-progress.txt, init.sh to start the dev server, and descriptive git commits. Each session gets its bearings (pwd, git log, progress file, basic e2e test) before picking the top unfinished feature. Failure modes: one-shotting the whole app and running out of context; declaring victory early; marking features done after unit tests or curl only. Browser automation (Puppeteer MCP) improved end-to-end checking. The Opus 5.5 playbook (Sep 2026) gives the lightweight version: 'Keep a checklist in TASKS.md. Tick each item when it's done, and add anything new you find', which survives compaction.
- Use: Lesson on long-running and autonomous work. Exercise: create TASKS.md and a progress log for a multi-step build, then resume in a fresh session.
- Sources: Effective harnesses for long-running agents <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>; Getting the most out of Opus 5.5 in Claude and Claude Code <https://claude.dev/blog/getting-the-most-out-of-opus-5-5/>

### [practice-23] [Official] Parallel sessions with git worktrees (corrected, high)
- Claim: The official mechanics are correct (.claude/worktrees/<name>/, branch worktree-<name>, .gitignore tip, .worktreeinclude, worktree.baseRef 'fresh' default / 'head', claude --worktree "#1234", clean unnamed worktrees removed on exit, 'claude --worktree <name> --resume', -p worktrees not cleaned up, isolation: worktree, sparsePaths/symlinkDirectories, repo needs at least one commit). But the community tips attributed to the cited Zenn article (npm install/codegen per worktree, separate dev-server ports, one tab per worktree, urgent-fix worktree) are not in that article, and the 'Boris Cherny runs ~5 parallel checkouts' claim is unsourced. Drop both or cite a different source; the official page does say to install dependencies in each new worktree.
- Detail: Add .claude/worktrees/ to .gitignore. Each worktree is a fresh checkout: install dependencies there, or copy gitignored files like .env with a .worktreeinclude file (.gitignore syntax). The base is worktree.baseRef: 'fresh' (the remote default branch, the default) or 'head' (your local HEAD). Branch from a PR with claude --worktree "#1234". On exit, a clean unnamed worktree is removed automatically; one with work prompts you to keep it, and you resume with 'claude --worktree <name> --resume'. -p runs are not cleaned up, so use git worktree remove. Subagents can isolate with `isolation: worktree`. For large repos, worktree.sparsePaths and symlinkDirectories (e.g. node_modules) cut disk use. The repo needs at least one commit. Community (Japanese Zenn/Qiita): run npm install/codegen per worktree, give each dev server its own port, keep one terminal tab per worktree, and use a separate worktree for urgent fixes. Boris Cherny reportedly runs about 5 or more parallel checkouts (secondhand reports, numbers vary).
- Use: Parallel-work lesson. Exercise: run a feature session and a bugfix session side by side in two worktrees, then merge both.
- Sources: Run parallel sessions with worktrees <https://code.claude.com/docs/en/worktrees>; Set up Claude Code in a monorepo or large codebase (sparsePaths) <https://code.claude.com/docs/en/large-codebases>; Claude Code が Git Worktree をネイティブサポート ── 並列セッションから Subagent まで <https://zenn.dev/hiraoku/articles/74f4b3083b582f>
- Verifier evidence: Worktrees page: 'created under .claude/worktrees/<name>/ ... on a new branch named worktree-<name>'; 'A worktree is a fresh checkout, so initialize your development environment there'; baseRef values; PR syntax; cleanup rules; 'Non-interactive runs with -p have no exit prompt, so Claude doesn't clean up their worktrees'. Common workflows: 'the repository needs at least one commit first'. hiraoku Zenn (2026-02-25) check: per-worktree install, ports, urgent-fix tips and Boris Cherny 'Not mentioned'. <https://code.claude.com/docs/en/worktrees>

### [practice-24] [Official] Choosing a parallelism approach (subagents to teams to workflows) (verified, high)
- Claim: Claude Code offers five ways to run several tasks at once: subagents, agent view (`claude agents`, research preview), agent teams (experimental, off by default), dynamic workflows, and projects (public beta on Pro and Max), plus helpers such as worktrees, cross-session messaging and /batch.
- Detail: Decision questions from the docs: who coordinates (Claude in one conversation = subagents; you hand off and check back = agent view; a lead supervises workers = agent teams; a script holds the plan = dynamic workflows), do workers need to talk (cross-session messaging, team mailboxes), and do they touch the same files (use worktrees; agent teams don't isolate in worktrees, so partition files). '/batch <instruction>' splits one large change into 5 to 30 worktree-isolated background subagents after you approve a plan. /fork copies the session into a new background session. Monitoring: claude agents (agent view), /tasks, /workflows. 'Running several sessions or subagents at once multiplies token usage.' Agent teams: enable with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1. Start with 3-5 teammates and 5-6 tasks each, give spawn prompts full context (teammates don't inherit the lead's history), give each teammate its own files, and start with research or review. A strong pattern is 'competing hypotheses', where teammates try to disprove each other. Quality gates: TeammateIdle, TaskCreated and TaskCompleted hooks (exit 2 to push back). Limitations: no /resume of in-process teammates, one team per session, no nested teams.
- Use: Multi-agent orchestration lesson, with a decision-tree diagram and a scenario quiz ('which approach fits?').
- Sources: Run agents in parallel <https://code.claude.com/docs/en/agents>; Orchestrate teams of Claude Code sessions <https://code.claude.com/docs/en/agent-teams>; Best practices for Claude Code (Run multiple Claude sessions) <https://code.claude.com/docs/en/best-practices>

### [practice-25] [Official] Dynamic workflows (scripted fan-out with cross-checking) (verified, high)
- Claim: A dynamic workflow is a JavaScript script Claude writes that orchestrates many subagents in the background. You start one with the `ultracode` keyword or a direct request, run the bundled /deep-research, and watch runs with /workflows.
- Detail: Use one when a job outgrows a handful of subagents, or when findings should be cross-checked: codebase-wide audits, 500-file migrations, cited research, plans drafted from several angles. Example prompts: 'use a workflow to run npx tsc --noEmit and keep fixing the reported errors until the type check passes or two rounds in a row make no progress'; 'ultracode: audit every API endpoint under src/routes/ for missing auth checks'. '/effort ultracode' makes Claude plan a workflow for every substantive task, which uses more tokens. Save a run with 's' in /workflows to .claude/workflows/ (shared) or ~/.claude/workflows/, and it becomes /<name>. Scripts use agent(), pipeline(), parallel(), phase() and log(). Limits: 16 concurrent agents by default, 1,000 agents per run, 4,096 items per parallel()/pipeline(). A 'Large workflow' warning appears above 25 agents or a projected 1.5M tokens. workflowSizeGuideline defaults to medium (<10 agents), or small on Pro (v2.1.271+). Cost advice: run on a small slice first. On Pro, enable workflows in /config.
- Use: Advanced orchestration lesson. Exercise: run /deep-research on a question, then read the saved script to see the pattern.
- Sources: Orchestrate subagents at scale with dynamic workflows <https://code.claude.com/docs/en/workflows>

### [practice-26] [Official] Lessons from 16 parallel Claudes building a C compiler (verified, high)
- Claim: Anthropic's Feb 5 2026 experiment ran 16 parallel Claude agents with no orchestrator, coordinating through git and lock files, and built a roughly 100,000-line Rust C compiler that builds Linux 6.9. It took about 2,000 sessions and just under $20,000 in API cost.
- Detail: Setup (Nicholas Carlini): a bash loop running Claude with --dangerously-skip-permissions inside Docker containers (the author recommends a container), a prompt file AGENT_PROMPT.md, a bare git repo as upstream, and task claims via lock files in current_tasks/. Practitioner lessons: tests are the oracle and must be nearly perfect ('it is easy to see tests pass and assume the job is done'); keep test output to a few lines, log details to files and put 'ERROR' on the same line so grep finds it, to avoid context pollution; Claude has time blindness, so add a --fast sampled test mode; parallelism needs independent tasks, and when all agents hit the same kernel bug, GCC was used as a known-good oracle with delta debugging; maintain READMEs and progress files for fresh contexts; specialized roles (dedupe, performance, docs). Limits: regressions grew and code quality fell short of an expert's.
- Use: Case study for the multi-agent lesson. Discuss which lessons apply at small scale (short test output, progress notes, independent tasks).
- Sources: Building a C compiler with a team of parallel Claudes <https://www.anthropic.com/engineering/building-c-compiler>

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

### [practice-31] [Official] Permissions, auto mode and its limits (corrected, high)
- Claim: Claim is correct, but quote the engineering post exactly: auto mode is 'not a drop-in replacement for careful human review on high-stakes infrastructure' (not 'not a substitute for'). Before v2.1.283, auto mode was the starting mode only on Pro, Max and Team plans. Also note that `claude -p` runs on v2.1.302+ start in Manual mode when nothing sets a permission mode.
- Detail: Docs: pre-approve trusted commands with /permissions (e.g. npm run lint, git commit), use /sandbox for OS-level filesystem and network isolation, and switch to Manual mode to approve actions yourself. Shift+Tab cycles modes. Mar 25 2026 engineering post (John Hughes): users accepted 93% of manual prompts (approval fatigue). The classifier is reasoning-blind (sees user messages and tool calls, not Claude's prose) and blocks scope escalation, credential exploration, guessed targets, external data sharing and bypassed safety checks. On real traffic it had 0.4% false positives and 17% misses on real overeager actions. A blocked action returns to Claude, and after 3 consecutive or 20 total denials it escalates to the human. The authors say it 'is not a substitute for careful human review on high-stakes infrastructure' and call --dangerously-skip-permissions 'unsafe in most situations'. The Opus 5.5 playbook advises keeping prompts on for destructive commands and naming stop rules in CLAUDE.md ('Stop and ask only ... before anything destructive').
- Use: Safety and permissions lesson. Exercise: configure an allowlist, compare Manual vs auto mode on a task, and discuss residual risk.
- Sources: Best practices for Claude Code (Configure permissions) <https://code.claude.com/docs/en/best-practices>; How we built Claude Code auto mode: a safer way to skip permissions <https://www.anthropic.com/engineering/claude-code-auto-mode>; Getting the most out of Opus 5.5 in Claude and Claude Code <https://claude.dev/blog/getting-the-most-out-of-opus-5-5/>
- Verifier evidence: Best practices: 'With Claude Code v2.1.283 or later, auto mode is the built-in starting permission mode for interactive terminal and VS Code sessions'. Auto mode post (John Hughes, Mar 25, 2026): 'users accept 93% of them anyway'; 'reasoning-blind by design'; 'FPR drops from 8.5% to 0.4%'; about 17% of real overeager actions get through ('the honest number'); '3 consecutive denials or 20 total'; --dangerously-skip-permissions 'unsafe in most situations'. Opus 5.5 playbook: 'Keep permission prompts on for destructive commands regardless.' <https://www.anthropic.com/engineering/claude-code-auto-mode>

### [practice-32] [Official] Headless and scripted use with claude -p (verified, high)
- Claim: `claude -p` runs Claude Code non-interactively for scripts and CI. The docs recommend `--bare` for scripted calls (it will become the -p default) and pre-approving only the tools needed with `--allowedTools`.
- Detail: Output: --output-format text|json|stream-json (stream-json needs --verbose; add --include-partial-messages for tokens). json gives result, session_id and total_cost_usd. '--json-schema <schema>' returns structured_output. Permissions: --allowedTools "Bash(git diff *),Bash(git commit *)" (the space before * matters); --permission-mode dontAsk (deny anything not pre-approved), auto or acceptEdits; '--permission-prompts none' (v2.1.259+) for runs with no human. --bare skips auto-discovery of hooks, skills, plugins, MCP, auto memory and CLAUDE.md, and needs ANTHROPIC_API_KEY. Without --bare, a -p session runs a project's .claude/settings.json hooks and .mcp.json servers even in an untrusted folder. Other flags: --max-budget-usd caps spend; --continue / --resume <id> chain runs; --append-system-prompt. Fan-out recipe: generate files.txt, loop 'claude -p "Migrate $file ... Return OK or FAIL." --allowedTools "Edit,Bash(git commit *)" --permission-mode dontAsk', test on 2-3 files first, then run on all. Script example: "lint:claude": "git diff main | claude -p ...".
- Use: Automation lesson. Exercise: build a 'git diff | claude -p' typo linter, then a JSON-schema extraction script parsed with jq.
- Sources: Run Claude Code programmatically <https://code.claude.com/docs/en/headless>; Best practices for Claude Code (Fan out across files) <https://code.claude.com/docs/en/best-practices>

### [practice-33] [Official] CI: GitHub Actions and Code Review (verified, high)
- Claim: anthropics/claude-code-action@v1 runs Claude Code in GitHub workflows, either replying to @claude mentions (interactive mode) or running a `prompt` automatically (automation mode), and is set up quickly with /install-github-app.
- Detail: Secrets: ANTHROPIC_API_KEY, or CLAUDE_CODE_OAUTH_TOKEN from 'claude setup-token'. Key inputs: prompt (plain text or a /skill), claude_args (e.g. '--max-turns 5 --model ... --allowedTools ...'), plugin_marketplaces, plugins, settings, trigger_phrase. Only users with write access can trigger runs, and bots are rejected unless listed in allowed_bots. Cost controls: specific @claude requests, issue templates, a concise CLAUDE.md, --max-turns, workflow timeouts, concurrency limits. Migrating from @beta: change to @v1, remove mode, rename direct_prompt to prompt, move CLI options into claude_args. The managed 'Code Review' product (Team/Enterprise; GA announced Oct 2026) reviews every PR with verifier agents and inline comments, tuned by REVIEW.md and CLAUDE.md; 'Mention @claude review' requests one.
- Use: CI lesson. Exercise: add the @claude workflow to a sandbox repo and trigger an issue-to-PR run with a bounded --max-turns.
- Sources: Claude Code GitHub Actions <https://code.claude.com/docs/en/github-actions>; How the Claude Code team does code review <https://claude.dev/blog/solving-code-review-at-anthropic/>

### [practice-34] [Official] How the Claude Code team reviews AI-written code (verified, high)
- Claim: Anthropic reports that Claude writes about 90% of Claude Code's own code, and that the team keeps quality with layered automated checks plus risk-tiered human approval in which an agent's approval never counts as a person's.
- Detail: Oct 15 2026 post (Addy Osmani, Morgan Westlee Lunt, Qing Wang). From June to September, merged PRs more than doubled while reverts fell by over 40%. Layers: verification before the PR (tests, builds, screenshots, plus a fresh-context review subagent); AI review on every PR (parallel bug hunters plus verifier voting, posting only Important, Nit or Pre-existing findings); a separate security review that can block; required CI, with a PR template asking how it was tested and how to revert; risk tiers set by the change, not the author (low: none once checks are green; medium: one person; high: two people); merge queue, flags and staged release. Rules: 'The person prompting an agent counts as a required reviewer', and approvals cover one specific commit. REVIEW.md should be short, define what failure looks like (for docs 'it lies'), cap nits, require file-and-line evidence, and open with a count. Convergence: cap at 3 review rounds, then reconsider the approach. Humans own direction, risky code, architecture and reading the evidence: 'You land it, you own it.'
- Use: Team-practice lesson on accountability. Learners draft a REVIEW.md and risk-tier table for a sample repo.
- Sources: How the Claude Code team does code review <https://claude.dev/blog/solving-code-review-at-anthropic/>

### [practice-35] [Official] Effort levels and steering long runs (corrected, high)
- Claim: Mostly correct, with three fixes: (1) the rule of thumb is Thariq Shihipar's personal usage in an Anthropic blog post ('Low: for when I want quick responses that are in the loop ... Max: When I want Claude to operate fully autonomously'), not formal policy; (2) the exact quote is that higher effort 'does not fix when the model has the wrong approach'; (3) the Apr 23, 2026 postmortem does not tell readers to use /feedback, it thanks users who did. Timing example verified: low 16 min, medium 22, high 33, max 79.
- Detail: Sep 25 2026 post (Thariq Shihipar): higher effort costs time and tokens (e.g. one spec implementation took 16 min at low vs 79 min at max). 'It does not fix a model that chose the wrong approach.' Start low to see direction early, and use high or max when no human is in the loop. The Apr 23 2026 postmortem shows why to check '/effort' when quality seems worse: a default changed from high to medium (reverted), a caching bug and a verbosity prompt caused complaints, all fixed by v2.1.116; report problems with /feedback. Opus 5.5 playbook (Sep 22 2026): drop 'think hard' / 'think step by step' lines, give the whole task and finish line in one message, add follow-ups while Claude works, set stop rules in CLAUDE.md, end runs with 'Blocked on me, Changed, Found' headings, and ask Claude to 'Mark anything you couldn't confirm, and say where you looked.'
- Use: Session-management lesson on choosing effort and writing done and stop rules. Includes a short 'when it feels dumber, check config' troubleshooting card.
- Sources: Using Claude Code: Spending your effort <https://claude.dev/blog/spending-your-effort/>; An update on recent Claude Code quality reports <https://www.anthropic.com/engineering/april-23-postmortem>; Getting the most out of Opus 5.5 in Claude and Claude Code <https://claude.dev/blog/getting-the-most-out-of-opus-5-5/>; Commands (/effort) <https://code.claude.com/docs/en/commands>
- Verifier evidence: Commands: '/effort [level|auto|status|ultracode [on|off]] ... low to xhigh, max, or auto'. Effort post (Sep 25, 2026) verbatim levels and timings. Postmortem (Apr 23, 2026): default effort lowered high->medium Mar 4 and reverted Apr 7; caching bug fixed Apr 10; verbosity prompt reverted Apr 20; 'All three issues have now been resolved as of April 20 (v2.1.116)'. Opus 5.5 playbook confirms dropping 'think step by step', mid-run follow-ups, stop rules in CLAUDE.md, 'Blocked on me, Changed, Found', 'Mark anything you couldn't confirm, and say where you looked.' <https://claude.dev/blog/spending-your-effort/>

### [practice-36] [Official] Unattended automation: scheduling, cloud sessions and safe design (verified, high)
- Claim: Anthropic's guidance for unattended runs is to state explicitly what success looks like, give read-only access wherever the agent only reads, cap spend per run, and treat a failed read as a failure, not as a quiet day.
- Detail: Scheduling options (common-workflows): cloud scheduled tasks (formerly Routines, claude.ai/code/routines, triggered by schedule, API or GitHub events), desktop scheduled tasks, GitHub Actions cron, and /loop in-session. 'When writing prompts for scheduled tasks, be explicit about what success looks like and what to do with results... it can't ask clarifying questions.' Oct 8 2026 'Building effective agent automations' (Lance Martin, CJ Avilla, built on Managed Agents): read each source from a bookmark, not a fixed window; report unreadable sources; re-check items right before posting; count a post as sent only on confirmation; re-read preferences from a store the agent can't edit; 'Limit what the agent could do if it followed' instructions in text written by others; set a spend cap at 3-5x a normal run; watch server time zones. Cloud field guide (Addy Osmani, Oct 6 2026): 'claude --cloud "..."', 'claude --teleport', push before --cloud, one task per session, name the command that proves done, use the narrowest network level, and '/autofix-pr' to watch CI and review comments. Parallel cloud sessions share your plan limits.
- Use: Automation lesson (scheduled report or PR babysitter). Checklist exercise: audit an automation prompt for success criteria, permissions, budget and failure reporting.
- Sources: Common workflows (Run Claude on a schedule) <https://code.claude.com/docs/en/common-workflows>; Building effective agent automations <https://claude.dev/blog/building-effective-agent-automations/>; Claude Code in the cloud: a field guide to cloud sessions <https://claude.dev/blog/claude-code-in-the-cloud/>

### [practice-37] [Official + Community] Claude Code for non-coding work (corrected, high)
- Claim: Claude Code in non-code folders and the role-tagged prompt library (pm, design, marketing, docs, data, ops, security) are verified. For Cowork, the product page says it is 'built for non-coding knowledge work — research, analysis, document creation', works in folders you choose, needs approval for deletes, is included in Pro, Max, Team and Enterprise, runs on desktop with web and mobile in beta, and currently shows a banner 'Claude Cowork is now just Claude'. The 'research preview in Jan 2026' date is unverified; omit it. Built-in output styles are Proactive, Concise, Explanatory and Learning.
- Detail: Docs: 'Run it inside a notes vault, a documentation folder, or any collection of markdown files to search, edit, and reorganize content the same way you would code.' The prompt library tags prompts by role (pm, design, marketing, docs, data, ops), e.g. 'read the {examples} in {folder} to learn the structure and voice, then draft a new one for {topic}', 'compare {from} to {to} and draft release notes...', 'create a {tool} using HTML, CSS, and vanilla JavaScript, then open it in my browser'. Output styles change role and tone; built-ins include Explanatory and Learning. Anthropic teams (Jul 24 2025): Growth Marketing processed ad CSVs with two subagents to generate variations; Legal built a 'phone tree' routing prototype; Product Design mapped error states. Cowork (official product page) targets research, analysis and documents, works in folders you choose, and asks approval before deletes and significant actions. Secondary sources say it launched as a research preview in Jan 2026. Japanese community: many non-engineer automation stories on Zenn, Qiita and note (reports, shift management, 39 tools); their time savings are self-reported.
- Use: Lesson for non-developer learners. Exercise: use Claude Code in a folder of markdown notes to restructure and summarize them, with a verification step (checklist or diff review).
- Sources: Common workflows (Work in notes and non-code folders) <https://code.claude.com/docs/en/common-workflows>; Prompt library <https://code.claude.com/docs/en/prompt-library>; How Anthropic teams use Claude Code <https://claude.com/blog/how-anthropic-teams-use-claude-code>; Cowork <https://claude.com/product/cowork>; 非開発者がClaude Codeで39個の業務自動化ツールを作った話 <https://zenn.dev/taku_z3nn/articles/a136f069d2cbf1>
- Verifier evidence: Common workflows: 'Run it inside a notes vault, a documentation folder, or any collection of markdown files'. Prompt library contains the three cited prompts. Anthropic teams post (Jul 24, 2025): Growth Marketing ad CSVs with two helper agents, Legal 'phone tree', Product Design 'error states, logic flows'. Output styles page lists the four built-ins. Taku's Zenn post (2026/04/07) exists: non-programmer SIer PL built 39 tools (self-reported). <https://claude.com/product/cowork>

### [practice-38] [Official] Common failure patterns (verified, high)
- Claim: The official best-practices page names five common failure patterns: the kitchen sink session, correcting over and over, the over-specified CLAUDE.md, the trust-then-verify gap, and infinite exploration, each with a fix.
- Detail: Fixes: kitchen sink -> /clear between unrelated tasks; correcting over and over -> after two failed corrections, /clear and write a better initial prompt; over-specified CLAUDE.md -> 'Ruthlessly prune. If Claude already does something correctly without the instruction, delete it or convert it to a hook'; trust-then-verify gap -> 'Always provide verification (tests, scripts, screenshots). If you can't verify it, don't ship it'; infinite exploration -> scope investigations narrowly or use subagents. Related failure modes from Anthropic harness research: one-shotting, declaring victory early, self-approval, stubbed features, context anxiety. Community (Simon Willison anti-patterns): 'Don't file pull requests with code you haven't reviewed yourself', and include evidence such as test notes and screenshots. Use /insights to generate an HTML report on your recent sessions ('where things go wrong, and features to try') and /powerup for interactive lessons. The docs close with 'Develop your intuition': the patterns are starting points.
- Use: Review lesson or end-of-course 'failure clinic'. Learners diagnose transcripts showing each pattern and prescribe the fix.
- Sources: Best practices for Claude Code (Avoid common failure patterns) <https://code.claude.com/docs/en/best-practices>; Effective harnesses for long-running agents <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>; Anti-patterns: things to avoid - Agentic Engineering Patterns <https://simonwillison.net/guides/agentic-engineering-patterns/anti-patterns/>; Commands (/insights, /powerup) <https://code.claude.com/docs/en/commands>

### [practice-39] [Official] Rolling out Claude Code in large codebases and organizations (verified, high)
- Claim: Anthropic's May 14 2026 guidance says to build the harness in order (CLAUDE.md, then hooks, skills, plugins and MCP servers, plus LSP and subagents), scope Claude to the relevant subdirectory, name a single DRI, and review the configuration every 3 to 6 months and after major model releases.
- Detail: Quotes: 'Claude works best when it's scoped to the part of the codebase that's actually relevant to the task'; 'The root file should be pointers and critical gotchas only'. Docs specifics: launch from a package directory to load that CLAUDE.md plus its ancestors; use per-directory CLAUDE.md maintained by owners; claudeMdExcludes for others' packages; permissions.deny Read rules (e.g. "Read(./**/dist/**/*)") for generated or vendored code; code intelligence plugins; worktree.sparsePaths; --add-dir or additionalDirectories for sibling packages; per-directory skills with short, keyword-first descriptions; a Stop hook that proposes CLAUDE.md updates; remove instructions that worked around older model limits. Rollout: make the codebase navigable first, invest before broad access, start with approved skills and required review, form cross-functional groups (security, governance), then expand. A Japanese summary (Qiita, Sep 2026) calls this the 'ハーネス7層'.
- Use: Team and organization lesson for leads. Exercise: produce a rollout checklist and an owner (DRI) charter for a sample monorepo.
- Sources: How Claude Code works in large codebases: Best practices and where to start <https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start>; Set up Claude Code in a monorepo or large codebase <https://code.claude.com/docs/en/large-codebases>; 「Claude Code」を大規模なコードベースに導入するためのベストプラクティス ── ハーネス7層を構築順に理解する <https://qiita.com/nogataka/items/24db436c1123ab3d4cb2>

### [practice-40] [Research / Community] Measuring productivity honestly (corrected, medium)
- Claim: The 2025 numbers are correct (16 developers, 246 issues, mainly Cursor Pro with Claude 3.5/3.7 Sonnet, 19% longer, forecast 24% speedup, still believed 20% faster). But the curriculum must add METR's Feb 24, 2026 update: METR now believes 'it is likely that developers are more sped up from AI tools now' than in early 2025, while calling its new data 'an unreliable signal' and 'only very weak evidence for the size of this increase'. The detail 'many had not used Cursor before' was not confirmed; omit it.
- Detail: Design: 16 experienced developers, 246 real tasks in their own large repos, tools mainly Cursor Pro with Claude 3.5/3.7 Sonnet. They predicted a 24% speedup and still estimated 20% faster afterwards. METR calls it a snapshot of early-2025 capabilities and warns against broad generalization (small sample; many had not used Cursor before). It predates Claude Code's current agentic workflows, so present it as a caution about perceived vs measured productivity, not as a verdict on Claude Code. Contrast with Anthropic's internal numbers (Claude writes about 90% of Claude Code's code; merged PRs more than doubled June to September 2026 with reverts down over 40%), which are vendor-reported.
- Use: Short critical-thinking sidebar in the intro or capstone lesson: measure outcomes (reverts, test pass rates, review rounds), not vibes.
- Sources: Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity <https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/>; Plan Mode 中心の Claude Code 開発手法 <https://zenn.dev/ino_h/articles/2026-05-01-claude-code-plan-mode-workflow>; How the Claude Code team does code review <https://claude.dev/blog/solving-code-review-at-anthropic/>
- Verifier evidence: METR 2025 page: 'take 19% longer to complete issues', 'a snapshot of early-2025 AI capabilities'. METR update (2026-02-24) quotes above. ino_h Zenn (2026/05/01) cites the study and the Feb 2026 follow-up, concluding planning before implementation decides whether AI speeds you up. <https://metr.org/blog/2026-02-24-uplift-update/>


## Missed by the sweep (from the verifier)
- Teaching auto mode your environment: run `/auto-mode-setup` to draft `autoMode.environment` entries into ~/.claude/settings.json (Pro, Max or Team, v2.1.228+), check the result with `claude auto-mode config` and `claude auto-mode critique`, and add a human checkpoint in auto mode with `permissions.ask` rules such as "Bash(git push *)" and "Bash(gh pr create *)". The classifier does not read `autoMode` from project settings. https://code.claude.com/docs/en/auto-mode-config
- security-guidance plugin (`/plugin install security-guidance@claude-plugins-official`, or `enabledPlugins` for a team): Claude reviews its own changes at each edit (pattern match), at the end of each turn (a separate model review) and on each commit or push. It is advisory and never blocks. The docs lay out a defense-in-depth stack: this plugin, then /security-review, the Claude Security plugin, Code Review, and CI. https://code.claude.com/docs/en/security-guidance
- Cross-session messaging (v2.1.224+ on macOS/Linux/WSL 2, v2.1.234+ on native Windows): sessions pass findings to each other via SendMessage and ListAgents, `/list-agents`, and `@session` mentions. A peer message never counts as your consent and cannot change configuration. Controlled by `crossSessionInbound` and `isolatePeerMachines`. https://code.claude.com/docs/en/cross-session-messaging
- Built-in output styles Proactive, Concise, Explanatory and Learning (`/output-style <style>`). Learning leaves `TODO(human)` pieces for the learner to write, which suits a learning platform. Custom styles drop the coding instructions unless `keep-coding-instructions: true`. https://code.claude.com/docs/en/output-styles
- Code Review product details useful for a team lesson: Find, Verify, Rank, Post stages; review levels Quick, Standard (default) and Deep; it never approves or blocks a PR; `@claude review` comment command; REVIEW.md is read from the base branch, never from the PR's own changes; not available with ZDR or HIPAA. https://code.claude.com/docs/en/code-review
- Measuring setup cost: `/skill-doctor` (v2.1.252+) shows each skill's context cost and how often it is used. https://code.claude.com/docs/en/whats-new/2026-w36 . `/usage` gives a plan-usage breakdown and, since v2.1.299, warnings for max effort, workflows, always-on context and large tool results. https://code.claude.com/docs/en/commands
- `claude plugin eval` (v2.1.269+): runs a plugin against test cases with graders and compares with a no-plugin baseline. `claude plugin eval init` drafts the cases. The plugin-level counterpart to skill-creator evals. https://code.claude.com/docs/en/plugin-evals
- Idle compaction: a long conversation left idle in the terminal on the one-hour cache TTL is compacted shortly before the cache expires (`idleCompaction`, v2.1.290+). This affects resume cost and the 'compact at natural breaks' advice. https://code.claude.com/docs/en/prompt-caching
- Recent auto-mode safety defaults: Claude Code asks before Claude first reads a file outside your working directories in auto mode, and a project-level `defaultMode: "bypassPermissions"` no longer takes effect (it must be set in user or managed settings). https://code.claude.com/docs/en/whats-new/2026-w36
- METR's Feb 24, 2026 update revises the 2025 slowdown narrative: developers are 'likely' more sped up now, but the data is weak. It belongs next to the 2025 RCT in any productivity sidebar. https://metr.org/blog/2026-02-24-uplift-update/
- Keeping the curriculum current: the official weekly 'What's new' digest and the changelog (latest at the time of writing is v2.1.304) are the authoritative sources for feature drift. Several facts in this sweep are version-gated, for example v2.1.283 (auto mode default, /doctor prompt-audit) and v2.1.304 (skill descriptions re-injected after compaction). https://code.claude.com/docs/en/whats-new
- /import (offered by /init when it finds OpenAI Codex or Gemini CLI configuration) carries another agent's instruction files, MCP servers, commands, subagents and skills into Claude Code. Relevant to the AGENTS.md lesson. https://code.claude.com/docs/en/commands

## Open questions
- The current Claude Code version as of 2026-10-20 was not checked here (the changelog angle should confirm it). Version-gated facts such as auto mode as the default from v2.1.283 and /doctor prompt-audit from v2.1.283 should be rechecked against it.
- Agent view (`claude agents`) is a research preview and agent teams are experimental. Lessons should flag both as subject to change, or treat them as optional.
- The Cowork launch date (January 2026, research preview) comes only from secondary sources. The official product page did not show a launch date. The page banner says Cowork is 'now just Claude', so the naming may be in flux.
- Boris Cherny's original tips thread (number of parallel sessions, plan-mode habits) was not read directly. Only secondhand write-ups were seen, and their numbers vary.
- Spec Kit's README example uses Copilot. Its Claude Code integration key and setup were not verified. cc-sdd command names changed in v3.0 (legacy /kiro:* is deprecated).
- The code review post's date shows as Oct 15, 2026 on claude.dev and Oct 16, 2026 on the claude.com listing. The Code Review GA announcement is dated Oct 15, 2026 on the listing.
- /ultraplan is listed as Removed in the commands reference. Older Japanese articles that teach it are outdated and should not be used as sources.
- Japanese translations of the official docs exist under code.claude.com/docs/ja/ (e.g. /docs/ja/sub-agents was in search results). Check how complete and current they are before citing them in a Japanese course.
- Time savings in Japanese non-engineer stories (Zenn, Qiita, note) are self-reported. Use them as motivation examples only, not as facts.

# Angle: learning

## Summary
Learning-design inputs for a Japanese Claude Code course, checked against the web on 2026-10-20.
EXISTING COURSES: Anthropic's Claude Academy (academy.claude.com, hosted on anthropic.skilljar.com) now splits Claude Code into four courses. (1) Claude Code 101 is the beginner course: 1.5 h, 12 lessons in the order What is Claude Code -> Your first prompt -> Daily workflows -> Customizing. (2) Claude Code in Action has been rewritten as an advanced course on long, unsupervised and team-wide runs: steer -> configure (CLAUDE.md, skills, permission modes, hooks) -> automate (routines, headless, GitHub Actions) -> verify and share (plugins). (3) Introduction to agent skills and (4) Introduction to subagents cover those two features. DeepLearning.AI's 'Claude Code: A Highly Agentic Coding Assistant' (Elie Schoppik, Intermediate, about 2 h, Python and Git assumed) teaches through projects: codebase understanding -> features -> testing/debugging/refactor -> parallel features -> GitHub and hooks -> notebook to dashboard -> Figma to web app.
JAPANESE MARKET: 2025-26 books include 実践Claude Code入門 (技術評論社, 2025-12, built around spec-driven development), 1週間でClaude Codeの基礎が学べる本 (インプレス, 2026-09-25, a 7-day beginner format that assumes Pro or higher), and 2026 titles from 秀和システム新社 and マイナビ出版. The official docs exist in Japanese at code.claude.com/docs/ja/. No Japanese Udemy course was found.
REQUIREMENTS TODAY: macOS 13+, Windows 10 1809+, Ubuntu 20.04+, Debian 10+ or Alpine 3.19+; 4 GB RAM; x64 or ARM64; internet; an Anthropic-supported country. The recommended install is the native installer (curl ... install.sh | bash, or irm ... install.ps1 | iex), with Homebrew, WinGet, apt, dnf and apk as alternatives. Node.js 22+ is needed only for the npm route. You need Pro, Max, Team, Enterprise or a Console account; the Free plan does not include Claude Code. Pro is $20/month. The Desktop app and the web (cloud sessions, which need a GitHub repository) let learners skip the terminal.
PITFALLS AND MISCONCEPTIONS (official best practices): five failure patterns (kitchen-sink session, correcting over and over, over-specified CLAUDE.md, trust-then-verify gap, infinite exploration). Context fills fast and quality drops as it fills, so use /clear, /compact, /context and /btw. Sessions start fresh; only CLAUDE.md and auto memory (the first 200 lines or 25 KB of MEMORY.md) carry over. Checkpoints (Esc Esc or /rewind) do not cover Bash changes or remote actions and do not replace git. Since v2.1.283, auto mode is the default permission mode for interactive sessions, and the user is still responsible for reviewing changes. A set ANTHROPIC_API_KEY, once approved, takes precedence over the subscription and can bill the API account. Long sessions use more of the plan limits.
PROGRESSION: the docs' 'Build your setup over time' table gives a trigger for each feature (CLAUDE.md -> output style -> skills -> MCP -> code intelligence -> subagents -> hooks -> plugins). Automation goes through claude -p, GitHub Actions and /schedule. The Champion kit gives a 30-day team rollout plan.
LEARNING SCIENCE: Anthropic's RCT (2026-01-29) found AI-assisted learners scored 17% lower on a quiz, with the biggest gap on debugging, unless they asked for explanations or conceptual help. That supports using the built-in Explanatory and Learning output styles (Learning leaves TODO(human) gaps for the learner), the interactive /powerup lessons, and comprehension checks.
Claude Code changes weekly (CHANGELOG top = 2.1.304 on 2026-10-20), so lessons should teach concepts, link to the docs, and avoid freezing UI details.

### [learning-1] Existing courses: Anthropic Claude Academy - Claude Code 101 (verified, high)
- Claim: Claude Code 101 is Anthropic's official beginner course: 1.5 hours, 12 lessons in four sections (What is Claude Code? 2, Your first prompt 2, Daily workflows 3, Customizing Claude Code 5), plus a course quiz and a completion badge.
- Detail: Audience: developers new to software engineering, and experienced engineers who haven't tried AI coding agents. Prerequisites: basic familiarity with a code editor and the command line, plus a Claude account (Pro, Max or Enterprise) or an API key. Lesson order: What is Claude Code? -> How Claude Code works -> Your first prompt / Installing Claude Code -> Daily workflows (the explore -> plan -> code -> commit workflow, Context management, Code review) -> Customizing (The CLAUDE.md file, Subagents, Skills, MCP, Hooks) -> Course quiz. Objectives include: explain how an agent differs from chat tools; the agentic loop, context window, tools and permissions; install on terminal, VS Code, JetBrains, Desktop or web; approval mode, auto-accept and Plan Mode; /compact, /clear and /context; CLAUDE.md; subagents; MCP; hooks. The docs Quickstart links this course from its 'Getting help' section.
- Use: Benchmark for the beginner track's scope and order: concepts and the agentic loop first, then install and first prompt, then the daily workflow, context and review, then customization. Our Japanese course can follow this backbone and add Japanese context, practice and checks.
- Sources: Claude Code 101 (Claude Academy) <https://academy.claude.com/courses/claude-code-101>; Claude Code 101 (Skilljar) <https://anthropic.skilljar.com/claude-code-101>; Quickstart - Getting help <https://code.claude.com/docs/en/quickstart>

### [learning-2] Existing courses: Claude Code in Action (revised, advanced) (corrected, high)
- Claim: The exact tagline is 'Run long, hands-off Claude Code sessions you can trust: steer, configure, automate, and verify'. The Academy page gives the length as 1 hour, 9 lessons plus 1 quiz, and a completion badge, so the course does state a length. Prerequisites: already using Claude Code for single prompts, and basic Git and command-line skills.
- Detail: Audience: developers who already use Claude Code for single prompts and want longer, less supervised, team-wide workflows. Curriculum: 1) Steer the Work: Steering Long Sessions (plan mode, directing compaction, the rewind menu, goal and loop runs). 2) Configure Claude: A CLAUDE.md That Follows, Verification Skills, Permission Modes, Hooks. 3) Automate Repeat Work: Routines and Headless, GitHub Actions and Code Review. 4) Verify and Share: Trust It: Verifying Unsupervised Runs, Plugins. 5) Course Quiz. The page states no length. Third-party blogs (2026) still describe an older version (15 lessons, about 1 h of video, covering file reading, commands, context and GitHub integration), so the course was evidently rewritten; I did not verify the old syllabus from an official source.
- Use: Template for the intermediate/advanced track (Unit 'long sessions and automation'): steering -> configuration (CLAUDE.md, skills, permissions, hooks) -> automation (headless, CI, routines) -> verification and sharing (plugins).
- Sources: Claude Code in Action <https://anthropic.skilljar.com/claude-code-in-action>; Anthropic Academy: 13 Free Courses on Claude Code, API, MCP and Agent Skills (Updated April 2026) <https://pasqualepillitteri.it/en/news/371/anthropic-academy-free-courses-claude>
- Verifier evidence: Skilljar and academy.claude.com both give the tagline as 'Run long, hands-off Claude Code sessions you can trust: steer, configure, automate, and verify'. The academy page lists '1 hour, 9 lessons, 1 quiz' and a 'Completion badge'. The audience is 'Developers who already use Claude Code for single prompts and want to move to longer, less supervised, team-wide workflows.' The section and lesson titles match the finding. The 'What you'll learn' section mentions 'scope work with plan mode', 'direct compaction so summaries keep what matters', 'use the rewind menu to course-correct' and 'autonomous goal and loop runs'. I did not check the older syllabus claimed by third-party blogs. <https://academy.claude.com/courses/claude-code-in-action>

### [learning-3] Existing courses: Introduction to agent skills / Introduction to subagents (verified, high)
- Claim: Anthropic offers separate short courses on Skills (6 lessons) and Subagents (4 lessons) in Claude Code.
- Detail: Introduction to agent skills, in order: What are skills? -> Creating your first skill -> Configuration and multi-file skills -> Skills vs. other Claude Code features -> Sharing skills -> Troubleshooting skills. It covers SKILL.md frontmatter and descriptions that trigger reliably, progressive disclosure, allowed-tools, sharing through repos, plugins and managed settings, and skills that won't trigger. Introduction to subagents, in order: What are subagents? -> Creating a subagent -> Designing effective subagents -> Using subagents effectively. Objectives: how subagents get inputs and return summaries; designing them with structured output, obstacle reporting and limited tool access; when not to use them.
- Use: Scope for two elective lessons in the extension unit. 'Skills vs. other features' and 'when to avoid subagents' are good discrimination exercises (sort scenarios into the right feature).
- Sources: Introduction to agent skills <https://anthropic.skilljar.com/introduction-to-agent-skills>; Introduction to subagents <https://anthropic.skilljar.com/introduction-to-subagents>

### [learning-4] Existing courses: AI Fluency 4D framework (Anthropic) (verified, high)
- Claim: Anthropic's 'AI Fluency: Framework & Foundations' course teaches a 4D framework: Delegation, Description, Discernment and Diligence, including a 'Description-Discernment loop'.
- Detail: The course goal is to 'collaborate with AI systems effectively, efficiently, ethically, and safely.' The catalog page lists the four Ds as curriculum sections but does not define them, so define them from the course itself before quoting. The Academy catalog also lists Claude 101, Claude Code 101, Claude Code in Action, Introduction to agent skills, Introduction to subagents, and AI Fluency variants for educators and students.
- Use: A meta-frame for the course's 'working with an agent' thread: what to delegate (Delegation), how to specify the task (Description, i.e. prompts and specs), judging output (Discernment, i.e. reviewing diffs and verification), and responsibility (Diligence, i.e. security and not shipping unreviewed code).
- Sources: AI Fluency: Framework & Foundations <https://anthropic.skilljar.com/ai-fluency-framework-foundations>; Anthropic Academy catalog <https://anthropic.skilljar.com/>

### [learning-5] Existing courses: DeepLearning.AI (with Anthropic) (verified, high)
- Claim: DeepLearning.AI's 'Claude Code: A Highly Agentic Coding Assistant', taught by Elie Schoppik of Anthropic, is an Intermediate course of about 2 hours (one listing says 1 h 50 min) that assumes familiarity with Python and Git.
- Detail: Lesson order: Introduction (4m) -> What is Claude Code? (8m) -> Course Notes -> Setup & Codebase Understanding (13m) -> Adding Features (17m) -> Testing, Error Debugging and Code Refactoring (12m) -> Adding Multiple Features Simultaneously (11m) -> Exploring Github Integration & Hooks (10m) -> Refactoring a Jupyter Notebook & Creating a Dashboard (12m) -> Creating Web App based on a Figma Mockup (9m) -> Conclusion -> Quiz -> Prompts & Summaries of Lessons. The three projects are a RAG chatbot codebase, an e-commerce notebook turned into a dashboard, and a Figma mockup turned into a web app, with MCP servers (Playwright, Figma). Search snippets date it to Aug 2025. A newer DeepLearning.AI short course, 'Agent Skills with Anthropic' (Beginner, about 2 h 19 min, 10 lessons), includes a Claude Code unit on skills and subagents; I saw only listing snippets for that one.
- Use: Shows a project-based order: understand the codebase -> add a feature -> test/debug/refactor -> parallel work -> GitHub and hooks -> MCP integrations. Useful for designing a running practice project, such as a small app with tests, carried across lessons.
- Sources: Claude Code: A Highly Agentic Coding Assistant <https://www.deeplearning.ai/courses/claude-code-a-highly-agentic-coding-assistant>; Agent Skills with Anthropic <https://www.deeplearning.ai/short-courses/agent-skills-with-anthropic/>

### [learning-6] Japanese books: 実践Claude Code入門 (技術評論社) (verified, high)
- Claim: 『実践Claude Code入門 ―現場で活用するためのAIコーディングの思考法』 (by 西見公宏, 吉田真吾 and 大嶋勇樹; 技術評論社, 2025-12-26; 304 pages; ¥3,300 tax incl.) is organized around spec-driven development (スペック駆動開発).
- Detail: Part 1, hands-on basics: ch1 integrating Claude Code with software engineering, ch2 Claude Code basics, ch3 MCP, ch4 spec-driven development learned from experts, ch5 using Claude Code Action. Part 2, understanding how it works and systematizing the flow: ch6 how Claude Code works, ch7 making it behave as intended, ch8-9 systematizing the spec-driven flow (design and practice). Appendix: service setup, plus Anthropic's company overview, compliance and terms. Readers: software engineers, tech leads and PMs. A review site places it after an intro book, for practical adoption.
- Use: A Japanese-market reference for the intermediate track: spec-first work (an interview producing SPEC.md, then implementation) and CI review. Students who want to go deeper can be pointed to it.
- Sources: エンジニア選書 実践Claude Code入門 ―現場で活用するためのAIコーディングの思考法 <https://gihyo.jp/book/2026/978-4-297-15354-0>

### [learning-7] Japanese books: 1週間でClaude Codeの基礎が学べる本 (インプレス) (verified, medium)
- Claim: 『1週間でClaude Codeの基礎が学べる本』 by 羽田野太巳 (インプレス, published 2026-09-25, ¥3,190 tax incl.) is a 7-day beginner book that assumes a paid Claude plan (Pro or higher).
- Detail: Day 1: get to know and set up Claude Code. Day 2: build a first app. Day 3: control Claude Code freely. Day 4: finish a small app. Day 5: external integrations and automating work. Day 6: customization and keeping code safe. Day 7: using Claude Code more broadly. Readers: people new to Claude Code, ChatGPT/Claude users wanting a next step, people who want to automate their work, and people who gave up on traditional programming study.
- Use: Evidence that Japanese beginners respond to a short, day-by-day, build-something format aimed partly at non-engineers. Supports a 'first app in a day' hook and a safety/customization lesson near the end of the beginner track.
- Sources: AIへの指示から始める新しいプログラミング入門!『1週間でClaude Codeの基礎が学べる本』を9月25日に発売 (PR TIMES release via koubo) <https://koubo.jp/press-release/prtimes/c5875_r7683>

### [learning-8] Japanese books: other 2026 titles (秀和システム新社, マイナビ出版) (verified, medium)
- Claim: Two more Japanese Claude Code books came out in 2026: 『開発効率をアップする! Claude Code 実用入門』 by 大澤文孝 (マイナビ出版, 2026-05-19, 368 pages, ¥3,300) and 『ターミナルから始める次世代AIコーディング Claude Code入門』 by 掌田津耶乃 (秀和システム新社, 2026-06-16, ¥3,300).
- Detail: マイナビ's release says the book was reprinted before launch and ranked #1 in Amazon's software development category; it lists no table of contents. 秀和's release lists its themes as install and prompt engineering (including setting up a Node.js environment and API keys), code management and automated testing (Vitest/Jest, TDD), building CLI tools up to a React app, and building MCP servers. Note that current official docs recommend the native installer, and Node.js 22+ is needed only for the npm route, so book-based setup steps may already be out of date.
- Use: Market check: Japanese books lean toward app-building and MCP. Our course can stand out by staying aligned with the current official docs (install method, auto mode) and by building in verification and review habits.
- Sources: 【発売前重版!】『開発効率をアップする! Claude Code 実用入門』発売 <https://prtimes.jp/main/html/rd/p/000000129.000016440.html>; ターミナルから始める次世代AIコーディング Claude Code入門 (press release via koubo) <https://koubo.jp/press-release/prtimes/c169048_r154>

### [learning-9] Official Japanese documentation (verified, high)
- Claim: The official Claude Code docs are published in Japanese at code.claude.com/docs/ja/ (overview, quickstart, terminal guide, memory and more), and the Japanese overview recommends Claude Academy's Claude Code 101 and Claude Code in Action.
- Detail: The Japanese overview mirrors the English one: install tabs (native, Homebrew, WinGet, apt/dnf/apk), the surfaces (Terminal, VS Code, Desktop app, Web, JetBrains), CLAUDE.md and auto memory, skills, hooks, scheduled tasks and so on. The llms.txt index lists translated indexes for Japanese and other languages. Command names and settings keys stay in English in the Japanese pages.
- Use: Every lesson can link to the Japanese doc page for further reading (a source and cite target). Shows learners where to check the latest behavior. Use the same katakana and English term pairs the docs use (for example エージェント, フック, スキル).
- Sources: 概要 - Claude Code Docs (Japanese) <https://code.claude.com/docs/ja/overview>; Documentation index (llms.txt) <https://code.claude.com/docs/llms.txt>

### [learning-10] Minimum requirements: OS, hardware, network (verified, high)
- Claim: Claude Code officially supports macOS 13.0+, Windows 10 1809+ or Windows Server 2019+, Ubuntu 20.04+, Debian 10+ and Alpine Linux 3.19+, and needs 4 GB+ RAM, an x64 or ARM64 processor, an internet connection, and Bash, Zsh, PowerShell or CMD.
- Detail: It must be used in an Anthropic-supported country. ripgrep is usually bundled. Alpine/musl needs bash, curl, libgcc, libstdc++ and ripgrep, plus USE_BUILTIN_RIPGREP=0. On macOS older than 13.0 you see errors like 'dyld: cannot load' or 'built for Mac OS X 13.0'. 32-bit Windows is not supported; opening 'Windows PowerShell (x86)' triggers that error.
- Use: The prerequisites checklist in the setup lesson, and a 'check your environment' step before install. Include the macOS-version and x86-PowerShell error messages in a troubleshooting FAQ.
- Sources: Advanced setup - System requirements <https://code.claude.com/docs/en/setup>; Terminal guide for new users - Troubleshooting <https://code.claude.com/docs/en/terminal-guide>

### [learning-11] Install methods and updates (verified, high)
- Claim: The recommended install is the native installer: `curl -fsSL https://claude.ai/install.sh | bash` (macOS/Linux/WSL), `irm https://claude.ai/install.ps1 | iex` (PowerShell), or `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` (CMD). It auto-updates in the background.
- Detail: Alternatives: `brew install --cask claude-code` (stable channel, about a week behind; `claude-code@latest` for latest), `winget install Anthropic.ClaudeCode`, and signed apt/dnf/apk repositories. Homebrew, WinGet and Linux package installs do not auto-update (`brew upgrade claude-code`, `winget upgrade Anthropic.ClaudeCode`). Verify with `claude --version`, which prints e.g. '2.1.211 (Claude Code)'; `claude doctor` prints read-only diagnostics. Update manually with `claude update`. The install command shows no progress while it downloads. If you see 'command not found', the install directory isn't on PATH yet (fix: add ~/.local/bin to PATH and open a new terminal). The release channel is set with `autoUpdatesChannel` ('latest' by default, or 'stable').
- Use: The install lesson's step-by-step and its check question (e.g. 'Which install method updates itself?'). Include the PowerShell-vs-CMD confusion messages ('The token '&&' is not a valid statement separator' / ''irm' is not recognized') as a practice diagnosis.
- Sources: Advanced setup <https://code.claude.com/docs/en/setup>; Quickstart <https://code.claude.com/docs/en/quickstart>

### [learning-12] Prerequisite misconception: Node.js (verified, high)
- Claim: Node.js is not a prerequisite for the recommended install: only the npm route (`npm install -g @anthropic-ai/claude-code`) requires Node.js 22 or later, and the installed `claude` binary does not use Node at runtime.
- Detail: On an older Node.js, npm prints an EBADENGINE warning but the install completes, because the package downloads a native binary. The docs warn: 'Do NOT use `sudo npm install -g`'. To upgrade, use `npm install -g @anthropic-ai/claude-code@latest`, not `npm update -g`. Some 2026 Japanese books still start with 'Node.js環境の構築', which reflects the older npm-first install.
- Use: A misconception check in the setup lesson ('Do I have to install Node.js first?'), and a reason to keep the course aligned with the current docs rather than with older books or blogs.
- Sources: Advanced setup - Install with npm <https://code.claude.com/docs/en/setup>; ターミナルから始める次世代AIコーディング Claude Code入門 (press release) <https://koubo.jp/press-release/prtimes/c169048_r154>

### [learning-13] Windows setup choices (verified, high)
- Claim: On Windows, Claude Code runs natively or in WSL. Native Windows does not need Administrator rights; Git for Windows is optional (it provides Git Bash for the Bash tool, and without it Claude Code uses PowerShell). Sandboxing is supported only under WSL 2.
- Detail: Option table: Native Windows (requires nothing; sandboxing not supported), WSL 2 (sandboxing supported), WSL 1 (no sandboxing). In WSL you install and launch `claude` inside the WSL terminal, not from PowerShell. If Git Bash isn't found, set `CLAUDE_CODE_GIT_BASH_PATH` in settings.json env. The terminal guide tells absolute beginners to install Git for Windows with the defaults and notes 'You won't need to learn Git yourself.'
- Use: A Windows branch in the setup lesson (many Japanese learners are on Windows), and a 'which shell am I in?' practice.
- Sources: Advanced setup - Set up on Windows <https://code.claude.com/docs/en/setup>; Terminal guide for new users <https://code.claude.com/docs/en/terminal-guide>

### [learning-14] Account and plan requirements, prices (verified, high)
- Claim: Claude Code requires a Pro, Max, Team, Enterprise or Console account (or Amazon Bedrock, Google Cloud's Agent Platform or Microsoft Foundry); 'The free claude.ai plan does not include Claude Code access.'
- Detail: claude.com/pricing as fetched: Free $0 (no Claude Code); Pro '$20 if billed monthly' ($17/month annual, $200 up front), Claude Code included; Max 'From $100' per month (5x or 20x Pro usage), included; Team Standard $25 monthly or $20/seat/month annual; Team Premium $125 monthly or $100 annual; Enterprise 'US$20/seat/month, billed annually, 20 seat minimum', with usage billed at API rates. Only Enterprise names the currency. Logging in: run `claude` and follow the browser prompts; on first Console login a 'Claude Code' workspace is created for cost tracking. `/login` switches accounts and `/logout` signs out.
- Use: The 'what you need before starting' panel in lesson 1. A check item: 'Can you use Claude Code on the Free plan?' (no). Prices change, so cite the pricing page and its fetch date instead of hard-coding them in body text.
- Sources: Advanced setup - Authenticate <https://code.claude.com/docs/en/setup>; Authentication <https://code.claude.com/docs/en/authentication>; Pricing <https://claude.com/pricing>

### [learning-15] No-terminal entry points: Desktop app and web (verified, high)
- Claim: Learners can start without a terminal: the Desktop app includes Claude Code (no separate CLI install; requires a paid subscription), and cloud sessions at claude.ai/code are available on Pro, Max and Team plans, and to Enterprise users with premium or Chat + Claude Code seats.
- Detail: Cloud sessions need a GitHub repository: Claude clones it into an isolated VM, works, and pushes a branch for you to review. They offer Auto, Accept edits and Plan modes (no Manual or Bypass). There is no separate VM charge; usage counts toward plan limits. Private repos need the Claude GitHub App. The Desktop app is available for macOS, Windows x64/ARM64 and Linux (beta, apt). Every surface uses the same engine, so CLAUDE.md, settings and MCP work everywhere.
- Use: An alternative path for non-engineers, or for learners blocked by terminal setup. A comparison table of local vs cloud vs Remote Control in the 'where Claude Code runs' lesson.
- Sources: Get started with Claude Code in the cloud <https://code.claude.com/docs/en/web-quickstart>; 概要 (Japanese overview) - Desktop app tab <https://code.claude.com/docs/ja/overview>

### [learning-16] First exercises for absolute beginners (terminal guide) (verified, high)
- Claim: The official terminal guide is for people who have never used a terminal and suggests first tasks such as `make me a simple webpage that says hello world`, then double-clicking the HTML file to open it.
- Detail: Steps: open a terminal (macOS: Cmd+Space, 'Terminal'; Linux: Ctrl+Alt+T; Windows: Win+X, PowerShell) -> paste the install command -> run `claude` -> log in through the browser. Basics: you can't click in the terminal (use the arrow keys); `Esc` interrupts Claude; `exit` or Ctrl+D twice leaves; `/help` lists commands; press Enter to choose Yes when Claude asks permission. Other suggested first tasks: rename the Desktop screenshots by their content; 'I want to build a personal budget tracker. What would I need?'
- Use: Lesson 1 (non-engineer track): a hook in which a webpage appears in a minute, plus a keyboard-basics checklist (Esc, Ctrl+D, /help, approving with Enter).
- Sources: Terminal guide for new users <https://code.claude.com/docs/en/terminal-guide>

### [learning-17] First exercises for developers (quickstart sequence) (verified, high)
- Claim: The official Quickstart orders first tasks as: install -> start in a project -> ask questions ('what does this project do?') -> make a small change ('add a hello world function to the main file') -> Git ('what files have I changed?', 'commit my changes with a descriptive message') -> fix a bug or add a feature -> other workflows (refactor, tests, README, 'review my changes').
- Detail: Before you begin: a terminal, a code project, and a subscription, Console account or cloud provider. Essential shell commands: `claude`, `claude "task"`, `claude -p "query"`, `claude -c` (continue the latest conversation), `claude -r` (resume). Session commands: `/clear`, `/help`, `/exit`. Pro tips: be specific, break the task into steps, let Claude explore first, and use '/' for commands, Tab, the up arrow and Shift+Tab to cycle permission modes. 'Claude Code reads your project files as needed. You don't have to manually add context.'
- Use: The developer track's first hands-on lesson, and the order of the first practice set (read before writing, small change, git, then a feature). The essential-commands table becomes flashcards.
- Sources: Quickstart <https://code.claude.com/docs/en/quickstart>; Common workflows <https://code.claude.com/docs/en/common-workflows>

### [learning-18] Misconception: treating it like chat or autocomplete (verified, high)
- Claim: Claude Code works as an agentic loop of 'gather context, take action, and verify results', using tools (file operations, search, execution, web, code intelligence). The docs contrast it with inline assistants that 'only see the current file.'
- Detail: 'Tools are what make Claude Code agentic. Without tools, Claude can only respond with text.' When you say 'fix the failing tests', Claude may run the tests, read the errors, search the source, edit, and rerun. It can access your project files, your terminal ('Any command you could run'), git state, CLAUDE.md, auto memory, and configured extensions. Advice: 'Delegate, don't dictate'; 'It's a conversation' (iterate rather than restart). The Champion kit answers 'Is this just autocomplete?' with a demo of explaining an unfamiliar file or tracing a bug across services. Best practices: 'Unlike a chatbot that answers questions and waits, Claude Code can read your files, run commands, make changes...'
- Use: The concept segment of lesson 1, with a diagram of the agentic loop. Predict prompt: 'What happens when you ask it to fix the failing tests?' Misconception item: 'It only sees the file I paste.'
- Sources: How Claude Code works <https://code.claude.com/docs/en/how-claude-code-works>; Champion kit <https://code.claude.com/docs/en/champion-kit>; Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>

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

### [learning-22] Verification as the core habit (verified, high)
- Claim: The first official best practice is 'Give Claude a way to verify its work': tests, a build, a linter or a screenshot comparison, so that Claude iterates until the check passes instead of stopping when the work 'looks done'.
- Detail: Before/after examples: 'implement a function that validates email addresses' becomes 'write a validateEmail function. example test cases: ... run the tests after implementing'; 'the build is failing' becomes 'the build fails with this error: [paste error]. fix it and verify the build succeeds. address the root cause, don't suppress the error'. Escalation: ask in one prompt -> a `/goal` condition across a session -> a Stop hook as a deterministic gate -> a verification subagent for a second opinion. 'Have Claude show evidence rather than asserting success.' Bundled `/code-review` reviews the diff in a fresh subagent; `/verify` runs the app. Practitioner Simon Willison starts sessions on existing projects with 'First run the tests', so the agent finds the test suite and adopts a testing mindset.
- Use: A recurring thread in every practice exercise (each task includes a check). A dedicated 'verification' lesson. Inline check: rewrite a vague prompt into one that includes a check.
- Sources: Best practices - Give Claude a way to verify its work <https://code.claude.com/docs/en/best-practices>; First run the tests (Agentic Engineering Patterns) <https://simonwillison.net/guides/agentic-engineering-patterns/first-run-the-tests/>

### [learning-23] Explore -> Plan -> Implement -> Commit workflow (verified, high)
- Claim: The officially recommended workflow has four phases (Explore, Plan, Implement, Commit), with plan mode entered by pressing `Shift+Tab` until the status bar shows `⏸ plan mode on`, by `claude --permission-mode plan`, or by `/plan`.
- Detail: In plan mode Claude reads and answers without editing. `Ctrl+G` opens the plan in your editor for direct editing. After approving the plan, switch out and implement with tests, then 'commit with a descriptive message and open a PR'. The docs caution: 'If you could describe the diff in one sentence, skip the plan.' Planning pays off when the approach is uncertain, the change touches multiple files, or the code is unfamiliar. For larger features, have Claude interview you with the AskUserQuestion tool and write SPEC.md, then start a fresh session to implement it.
- Use: The workflow lesson. A sorting exercise: plan or skip the plan for given tasks (typo fix vs OAuth integration). The spec interview becomes an intermediate practice.
- Sources: Best practices - Explore first, then plan, then code <https://code.claude.com/docs/en/best-practices>; Commands - /plan <https://code.claude.com/docs/en/commands>

### [learning-24] Unclear prompts: how to make them specific (verified, high)
- Claim: Official guidance gives four prompt-specificity strategies (scope the task, point to sources, reference existing patterns, describe the symptom), and says to use `@` to reference files, paste images, give URLs, or pipe data in.
- Detail: Examples: 'add tests for foo.py' becomes 'write a test for foo.py covering the edge case where the user is logged out. avoid mocks.'; 'fix the login bug' becomes 'users report that login fails after session timeout. check the auth flow in src/auth/, especially token refresh. write a failing test that reproduces the issue, then fix it'. Piping: `cat error.log | claude -p "explain this error"`. An `@file` reference includes a file's content when it fits the Read tool's limit (25,000 tokens by default). Vague prompts are acceptable while exploring. The Champion kit adds: 'Recover from an incorrect result' by pasting the failing test or stack trace rather than rephrasing, and 'Keep edits surgical' by saying 'only change X.'
- Use: A prompt-rewriting worked example and practice (before -> after) in the prompting lesson. Grading rubric: does the prompt name the location, the constraints and a 'done' condition?
- Sources: Best practices - Provide specific context in your prompts <https://code.claude.com/docs/en/best-practices>; Champion kit - Quick-reference sheet <https://code.claude.com/docs/en/champion-kit>

### [learning-25] Permission modes (permission confusion) (corrected, high)
- Claim: The six modes and the v2.1.283 starting-mode rule are correct (before v2.1.283, auto was the starting mode only on Pro, Max and Team). Add these caveats. Auto mode needs a supported model (on the Anthropic API: Opus 4.6+, Sonnet 4.6+, Haiku 5.5 or a Fable model), and Team/Enterprise admins can turn it off with permissions.disableAutoMode. dontAsk allows file reads inside your working directories and pre-approved tools, and denies everything else. dontAsk never appears in the Shift+Tab cycle. In v2.1.302+, `claude -p` and Agent SDK runs with no mode set start in Manual.
- Detail: What runs without asking: Manual runs reads only; acceptEdits runs reads, file edits and common filesystem commands; plan runs reads (plus classifier-approved commands where auto is available); auto runs 'Everything, with background safety checks', with a classifier blocking risky actions; dontAsk runs only pre-approved tools and denies everything else (for CI); bypassPermissions runs 'Everything', for 'Isolated containers and VMs only'. The Shift+Tab cycle goes from auto to default -> acceptEdits -> plan. Start with `--permission-mode <mode>` or set `permissions.defaultMode`. Allowlists (`/permissions`) and `/sandbox` reduce prompts. Best practices warn that in Manual mode 'After the tenth approval you're clicking through rather than reviewing.' bypassPermissions 'offers no protection against prompt injection' and refuses to run as root.
- Use: A permissions lesson with a mode-matching exercise (scenario -> mode), and a misconception item: 'auto mode means no risk' (false; the user still reviews). Screenshots and UI text vary by version, so teach the concepts and point to the docs.
- Sources: Choose a permission mode <https://code.claude.com/docs/en/permission-modes>; Best practices - Configure permissions <https://code.claude.com/docs/en/best-practices>
- Verifier evidence: Permission-modes table: dontAsk = 'File reads inside your working directories and pre-approved tools; anything that would prompt is denied'. bypassPermissions = 'Everything', for 'Isolated containers and VMs only'. It also says: 'From auto, the first press switches to default, and the cycle then runs default -> acceptEdits -> plan'; 'bypassPermissions offers no protection against prompt injection'; and it refuses root/sudo. Auto mode is on 'All plans', with the model requirements listed. Best practices: 'After the tenth approval you're clicking through rather than reviewing.' <https://code.claude.com/docs/en/permission-modes>

### [learning-26] Accepting changes without review / checkpoints are not git (verified, high)
- Claim: Checkpoints (Esc twice or `/rewind`) restore only changes made by Claude's file-editing tools. Changes made by Bash commands (e.g. `rm`, `mv`, `cp`), most subagent edits, external edits and remote actions (databases, APIs, deployments) are not restored, and checkpoints are 'Not a replacement for version control.'
- Detail: A checkpoint is created for every prompt that starts a turn, and the 100 most recent are kept per session. The rewind menu offers Restore code and conversation / Restore conversation / Restore code / Summarize from here / Summarize up to here. Snapshots are deleted after about 30 days by default (cleanupPeriodDays). `/diff` shows working-tree changes. Security docs: 'You're responsible for reviewing proposed code and commands for safety before approval.' Simon Willison's anti-pattern: 'Don't file pull requests with code you haven't reviewed yourself.'
- Use: A safety-net lesson: practise rewind in a sandbox repo, then show that a Bash `rm` is not undone, which motivates committing often with git. Habit: review /diff before every commit.
- Sources: Checkpointing - Limitations <https://code.claude.com/docs/en/checkpointing>; Security - User responsibility <https://code.claude.com/docs/en/security>; Anti-patterns: things to avoid (Agentic Engineering Patterns) <https://simonwillison.net/guides/agentic-engineering-patterns/anti-patterns/>

### [learning-27] Security: prompt injection and untrusted content (verified, high)
- Claim: The official best practices for untrusted content are: '1. Review suggested commands before approval 2. Avoid piping untrusted content directly to Claude 3. Verify proposed changes to critical files 4. Use virtual machines (VMs) to run scripts and make tool calls... 5. Report suspicious behavior with `/feedback`'.
- Detail: The workspace trust dialog appears when you start in an untrusted folder, and a project's `.mcp.json` servers have their own approval prompt. A `-p` session shows neither prompt. Starting in your home directory means trust is not saved, so start from a project subdirectory. Network commands such as `curl` and `wget` are not auto-approved by default. In Manual mode, Claude asks before file tools read or write outside the working directory, but an approved Bash command can write anywhere. Use only MCP servers from providers you trust; Anthropic does not security-audit MCP servers. `/security-review` checks branch changes for vulnerabilities.
- Use: A security lesson for both tracks: a scenario quiz (an issue text containing hidden instructions, piping in web content), plus a team checklist.
- Sources: Security <https://code.claude.com/docs/en/security>

### [learning-28] Cost surprises and usage tracking (verified, high)
- Claim: Across enterprise deployments, Anthropic reports average Claude Code costs of 'around $13 per developer per active day and $150-250 per developer per month, with costs remaining below $30 per active day for 90% of users.'
- Detail: Subscription users (Pro, Max, Team, Enterprise) draw on plan usage limits; Team and Enterprise seats reset on a rolling five-hour window and a weekly window. Console and cloud-provider users pay per token. `/usage` (aliases `/cost`, `/stats`) shows session cost, plan usage bars and an attribution breakdown. Reasons usage climbs: long context re-sent with every request, cache misses after breaks, scheduled tasks, subagents and workflows, agent teammates, and compaction. 'When you want a fresh start instead of continuity, `/clear` costs nothing.' Tips: Sonnet for most coding (Opus for complex architecture), specific prompts, plan mode, CLI tools over MCP, fewer unused MCP servers, CLAUDE.md under 200 lines. Agent teams use about 7x more tokens in plan mode. Background usage is typically under $0.04 per session.
- Use: A 'cost and limits' lesson. Exercise: open /usage and explain why a long session cost more. Flashcard: '/clear costs nothing; /compact is itself a large request.'
- Sources: Manage costs effectively <https://code.claude.com/docs/en/costs>; Commands - /usage <https://code.claude.com/docs/en/commands>

### [learning-29] Billing pitfall: ANTHROPIC_API_KEY overrides the subscription (verified, high)
- Claim: If you have a Claude subscription but `ANTHROPIC_API_KEY` is set in your environment, Claude Code uses the API key once you approve it (in `-p` mode it is always used), so usage can bill the API account instead of the plan.
- Detail: Authentication precedence: cloud-provider variables -> `ANTHROPIC_AUTH_TOKEN` -> `ANTHROPIC_API_KEY` -> apiKeyHelper -> `CLAUDE_CODE_OAUTH_TOKEN` -> Anthropic profile/federation -> subscription OAuth from `/login`. Fix: `unset ANTHROPIC_API_KEY` and check `/status` for the active login method. The approval choice can be changed with the 'Use custom API key' toggle in `/config`. Cloud sessions always use subscription credentials. `claude setup-token` produces a one-year OAuth token (CLAUDE_CODE_OAUTH_TOKEN) for CI on a subscription.
- Use: A short 'why was I billed on the API?' segment in the setup or costs lesson, and a troubleshooting FAQ entry.
- Sources: Authentication - Authentication precedence <https://code.claude.com/docs/en/authentication>

### [learning-30] Skill progression: when to add each extension (verified, high)
- Claim: The docs advise new users to 'Start with CLAUDE.md for project conventions, then add other extensions as specific triggers come up', and give a trigger table for the order most teams follow.
- Detail: Triggers: Claude gets a convention or command wrong twice -> CLAUDE.md. You keep asking for shorter or more explanatory answers -> an output style. You keep typing the same prompt -> a user-invocable skill. You paste the same playbook a third time -> a skill. You keep copying data from a browser tab -> an MCP server. Claude reads many files to find a symbol -> a code intelligence plugin. A side task floods the conversation -> a subagent. Something must happen every time -> a hook. A second repo needs the same setup -> a plugin. Key distinction: CLAUDE.md and skills are instructions ('a request, not a guarantee'), while hooks are deterministic ('Put guardrails in hooks'). Context cost: CLAUDE.md on every request; skills are low (descriptions only); subagents are isolated; hooks cost zero unless they return output.
- Use: The spine of the intermediate track: one lesson per trigger. A matching exercise (scenario -> feature) assesses an 'analyze'-level objective. Good for the final exam.
- Sources: Extend Claude Code - Build your setup over time <https://code.claude.com/docs/en/features-overview>

### [learning-31] Automation level: headless, CI, scheduling, parallel sessions (verified, high)
- Claim: Automation uses non-interactive mode: `claude -p "prompt"` with `--output-format json` or `stream-json --verbose`, `--allowedTools` to pre-approve tools, and `--permission-mode dontAsk` to deny anything else in unattended runs.
- Detail: Fan-out loop: `for file in $(cat files.txt); do claude -p "Migrate $file ..." --allowedTools "Edit,Bash(git commit *)" --permission-mode dontAsk; done`. Test the prompt on 2-3 files before running all of them. `/batch <instruction>` splits work across 5 to 30 subagents, each in its own worktree. Parallel sessions: `claude --worktree <name>`, agent view (`claude agents`), and cloud sessions. Writer/Reviewer pattern: a fresh session reviews code another session wrote. GitHub: `/install-github-app` sets up the app and Actions; managed Code Review. Scheduling: `/schedule` (cloud scheduled tasks, formerly routines), Desktop scheduled tasks, and `/loop` within a session. Prompts for scheduled tasks must state what success looks like, because the run can't ask questions.
- Use: The advanced and team track: a lesson on headless and CI, and a capstone that automates a repo chore with `claude -p` plus review gating.
- Sources: Best practices - Automate and scale <https://code.claude.com/docs/en/best-practices>; Common workflows - Run Claude on a schedule <https://code.claude.com/docs/en/common-workflows>; Commands - /install-github-app, /schedule, /loop, /batch <https://code.claude.com/docs/en/commands>

### [learning-32] Built-in learning features: output styles, /powerup, /insights (verified, high)
- Claim: Claude Code ships learning-oriented output styles: 'Explanatory' adds `★ Insight` blocks explaining its choices, and 'Learning' also leaves `TODO(human)` spots for the learner to write code, then waits. `/powerup` gives 'quick interactive lessons with animated demos'.
- Detail: Switch styles with `/output-style <style>` (e.g. `/output-style learning`; requires v2.1.269+ in some contexts), with `/config` -> Output style, or with an `outputStyle` setting ('Explanatory' and 'Learning' are case-sensitive in settings). There are four built-in styles besides Default: Proactive, Concise, Explanatory and Learning. Explanatory and Learning produce longer responses, which costs more output tokens. `/insights` writes an HTML report on your recent sessions (friction points, suggestions) to ~/.claude/usage-data/report.html. Claude can also answer questions about itself from the current docs ('how do I set up hooks?'), and `/init` generates a starter CLAUDE.md.
- Use: Recommend that learners turn on the Learning style during practice so they write the key logic themselves. Use /powerup as optional self-study, and /insights as a reflection activity at the end of a unit.
- Sources: Output styles <https://code.claude.com/docs/en/output-styles>; Commands - /powerup, /insights <https://code.claude.com/docs/en/commands>; Manage costs - Analyze your usage patterns <https://code.claude.com/docs/en/costs>

### [learning-33] Learning science: AI assistance and skill formation (Anthropic RCT) (verified, high)
- Claim: In Anthropic's randomized controlled trial (published 2026-01-29; 52 mostly junior engineers learning the Python Trio library), the AI-assisted group scored 50% on a follow-up quiz versus 67% for hand-coders ('nearly two letter grades'; Cohen's d = 0.738, p = 0.01), with no significant speed gain and the largest gap on debugging questions.
- Detail: Patterns linked to low quiz scores (under 40%): AI delegation, progressive AI reliance, and iterative AI debugging. Patterns linked to high scores (65%+): generation-then-comprehension, hybrid code-explanation, and conceptual inquiry. The authors write that 'Cognitive effort—and even getting painfully stuck—is likely important for fostering mastery,' and point to Claude Code's Learning and Explanatory modes. Caveats: a small sample, a short-term quiz, and the setup was an AI sidebar rather than an agentic tool like Claude Code (they expect agentic tools could have a larger effect). The full paper is arXiv 2601.20245.
- Use: Design rationale for the course: after each agent-driven exercise, include comprehension checks ('explain this diff', 'predict what the test will do'), encourage 'ask for an explanation' prompts, and give one debugging task to do without the agent. Cite this in the course intro on why we learn to understand, not just delegate.
- Sources: How AI assistance impacts the formation of coding skills <https://www.anthropic.com/research/AI-assistance-coding-skills>

### [learning-34] Practitioner framing: vibe coding vs vibe/agentic engineering (verified, medium)
- Claim: Simon Willison defines 'vibe engineering' (7 Oct 2025) as the opposite of vibe coding: 'seasoned professionals accelerate their work with LLMs while staying proudly and confidently accountable' for the software. He lists the practices that make coding agents work well.
- Detail: His practices: automated testing, planning in advance, comprehensive documentation, good version control, effective automation (CI, formatting, linting, preview deploys), a code review culture, managing agents like collaborators, strong manual QA, research skills, preview environments, judgment about what to delegate, and updated estimation. His work-in-progress 'Agentic Engineering Patterns' guide is organized as Principles (incl. 'Anti-patterns: things to avoid') -> Working with coding agents (How coding agents work, Using Git with coding agents, Subagents) -> Testing and QA (Red/green TDD, First run the tests, Agentic manual testing) -> Understanding code (Linear walkthroughs, Interactive explanations) -> Annotated prompts.
- Use: Frames the course goal as moving from 'vibe coding' to accountable agentic engineering. The guide's section order (principles -> git -> tests -> understanding code) is another sequencing reference for the intermediate track.
- Sources: Vibe engineering <https://simonwillison.net/2025/Oct/7/vibe-engineering/>; Agentic Engineering Patterns <https://simonwillison.net/guides/agentic-engineering-patterns/>

### [learning-35] Team adoption progression (Champion kit) (verified, high)
- Claim: The official Champion kit gives a thirty-day team adoption playbook: Week 1, seed a channel with your own examples; Week 2, start a weekly show-and-tell and share a skill or CLAUDE.md snippet; Week 3, pair and consolidate an FAQ; Week 4, hand off to a second champion.
- Detail: It recommends a 'real but contained task' as the first try: 'a bug or chore the person has been postponing because it is tedious rather than difficult.' `/team-onboarding` generates a guide from your last 30 days of usage that a teammate can paste as their first message. On the concern 'It will make junior engineers weaker', it suggests having them ask Claude to explain a file and its call sites before changing anything. On 'I tried it once and it hallucinated': 'usually a context problem rather than a model problem', fixed with @-mentions, /init and the real error output. It also says 'Claude Code is updated frequently. Verify version-specific details' against the docs.
- Use: Content for a team/organization lesson (the last unit), a recommended first real task for the practice brief, and answers to learner and manager objections.
- Sources: Champion kit <https://code.claude.com/docs/en/champion-kit>; Commands - /team-onboarding <https://code.claude.com/docs/en/commands>

### [learning-36] Change rate and source of truth (verified, high)
- Claim: Claude Code changes very quickly: the top entry of the official CHANGELOG.md on 2026-10-20 is version 2.1.304, the docs contain many version gates (e.g. auto mode as the default from v2.1.283), and the older engineering blog URL anthropic.com/engineering/claude-code-best-practices now permanently redirects (308) to the docs' best-practices page.
- Detail: The docs site has weekly 'What's new' pages (latest listed: Week 37, September 7-11, 2026) and a changelog page. Command details change too: `/agents` now prints a reminder rather than opening the old interactive UI (v2.1.197 and earlier), `/cost` and `/stats` are aliases of `/usage`, and `/vim` was removed in v2.1.92. Exact release dates per version were not confirmed, because GitHub API access was unavailable in this session.
- Use: Authoring policy: teach stable concepts (agentic loop, context, verification, permissions, extension triggers), cite the docs for exact UI and commands, add a 'confirmed on 2026-10' note, and plan a quarterly content review. Avoid screenshots of version-specific UI where possible.
- Sources: Claude Code CHANGELOG.md <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>; Best practices for Claude Code (redirect target) <https://code.claude.com/docs/en/best-practices>; Documentation index (What's New) <https://code.claude.com/docs/llms.txt>


## Missed by the sweep (from the verifier)
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

## Open questions
- Claude Code in Action (revised) does not list its length or lesson count; the older 2025 syllabus (15 lessons, about 1 h of video) is known only from third-party blogs.
- Claude Code 101 shows a 'Completion badge'; it is unclear whether a formal certificate is still issued (third-party posts say 'certificates').
- I could not confirm the tables of contents for the 2026 Japanese books from 秀和システム新社 and マイナビ出版; I have only themes from the publisher press releases.
- No Japanese-language Udemy course on Claude Code was found in search; this could change, so check Udemy directly if needed.
- The release date of Claude Code 2.1.304 (top of the CHANGELOG on 2026-10-20) is not confirmed, because the GitHub API was not accessible from this session.
- The 4D definitions of AI Fluency (Delegation, Description, Discernment, Diligence) are not on the catalog page; read the course itself before quoting definitions.
- The Anthropic skill-formation RCT used an AI sidebar, not an agentic tool. How strongly its findings carry over to Claude Code learners is not established.
- Boris Cherny's widely repeated claim that verification '2-3x' quality comes only from secondhand write-ups; it was not verified against his original post, so it is left out of the findings.
- Prices on claude.com/pricing show '$' without a currency for individual and Team plans; Japanese-yen pricing and taxes for Japanese learners were not checked.

# Angle: safety

## Summary
Angle: safety, governance and cost, checked against official Anthropic sources on 2026-10-20. The latest CHANGELOG release is v2.1.304.
1) Permission model: Claude Code has six modes: default (shown as "Manual"), acceptEdits, plan, auto, dontAsk and bypassPermissions. Shift+Tab cycles through them. Since v2.1.283, auto mode is the built-in starting mode for interactive terminal and VS Code sessions. Since 14 Aug 2026 it is the default for new Pro, Max and Team sessions. Since v2.1.302, `claude -p` and SDK runs with no mode set start in Manual.
2) Rules: allow/ask/deny rules are checked in a fixed order (deny, then ask, then allow), and the first match wins. Claude Code enforces them, not the model, so writing a rule in CLAUDE.md does not enforce it. Bash patterns match the command as written and are explicitly "not a security boundary" (/usr/bin/curl and sh -c get around them). For real enforcement the docs point to the OS sandbox or a PreToolUse hook. Read/Edit rules use gitignore syntax (// means absolute, ~/ means home, /path is relative to the settings file). A `.claudeignore` file has no effect.
3) Sandboxing: off by default. Turn it on with /sandbox or sandbox.enabled. It uses Seatbelt on macOS and bubblewrap+socat on Linux/WSL2, and native Windows is not supported. It covers shell commands only. Built-in file tools, MCP servers and hooks run outside it, so wrapping the whole process needs `srt claude`, a dev container or a VM. Documented limits: domain fronting, broad domains such as github.com, docker.sock. Anthropic says sandboxing cut its internal permission prompts by 84%.
4) Prompt injection: the docs list layered mitigations: approval for network commands, WebFetch page summaries, workspace trust, command-injection detection and fail-closed matching. Auto mode adds a server-side probe that scans tool output for injection, plus a transcript classifier that never sees tool results. Anthropic's own numbers: 0.4% false positives and 17% false negatives on real overeager actions; 0/720 Trajectory Labs injection attempts succeeded; humans caught 13.6% of dangerous commands vs 89% blocked by auto mode. Anthropic still says to review high-stakes production changes yourself.
5) Data: consumer plans (Free/Pro/Max) choose whether their data trains models; data is kept 5 years if they opt in, otherwise 30 days. Commercial plans (Team/Enterprise/API) are not trained on and data is kept 30 days. ZDR is only for qualified Enterprise organisations. Local transcripts are stored in plain text under ~/.claude/projects for 30 days (cleanupPeriodDays). Telemetry opt-out variables exist.
6) Governance: managed settings are delivered by file, MDM or the server, and nothing can override them. Managed-only locks include allowManagedPermissionRulesOnly, disableBypassPermissionsMode, availableModels and forceLoginOrgUUID. Server-managed settings are explicitly a client-side control, not a security boundary.
7) Reviewing changes: checkpoints and /rewind track only edits made by Claude's file tools, not Bash changes, and the docs say they don't replace git. Other review tools: /diff, /code-review, /security-review.
8) Cost: /usage (with /cost and /stats as aliases) and --max-budget-usd. Official averages: about $13 per developer per active day, $150-250 per month, and 90% of users under $30 per active day. Prices read on claude.com/pricing today: Pro $20/month ($17 annual), Max from $100, Team Standard $25 ($20 annual), Team Premium $125 ($100 annual), Enterprise $20/seat plus usage at API rates; Free does not include Claude Code. Plan limits run on a 5-hour window plus a weekly limit, shared with chat. If ANTHROPIC_API_KEY is set, it overrides the subscription and you are billed for API usage.
9) Japan: Japan is on the official supported-regions lists. Up-to-date Japanese docs exist at code.claude.com/docs/ja and give the official terms (権限モード, 分類器, サンドボックス化, チェックポイント, 管理設定). The `language: "japanese"` setting sets the response language.

### [safety-1] Permission modes (verified, high)
- Claim: Claude Code has six permission modes: default (labeled Manual, alias `manual`), acceptEdits, plan, auto, dontAsk and bypassPermissions, set with `permissions.defaultMode`, `--permission-mode`, or Shift+Tab in the CLI.
- Detail: default/Manual: reads only run without asking. acceptEdits: auto-accepts file edits and common filesystem commands (mkdir, touch, rm, rmdir, mv, cp, sed) inside the working directory. plan: Claude reads and proposes but doesn't edit source until you approve the plan (enter with Shift+Tab, a `/plan` prefix, or `claude --permission-mode plan`; Ctrl+G opens the plan in your editor). auto: a classifier reviews actions instead of you. dontAsk: auto-denies anything that would prompt; meant for CI; not in the Shift+Tab cycle. bypassPermissions: skips prompts; for isolated environments only. Shift+Tab cycle from auto: default → acceptEdits → plan, then the optional modes. `--dangerously-skip-permissions` equals bypassPermissions. Deny rules still block in every mode, including bypassPermissions. The official Japanese docs call these 権限モード, and the plan mode heading reads プランモード.
- Use: Lesson 1 (権限モード入門): a comparison table of modes plus a quiz that has learners pick the right mode for a scenario (exploring vs refactoring vs CI).
- Sources: Choose a permission mode <https://code.claude.com/docs/en/permission-modes>; Configure permissions <https://code.claude.com/docs/en/permissions>; 権限モードを選択する <https://code.claude.com/docs/ja/permission-modes>

### [safety-2] Auto mode as the default (corrected, high)
- Claim: With v2.1.283+, auto is the built-in starting mode for interactive terminal and VS Code sessions on every plan and provider (the docs now say so explicitly), except orgs with the HIPAA configuration applied, which start in Manual (v2.1.285+). The Aug 7, 2026 announcement first made it default from Aug 14 for Pro/Max/Team and said Enterprise, the Claude API and cloud providers would follow 'In the coming month' (not 'within about a month'). claude -p and Agent SDK runs with no mode set start in Manual from v2.1.302. Start-mode order: --permission-mode/--dangerously-skip-permissions > permissions.defaultMode (auto or bypassPermissions in .claude/settings.json or settings.local.json don't take effect) > built-in default; any settings file with disableAutoMode "disable" makes the default Manual. A user-set default stays unless they accept the one-time switch prompt, and an org-managed default doesn't change. Supported models on the Anthropic API: Opus 4.6+, Sonnet 4.6+, Haiku 5.5, Fable; on Bedrock/Agent Platform/Foundry only Sonnet 5+, Opus 4.7+, Haiku 5.5, Fable.
- Detail: How the starting mode is chosen: (1) `--permission-mode` or `--dangerously-skip-permissions`; (2) `permissions.defaultMode` in a settings file, except that "auto" or "bypassPermissions" in a project's .claude/settings.json or settings.local.json does not take effect; (3) the built-in default. If any settings file sets `disableAutoMode` to "disable", the default is `default`. The Aug 7, 2026 announcement said Enterprise, the Claude API and cloud providers stayed opt-in for the time being, with a plan to switch them within about a month. Users who had set their own default kept it unless they accepted a one-time switch prompt. Auto mode works on all plans with supported models only: on the Anthropic API, Opus 4.6+, Sonnet 4.6+, Haiku 5.5 or Fable; Sonnet 4.5, Opus 4.5, Haiku 4.5 and claude-3 models are not supported. Team/Enterprise admins can turn it off with `permissions.disableAutoMode`.
- Use: Lesson 1: explain why a fresh install now starts in auto mode, and how to switch back to Manual mode or pin a default. Exercise: write a ~/.claude/settings.json that sets defaultMode.
- Sources: Choose a permission mode — Which mode a session starts in <https://code.claude.com/docs/en/permission-modes>; Auto mode is now the default in Claude Code for Pro, Max, and Team plans <https://claude.com/blog/auto-mode-default-in-claude-code>; Week 32 · August 3–7, 2026 <https://code.claude.com/docs/en/whats-new/2026-w32>
- Verifier evidence: permission-modes: 'With Claude Code v2.1.283 or later, auto mode is the built-in starting permission mode for interactive terminal and VS Code sessions on every plan and provider'; HIPAA row: 'default with Claude Code v2.1.285 or later'; 'In Claude Code v2.1.302 or later, claude -p and Agent SDK runs with no permission mode set start in Manual mode.' Blog (Aug 7, 2026): 'Starting on August 14, new sessions on Pro, Max, and Team plans will run in auto mode'; 'Auto mode remains opt-in for now on Claude Enterprise, the Claude API ...'; 'In the coming month, working with our cloud partners.' Week 32 digest: 'If you set a default mode yourself, it stays in place unless you accept the one-time switch prompt, and a default your organization manages doesn't change.' <https://code.claude.com/docs/en/permission-modes>

### [safety-3] How the auto mode classifier works (verified, high)
- Claim: In auto mode a separate classifier model checks non-read-only actions before they run. It sees user messages, tool calls and CLAUDE.md, but tool results are stripped from its input, which is the main defence against prompt injection.
- Detail: Decision order, first match wins: explicit allow/ask/deny rules; then read-only actions and working-directory edits are auto-approved (except writes to protected paths and the first read outside the working directories); everything else goes to the classifier. When auto mode starts, broad allow rules are dropped: Bash(*), wildcarded interpreters such as Bash(python*), package-manager run commands, Agent rules and Monitor rules. Narrow rules such as Bash(npm test) stay. The default classifier model is Claude Sonnet 5 (override with `CLAUDE_CODE_AUTO_MODE_MODEL`, v2.1.302+). Fallback: 3 blocks in a row or 20 in total pause auto mode and return to prompting (not configurable). Denials appear in /permissions under 'Recently denied', where `r` retries. The engineering post describes a second, input-side layer: a server-side probe scans tool output for injection and adds a warning. The classifier also never sees assistant text, so the agent can't argue its way past it.
- Use: Lesson 4 (プロンプトインジェクション): a diagram of the two layers (input probe and transcript classifier). Discussion question: why does hiding tool results from the classifier help?
- Sources: Choose a permission mode — Eliminate prompts with auto mode <https://code.claude.com/docs/en/permission-modes>; How we built Claude Code auto mode: a safer way to skip permissions <https://www.anthropic.com/engineering/claude-code-auto-mode>

### [safety-4] What auto mode blocks and allows by default (verified, high)
- Claim: By default auto mode blocks high-risk actions: curl|bash, sending sensitive data outside, production deploys and migrations, force push, git reset --hard, terraform/pulumi/cdk destroy, and merging a PR no human approved. It allows routine local work.
- Detail: Blocked by default (examples from the docs): downloading and executing code; mass deletion on cloud storage; granting IAM or repo permissions; `git checkout -- .`, `git restore .`, `git clean -fd`, `git stash drop/clear`; `git commit --amend` on a HEAD not created in this session; disabling CI checks; cloud instance-metadata requests (169.254.169.254); posting content to public paste services. Allowed by default: local file operations in the working directory; installing dependencies declared in lock files or manifests; reading .env and sending credentials to their matching API; read-only HTTP; pushing to any branch of the working repo except deploy-like names such as production or gh-pages. The classifier trusts only the working directory and the repo's configured remotes, so pushes to your company org or writes to team buckets are blocked until you add them to `autoMode.environment`.
- Use: Lesson 4 exercise: sort ten example commands into 'blocked' and 'allowed' under auto mode, then explain each choice.
- Sources: Choose a permission mode <https://code.claude.com/docs/en/permission-modes>; Configure auto mode <https://code.claude.com/docs/en/auto-mode-config>

### [safety-5] How well auto mode works, and its limits (verified, high)
- Claim: Anthropic reports a 0.4% false-positive rate on real traffic and a 17% false-negative rate on real overeager actions for the full pipeline. It calls the 17% "the honest number" and says auto mode is not a replacement for careful human review of high-stakes infrastructure.
- Detail: Engineering post (Mar 25, 2026) results table: real internal traffic n=10,000 → 0.4% false positives (full pipeline); real overeager actions n=52 → 17% false negatives; synthetic data exfiltration n=1,000 → 5.7% false negatives. Aug 7, 2026 announcement: in a study with 1,053 paid testers, humans caught 13.6% of a deliberately inserted dangerous command, while auto mode blocked 89%. In Trajectory Labs' third-party test (72 indirect-injection scenarios × 10 = 720 attempts), none succeeded against Claude Fable 5, Opus 5 or Sonnet 5 in auto mode. The announcement says auto mode "does not eliminate risk" and recommends reviewing production-infrastructure changes yourself. Practitioner Simon Willison (Aug 8, 2026) welcomed the change but said he wants independent confirmation of the injection results.
- Use: Lesson 4: teach 'approval fatigue' (people approving without reading) vs classifier error rates. Learners decide when to keep Manual mode or add ask rules (e.g. production work).
- Sources: How we built Claude Code auto mode: a safer way to skip permissions <https://www.anthropic.com/engineering/claude-code-auto-mode>; Auto mode is now the default in Claude Code for Pro, Max, and Team plans <https://claude.com/blog/auto-mode-default-in-claude-code>; Auto mode is now the default in Claude Code for Pro, Max, and Team plans <https://simonwillison.net/2026/aug/8/auto-mode>

### [safety-6] Configuring auto mode and adding human checkpoints (corrected, high)
- Claim: Ask rules such as Bash(git push *) always prompt even in auto mode (but don't catch `git -C <dir> push`). autoMode is read from ~/.claude/settings.json, managed settings, --settings or the Agent SDK, never from .claude/settings.json or settings.local.json. $defaults works per section: setting environment without "$defaults" replaces only the default environment entries; the force-push/curl|bash rules live in soft_deny and the data-exfiltration rule in hard_deny, so those are discarded only if you set soft_deny or hard_deny without "$defaults" (setting environment alone leaves allow/soft_deny/hard_deny intact). /auto-mode-setup is documented as Pro/Max/Team, v2.1.228+ (v2.1.233+ on native Windows), but the v2.1.304 changelog (Oct 19, 2026) says it is now also available on Bedrock, Vertex, Foundry, Claude apps gateway and telemetry-disabled sessions. The /permissions Auto mode tab needs v2.1.246+. Billing: classifier overhead stopped being charged on Pro/Max/Team on Aug 7, 2026, and those plans never see the charge notice; the notice appears on other accounts (e.g. Enterprise/API) when server-side checks don't reach the session (typically a gateway stripping fields), and CLAUDE_CODE_AUTO_MODE_SERVER=0 makes Claude Code always use its own (billed) classifier requests.
- Detail: Example human checkpoint: `{"permissions":{"ask":["Bash(git push *)","Bash(gh pr create *)"]}}`. Boundaries in order of firmness: permissions.ask (always prompts), permissions.deny (blocks before the classifier), and a sentence in the chat (can be lost when the context is compacted). `autoMode.environment` entries are plain prose such as "Source control: github.example.com/acme-corp". Always include "$defaults": an array without it replaces the built-in list, including the force-push and exfiltration rules. Tools: `/auto-mode-setup` drafts entries (Pro, Max or Team, v2.1.228+); `claude auto-mode defaults`, `config`, `critique` and `reset` inspect, check and reset the configuration; the /permissions 'Auto mode' tab edits it. Billing: since Aug 7, 2026, classifier calls are not charged on Pro/Max/Team. Sessions behind a gateway that strips fields may see a notice and be billed for client-side classifier calls (`CLAUDE_CODE_AUTO_MODE_SERVER=0` opts out of the server-side check).
- Use: Lesson 2 practice: add an ask rule for git push and confirm it still prompts in auto mode. Advanced/admin lesson: write an autoMode.environment with $defaults.
- Sources: Configure auto mode <https://code.claude.com/docs/en/auto-mode-config>; Auto mode classifier request charges <https://code.claude.com/docs/en/auto-mode-classifier-billing>
- Verifier evidence: auto-mode-config: 'Each section is evaluated independently, so setting environment alone leaves the default allow, soft_deny, and hard_deny lists intact'; Danger box: without $defaults 'soft_deny: every built-in soft block rule, including force push, curl | bash, production deploys ...; hard_deny: the built-in data exfiltration rule'; 'The classifier doesn't read autoMode from project settings'; '/auto-mode-setup requires a Pro, Max, or Team plan and Claude Code v2.1.228 or later'. Changelog 2.1.304: 'Added /auto-mode-setup ... now also available on Bedrock, Vertex, Foundry, Claude apps gateway and telemetry-disabled sessions'. auto-mode-classifier-billing: 'Pro, Max, and Team plans never show the notice.' <https://code.claude.com/docs/en/auto-mode-config>

### [safety-7] Permission rule evaluation (verified, high)
- Claim: Rules are checked in a fixed order (deny, then ask, then allow) and the first match wins; a more specific rule does not change that order. Claude Code enforces the rules, not the model, so an instruction in CLAUDE.md does not grant or revoke access.
- Detail: A broad deny such as Bash(aws *) blocks even calls that also match a narrower allow such as Bash(aws s3 ls). An allow cannot carve an exception out of a deny. A bare tool name in deny (e.g. `Bash`) removes the tool from Claude's context; a scoped rule (Bash(rm *)) only blocks matching calls. Manage rules with `/permissions` (alias /allowed-tools), which shows each rule's source file. Deny and ask rules can match a top-level tool parameter, e.g. `Agent(model:opus)` or `Bash(run_in_background:true)`. MCP tool globs: deny `mcp__*` blocks all MCP tools; allow globs need a literal `mcp__<server>__` prefix. A PreToolUse hook that exits with code 2 blocks a call before rules are checked, but a hook's "allow" cannot override a deny or ask rule.
- Use: Lesson 2 (権限ルール実践): a predict-the-outcome quiz about deny/ask/allow precedence, then edit .claude/settings.json.
- Sources: Configure permissions — Manage permissions <https://code.claude.com/docs/en/permissions>

### [safety-8] Bash rule patterns and their limits (verified, high)
- Claim: Bash rules match the command text as Claude writes it. A `*` matches any text, and the docs warn to put it after the subcommand (Bash(git log *), not Bash(git * main)). A Bash rule "isn't a security boundary": Bash(curl *) does not stop /usr/bin/curl or sh -c 'curl …'.
- Detail: Shell operators (&&, ||, ;, |, |&, &, newline) are understood, so each subcommand must match on its own. Deny/ask rules also apply inside subshells and loops. Wrappers stripped before matching: timeout, time, nice, nohup, stdbuf, command, builtin, noglob, and bare xargs. Runners such as npx, docker exec and devbox run are NOT stripped, so write rules that name the inner command. `Bash(ls *)` does not match lsof, but `Bash(ls*)` does. The `:*` suffix equals a trailing ` *`. A built-in set of read-only commands (ls, cat, grep, find, read-only git, …) runs without prompts. Recommended network control: deny curl/wget, allow WebFetch(domain:…), and pair that with the sandbox network allowlist or a PreToolUse hook.
- Use: Lesson 2 worked example: show why Bash(git * main) is dangerous (it also matches git push origin main). Inline check about bypass forms.
- Sources: Configure permissions — Bash <https://code.claude.com/docs/en/permissions>

### [safety-9] Read/Edit path rules (corrected, high)
- Claim: Same as stated, except `/path` is relative to the settings source, not literally to the settings file's folder: in .claude/settings.json or .claude/settings.local.json it resolves to <primary working directory>/path; in ~/.claude/settings.json it resolves to ~/.claude/path (so Read(/secrets/**) in user settings blocks ~/.claude/secrets/**, not a project folder); in a --settings file it resolves to that file's directory. Use // or ~/ for rules in user settings that should apply in every project. NotebookEdit isn't covered by a Read deny; add an Edit deny.
- Detail: Common mistake: `/Users/<name>/file` in a rule is NOT absolute; use `//Users/<name>/file`. A deny rule `Read(.env)` matches any .env at any depth under the current directory. A Read deny also blocks Edit and Write on the same path (Write needs v2.1.228+). Only Edit(...) and Read(...) path rules are checked; a rule written for Write(...) or Glob(...) is accepted but never used. Read/Edit denies apply to built-in tools, recognised Bash file commands (cat, head, tail, sed, tee) and redirect targets. They do NOT apply to commands such as `grep -r .` or to scripts that open files themselves; use the sandbox for OS-level enforcement. `!` negation can carve out exceptions within the same settings source.
- Use: Lesson 2 / secrets lesson: fix-the-rule exercise (absolute-path mistakes, .claudeignore migration).
- Sources: Configure permissions — Read and Edit <https://code.claude.com/docs/en/permissions>
- Verifier evidence: permissions table: '/path | Path relative to the settings source | Edit(/src/**/*.ts) | <primary working directory>/src/**/*.ts in project settings'; resolution table: 'User settings at ~/.claude/settings.json -> ~/.claude/path'; 'A deny rule such as Read(/secrets/**) in user settings blocks ~/.claude/secrets/**, not a secrets directory in your project'; 'If your project has a .claudeignore file, it has no effect'; 'For the Write tool, the check requires Claude Code v2.1.228 or later'; 'NotebookEdit isn't covered'. <https://code.claude.com/docs/en/permissions>

### [safety-10] Secrets handling (corrected, high)
- Claim: As stated, with two precision fixes: CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 strips credentials (recognised by variable name or value) from Bash, hook and stdio MCP subprocess environments but deliberately leaves GitHub tokens and proxy settings in place, so it does not remove GITHUB_TOKEN; use sandbox.credentials envVars deny for that in sandboxed commands. "mode": "mask" needs network.tlsTerminate and is honoured only from user, managed or --settings (not project settings); on macOS a masked credential file is blocked (treated as deny) rather than masked. Project and local settings' sandbox.credentials entries are ignored (v2.1.246+).
- Detail: settings-reference says permissions.deny matches are excluded from file discovery and search, and their reads and edits are denied. It replaces the deprecated `ignorePatterns`. By default, sandboxed commands can still read most of the machine, including ~/.ssh and ~/.aws/credentials, and inherit environment secrets. `sandbox.credentials` with "mode": "deny" blocks reads of listed files and unsets listed env vars (e.g. GITHUB_TOKEN, NPM_TOKEN); "mode": "mask" substitutes a placeholder and requires network.tlsTerminate. There is no built-in credential deny list. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` strips credentials from Bash, hook and stdio MCP subprocesses "to reduce what a prompt injection attack can read". Credentials are stored in the macOS Keychain, or in ~/.claude/.credentials.json with mode 0600 on Linux. Hooks guide example: a PreToolUse hook on Edit|Write that exits 2 for .env, package-lock.json and .git/.
- Use: Lesson 3 (秘密情報を守る): practice adding .env deny rules and a protect-files hook, then verify by asking Claude to read .env.
- Sources: Settings reference — permissions.deny <https://code.claude.com/docs/en/settings-reference>; Configure the sandboxed Bash tool — Protect credentials <https://code.claude.com/docs/en/sandboxing>; Environment variables <https://code.claude.com/docs/en/env-vars>; Automate actions with hooks — Block edits to protected files <https://code.claude.com/docs/en/hooks-guide>
- Verifier evidence: settings-reference permissions.deny: 'Claude Code excludes matching files from file discovery and search results, denies reads of them, and blocks the Edit and Write tools ... This key replaces the deprecated ignorePatterns'. env-vars: 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB | Set to 1 to strip credentials ... The scrub recognizes a credential by its variable name or its value, and it leaves GitHub tokens and proxy settings in place.' sandboxing: 'There is no built-in credential deny list'; 'For files on macOS, Claude Code blocks the file instead of masking it'; mask honoured 'only from user settings, managed settings, and the --settings flag'. authentication: Linux '~/.claude/.credentials.json with file mode 0600'. hooks-guide: PROTECTED_PATTERNS=(".env" "package-lock.json" ".git/"). <https://code.claude.com/docs/en/sandboxing>

### [safety-11] Where approvals are saved (verified, high)
- Claim: Choosing "Yes, and don't ask again" for a Bash command or WebFetch domain saves a rule to `.claude/settings.local.json` at the git repository root (v2.1.211+). File-edit approvals last only until the session ends.
- Detail: Approval table: read-only tools need no approval inside the working and additional directories. Bash and WebFetch approvals are permanent per repository. Web search approvals are permanent per repository. File modifications are approved for the session only. Approving a compound command saves one rule per subcommand that needed approval (up to 5). Some prompts offer only one-time approval when the rule couldn't be shown in full. Press Tab on Yes/No to attach a comment to Claude. Extend access with `--add-dir`, `/add-dir` or `permissions.additionalDirectories`. `/cd` moves the session and applies the new directory's project settings after a trust prompt. Security guidance says to audit rules regularly with `/permissions`.
- Use: Lesson 2: show where rules land and have learners clean up an over-broad saved rule.
- Sources: Configure permissions — Permission system <https://code.claude.com/docs/en/permissions>; Security — Security best practices <https://code.claude.com/docs/en/security>

### [safety-12] Settings scopes and precedence (verified, high)
- Claim: Settings precedence, highest first: managed settings (managed-settings.json, MDM, or the claude.ai console), command line (`claude --settings`), project local (.claude/settings.local.json), shared project (.claude/settings.json), user (~/.claude/settings.json). A deny at any level cannot be overridden by an allow elsewhere.
- Detail: No other level can override a managed permission rule; for example, --allowedTools cannot override a managed deny, while --disallowedTools can add restrictions. Across scopes, a user-level deny blocks a project-level allow and the other way round. A few security-sensitive keys are exceptions where a stricter value from a lower level still counts. Shared project settings are checked into git for the team; local settings are personal, and Claude Code adds settings.local.json to the global gitignore when it writes there.
- Use: Lesson 6 (チーム・組織ガバナンス): a diagram of the five layers and exercises on which file a team rule vs a personal rule belongs in.
- Sources: Settings files and precedence <https://code.claude.com/docs/en/settings>; Configure permissions — Settings precedence <https://code.claude.com/docs/en/permissions>

### [safety-13] Workspace trust and untrusted repositories (verified, high)
- Claim: A project's `permissions.allow` rules and `additionalDirectories` take effect only after you accept the workspace trust dialog. `claude -p` and SDK runs never show the dialog, and in them a repository's hooks, `env` block and `apiKeyHelper` still run.
- Detail: The trust dialog lists the rules and directories a folder would grant. Deny and ask rules apply without trust because they only restrict. `.mcp.json` servers have their own approval prompt, but a `-p` run connects them without asking. Before running `claude -p` in a repository you didn't write, the docs advise: `--setting-sources user` (skips the project's settings and .mcp.json), `--bare` (skips project hooks, skills, commands, subagents, plugins and .mcp.json; the env block and helpers such as awsAuthRefresh still apply), `--settings '{"disableAllHooks": true}'`, and `disabledMcpjsonServers`. Starting in your home directory keeps trust only for that session. For an untrusted repository the docs recommend a dedicated VM or a cloud session.
- Use: Lesson 4: a scenario about cloning an unknown repo and running headless Claude, with a checklist of flags to use.
- Sources: Configure permissions — Project allow rules and workspace trust <https://code.claude.com/docs/en/permissions>; Choose a sandbox environment <https://code.claude.com/docs/en/sandbox-environments>

### [safety-14] Protected paths and actions no mode auto-approves (verified, high)
- Claim: Writes to protected paths (for example .git, .claude, .vscode, .husky, .devcontainer, .bashrc, .zshrc, .npmrc, .envrc, .mcp.json, .gitconfig) prompt in default and acceptEdits, go to the classifier in auto, are denied in dontAsk, and are allowed only in bypassPermissions. `permissions.allow` rules don't pre-approve them.
- Detail: Even bypassPermissions still stops for: explicit ask rules; connector tools an organization set to ask; AskUserQuestion and MCP tools marked requiresUserInteraction; rm/rmdir on a critical path (no allow rule or hook can approve it); cross-session messaging safeguards; and reads outside the working directories while `permissions.blockReadsOutsideWorkingDirectories` is on (v2.1.257+). Protected files include shell startup files and package-manager configs because writing them can lead to code running later.
- Use: Lesson 1/4: explain why some paths always prompt (persistence and code-execution risk).
- Sources: Choose a permission mode — Protected paths <https://code.claude.com/docs/en/permission-modes>

### [safety-15] bypassPermissions / --dangerously-skip-permissions (verified, high)
- Claim: The docs say bypassPermissions should be used "only … in isolated environments like containers, VMs, or dev containers without internet access" and "offers no protection against prompt injection or unintended actions". Claude Code refuses it when running as root or under sudo.
- Detail: It cannot be entered from a session started without it. Enable it at launch with defaultMode, `--permission-mode bypassPermissions` or `--dangerously-skip-permissions`; `--allow-dangerously-skip-permissions` only adds it to the Shift+Tab cycle. First use shows an acceptance dialog. Running as root gives: `--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons`. Cloud sessions ignore defaultMode bypassPermissions/dontAsk from settings. Admins block it with `permissions.disableBypassPermissionsMode: "disable"`; a user can also set this for themselves. The sandbox-environments page says to always run --dangerously-skip-permissions sessions inside a container, a VM or the sandbox runtime, so that file tools, MCP servers and hooks are inside the boundary too.
- Use: Lesson 1 warning callout plus a misconception check: 'Is bypass OK on my laptop?' → No.
- Sources: Choose a permission mode — bypassPermissions <https://code.claude.com/docs/en/permission-modes>; Choose a sandbox environment <https://code.claude.com/docs/en/sandbox-environments>

### [safety-16] Sandboxing basics (verified, high)
- Claim: The built-in Bash sandbox is off by default. Turn it on with `/sandbox` or `sandbox.enabled: true`. It uses Seatbelt on macOS and bubblewrap plus socat on Linux and WSL2; on native Windows commands run unsandboxed.
- Detail: Default boundary: writes are allowed to the working directory, a per-user temp directory and added directories (protected paths stay write-denied); reads cover most of the machine, including ~/.ssh and ~/.aws/credentials, unless you add `filesystem.denyRead` or credentials entries; network goes through a local proxy whose allowlist starts empty (`network.allowedDomains`, `network.deniedDomains`). It covers Bash, PowerShell and Monitor commands and their child processes. Built-in file and web tools, hooks, local MCP servers, LSP servers, statusLine and apiKeyHelper run OUTSIDE the sandbox. Install on Linux: `sudo apt-get install bubblewrap socat`. If the sandbox can't start, commands run unsandboxed unless `sandbox.failIfUnavailable: true`. To test it, ask Claude (not the `!` prompt) to run `touch ~/sandbox-probe`, which should fail. Built on the open-source `@anthropic-ai/sandbox-runtime`.
- Use: Lesson 3 (サンドボックス): a hands-on probe exercise and a table of what is inside vs outside the sandbox.
- Sources: Configure the sandboxed Bash tool <https://code.claude.com/docs/en/sandboxing>; サンドボックス化された Bash ツールを設定する <https://code.claude.com/docs/ja/sandboxing>

### [safety-17] Sandbox modes and the escape hatch (verified, high)
- Claim: There are two sandbox modes: auto-allow runs sandboxed commands without prompting, and regular permissions keeps prompts. Claude may retry a failed command outside the sandbox with `dangerouslyDisableSandbox`, which `allowUnsandboxedCommands: false` ('Strict sandbox mode') turns off.
- Detail: In auto-allow mode, Bash deny rules, critical-path rm and content-scoped ask rules such as Bash(git push *) still apply. Commands like `FOO=bar npm test`, `make CC=clang` and `eval` go through the normal permission flow. Who approves an unsandboxed retry: a 'Bash command (unsandboxed)' prompt in Manual/acceptEdits mode, the classifier in auto mode, an automatic denial in dontAsk, and no prompt in bypassPermissions. An allow rule that matches the command also approves its unsandboxed retry; add the ask rule `Bash(dangerouslyDisableSandbox:true)` to always be asked. `excludedCommands` always run unsandboxed. Commands you type at the `!` prompt usually run unsandboxed. One-session example: `claude --settings '{"sandbox": {"enabled": true, "allowUnsandboxedCommands": false}}'`.
- Use: Lesson 3 worked example: choosing between auto-allow and strict mode for a personal laptop vs a shared server.
- Sources: Configure the sandboxed Bash tool — Sandbox modes <https://code.claude.com/docs/en/sandboxing>

### [safety-18] Sandbox limitations and why both boundaries matter (verified, high)
- Claim: Effective sandboxing needs both filesystem and network isolation. The docs warn that allowing broad domains such as github.com can create exfiltration paths, because the proxy decides from the hostname without inspecting TLS (domain fronting).
- Detail: Documented limitations: by default the network proxy does not inspect TLS; allowing a Unix socket such as /var/run/docker.sock effectively grants host access; write access to directories on $PATH, system config or .bashrc/.zshrc can lead to privilege escalation; `enableWeakerNestedSandbox` (for Docker without privileged namespaces) "considerably weakens security"; `allowAppleEvents` removes code-execution isolation on macOS. Anthropic's engineering post (Oct 20, 2025) says sandboxing "safely reduces permission prompts by 84%" internally and gives the reasons: approval fatigue and prompt injection. Without network isolation a compromised agent could exfiltrate SSH keys; without filesystem isolation it could escape and gain network access.
- Use: Lesson 3 concept segment: a two-boundary diagram plus a check question about why github.com in allowedDomains is risky.
- Sources: Configure the sandboxed Bash tool — Limitations <https://code.claude.com/docs/en/sandboxing>; Beyond permission prompts: making Claude Code more secure and autonomous <https://www.anthropic.com/engineering/claude-code-sandboxing>

### [safety-19] Choosing an isolation environment, including cloud sessions (verified, high)
- Claim: The docs compare six isolation options: the sandboxed Bash tool, the sandbox runtime (`srt claude`, which wraps the whole process), dev containers, custom containers, VMs, and Anthropic-hosted cloud sessions. They recommend a VM or cloud session for untrusted repositories.
- Detail: Only the sandboxed Bash tool leaves file tools, MCP servers and hooks on the host. The others wrap the whole Claude Code process. Install the runtime with `npm install -g @anthropic-ai/sandbox-runtime`, configure ~/.srt-settings.json, then run `srt claude` (beta research preview). The claude-code repo's example dev container has a default-deny iptables firewall that supports unattended --dangerously-skip-permissions work. Auto mode is "a per-action control, not an isolation boundary". Key warning: isolation "does not change what is sent to the model". Cloud sessions run in isolated Anthropic-managed VMs with limited network access by default. GitHub credentials never enter the VM; a proxy attaches them, and branch deletions and tag pushes are rejected. Remote Control instead runs on your own machine.
- Use: Lesson 3 practice: a decision table matching scenarios (unknown OSS repo, CI job, daily work) to an environment.
- Sources: Choose a sandbox environment <https://code.claude.com/docs/en/sandbox-environments>; Security — Cloud execution security <https://code.claude.com/docs/en/security>

### [safety-20] Prompt injection safeguards in the security docs (verified, high)
- Claim: The security page lists these prompt-injection protections: permission approval, network command approval (curl and wget are not auto-approved), WebFetch page summaries from a separate model call, workspace trust verification, command-injection detection, fail-closed matching, and secure credential storage.
- Detail: Its five best practices for untrusted content: 1) review suggested commands before approval; 2) avoid piping untrusted content directly to Claude; 3) verify proposed changes to critical files; 4) use VMs to run scripts and tool calls, especially with external web services; 5) report suspicious behaviour with `/feedback`. The page warns that "no system is completely immune to all attacks" and that the user is responsible for reviewing proposed code and commands. Before fetching, WebFetch sends only the hostname to api.anthropic.com for a safety-blocklist check. Windows WebDAV paths can bypass the permission system and are discouraged. Related tools: the `/security-review` command and the security-guidance plugin.
- Use: Lesson 4 core content: a checklist card of the five practices plus a short scenario of an injection hidden in a README.
- Sources: Security — Protect against prompt injection <https://code.claude.com/docs/en/security>; セキュリティ <https://code.claude.com/docs/ja/security>

### [safety-21] MCP servers and plugins (verified, high)
- Claim: Anthropic reviews connectors against listing criteria for its directory, but "does not security-audit or manage any MCP server". Reviewing `.mcp.json` doesn't show every server a session can load, because user-scope servers, claude.ai connectors and plugins add more.
- Detail: Advice: write your own MCP servers or use ones from trusted providers, and set permissions for MCP tools (e.g. deny `mcp__*`, or allow only `mcp__<server>__*`). Organisations can restrict servers with managed MCP configuration (`managed-mcp.json`, `allowedMcpServers`/`deniedMcpServers`, `allowManagedMcpServersOnly`). Data handled by MCP servers and other third-party integrations is not covered by ZDR. The docs index also has a dedicated page, 'Plugin security and trust'.
- Use: Lesson 4 or 6: a supply-chain discussion (MCP and plugins as trust decisions).
- Sources: Security — MCP security <https://code.claude.com/docs/en/security>; Zero data retention <https://code.claude.com/docs/en/zero-data-retention>

### [safety-22] Data training policy (verified, high)
- Claim: Consumer users (Free, Pro, Max) choose whether their data, including Claude Code use, trains future models. Under commercial terms (Team, Enterprise, API, third-party platforms, Claude Gov), Anthropic does not train generative models on Claude Code prompts or code unless the customer opts in (e.g. the Development Partner Program).
- Detail: Consumers change the setting at claude.ai/settings/data-privacy-controls, or with `/privacy-settings` in Claude Code (Pro and Max only). Terms: Consumer Terms for Free/Pro/Max; Commercial Terms for Team/Enterprise/API. The Development Partner Program is opt-in by an org admin and only on the first-party API. Session-quality survey ratings and transcripts shared after them do not affect training preferences and cannot be used for training.
- Use: Lesson 5 (データとプライバシー): compare personal and company accounts; exercise: check your own privacy setting.
- Sources: Data usage <https://code.claude.com/docs/en/data-usage>; Commands — /privacy-settings <https://code.claude.com/docs/en/commands>; Legal and compliance <https://code.claude.com/docs/en/legal-and-compliance>

### [safety-23] Data retention, local transcripts and ZDR (verified, high)
- Claim: Retention: consumer accounts that allow training keep data 5 years, otherwise 30 days. Commercial accounts keep it 30 days. Claude Code also stores session transcripts locally in plain text under `~/.claude/projects/` for 30 days by default (`cleanupPeriodDays`).
- Detail: Transcripts shared via /feedback, /bug or /share are kept 5 years; transcripts shared in the optional survey follow-up are kept up to 6 months. Zero Data Retention is only for qualified Claude for Enterprise organisations, enabled per organisation by Anthropic. It does not cover claude.ai chat, Cowork, analytics metadata or third-party/MCP data. It disables cloud sessions, Remote Control, Artifacts, Claude Tag and feedback submission. Fable models need data retention by default. Even under ZDR, data flagged for a Usage Policy violation may be kept up to 2 years. `cleanupPeriodDays` is at least 1 (0 fails validation). Rewind snapshots are deleted on the same schedule.
- Use: Lesson 5: a table of where data lives (Anthropic servers vs your disk), and why plaintext local transcripts matter on shared machines.
- Sources: Data usage — Data retention <https://code.claude.com/docs/en/data-usage>; Zero data retention <https://code.claude.com/docs/en/zero-data-retention>; Settings reference — cleanupPeriodDays <https://code.claude.com/docs/en/settings-reference>

### [safety-24] What is sent, and turning telemetry off (verified, high)
- Claim: Claude Code sends all user prompts and model outputs to the model provider over TLS 1.2+. Separate usage metrics "never include your code, prompts, or file paths" and can be turned off with `DISABLE_TELEMETRY=1`. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` turns off all non-essential traffic.
- Detail: Other opt-outs: `DISABLE_ERROR_REPORTING=1`, `DISABLE_FEEDBACK_COMMAND=1`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1`. Error reports are on only for Pro/Max sign-ins on v2.1.198+ connecting directly, and known secrets, paths and emails are redacted first. On Bedrock, Google Cloud's Agent Platform, Foundry and Claude Platform on AWS, metrics, error reports and /feedback are off by default. The WebFetch hostname safety check runs on every provider; turn it off with `skipWebFetchPreflight: true`. Note that setting `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` to 0 or false still disables the traffic; you must unset it. Using the sandbox doesn't reduce what is sent to the model.
- Use: Lesson 5: true/false items (e.g. 'telemetry contains my code' → false).
- Sources: Data usage — Telemetry services <https://code.claude.com/docs/en/data-usage>; Environment variables <https://code.claude.com/docs/en/env-vars>

### [safety-25] Managed and enterprise settings (corrected, high)
- Claim: Paths, MDM domain, managed-settings.d (merged after managed-settings.json, alphabetical), hourly server-managed refresh, approval dialog and 'client-side control, not a security boundary' are all correct. But not all listed keys are managed-only: managed-only keys include allowManagedPermissionRulesOnly, allowManagedHooksOnly, allowManagedMcpServersOnly, sandbox.network.allowManagedDomainsOnly, modelPricing, allowedProviders (v2.1.285+), forceRemoteSettingsRefresh, strictKnownMarketplaces and policyHelper. permissions.disableBypassPermissionsMode, availableModels and forceLoginMethod can be set in any settings file (they act as non-overridable policy when delivered by managed settings), and forceLoginOrgUUID can be written anywhere but only a managed source enforces it. Server-managed settings require the Owner or Primary Owner role.
- Detail: Managed-only and lock keys include `allowManagedPermissionRulesOnly`, `allowManagedHooksOnly`, `allowManagedMcpServersOnly`, `sandbox.network.allowManagedDomainsOnly`, `permissions.disableBypassPermissionsMode`, `availableModels`, `modelPricing`, `forceLoginMethod`/`forceLoginOrgUUID` (restrict logins to your organisation) and `allowedProviders` (v2.1.285+). `managed-settings.d/*.json` drop-ins merge in alphabetical order. Server-managed settings (Organization settings > Claude Code > Managed settings) are fetched at startup and refreshed hourly. Hooks and shell-command settings in them trigger a user approval dialog. They are "a client-side control, not a security boundary"; for stronger guarantees use MDM. Verify with `/status`, `claude doctor` or `/permissions`. Track usage with OpenTelemetry, and audit settings changes with ConfigChange hooks.
- Use: Lesson 6 (組織ガバナンス): example managed-settings.json (deny .env, disable bypass, allowManagedPermissionRulesOnly) and a discussion of MDM vs server-managed.
- Sources: Deploy managed settings <https://code.claude.com/docs/en/managed-settings>; Configure server-managed settings <https://code.claude.com/docs/en/server-managed-settings>; Authentication — Restrict login to your organization <https://code.claude.com/docs/en/authentication>
- Verifier evidence: managed-settings: macOS '/Library/Application Support/ClaudeCode/managed-settings.json', Linux/WSL '/etc/claude-code/managed-settings.json', Windows 'C:\Program Files\ClaudeCode\managed-settings.json'; 'com.anthropic.claudecode'; 'merges managed-settings.json first, then every *.json file in the directory in alphabetical order'; 'Keys only a managed source can set' table. settings-reference index scopes: availableModels 'Any file', forceLoginMethod 'Any file', forceLoginOrgUUID 'Any file ... only a managed source enforces it', modelPricing 'Managed', allowedProviders 'Managed'. permissions: 'disableBypassPermissionsMode ... works from any scope'. server-managed-settings: 'refreshes hourly'; 'they operate as a client-side control, not a security boundary'. <https://code.claude.com/docs/en/managed-settings>

### [safety-26] Reviewing changes safely: checkpoints, /diff, git (verified, high)
- Claim: Every prompt that starts a turn creates a checkpoint. `/rewind` (aliases /checkpoint, /undo), or Esc twice on an empty prompt, restores code, conversation or both. Checkpoints do NOT track files changed by Bash commands and are "not a replacement for version control".
- Detail: Rewind menu options: Restore code and conversation, Restore conversation, Restore code, Summarize from here, Summarize up to here, Never mind. Snapshots are kept for the 100 most recent checkpoints per session and deleted in the retention sweep (about 30 days). Edits by background subagents are generally not restored, so use git. Symlinked and hard-linked files are skipped. `/diff` shows working-tree changes, including Claude's edits. The diff panel needs fullscreen rendering, a git repo, a terminal ≥110 columns and v2.1.287+. `/code-review` (alias /review) checks the diff for bugs. `/security-review` scans the branch diff against origin's default branch. Best practices add: give Claude a way to verify its work, and have a subagent review the diff in a fresh context.
- Use: Lesson 7 (変更のレビューと巻き戻し): a rewind practice and a 'Bash rm can't be rewound' check, then the commit habit with git.
- Sources: Checkpointing <https://code.claude.com/docs/en/checkpointing>; Interactive mode — Review changes with /diff <https://code.claude.com/docs/en/interactive-mode>; Commands <https://code.claude.com/docs/en/commands>; Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>

### [safety-27] Plans that include Claude Code and usage limits (corrected, high)
- Claim: All prices and plan facts check out as read on claude.com/pricing on 2026-10-20 (US view). Correct the limits wording: the Help Center says 'Both Pro and Max plans have a five-hour session limit and a weekly limit' and 'These limits are shared across Claude and Claude Code'; it does not describe the five-hour window as 'rolling', so don't teach that detail. The API-credit sentence in full: 'Monthly API credits included with Max plans can't be used in Claude Code or the Claude apps, including for extra usage.'
- Detail: Prices read on claude.com/pricing on 2026-10-20 (USD, shown to a US visitor): Pro $17/month with annual billing ($200 up front) or $20 monthly; Max 'From $100' per month, in 5x or 20x Pro usage per 5-hour session, billed monthly; Team Standard $20 per seat/month annual or $25 monthly; Team Premium $100 annual or $125 monthly; Enterprise US$20/seat/month billed annually, 20-seat minimum, plus usage at API rates. Help Center: Pro and Max have a five-hour session limit and a weekly limit, plus a separate weekly Fable limit on Max. At the limit you can upgrade, enable usage credits (`/usage-credits`), switch to Console API credits, or wait. "Monthly API credits included with Max plans can’t be used in Claude Code". Messages such as "You've hit your session limit" can't be fixed by switching models; "You've hit your Opus limit" can.
- Use: Lesson 8 (コストと使用量): a plan-choice exercise for a learner persona. Note that prices are USD as listed today and may differ by region or tax; tell learners to check the live page.
- Sources: Pricing <https://claude.com/pricing>; Use Claude Code with your Pro or Max plan <https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan>; Manage costs effectively — When a developer asks about a limit <https://code.claude.com/docs/en/costs>
- Verifier evidence: claude.com/pricing: Pro '$17 ... ($200 billed up front). $20 if billed monthly'; Max 'From $100', '5x or 20x', 'Both options are billed monthly'; Team Standard $20/$25, Premium $100/$125; Enterprise 'US$20/seat/month, billed annually, 20 seat minimum' + 'usage at API rates'; FAQ 'Claude Code is included in all paid plans'; comparison 'No' for Free. Help Center 11145838: shared-limits sentence; 'Max plans also have a separate weekly limit for Fable'; no mention of 'rolling'. costs: session/weekly limit messages 'can't restore access by switching models', Opus/Sonnet limit messages differ. <https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan>

### [safety-28] Authentication and the API-key billing trap (verified, high)
- Claim: If `ANTHROPIC_API_KEY` is set and you approve it, Claude Code uses the key instead of your subscription, so usage is billed as API charges. Run `unset ANTHROPIC_API_KEY` and check `/status` to confirm which credential is active.
- Detail: Credential order: cloud provider variables (CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY) > ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY (in -p mode it is always used when present) > apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN > Anthropic profile/federation > subscription OAuth from /login. Account types: Pro or Max, Team or Enterprise (invited by an admin), Claude Console (roles 'Claude Code' or 'Developer'), Bedrock, Google Cloud's Agent Platform, Foundry, or a Claude apps gateway. `claude setup-token` creates a one-year OAuth token for CI (requires Pro, Max, Team or Enterprise). Credentials are stored in the macOS Keychain, or in ~/.claude/.credentials.json (0600) on Linux. Legal: subscription OAuth is for ordinary use of Anthropic's own apps. Developers building products, including with the Agent SDK, must use API keys and may not route users through Free, Pro or Max credentials.
- Use: Lesson 8: a troubleshooting case ('my API bill jumped': find the stray env var).
- Sources: Authentication <https://code.claude.com/docs/en/authentication>; Legal and compliance <https://code.claude.com/docs/en/legal-and-compliance>

### [safety-29] Tracking cost: /usage, /cost, budgets (verified, high)
- Claim: `/usage` shows the session cost, plan usage limits and activity stats; `/cost` and `/stats` are aliases of it. Its dollar figure is a local estimate at list price, not a bill, and for Pro/Max subscribers the session cost isn't relevant to billing.
- Detail: /usage on paid plans adds an attribution breakdown (skills, subagents, plugins, MCP servers), flags behaviours that account for 10% or more of recent usage (e.g. long context, cache misses), and a 'Prompt cache (main)' line (v2.1.251+). Press d or w to switch between 24 hours and 7 days. Official averages for enterprise deployments: "around $13 per developer per active day and $150-250 per developer per month, with costs remaining below $30 per active day for 90% of users". The Console creates a 'Claude Code' workspace automatically, where you can set spend limits. The docs give recommended per-user TPM/RPM by team size (e.g. 1-5 users: 200k-300k TPM). In print mode, `--max-budget-usd` stops a run at an estimated spend and `--max-turns` limits turns. `/insights` writes a usage-pattern report to ~/.claude/usage-data/report.html. Background usage is typically under $0.04 per session.
- Use: Lesson 8 practice: run /usage, read the Session block, and set --max-budget-usd on a -p script.
- Sources: Manage costs effectively <https://code.claude.com/docs/en/costs>; Commands — /usage <https://code.claude.com/docs/en/commands>; CLI reference — --max-budget-usd <https://code.claude.com/docs/en/cli-reference>

### [safety-30] Reducing token use (verified, high)
- Claim: The official cost guidance: `/clear` between unrelated tasks, `/compact [instructions]`, Sonnet for most coding and Opus for complex reasoning, lower effort for simple tasks, CLAUDE.md under 200 lines (move specialised instructions into skills), and verbose work delegated to subagents.
- Detail: Other points from the docs: MCP tool definitions are deferred by default; CLI tools such as gh or aws use less context than MCP; `/context` shows what fills the context window; plan mode avoids costly rework; Esc and /rewind let you correct course early. Agent teams use about 7x more tokens when teammates run in plan mode. Prompt-cache lifetime is 1 hour on a subscription but 5 minutes on API keys or once you're on usage credits, so the first message after a break re-processes the full context. Long sessions keep growing because the full history is resent each turn; `/clear` costs nothing, while `/compact` is itself a large request. Thinking tokens are billed as output. Thinking can't be turned off on Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable models; use `/effort` instead.
- Use: Lesson 8: a cost-habits checklist plus a 'why did my long session burn usage?' scenario.
- Sources: Manage costs effectively — Reduce token usage <https://code.claude.com/docs/en/costs>; Best practices for Claude Code — Avoid common failure patterns <https://code.claude.com/docs/en/best-practices>

### [safety-31] Choosing a model for cost (verified, high)
- Claim: Model aliases are default, best, fable, opus, sonnet, haiku, sonnet[1m], opus[1m] and opusplan (Opus during plan mode, Sonnet for execution). Pro, Max, Team, Enterprise and the Anthropic API default to Opus 5.5.
- Detail: Set the model with /model (Enter saves it as default; `s` switches for this session only), `claude --model`, `ANTHROPIC_MODEL` or the `model` setting. Default effort: Opus 5.5, Sonnet 5.5 and Haiku 5.5 default to `medium`; levels are low, medium, high, xhigh and max (/effort). Fable usage may bill to usage credits, and a consent prompt appears first. Admins can restrict models with `availableModels` (e.g. ["sonnet","haiku"]) and `enforceAvailableModels`. API list prices read on claude.com/pricing today (USD per million input/output tokens): Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 (≤100K-token prompts), Fable 5.1 $10/$50. Fast mode for Opus 5.5 is 2x standard pricing.
- Use: Lesson 8: match a model to a task (simple refactor → Sonnet or Haiku; architecture → Opus or opusplan).
- Sources: Model configuration <https://code.claude.com/docs/en/model-config>; Pricing <https://claude.com/pricing>

### [safety-32] Japan availability and Japanese-language use (verified, high)
- Claim: Japan is on Anthropic's official supported-countries lists for the apps and API. Official Claude Code docs are published in Japanese at code.claude.com/docs/ja/ and were current with the English pages on 2026-10-20. The `language` setting (e.g. "japanese") makes Claude respond in that language by default.
- Detail: The `language` value is passed to Claude verbatim and isn't validated. The same value sets the voice-dictation language (which does have a fixed list) and the language of auto-generated session titles. Example: `{"language": "japanese"}` in any settings file. The Japanese docs give the official terms for teaching: 権限を設定する (permissions), 権限モード, auto モード / Manual モード, 分類器 (classifier), サンドボックス化された Bash ツール, 保護されたパス, 管理設定, 設定の優先順位, チェックポイント, データ使用, コストを効果的に管理する. The docs do not say how the auto mode classifier performs on Japanese-language prompts.
- Use: Course-wide: use the official Japanese terms with English on first mention (per AGENTS.md). Setup lesson: set language to japanese.
- Sources: Supported countries & regions <https://www.anthropic.com/supported-countries>; Supported regions <https://platform.claude.com/docs/en/api/supported-regions>; Settings reference — language <https://code.claude.com/docs/en/settings-reference>; セキュリティ / 権限を設定する (Japanese docs) <https://code.claude.com/docs/ja/security>


## Missed by the sweep (from the verifier)
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

## Open questions
- Japanese pricing was not checked. claude.com/pricing showed USD to this (US) visitor; yen prices and Japanese consumption tax weren't confirmed. The course should link to the live page rather than state yen amounts.
- Whether auto mode is now also the default for Enterprise, the API and cloud providers. The Aug 7, 2026 blog said 'coming month', and the permission-modes table says auto is the terminal/VS Code default from v2.1.283 regardless of plan, but no dated official announcement for Enterprise/API was found.
- The default consumer training setting (on or off) at signup isn't stated on the data-usage page, which only says consumers 'choose'. Don't teach a default without checking the Privacy Center.
- How well the auto mode classifier works on Japanese-language prompts and CLAUDE.md files is not documented.
- The Trajectory Labs 0/720 prompt-injection result is reported by Anthropic. An independent replication wasn't found; a BankInfoSecurity report cites a researcher (Johann Rehberger) whose limited tests succeeded 60-80% of the time (not verified first-hand).
- Separate Max 5x vs Max 20x prices are not shown on the pricing page (only 'From $100').
- Many behaviours depend on the version (the docs cite v2.1.2xx–v2.1.30x; the latest CHANGELOG entry is 2.1.304). Lessons should tell learners to run `claude --version` and expect details to change.