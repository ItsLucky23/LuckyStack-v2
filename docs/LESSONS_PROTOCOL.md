# Lessons Protocol

## Why this layer exists

A lesson prevents a costly, non-obvious dead-end from recurring. Branch history preserves a session; a decision settles a choice; a lesson preserves the misleading symptom and the signal that would have exposed it sooner.

## Capture bar and timing

Follow `AGENTS.md`: keep a candidate in-session and capture once at wrap-up, autonomously, only when real effort was spent on a failure that was not obvious and would plausibly repeat. A quick fix, known pitfall or casual discussion does not qualify.

Consult `find_lesson`/`get_lesson` before retrying a difficult abandoned approach. If substantial history has no lessons, offer a focused history review and resumable interview; obtain approval and never fabricate past failures.

## Record shape

Use `docs/lessons/0000-template.md` for a committed `NNNN-slug.md`. Keep frontmatter `name`, `title`, `severity`, `area`, absolute `date` and `tags`; the slug must match the filename. Severity vocabulary: `low`, `medium`, `high`, `critical`.

Body sections: **What happened**, **Root cause**, **How to avoid**. Explain why the obvious diagnosis failed, not how the present fix is implemented. Use source/history pointers rather than pasted code; the pitfall should outlive the fix.

Numbers are identities: never shift or reuse published numbers. See [DECISION_MEMORY_PROTOCOL.md](DECISION_MEMORY_PROTOCOL.md) for collision reasoning. Refresh the ignored index with `npm run ai:lessons` and verify identities/backreferences with `npm run ai:check-ids -- --backrefs`.
