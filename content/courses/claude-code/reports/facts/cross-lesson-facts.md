# Cross-lesson facts confirmed by the fact audits (official pages, 2026-10-20)

Every cc lesson and the research report must state these the same way.

1. auto mode is the built-in starting mode from v2.1.283 for **interactive terminal and VS Code sessions** only
   (permission-modes). Desktop: set defaultMode; cloud sessions: Auto is an option when the org allows it.
2. The 17% false-negative figure comes from Anthropic's engineering post of March 2026 (classifier pipeline on
   Sonnet 4.6, 52 real overeager actions). Present it as that post's measurement, not as today's classifier.
3. Ask/deny Bash rules match the invocation Claude usually produces; they are not a security boundary
   (`Bash(git push *)` does not match `git -C . push`) (permissions).
4. Read/Edit deny rules apply to built-in file tools, Bash file commands Claude Code recognizes (cat, head, tail,
   sed, tee) and redirection targets; not to scripts that open files themselves or commands that read without naming
   the file (grep -r .). OS-level: sandbox. A Read deny also blocks Edit and Write on the same path (permissions).
5. Path forms in rules: `//path` absolute, `~/path` home, `/path` relative to the settings source, `path` / `./path`
   relative to the current directory (permissions).
6. Skills: changes under existing skills dirs are picked up live; a top-level skills dir created after the session
   started needs `/reload-skills` (skills).
7. Auto compaction runs as the context nears its limit; `/autocompact` and "Compact Instructions" in CLAUDE.md
   influence it (context-window, how-claude-code-works). Project-root CLAUDE.md and unscoped rules are re-injected
   from disk; path-scoped rules and nested CLAUDE.md come back only on demand (context-window).
8. `claude -p` (without --bare) runs project hooks and connects .mcp.json servers without a trust dialog; allow rules
   in an untrusted folder are not used (headless, permissions).
