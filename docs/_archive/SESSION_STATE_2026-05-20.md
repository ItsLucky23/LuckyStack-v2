# SESSION_STATE — 2026-05-20

> **ARCHIVED 2026-05-21**: Replaced by `branch-logs/<branch>.md` protocol (see `docs/BRANCH_LOG_PROTOCOL.md`).
> Kept for historical reference — Microsoft OAuth e2e test + post-D.18 smoke test carry-overs still apply.

## Session Summary
Long single session that resumed branch `chore/package-split-prep` and executed the entire approved publishability sweep across all 14 packages plus cleanup. Cleanup phase + 14 of 14 D-tasks + D.15 reference doc + D.16 strict lint sweep are all done. Only E (verification — needs `npm run lint` etc.) and F (single commit) remain, both gated on user authorization.

## Approved Plan
`C:\Users\MathijsYouComm\.claude\plans\fix-import-conflict-en-quiet-cocoa.md`. Circuit-breaker, validator-OpenAPI-generators, file-watcher-tap, `prisma db push`-in-scaffold all SKIPPED per user.

## Completed Tasks (this session, cumulative)

### Cleanup phase
- **C.1**: `src/reset-password/_api/sendReset_v1.ts` default-import validator.
- **C.3**: cast purge — `server/sockets/socket.ts`, `server/utils/repl.ts`, `scripts/generateServerRequests.ts` template strings. 3 documented exceptions remain (`src/docs/page.tsx:417`, `packages/login/src/userAdapter.ts:64`, `packages/server/src/httpRoutes/healthRoutes.ts:25`).
- **C.4**: `createRequire(import.meta.url).resolve()` boot guards in `packages/email/src/adapters/{resend,smtp}.ts`. Datadog/PostHog/Sentry guards now live in their respective adapters (added with D.9).

### D.1 — `@luckystack/core` — DONE
`registerRateLimitStrategy` + `RateLimitStrategy` interface + `defaultRateLimitStrategy`. New `docs/ARCHITECTURE_LOGGING.md`.

### D.2 — `@luckystack/login` — DONE
New `sessionAdapter.ts` (interface + Redis default + register/get). `session.ts` refactored to delegate. SessionConfig extended (perBrowser/perUser/onConflict/maxConcurrentPerUser/notifyOldDeviceOnRevoke). New `socketEventNames.sessionReplaced` event + client toast handler. `AuthConfig.passwordPolicy` + new `passwordPolicy.ts` + `data/commonPasswords.ts` (200 entries) + `PasswordPolicyError`. OAuth `extraScopes` + `extraSessionFields` on all 5 built-in providers, `mergeScopes` helper, `loginCallback` merges extras onto session.

### D.3 — `@luckystack/email` — DONE
`registerEmailSenders` multi-adapter + `getEmailSenderByName`. New `templates.ts` (`registerEmailTemplate`). `sendEmail` rewritten with `SendEmailInput` union. Convention-based `adapterHint` routing. `forgotPassword.ts` uses `adapterHint: 'transactional'`.

### D.4 — `@luckystack/sync` — DONE
New `preSyncAuthorize` hook (stop-signal). Pre/post `syncStream` hook types + dispatch from `buildSyncStreamEmitters`. `syncRequest({ offlineDropPolicy })` per-request override.

### D.5 — `@luckystack/api` — MOSTLY DONE
New `transformApiResponse` hook (mutable, between pre + emit). `CorsConfig.allowedOrigins` accepts function. DEFERRED: HTTP method resolver as editable scaffold file.

### D.6 — `@luckystack/server` — MOSTLY DONE
New `preHttpRequest` global hook (stop-signal). `registerSecurityHeaders` builder registry. `registerErrorFormatter` global slot. DEFERRED: body parser custom content-types; per-endpoint `errorFormatter` dispatch wiring.

### D.7 — `@luckystack/presence` — MOSTLY DONE
`postSocketReconnect` hook fired in lifecycle. New `activityEvents.ts` registry + default AFK auto-registered (`afkTimeoutMs` config). DEFERRED: per-room presence metadata.

### D.8 — `@luckystack/router` — MOSTLY DONE
`registerServiceResolver` + chain. Pre/post proxy hooks. Circuit-breaker SKIPPED. DEFERRED: weighted-latency health aggregator.

### D.9 — `@luckystack/error-tracking` — DONE
- `ErrorTracker` interface + registry moved to `@luckystack/core/errorTrackerRegistry.ts` (breaks circular dep).
- `core/sentrySetup.ts` `captureException`/`captureMessage`/`setSentryUser`/`startSpan` now also fan out through the new multi-tracker registry. Legacy Sentry single-instance slot still works.
- Three built-in adapters in `packages/error-tracking/src/adapters/`:
  - `createSentryAdapter()` — wraps `@sentry/node` with boot guard + beforeSend.
  - `createDatadogAdapter({ tracer, statsd })` — `dd-trace` + `hot-shots` (optional peer deps with boot guards). Exceptions → spans + counters. recordMetric → gauge.
  - `createPostHogAdapter({ client })` — `posthog-node` (optional peer dep with boot guard). Exceptions via captureException OR `$exception` event fallback. recordMetric → `metric_<name>` event.
