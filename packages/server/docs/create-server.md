# Server creation

The high-level bootstrap supplies a single place to verify registrations and connect HTTP, sockets and optional feature packages. A lower-level server factory exists for integrations that knowingly take over this responsibility. Starting to listen before critical config and security registrations are ready creates request-time failures; check boot prerequisites first. Source: `../src/bootstrap.ts`, `../src/createServer.ts`, `../src/verifyBootstrap.ts`.

Shutdown hooks are best-effort opportunities to flush or drain dependencies, not a veto of termination. Production route maps must not depend on development-only tooling. For types, options and lifecycle implementation see `../src/types.ts`, `../src/afterListen.ts`, `../src/stopServer.ts` and `./runtime-maps.md`.

For long-running work, keep the framework's signal handlers and give the hook time to drain:

```ts
const server = await bootstrapLuckyStack({ shutdownTimeoutMs: 180_000 });
await server.listen();
```

The same option is available on `createLuckyStackServer`; its authoritative contract is in `../src/types.ts`.

Wait for long-running work in `preServerDrain`, not in `preServerStop`. The drain hook runs first, while the HTTP listener and Socket.io still serve: page loads keep working behind a single-instance proxy, and a request for new work can still get an answer such as "the server is restarting, retry shortly". Refuse that new work yourself; `isServerShuttingDown()` from `@luckystack/core` turns true just before the drain starts, and `@luckystack/cron` reads it to start no new runs. Once every drain handler resolves (or `timeoutMs` passes), the server closes HTTP and Socket.io together, so clients reconnect to the replacement, and then dispatches `preServerStop` for cleanup. Handlers run in registration order, so a drain handler should not wait on work that a later handler releases. Repeating the first signal (a second Ctrl+C, or a second SIGTERM) forces exit. A different signal during the drain is ignored, because a terminal Ctrl+C reaches a supervised child twice: as SIGINT and as the supervisor's SIGTERM. Programmatic `stop()` remains idempotent.

Allow additional time in your deployment platform's termination grace for tracker flushing and connection cleanup: production budgets apply per step, rather than to a total deadline. The devkit supervisor receives the configured ceiling over IPC. With a runtime without IPC (currently Bun on Windows), set `LUCKYSTACK_SUPERVISOR_GRACE_MS` in the supervisor's launching environment to cover the drain and cleanup. Restart the server after changing the option.
