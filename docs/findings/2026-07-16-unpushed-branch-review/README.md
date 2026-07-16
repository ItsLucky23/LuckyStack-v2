# Unpushed branch review — 2026-07-16

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: complete final diff from `origin/main` through the current working tree (22 unpushed commits + local edits; 97 changed paths) · Method: source/diff review, targeted probes, full unit/lint/build gates, strict Redis integration run · Supersedes: —

Last updated: 2026-07-16

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| BR-01 | The root production server bundle cannot resolve the new `@luckystack/core/config` subpath. | HIGH | open | 2026-07-16 | — | `npm run build` fails in `scripts/bundleServer.mjs`; its broad `@luckystack/core` alias rewrites the subpath to `packages/core/src/index.ts/config` |
| BR-02 | The secret-resolved CORS refresh resets almost the entire registered project config to defaults. | HIGH | open | 2026-07-16 | — | `config.ts` + scaffold template call `registerProjectConfig({ http: ... })`, while `projectConfig.ts` intentionally rebuilds each registration from pristine defaults |
| BR-03 | The C-04 refresh is incomplete for env-derived URL slots. | MED | open | 2026-07-16 | — | `DNS` / `PUBLIC_URL` can refresh the CORS array, but `app.publicUrl`, `backendUrl`, `oauthCallbackBase`, and environment selection remain frozen from module load |
| BR-04 | A `Date` API input now passes validation as a string but reaches a handler still typed as `Date`. | MED | open | 2026-07-16 | — | `zodEmitter.ts` correctly accepts ISO JSON, but input extraction deliberately preserves `Date`; `data.from.getTime()` therefore compiles and can throw |
| BR-05 | The “full wire projection” still emits false output types for several JSON/transport cases. | MED | open | 2026-07-16 | — | Examples: required `undefined` properties are omitted by JSON; function values with attached props are omitted but not dropped by `isFunctionOnlyType`; `Buffer` differs between HTTP JSON and Socket.io binary transport |
| BR-06 | Extraction-error diagnostics omit all stream fields. | LOW | open | 2026-07-16 | — | API/sync stream extractors catch to `never` without `recordExtractionOutcome`, and `collectFallbacks` never checks `stream` / `serverStream` / `clientStream` |
| BR-07 | Bun support metadata and release notes disagree with the implemented 1.3.3 floor/current status. | LOW | open | 2026-07-16 | — | Root `package.json` still says Bun `>=1.1.0`; create-app CHANGELOG says `bun@1.1.0` / `>=1.1.0` and still calls the now-fixed capability detector a blocker |

## Detail

### BR-01 — root server bundle is red

`config.ts`, `deploy.config.ts`, and `services.config.ts` now import the new client-safe
`@luckystack/core/config` subpath. TypeScript, Vite, package builds, and unit tests resolve it
correctly. The final server bundler does not: `scripts/bundleServer.mjs:141-148` has an esbuild
alias for `@luckystack/core` only. Esbuild applies it to the subpath and attempts to resolve:

```text
C:\code\LuckyStack-v2\packages\core\src\index.ts/config
```

Result: six resolution errors and exit 1 from `npm run build`. The consumer-template bundler
externalizes installed packages and is not affected; the monorepo/sample-app production build is.
The fix needs an explicit subpath alias (and a regression test), ordered/specified so the root
alias cannot swallow it.

### BR-02 — CORS refresh wipes project policy

Both `config.ts:409-413` and `packages/create-luckystack-app/template/config.ts:120-122`
re-register only this partial:

```ts
registerProjectConfig({ http: { cors: { allowedOrigins: collectAllowedOrigins() } } });
```

But `packages/core/src/projectConfig.ts:960-963` explicitly transforms every registration as
`deepMerge(DEFAULT_PROJECT_CONFIG, input)`, not as a merge over the currently active config.
A direct runtime probe confirmed that after this second registration custom values such as
`app.publicUrl`, `oauthCallbackBase`, `auth.forgotPassword`, `session.perUser`,
`rateLimiting.store`, and `http.cors.allowLocalhost` all revert to defaults. Only the refreshed
origin array survives.

This fires after every secret-manager resolve, even when only `EMAIL_FROM` changed, because the
listener ignores `changedKeys`. Impact includes silently disabling configured auth features,
changing session policy, and degrading Redis-backed rate limiting to the default in-memory store.
The new regression tests assert only `allowedOrigins`, so they remain green while missing this
collateral reset.

### BR-03 — other late env-derived values remain stale

The listener refreshes only CORS. In the root config, `detectedDns`, `resolvedEnvironment`,
`backendUrl`, `app.publicUrl`, and `oauthCallbackBase` are calculated before secret resolution.
In the scaffold template, `publicUrl`, `backendOrigin`, `backendUrl`, and `oauthCallbackBase` have
the same import-time shape. If `DNS` / `PUBLIC_URL` is a pointer, CORS can eventually contain the
real origin while links, redirects, OAuth callback URLs, and environment selection still use the
pointer/fallback. Either explicitly exclude these public routing vars from secret-manager support,
or refresh every derived slot coherently.

