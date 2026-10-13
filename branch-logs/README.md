# Branch Logs

These committed, append-only records preserve session intent and unfinished work across handoffs. The diff already shows code changes; a log should explain the reason behind them, not describe the implementation twice.

Follow `docs/BRANCH_LOG_PROTOCOL.md` (installed framework copy: `docs/luckystack/BRANCH_LOG_PROTOCOL.md`) for naming, entry fields and mandatory index maintenance. Capture once at wrap-up when real code/architecture work happened; read-only discussion and trivial edits create no entry.

Each application owns its own branch history. Do not import the framework's previous sessions as evidence about a consumer app.
