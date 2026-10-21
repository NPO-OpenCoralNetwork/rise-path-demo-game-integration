# Verified facts for cc-11-capstone (checked 2026-10-20)

### [practice-13] [Official] Build your setup over time: trigger -> feature (verified, high)
- Claim: The docs advise starting with CLAUDE.md alone and adding each extension only when its trigger appears, for example a CLAUDE.md line when Claude gets a convention wrong twice.
- Detail: The official trigger table: Claude gets a convention or command wrong twice -> CLAUDE.md. You keep asking for shorter or longer answers -> output style. You keep typing the same prompt to start a task -> user-invocable skill. You paste the same playbook a third time -> skill. You keep copying data from a browser tab -> MCP server. Claude reads many files to find a symbol -> code intelligence plugin. A side task floods the conversation -> subagent. Something must happen every time -> hook. A second repository needs the same setup -> plugin. The memory page lists when to add to CLAUDE.md: Claude makes the same mistake a second time, a code review catches something Claude should have known, you type the same correction as last session, or a new teammate would need the context. 'A repeated mistake or a recurring review comment is a CLAUDE.md edit, not a one-off correction in chat.'
- Use: A capstone 'design your setup' lesson. A matching exercise pairs symptoms with the right extension.
- Sources: Extend Claude Code (Build your setup over time) <https://code.claude.com/docs/en/features-overview>; How Claude remembers your project (When to add to CLAUDE.md) <https://code.claude.com/docs/en/memory>

### [practice-39] [Official] Rolling out Claude Code in large codebases and organizations (verified, high)
- Claim: Anthropic's May 14 2026 guidance says to build the harness in order (CLAUDE.md, then hooks, skills, plugins and MCP servers, plus LSP and subagents), scope Claude to the relevant subdirectory, name a single DRI, and review the configuration every 3 to 6 months and after major model releases.
- Detail: Quotes: 'Claude works best when it's scoped to the part of the codebase that's actually relevant to the task'; 'The root file should be pointers and critical gotchas only'. Docs specifics: launch from a package directory to load that CLAUDE.md plus its ancestors; use per-directory CLAUDE.md maintained by owners; claudeMdExcludes for others' packages; permissions.deny Read rules (e.g. "Read(./**/dist/**/*)") for generated or vendored code; code intelligence plugins; worktree.sparsePaths; --add-dir or additionalDirectories for sibling packages; per-directory skills with short, keyword-first descriptions; a Stop hook that proposes CLAUDE.md updates; remove instructions that worked around older model limits. Rollout: make the codebase navigable first, invest before broad access, start with approved skills and required review, form cross-functional groups (security, governance), then expand. A Japanese summary (Qiita, Sep 2026) calls this the 'ハーネス7層'.
- Use: Team and organization lesson for leads. Exercise: produce a rollout checklist and an owner (DRI) charter for a sample monorepo.
- Sources: How Claude Code works in large codebases: Best practices and where to start <https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start>; Set up Claude Code in a monorepo or large codebase <https://code.claude.com/docs/en/large-codebases>; 「Claude Code」を大規模なコードベースに導入するためのベストプラクティス ── ハーネス7層を構築順に理解する <https://qiita.com/nogataka/items/24db436c1123ab3d4cb2>

### [learning-30] Skill progression: when to add each extension (verified, high)
- Claim: The docs advise new users to 'Start with CLAUDE.md for project conventions, then add other extensions as specific triggers come up', and give a trigger table for the order most teams follow.
- Detail: Triggers: Claude gets a convention or command wrong twice -> CLAUDE.md. You keep asking for shorter or more explanatory answers -> an output style. You keep typing the same prompt -> a user-invocable skill. You paste the same playbook a third time -> a skill. You keep copying data from a browser tab -> an MCP server. Claude reads many files to find a symbol -> a code intelligence plugin. A side task floods the conversation -> a subagent. Something must happen every time -> a hook. A second repo needs the same setup -> a plugin. Key distinction: CLAUDE.md and skills are instructions ('a request, not a guarantee'), while hooks are deterministic ('Put guardrails in hooks'). Context cost: CLAUDE.md on every request; skills are low (descriptions only); subagents are isolated; hooks cost zero unless they return output.
- Use: The spine of the intermediate track: one lesson per trigger. A matching exercise (scenario -> feature) assesses an 'analyze'-level objective. Good for the final exam.
- Sources: Extend Claude Code - Build your setup over time <https://code.claude.com/docs/en/features-overview>