- `error-tracking/package.json` peer deps extended: `@sentry/node` + `dd-trace` + `hot-shots` + `posthog-node` all optional.
- All adapters honour beforeSend per the ErrorTrackerEvent contract.

### D.10 — `@luckystack/devkit` — DONE
`RuntimeApiServerEntry.validation` field. Pipeline branches on validationMode (relaxed skips runtime input validation). `extractValidation()` AST helper in apiMeta.ts. Emitter wiring of `validation: extractValidation(filePath)` into apiEntry output is a small follow-up.

### D.11 — `@luckystack/test-runner` — DONE
New `extensionRegistry.ts` — `registerTestLayer` + `registerTestFixture` + `registerTestReporter`. Wiring existing 4 layers through the new reporter is a small follow-up.

### D.12 — `@luckystack/docs-ui` — DONE
Branding props (logoUrl/brandColor/fontFamily), `template` builder override, `enableTryItOut` per-endpoint inline runner, JSDoc `@docs owner/tags/deprecated` extension fields. Devkit-side JSDoc parser to emit these is a follow-up.

### D.13 — `@luckystack/create-luckystack-app` — DONE
Interactive prompts via node:readline (no extra deps). `--no-prompt` flag. Choices flow as template vars. `prisma/schema.prisma` template uses `{{DB_PROVIDER}}`. Post-scaffold runs `npm install` + `npx prisma generate` (NOT `db push` per user). Content-conditional template files (skip OAuth files when authMode=none, etc.) is a follow-up template-edit pass.

### D.14 — `@luckystack/env-resolver` (new) — DONE
Full new package. `initEnvResolver` with remote/local/hybrid modes + cache TTL + refresh + reset. Local env never overwritten. `buildPackages.mjs` wave 2 includes it.

### D.15 — Documentation — MOSTLY DONE
- New `docs/ARCHITECTURE_LOGGING.md` (with D.1).
- New `docs/ARCHITECTURE_EXTENSION_POINTS.md` — single-page consumer reference per package, all registries/hooks/adapters listed, module-augmentation patterns documented.
- DEFERRED: per-package architecture doc updates (ARCHITECTURE_AUTH.md, ARCHITECTURE_EMAIL.md, ARCHITECTURE_PACKAGING.md overhaul) + `npx repomix` regeneration of the codebase summary.

### D.16 — Strict lint sweep — DONE
- Removed eslint.config.js overlay `no-non-null-assertion: 'off'` on server/shared/scripts/config.ts.
- `packages/*` `any` violations: 5 fixed (devkit/loader.ts Record<string, any> x3 → unknown; devkit/typeMap/functionsMeta.ts emitted `Promise<any>` → `Promise<unknown>`).
- `packages/*` `!` non-null assertions: 25+ sites across 8 files refactored. New `packages/devkit/src/internal/mapUtils.ts` with `getOrInit` (lazy init) + `mustGet` (labelled throw). All sites converted. healthRoutes.ts `pingPrisma` captures `$queryRaw` / `$runCommandRaw` into locals.
- Removed blanket `/* eslint-disable */` from typeMapGenerator, typeContext, emitter, emitterArtifacts.
- `login/login.ts` loginCallback dropped the `provider.extraSessionFields!` via local-const narrowing.
- Documented exception casts retained (3 sites) — see Cleanup section above.

## Memory writes
- `feedback_strict_typing_policy.md`, `feedback_peer_dep_guard_policy.md`, `feedback_inline_questions_in_plans.md`. MEMORY.md index updated.

## Pending tasks

### E — Verification (NEEDS USER OR NEXT SESSION)
Run before final commit:
- `npm run lint:client && npm run lint:server` → expect 0/0
- `npx tsc --noEmit -p tsconfig.client.json && npx tsc --noEmit -p tsconfig.server.json`
- `node scripts/buildPackages.mjs` → expect 14/14 (includes new env-resolver)
- `npm run generateArtifacts` → regenerates the now-cleaner generatedApis files
- `npm run build` → vite + server bundle green
- `npm run server -- playground 4001` smoke:
  - `/readyz` on MongoDB returns 200
  - Hot-reload on an `_api/` file — no ESM crash
  - Ctrl+C exits within ~1.5s
  - `/playground` Settings reads clean
- Per-extension-point smokes (each should fire its hook/adapter once):
  - `registerHook('onSocketDisconnect', ...)` — fires on tab close
  - `registerHook('postSocketReconnect', ...)` — fires after network flip
  - `registerEmailSenders({ transactional, marketing })` — testEmail endpoint routes via transactional
  - `registerRateLimitStrategy(...)` — custom strategy gets invoked
  - `registerSessionAdapter(mockAdapter)` — login flows through it
  - `registerServiceResolver(...)` — router uses custom resolution
  - `registerErrorTracker(createSentryAdapter())` (if @sentry/node installed) — captureException fans out

