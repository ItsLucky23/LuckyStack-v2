# Skill: daily-handoff

Preserve unfinished intent across sessions without copying the implementation into a second manual.

Use `/save_handoff` when available. Otherwise follow its canonical definition in `.claude/commands/save_handoff.md`; that command owns the destination and section format. Do not invent branch-log handoff paths or a separate layout for child agents.

## Evidence to gather

- Current branch/worktree, Git status and relevant branch history.
- Completed outcomes versus genuinely unfinished work, with verification commands/results.
- Decisions already made, open decisions, costly failed approaches and exact next actions.
- Active runtime/run identifiers, actual URLs/ports and lifecycle state when relevant.
- Source/diff pointers rather than copied signatures or code tours.

Keep it concise enough to act on. Do not pad to a line target, claim pending agents completed, or expose secrets. A new session must reconcile the handoff against Git and active runtimes before duplicating work.

Capture other record layers once at wrap-up under `AGENTS.md`, not as a side effect of every checkpoint.
