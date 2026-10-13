---
name: log_progress
description: Capture meaningful session work in the current branch log and maintain its index.
---

Follow `AGENTS.md` capture timing and `docs/BRANCH_LOG_PROTOCOL.md` (consumer copy under `docs/luckystack/`). This explicit invocation is the manual capture trigger; do not invent work for an empty/read-only session.

1. Determine the named branch; use the protocol's filename convention, not a second sanitizer. Detached HEAD has no branch log.
2. Read the existing log and append one session entry with the required heading/fields. Preserve history and summarize intent, outcome, evidence, failed paths and remaining work rather than copying implementation.
3. Update the corresponding `branch-logs/INDEX.md` row: actual entry count, timestamp and evidenced status. Create a missing row if needed.
4. Verify the append/index against Git/tool evidence and report the path/title.

Do not paste prompts, credentials or a second handoff. Link relevant durable records rather than retelling them.