### [learning-35] Team adoption progression (Champion kit) (verified, high)
- Claim: The official Champion kit gives a thirty-day team adoption playbook: Week 1, seed a channel with your own examples; Week 2, start a weekly show-and-tell and share a skill or CLAUDE.md snippet; Week 3, pair and consolidate an FAQ; Week 4, hand off to a second champion.
- Detail: It recommends a 'real but contained task' as the first try: 'a bug or chore the person has been postponing because it is tedious rather than difficult.' `/team-onboarding` generates a guide from your last 30 days of usage that a teammate can paste as their first message. On the concern 'It will make junior engineers weaker', it suggests having them ask Claude to explain a file and its call sites before changing anything. On 'I tried it once and it hallucinated': 'usually a context problem rather than a model problem', fixed with @-mentions, /init and the real error output. It also says 'Claude Code is updated frequently. Verify version-specific details' against the docs.
- Use: Content for a team/organization lesson (the last unit), a recommended first real task for the practice brief, and answers to learner and manager objections.
- Sources: Champion kit <https://code.claude.com/docs/en/champion-kit>; Commands - /team-onboarding <https://code.claude.com/docs/en/commands>

### [practice-2] [Official] Verification first (verified, high)
- Claim: Official guidance says giving Claude a runnable check (tests, build, linter, screenshot comparison) is what lets a session finish without you, and says to ask for evidence rather than claims of success.
- Detail: Before/after prompts from the docs: 'write a validateEmail function. example test cases: ... run the tests after implementing'; '[paste screenshot] implement this design. take a screenshot of the result and compare it to the original. list differences and fix them'; 'fix it and verify the build succeeds. address the root cause, don't suppress the error'. Four ways to gate the stop: (1) in one prompt; (2) across a session with /goal; (3) deterministically with a Stop hook; (4) a second opinion from a verification subagent or a dynamic workflow, so 'the agent doing the work isn't the one grading it'. Run /verify yourself after Claude's check passes. Bundled /verify builds, runs and observes the app; /run-skill-generator writes a per-project skill teaching /run and /verify how to launch it. In the Oct 15 2026 code-review post, Boris Cherny calls verification 'probably the most important thing' and says it makes results 'two to three times better'.
- Use: A core lesson on verification loops. Exercise: rewrite three vague prompts into ones with pass/fail checks, then compare runs with and without a test command.
- Sources: Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>; Commands (/verify, /run, /run-skill-generator) <https://code.claude.com/docs/en/commands>; How the Claude Code team does code review <https://claude.dev/blog/solving-code-review-at-anthropic/>

### [practice-4] [Official] Explore -> Plan -> Implement -> Commit with plan mode (verified, high)
- Claim: The recommended workflow has four phases (Explore, Plan, Implement, Commit), with plan mode used to separate read-only exploration and planning from execution.
- Detail: Enter plan mode by pressing Shift+Tab until the status bar shows '⏸ plan mode on', by starting with 'claude --permission-mode plan', or with '/plan [description]' (e.g. '/plan fix the auth bug'). In plan mode Claude reads files and makes no edits. Press Ctrl+G to edit the plan in your editor before approving. Implement: approve the plan or press Shift+Tab, then e.g. 'implement the OAuth flow from your plan. write tests for the callback handler, run the test suite and fix any failures.' Commit: 'commit with a descriptive message and open a PR'. Skip planning for small, clear changes: 'If you could describe the diff in one sentence, skip the plan.' Plan mode writes the plan to a file, and Claude Code re-injects that file after compaction, so it survives long sessions where conversation history may not. /ultraplan is listed as Removed (use plan mode instead).
- Use: Foundational workflow lesson with a hands-on exercise: run the four phases on a small feature in a sample repo, editing the plan with Ctrl+G.
- Sources: Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>; Common workflows <https://code.claude.com/docs/en/common-workflows>; Explore the context window (What survives compaction) <https://code.claude.com/docs/en/context-window>; Set up Claude Code in a monorepo or large codebase <https://code.claude.com/docs/en/large-codebases>; Commands <https://code.claude.com/docs/en/commands>

### [practice-12] [Official] Writing an effective CLAUDE.md (verified, high)
- Claim: Official guidance is to keep each CLAUDE.md under about 200 lines, write concrete, verifiable instructions, and cut any line whose removal would not cause Claude to make mistakes.
- Detail: Include: Bash commands Claude can't guess, style rules that differ from defaults, test instructions, repo etiquette, project-specific architecture decisions, environment quirks and non-obvious gotchas. Exclude: anything Claude can learn by reading the code, standard conventions, detailed API docs (link instead), frequently changing info, tutorials, file-by-file descriptions, and self-evident rules like 'write clean code'. Be concrete: 'Use 2-space indentation' not 'Format code properly'; 'Run `npm test` before committing' not 'Test your changes'. Use emphasis ('IMPORTANT') on one line at a time, not many. Tools: /init generates a starter, and suggests improvements if a file exists. CLAUDE_CODE_NEW_INIT=1 gives an interactive /init that also sets up skills and hooks. /doctor proposes cuts for a checked-in CLAUDE.md. '/doctor prompt-audit' (v2.1.283+) finds stale or conflicting instructions across CLAUDE.md, AGENTS.md, rules, skills and agents. @path imports organize a file but do not reduce context cost. Run /context to confirm the file loaded. The Jun 18 2026 steering post adds: 'Keep CLAUDE.md under 200 lines, give it an owner, and review changes to it like code.'
- Use: CLAUDE.md lesson. Exercise: prune a bloated 300-line sample CLAUDE.md with the include/exclude table and the 'would removing this cause mistakes?' test.
- Sources: Best practices for Claude Code (Write an effective CLAUDE.md) <https://code.claude.com/docs/en/best-practices>; How Claude remembers your project <https://code.claude.com/docs/en/memory>; Steering Claude Code: when to use CLAUDE.md, skills, hooks, and subagents <https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more>

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