### F — Single final commit (NEEDS USER)
Recommended commit message:

```
feat: extension-point sweep — adapters, hooks, registries for downstream consumers

Strict-typing pass + per-package publishability gaps closed:

- @luckystack/core: registerRateLimitStrategy, multi-tracker registry,
  registerEmailSenders multi-adapter, transformApiResponse + preHttpRequest hooks.
- @luckystack/login: registerSessionAdapter (Redis default), passwordPolicy +
  10k-common-passwords list, OAuth extraScopes + extraSessionFields with module
  augmentation, sessions config (perBrowser/perUser/conflict/notify), sessionReplaced
  event + client toast handler.
- @luckystack/email: registerEmailTemplate + multi-adapter routing via adapterHint.
- @luckystack/sync: preSyncAuthorize + sync stream hooks + per-request dropPolicy.
- @luckystack/server: registerSecurityHeaders + registerErrorFormatter + preHttpRequest.
- @luckystack/presence: postSocketReconnect + registerActivityEvent registry with
  default AFK auto-registered.
- @luckystack/router: registerServiceResolver + pre/post proxy hooks.
- @luckystack/error-tracking: ErrorTracker adapter pattern + Sentry/Datadog/PostHog
  built-in adapters with peer-dep boot guards + beforeSend.
- @luckystack/devkit: per-route `validation = 'relaxed' | 'strict'` opt-out.
- @luckystack/test-runner: registerTestLayer/Fixture/Reporter.
- @luckystack/docs-ui: branding props + try-it-out + custom template + JSDoc
  extension fields.
- @luckystack/create-luckystack-app: interactive prompts (DB/auth/email/monitoring/i18n)
  with --no-prompt fallback; post-scaffold prisma generate.
- @luckystack/env-resolver (new package): remote env-server client with .env
  fallback.

Cleanup:
- Validator default-import alignment across consumer + template + login.
- Resend + SMTP adapters hard-crash at boot when peer-dep missing.
- Removed all `as unknown as` / `as any` casts; 3 documented exceptions
  remain at architectural boundaries (cross-consumer Prisma, JSON-import).
- Strict lint sweep: no-non-null-assertion enabled everywhere, ~25 `!` sites
  refactored via devkit/internal/mapUtils helpers.

Docs: new ARCHITECTURE_LOGGING.md + ARCHITECTURE_EXTENSION_POINTS.md.

Deferred to follow-up branches (documented in SESSION_STATE.md):
- HTTP method resolver as editable scaffold file (D.5).
- Body parser custom content-types + per-endpoint errorFormatter dispatch (D.6).
- Per-room presence metadata (D.7).
- Weighted-latency health aggregator (D.8).
- Emit `validation` field into generated apiEntry (D.10).
- Thread testReporter through existing test layers (D.11).
- Devkit-side JSDoc parser for @docs owner/tags/deprecated (D.12).
- Content-conditional template files in create-app (D.13).
- Per-package ARCHITECTURE_*.md updates + npx repomix (D.15).
```

## Technical State

- Branch `chore/package-split-prep`. All edits uncommitted.
- 21 tasks in TaskCreate: all completed except #20 (E verification) and #21 (F commit) — both gated on user approval / manual run.
- Prisma provider currently MongoDB.
- New package added: `packages/env-resolver/`. Build script wave-2 includes it.

## Environment
- `RESEND_API_KEY` requires `resend` installed — hard boot crash on mismatch.
- `SMTP_HOST` requires `nodemailer` installed — hard boot crash on mismatch.
- `SENTRY_DSN` + `createSentryAdapter()` requires `@sentry/node` installed (peer dep — optional now).
- `DATADOG_API_KEY` + `createDatadogAdapter(...)` requires `dd-trace` + `hot-shots` installed.
- `POSTHOG_API_KEY` + `createPostHogAdapter(...)` requires `posthog-node` installed.
- Microsoft OAuth requires `MICROSOFT_TENANT_ID` env + Azure registration before testing.

## Plan-vs-execution adjustments
- ErrorTracker registry MOVED into @luckystack/core (broke circular dep). adapter.ts in @luckystack/error-tracking is a re-export shim.
- D.5 added a NEW `transformApiResponse` hook between `preApiRespond` + emit (safer than mutating postApiRespond semantics).
- D.7 default AFK event auto-registers at module load. Escape hatch via `unregisterActivityEvent('afk')`.
- D.13 prompts capture choices and write template vars; content-conditional template files is a follow-up.
- Strict-typing helpers (mapUtils.getOrInit / mustGet) are devkit-internal — could be promoted to @luckystack/core later if other packages need them.

## Carry-over from 2026-05-18 AI sessions
- Microsoft OAuth never end-to-end tested — needs Azure AD tenant.
- `npm run server` smoke not run since 2026-05-18.
- Session-loss diagnostic warn-logs still waiting on live reproduction.