### BR-04 — Date input validation and handler typing disagree

`packages/devkit/src/typeMap/zodEmitter.ts:111-124` correctly recognizes that JSON delivers a
`Date` input as an ISO string and now emits `z.iso.datetime()`. However,
`getInputTypeDetailsFromFile` intentionally uses unprojected input text, and the handler's own
`ApiParams.data` still declares `Date`. Consequently the validator admits a string and invokes a
handler whose TypeScript contract promises a `Date` instance. The old route rejected every such
input; the new route reaches business logic with a value on which Date methods do not exist.
A safe contract should either require route authors to declare ISO strings (and reject/diagnose
`Date` input annotations) or distinguish client convenience input from the handler's wire input.

### BR-05 — projection is correct for the reviewed Date/ORM path, not general JSON

The new output projection fixes the concrete reported cases: nested ORM `Date` fields become
strings and function-only ORM methods disappear. Its generic claim is broader than its model:

- `{ required: undefined }` serializes as `{}`, but the generated property remains required.
- JSON omits every function-valued property, including callable objects with attached properties;
  `isFunctionOnlyType` drops only functions with zero properties.
- Socket.io transports `Buffer` as binary, while HTTP JSON uses `Buffer.toJSON()`; one shared
  projected output cannot truthfully claim only one of those shapes.

These should become explicit diagnostics/conservative unions or transport-specific output types.
They do not invalidate the `Date -> string` and measured MikroORM fixes.

### BR-06 — stream failures remain silent

`getApiStreamPayloadTypeDetailsFromFile`, `getSyncServerStreamPayloadTypeDetailsFromFile`, and
`getSyncClientStreamPayloadTypeDetailsFromFile` each catch and return `never`, but do not clear/set
the new extraction-failure registry. `collectFallbacks` checks only API input/output and sync
clientInput/serverOutput/clientOutput. A stream projection crash therefore remains exactly the
silent degradation the new diagnostics layer claims to eliminate.

### BR-07 — Bun metadata/doc drift

The implementation correctly establishes Bun 1.3.3 as the minimum version that honors
`bunfig.toml`'s `env = false`, and the scaffold template + constant agree. Remaining drift:

- root `package.json:19` advertises `bun >=1.1.0`, although the root now relies on a 1.3.3 feature;
- `packages/create-luckystack-app/CHANGELOG.md` still promises `bun@1.1.0` and `>=1.1.0`;
- the same CHANGELOG still says detached `import.meta.resolve` makes Bun not production-ready,
  although `packages/server/src/capabilities.ts` fixes that on this branch.

## Verified claims

- **Date outputs/session values:** the reviewed Prisma/session path now types JSON-round-tripped
  dates as strings; deep ORM fixtures cover three levels and the full unit suite passes.
- **Bun runtime + package manager:** code, tests, and the same-day branch evidence support all four
  npm/bun × Node/Bun scaffold cells. This review did not rerun Verdaccio because it performs
  `npm install` (user-gated by project rule 8). The current unit/runtime-independent gates pass.
- **Router WebSockets on Node:** strict Redis integration run passed 13/13, including real
  Socket.io polling, upgrade, and cross-instance fan-out. Bun's router limitation is upstream and
  now fails loudly by capability probe; Bun backends themselves remain supported.
- **Explicit ports 80/443:** raw URL validation now accepts explicit defaults while rejecting an
  omitted port. A direct Node probe confirmed the downstream `Number('') === 0` option resolves to
  protocol defaults 80/443. The comments saying `targetUrl.port` is non-empty are false, and an
  actual proxy-level regression test should pin this behavior.
- **Mail env overwrite:** boot-time `EMAIL_FROM` resolution works through the getter because both
  email-config reads occur after secret resolution. BR-02 currently makes the overall
  secret-manager config path unsafe despite that local fix.

## Verification log

| Gate | Result |
|---|---|
| `npm run test:unit` | 158 files, **1790/1790 passed** |
| `npm run lint` + `npm run lint:packages` | passed |
| `npm run ai:lint` | 0 invariant violations |
| `npm run test:integration` | 1 passed, 12 skipped (not accepted as proof) |
| `LUCKYSTACK_ENV_FILES=.env LUCKYSTACK_REQUIRE_REDIS=1 npm run test:integration` | **13/13 passed** |
| `npm run ai:changelog-check` | passed structurally; BR-07 is semantic drift |
| `git diff --check origin/main` | passed |
| `npm run build` | **FAILED** at final server bundle (BR-01); package builds 17/17, typegen, `tsc`, and Vite completed first |
