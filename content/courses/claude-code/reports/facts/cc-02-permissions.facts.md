# Verified facts for cc-02-permissions (checked 2026-10-20)

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

### [safety-11] Where approvals are saved (verified, high)
- Claim: Choosing "Yes, and don't ask again" for a Bash command or WebFetch domain saves a rule to `.claude/settings.local.json` at the git repository root (v2.1.211+). File-edit approvals last only until the session ends.
- Detail: Approval table: read-only tools need no approval inside the working and additional directories. Bash and WebFetch approvals are permanent per repository. Web search approvals are permanent per repository. File modifications are approved for the session only. Approving a compound command saves one rule per subcommand that needed approval (up to 5). Some prompts offer only one-time approval when the rule couldn't be shown in full. Press Tab on Yes/No to attach a comment to Claude. Extend access with `--add-dir`, `/add-dir` or `permissions.additionalDirectories`. `/cd` moves the session and applies the new directory's project settings after a trust prompt. Security guidance says to audit rules regularly with `/permissions`.
- Use: Lesson 2: show where rules land and have learners clean up an over-broad saved rule.
- Sources: Configure permissions — Permission system <https://code.claude.com/docs/en/permissions>; Security — Security best practices <https://code.claude.com/docs/en/security>

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

### [safety-26] Reviewing changes safely: checkpoints, /diff, git (verified, high)
- Claim: Every prompt that starts a turn creates a checkpoint. `/rewind` (aliases /checkpoint, /undo), or Esc twice on an empty prompt, restores code, conversation or both. Checkpoints do NOT track files changed by Bash commands and are "not a replacement for version control".
- Detail: Rewind menu options: Restore code and conversation, Restore conversation, Restore code, Summarize from here, Summarize up to here, Never mind. Snapshots are kept for the 100 most recent checkpoints per session and deleted in the retention sweep (about 30 days). Edits by background subagents are generally not restored, so use git. Symlinked and hard-linked files are skipped. `/diff` shows working-tree changes, including Claude's edits. The diff panel needs fullscreen rendering, a git repo, a terminal ≥110 columns and v2.1.287+. `/code-review` (alias /review) checks the diff for bugs. `/security-review` scans the branch diff against origin's default branch. Best practices add: give Claude a way to verify its work, and have a subagent review the diff in a fresh context.
- Use: Lesson 7 (変更のレビューと巻き戻し): a rewind practice and a 'Bash rm can't be rewound' check, then the commit habit with git.
- Sources: Checkpointing <https://code.claude.com/docs/en/checkpointing>; Interactive mode — Review changes with /diff <https://code.claude.com/docs/en/interactive-mode>; Commands <https://code.claude.com/docs/en/commands>; Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>

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

### [practice-31] [Official] Permissions, auto mode and its limits (corrected, high)
- Claim: Claim is correct, but quote the engineering post exactly: auto mode is 'not a drop-in replacement for careful human review on high-stakes infrastructure' (not 'not a substitute for'). Before v2.1.283, auto mode was the starting mode only on Pro, Max and Team plans. Also note that `claude -p` runs on v2.1.302+ start in Manual mode when nothing sets a permission mode.
- Detail: Docs: pre-approve trusted commands with /permissions (e.g. npm run lint, git commit), use /sandbox for OS-level filesystem and network isolation, and switch to Manual mode to approve actions yourself. Shift+Tab cycles modes. Mar 25 2026 engineering post (John Hughes): users accepted 93% of manual prompts (approval fatigue). The classifier is reasoning-blind (sees user messages and tool calls, not Claude's prose) and blocks scope escalation, credential exploration, guessed targets, external data sharing and bypassed safety checks. On real traffic it had 0.4% false positives and 17% misses on real overeager actions. A blocked action returns to Claude, and after 3 consecutive or 20 total denials it escalates to the human. The authors say it 'is not a substitute for careful human review on high-stakes infrastructure' and call --dangerously-skip-permissions 'unsafe in most situations'. The Opus 5.5 playbook advises keeping prompts on for destructive commands and naming stop rules in CLAUDE.md ('Stop and ask only ... before anything destructive').
- Use: Safety and permissions lesson. Exercise: configure an allowlist, compare Manual vs auto mode on a task, and discuss residual risk.
- Sources: Best practices for Claude Code (Configure permissions) <https://code.claude.com/docs/en/best-practices>; How we built Claude Code auto mode: a safer way to skip permissions <https://www.anthropic.com/engineering/claude-code-auto-mode>; Getting the most out of Opus 5.5 in Claude and Claude Code <https://claude.dev/blog/getting-the-most-out-of-opus-5-5/>
- Verifier evidence: Best practices: 'With Claude Code v2.1.283 or later, auto mode is the built-in starting permission mode for interactive terminal and VS Code sessions'. Auto mode post (John Hughes, Mar 25, 2026): 'users accept 93% of them anyway'; 'reasoning-blind by design'; 'FPR drops from 8.5% to 0.4%'; about 17% of real overeager actions get through ('the honest number'); '3 consecutive denials or 20 total'; --dangerously-skip-permissions 'unsafe in most situations'. Opus 5.5 playbook: 'Keep permission prompts on for destructive commands regardless.' <https://www.anthropic.com/engineering/claude-code-auto-mode>

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