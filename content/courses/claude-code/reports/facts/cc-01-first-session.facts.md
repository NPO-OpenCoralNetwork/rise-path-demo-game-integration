# Verified facts for cc-01-first-session (checked 2026-10-20)

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

### [docs-47] Official learning resources (Japanese) (verified, high)
- Claim: The official docs are fully translated into Japanese at `https://code.claude.com/docs/ja/<page>`, with a Japanese index at code.claude.com/docs/_llms/jp.txt (228 pages). Claude Code also ships `/powerup`, interactive lessons with animated demos, and the overview page links to free Claude Academy courses.
- Detail: The Claude Academy courses linked from the overview are 'Claude Code 101' and 'Claude Code in Action' at academy.claude.com.

The weekly 'What's new' digest (code.claude.com/docs/en/whats-new) summarizes notable features by week. The most recent digest listed when fetched was Week 37 (Sept 7–11, 2026), while the changelog continues through v2.1.304 (Oct 19, 2026).
- Use: Cite Japanese doc pages as lesson sources; assign /powerup as warm-up; point learners to changelog/what's-new for staying current.
- Sources: Claude Code Docs: Japanese index <https://code.claude.com/docs/_llms/jp.txt>; Commands <https://code.claude.com/docs/en/commands>; Overview <https://code.claude.com/docs/en/overview>

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

### [learning-24] Unclear prompts: how to make them specific (verified, high)
- Claim: Official guidance gives four prompt-specificity strategies (scope the task, point to sources, reference existing patterns, describe the symptom), and says to use `@` to reference files, paste images, give URLs, or pipe data in.
- Detail: Examples: 'add tests for foo.py' becomes 'write a test for foo.py covering the edge case where the user is logged out. avoid mocks.'; 'fix the login bug' becomes 'users report that login fails after session timeout. check the auth flow in src/auth/, especially token refresh. write a failing test that reproduces the issue, then fix it'. Piping: `cat error.log | claude -p "explain this error"`. An `@file` reference includes a file's content when it fits the Read tool's limit (25,000 tokens by default). Vague prompts are acceptable while exploring. The Champion kit adds: 'Recover from an incorrect result' by pasting the failing test or stack trace rather than rephrasing, and 'Keep edits surgical' by saying 'only change X.'
- Use: A prompt-rewriting worked example and practice (before -> after) in the prompting lesson. Grading rubric: does the prompt name the location, the constraints and a 'done' condition?
- Sources: Best practices - Provide specific context in your prompts <https://code.claude.com/docs/en/best-practices>; Champion kit - Quick-reference sheet <https://code.claude.com/docs/en/champion-kit>

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

### [releases-34] Official renamed-terms list (for reading older tutorials) (verified, high)
- Claim: The docs glossary lists these renames: Headless mode → Non-interactive mode (same `-p`); 'Claude Code on the web' for any cloud session → Cloud session; Custom commands → Skills (`.claude/commands/` still works); Slash commands → Commands.
- Detail: Slash commands and skills were merged in 2.1.3 (2026-01-09). Other renames from the changelog and docs: Claude Code SDK → Claude Agent SDK (2.0.0, 2025-09-29; legacy entrypoint removed 2.0.25); `/allowed-tools` → `/permissions` (1.0.7, 2025-05-30); `/extra-usage` → `/usage-credits` (2.1.144, 2026-05-18); Vertex AI → 'Google Cloud's Agent Platform' in the docs; Windsurf → Devin Desktop in `/ide` (2.1.162). Removed: the `#` quick-memory shortcut (2.0.70, 2025-12-15), `/vim` (2.1.92), `/pr-comments` (2.1.91), and Opus 4/4.1 on the first-party API (2.1.68, 2026-03-04).
- Use: A dedicated 'old vs new names' reference card and flashcards. Also a lint list for the course's own text.
- Sources: Glossary — Deprecated and renamed terms <https://code.claude.com/docs/en/glossary>; Commands <https://code.claude.com/docs/en/commands>; Claude Code CHANGELOG.md <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

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