### [safety-7] Permission rule evaluation (verified, high)
- Claim: Rules are checked in a fixed order (deny, then ask, then allow) and the first match wins; a more specific rule does not change that order. Claude Code enforces the rules, not the model, so an instruction in CLAUDE.md does not grant or revoke access.
- Detail: A broad deny such as Bash(aws *) blocks even calls that also match a narrower allow such as Bash(aws s3 ls). An allow cannot carve an exception out of a deny. A bare tool name in deny (e.g. `Bash`) removes the tool from Claude's context; a scoped rule (Bash(rm *)) only blocks matching calls. Manage rules with `/permissions` (alias /allowed-tools), which shows each rule's source file. Deny and ask rules can match a top-level tool parameter, e.g. `Agent(model:opus)` or `Bash(run_in_background:true)`. MCP tool globs: deny `mcp__*` blocks all MCP tools; allow globs need a literal `mcp__<server>__` prefix. A PreToolUse hook that exits with code 2 blocks a call before rules are checked, but a hook's "allow" cannot override a deny or ask rule.
- Use: Lesson 2 (権限ルール実践): a predict-the-outcome quiz about deny/ask/allow precedence, then edit .claude/settings.json.
- Sources: Configure permissions — Manage permissions <https://code.claude.com/docs/en/permissions>

### [safety-26] Reviewing changes safely: checkpoints, /diff, git (verified, high)
- Claim: Every prompt that starts a turn creates a checkpoint. `/rewind` (aliases /checkpoint, /undo), or Esc twice on an empty prompt, restores code, conversation or both. Checkpoints do NOT track files changed by Bash commands and are "not a replacement for version control".
- Detail: Rewind menu options: Restore code and conversation, Restore conversation, Restore code, Summarize from here, Summarize up to here, Never mind. Snapshots are kept for the 100 most recent checkpoints per session and deleted in the retention sweep (about 30 days). Edits by background subagents are generally not restored, so use git. Symlinked and hard-linked files are skipped. `/diff` shows working-tree changes, including Claude's edits. The diff panel needs fullscreen rendering, a git repo, a terminal ≥110 columns and v2.1.287+. `/code-review` (alias /review) checks the diff for bugs. `/security-review` scans the branch diff against origin's default branch. Best practices add: give Claude a way to verify its work, and have a subagent review the diff in a fresh context.
- Use: Lesson 7 (変更のレビューと巻き戻し): a rewind practice and a 'Bash rm can't be rewound' check, then the commit habit with git.
- Sources: Checkpointing <https://code.claude.com/docs/en/checkpointing>; Interactive mode — Review changes with /diff <https://code.claude.com/docs/en/interactive-mode>; Commands <https://code.claude.com/docs/en/commands>; Best practices for Claude Code <https://code.claude.com/docs/en/best-practices>

### [learning-33] Learning science: AI assistance and skill formation (Anthropic RCT) (verified, high)
- Claim: In Anthropic's randomized controlled trial (published 2026-01-29; 52 mostly junior engineers learning the Python Trio library), the AI-assisted group scored 50% on a follow-up quiz versus 67% for hand-coders ('nearly two letter grades'; Cohen's d = 0.738, p = 0.01), with no significant speed gain and the largest gap on debugging questions.
- Detail: Patterns linked to low quiz scores (under 40%): AI delegation, progressive AI reliance, and iterative AI debugging. Patterns linked to high scores (65%+): generation-then-comprehension, hybrid code-explanation, and conceptual inquiry. The authors write that 'Cognitive effort—and even getting painfully stuck—is likely important for fostering mastery,' and point to Claude Code's Learning and Explanatory modes. Caveats: a small sample, a short-term quiz, and the setup was an AI sidebar rather than an agentic tool like Claude Code (they expect agentic tools could have a larger effect). The full paper is arXiv 2601.20245.
- Use: Design rationale for the course: after each agent-driven exercise, include comprehension checks ('explain this diff', 'predict what the test will do'), encourage 'ask for an explanation' prompts, and give one debugging task to do without the agent. Cite this in the course intro on why we learn to understand, not just delegate.
- Sources: How AI assistance impacts the formation of coding skills <https://www.anthropic.com/research/AI-assistance-coding-skills>