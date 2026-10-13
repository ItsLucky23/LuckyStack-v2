# @luckystack/test-runner

Generated-route contract, auth, rate-limit, CSRF and crash-resistance checks for a running LuckyStack server, over both API and sync routes. The checks probe each route over the transport real clients use, so a green sweep says something about the path users actually hit (ADR 0064).

## Install and run

```bash
npm install --save-dev @luckystack/test-runner zod socket.io-client
```

Start from the scaffolded project's `scripts/testAll.ts` and its test command; consult the installed types for a custom harness. A minimal entry passes the generated maps for **both** route kinds and the lazy config loader:

```ts
const summary = await runAllTests({
  apiMethodMap, apiMetaMap, apiInputSchemas,
  syncMetaMap, syncInputSchemas, // omit and sync routes are not swept (a warning says so)
  baseUrl: resolveTestBaseUrl({ fallbackUrl: `http://localhost:${ports.backend}` }),
  loadProjectConfig: async () => (await import('./config')).default,
});
logRunAllSummary(summary);
```

`runAllTests` writes the results file itself; an entry script should not write its own copy. A route filter is applied before any request is sent, so filtered-out routes are never called — not merely left out of the report.

**Upgrading an existing entry script to 0.10.2:** import `syncMetaMap` / `syncInputSchemas` from the generated files and pass them, and remove any manual write of the summary file. In a socket-mode project, Layer-5 `ctx.callSync` now runs over Socket.io; a test that depended on HTTP-only behaviour must request HTTP for that call. See the package changelog for the full list.

## Safety

A test process must load local environment layers and resolve configured secret pointers **before** importing database-backed tests. The server resolving its own secrets does not resolve the separate runner process. Never run against production or expose the test reset route there. The reset route requires a non-empty token in development/test and affects framework state, not your application database or custom session storage. The runner's own resets clear rate limits only, so an authenticated sweep keeps its session; see [rate-limit tests](./docs/rate-limit-tests.md).

An authenticated sweep calls every route with its own session, including routes that destroy it (logout, account deletion, session revoke); skip those routes or every later layer runs logged out.

The built-in checks are not a substitute for project-specific role, tenant or business assertions. Run the slower fuzz layer separately from fast PR checks. A fuzz pass means responses keep the framework envelope, **not** that no HTTP 5xx occurred; see [fuzz tests](./docs/fuzz-tests.md).
