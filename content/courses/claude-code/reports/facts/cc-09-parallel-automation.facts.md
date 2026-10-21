# Verified facts for cc-09-parallel-automation (checked 2026-10-20)

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

### [practice-36] [Official] Unattended automation: scheduling, cloud sessions and safe design (verified, high)
- Claim: Anthropic's guidance for unattended runs is to state explicitly what success looks like, give read-only access wherever the agent only reads, cap spend per run, and treat a failed read as a failure, not as a quiet day.
- Detail: Scheduling options (common-workflows): cloud scheduled tasks (formerly Routines, claude.ai/code/routines, triggered by schedule, API or GitHub events), desktop scheduled tasks, GitHub Actions cron, and /loop in-session. 'When writing prompts for scheduled tasks, be explicit about what success looks like and what to do with results... it can't ask clarifying questions.' Oct 8 2026 'Building effective agent automations' (Lance Martin, CJ Avilla, built on Managed Agents): read each source from a bookmark, not a fixed window; report unreadable sources; re-check items right before posting; count a post as sent only on confirmation; re-read preferences from a store the agent can't edit; 'Limit what the agent could do if it followed' instructions in text written by others; set a spend cap at 3-5x a normal run; watch server time zones. Cloud field guide (Addy Osmani, Oct 6 2026): 'claude --cloud "..."', 'claude --teleport', push before --cloud, one task per session, name the command that proves done, use the narrowest network level, and '/autofix-pr' to watch CI and review comments. Parallel cloud sessions share your plan limits.
- Use: Automation lesson (scheduled report or PR babysitter). Checklist exercise: audit an automation prompt for success criteria, permissions, budget and failure reporting.
- Sources: Common workflows (Run Claude on a schedule) <https://code.claude.com/docs/en/common-workflows>; Building effective agent automations <https://claude.dev/blog/building-effective-agent-automations/>; Claude Code in the cloud: a field guide to cloud sessions <https://claude.dev/blog/claude-code-in-the-cloud/>

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

### [releases-25] Scheduled tasks (formerly Routines) (verified, medium)
- Claim: Routines, cloud agents that fire on a schedule, a GitHub event or an API call, launched in Week 16 (April 13–17, 2026). The current docs call them 'scheduled tasks, formerly routines' and manage them with `/schedule` (alias `/routines`).
- Detail: A scheduled task bundles a saved prompt, repositories and connectors, and runs in Anthropic's cloud or a self-hosted environment. Triggers are Schedule, API (HTTP POST with a bearer token) or GitHub events. Available on Pro, Max, Team and Enterprise; it is still a research preview. The web address (claude.ai/code/routines), the CLI and the API still use the name 'routines'. Separately, `/loop` runs a prompt repeatedly in a local session (it self-paces when no interval is given, Week 15).
- Use: Automation lesson: a nightly PR-review task. Explain both names.
- Sources: Automate work with scheduled tasks <https://code.claude.com/docs/en/routines>; Week 16 · April 13–17, 2026 <https://code.claude.com/docs/en/whats-new/2026-w16>

### [learning-31] Automation level: headless, CI, scheduling, parallel sessions (verified, high)
- Claim: Automation uses non-interactive mode: `claude -p "prompt"` with `--output-format json` or `stream-json --verbose`, `--allowedTools` to pre-approve tools, and `--permission-mode dontAsk` to deny anything else in unattended runs.
- Detail: Fan-out loop: `for file in $(cat files.txt); do claude -p "Migrate $file ..." --allowedTools "Edit,Bash(git commit *)" --permission-mode dontAsk; done`. Test the prompt on 2-3 files before running all of them. `/batch <instruction>` splits work across 5 to 30 subagents, each in its own worktree. Parallel sessions: `claude --worktree <name>`, agent view (`claude agents`), and cloud sessions. Writer/Reviewer pattern: a fresh session reviews code another session wrote. GitHub: `/install-github-app` sets up the app and Actions; managed Code Review. Scheduling: `/schedule` (cloud scheduled tasks, formerly routines), Desktop scheduled tasks, and `/loop` within a session. Prompts for scheduled tasks must state what success looks like, because the run can't ask questions.
- Use: The advanced and team track: a lesson on headless and CI, and a capstone that automates a repo chore with `claude -p` plus review gating.
- Sources: Best practices - Automate and scale <https://code.claude.com/docs/en/best-practices>; Common workflows - Run Claude on a schedule <https://code.claude.com/docs/en/common-workflows>; Commands - /install-github-app, /schedule, /loop, /batch <https://code.claude.com/docs/en/commands>

### [safety-13] Workspace trust and untrusted repositories (verified, high)
- Claim: A project's `permissions.allow` rules and `additionalDirectories` take effect only after you accept the workspace trust dialog. `claude -p` and SDK runs never show the dialog, and in them a repository's hooks, `env` block and `apiKeyHelper` still run.
- Detail: The trust dialog lists the rules and directories a folder would grant. Deny and ask rules apply without trust because they only restrict. `.mcp.json` servers have their own approval prompt, but a `-p` run connects them without asking. Before running `claude -p` in a repository you didn't write, the docs advise: `--setting-sources user` (skips the project's settings and .mcp.json), `--bare` (skips project hooks, skills, commands, subagents, plugins and .mcp.json; the env block and helpers such as awsAuthRefresh still apply), `--settings '{"disableAllHooks": true}'`, and `disabledMcpjsonServers`. Starting in your home directory keeps trust only for that session. For an untrusted repository the docs recommend a dedicated VM or a cloud session.
- Use: Lesson 4: a scenario about cloning an unknown repo and running headless Claude, with a checklist of flags to use.
- Sources: Configure permissions — Project allow rules and workspace trust <https://code.claude.com/docs/en/permissions>; Choose a sandbox environment <https://code.claude.com/docs/en/sandbox-environments>

## Missed items (practice)
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

## Missed items (releases)
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