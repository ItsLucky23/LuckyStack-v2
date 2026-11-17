# feat/server-drain-phase

## 2026-11-17 — Drain before closing listeners

- **User prompt (summary)**: Implement a colleague's handoff: an awaited drain phase in graceful shutdown during which HTTP and Socket.io keep serving, cron starting no new runs, a shutdown-started signal for apps; release as 0.17.0.
- **What I did**: Added the `preServerDrain` hook and `isServerShuttingDown()` in core, reordered `runGracefulShutdown` (drain → close HTTP + io → `preServerStop` → flush → Redis), ran both hooks in the dev signal path, raised the announced supervisor grace to 6×/2×, and made the cron scheduler skip ticks and release leadership once shutdown starts.
- **Files touched**: `packages/core/src/{serverShutdown,index,hooks/types}.ts`, `packages/server/src/{stopServer,shutdownSignals,types}.ts` + tests, `packages/cron/src/scheduler.ts` + tests, changelogs, `packages/server/docs/create-server.md`, ADR 0089, this log.
- **Notes / decisions**: ADR 0089. Codex review (GPT-6.1 Sol): fixed the cron run admitted before shutdown but leased after it, and the outdated `preServerStop` contract comment. Not taken: awaiting running cron jobs during shutdown — the request only asks that they may finish, and cron never awaited them before; a consumer that needs it awaits its own work in `preServerDrain`. New tests fail on the old code: a real HTTP + Socket.io server serves a fresh connection and keeps a socket during the drain and refuses a connection after it; cron starts no runs after shutdown begins and lets the running one finish.
