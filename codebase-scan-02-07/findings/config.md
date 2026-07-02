# Config & Environment Audit — LuckyStack root

Scope: `config.ts`, `config.ports.ts`, `deploy.config.ts`, `services.config.ts`, `.env_template`, `.env.local_template`, `luckystack.ai.json`, `luckystack.invariants.json`, `package.json` (scripts). SCAN ONLY — no edits made.

Method: read each target fully, then cross-grepped the whole repo (`packages/*/src`, `server/`, `scripts/`, `shared/`, `src/`) to confirm whether each significant key is actually consumed.

Headline: no critical mis-config. The most concrete defect is a **dead deploy-config flag** (`switchNewTrafficToLocalWhenHealthy`) that reads as meaningful and is set to `true` but is wired to nothing. Everything else is drift, ordering, or template-hygiene.

---

## Findings

### C-01 — DEAD deploy flag: `switchNewTrafficToLocalWhenHealthy` (MEDIUM)

- **File/line:** `deploy.config.ts:83` (type), `deploy.config.ts:144` (value `true`).
- **Value:** `development.switchNewTrafficToLocalWhenHealthy: true`.
- **Why it's dead:** It is declared in the `DeployConfig.development` interface (`deploy.config.ts:83`), set to `true` in the active config (`:144`), and typed in the core registry (`packages/core/src/deployConfigRegistry.ts:105`) — but it is **never read anywhere**. A repo-wide grep for the identifier across `packages/**/src`, `scripts/`, and `server/` returns **only** the type declaration and the config assignment; the router's `startRouter.ts` / `healthPoller.ts` / `resolveTarget.ts` consume `enableFallbackRouting`, `healthPollMs`, `enableUnhealthyFallback`, and `strictBootHandshake`, but nothing consumes this key. The health poller flips local health via `setLocalHealth(...)` unconditionally.
- **Evidence:** `grep switchNewTrafficToLocalWhenHealthy packages/**/src/**/*.ts` → single hit = the type def at `deployConfigRegistry.ts:105`; `grep … scripts,server` → no matches. Contrast with the sibling flags on the same object, all of which have real consumers (see `startRouter.ts:99-101`, `resolveTarget.ts:238`, `startRouter.ts:158`).
- **Impact:** A developer reading `deploy.config.ts` reasonably believes toggling this changes dev traffic-switch behavior; it does nothing. Either wire it into `healthPoller`/`resolveTarget` or drop it from the config + registry type.

### C-02 — `.env_template` `EXTERNAL_ORIGINS` default omits Microsoft (LOW-MEDIUM)

- **File/line:** `.env_template:37`.
- **Value:** `EXTERNAL_ORIGINS=https://accounts.google.com,https://github.com,https://www.facebook.com,https://discord.com`.
- **Why it's wrong:** Microsoft (Azure AD) is a first-class, documented OAuth provider in the very same template (`.env_template:106-114`, `MICROSOFT_CLIENT_ID` block). The framework's canonical origin map lists it — `packages/cli/src/featureOptions.ts:55` and `packages/create-luckystack-app/src/index.ts:2010`: `microsoft: 'https://login.microsoftonline.com'`. The default `EXTERNAL_ORIGINS` string enumerates the other four providers but **not** `https://login.microsoftonline.com`.
- **Evidence:** `OAUTH_ORIGINS` map (`featureOptions.ts:50-55`) includes microsoft; template default line 37 does not.
- **Impact:** A project that enables Microsoft login by filling in `MICROSOFT_CLIENT_ID/SECRET` starts with a `EXTERNAL_ORIGINS` list that doesn't include the Microsoft origin (unless they use `luckystack add` which patches it via `updateExternalOrigin`). Low-medium because the OAuth callback is a top-level redirect rather than a CORS XHR, but it's an inconsistency between the documented provider set and the shipped origin default.

### C-03 — Root `deploy.config.ts` routing type omits `defaultRouterPort` (LOW)

- **File/line:** `deploy.config.ts:67-79` (the `routing?` interface), vs `.env_template:59`.
- **Value:** `.env_template:59` states: *"Port the router process listens on. Defaults to deploy.config.ts -> routing.defaultRouterPort (4000)."*
- **Why it's wrong/misleading:** The root project's own `DeployConfig.routing` interface declares only `onMissingService`, `missingServiceErrorCode`, `enableUnhealthyFallback`, `strictBootHandshake` — **no `defaultRouterPort`**. Yet the framework registry type (`packages/core/src/deployConfigRegistry.ts:44`), the scaffold template (`packages/create-luckystack-app/template/deploy.config.ts:47`), and the CLI asset (`packages/cli/assets/router/deploy.config.ts:47`) all declare it, and `packages/router/src/startRouter.ts:78` reads `deployConfig.routing?.defaultRouterPort ?? 4000`.
- **Evidence:** grep for `defaultRouterPort` → present in registry/template/cli/router, absent from root `deploy.config.ts`.
- **Impact:** A dev following the `.env` comment who tries to set `routing.defaultRouterPort` in the ROOT `deploy.config.ts` hits a TS error (the local interface doesn't allow it); the documented "4000" only ever comes from `startRouter`'s `?? 4000` fallback. Type drift between the root config and the framework/template.

### C-04 — Module-load-time env reads run BEFORE secret-manager resolution (LOW-MEDIUM, self-documented)

- **File/line:** `config.ts:248` (`EMAIL_FROM`), `config.ts:341-345` + `:369` (`collectAllowedOrigins()` reading `DNS`/`EXTERNAL_ORIGINS`), executed at import time; `config.ts:63` (`DNS`).
- **Why it's wrong:** `server/server.ts` imports `../config` at line 17, but `resolveSecretsIfConfigured(...)` (which overwrites `process.env` with secret-manager values) only runs at `server.ts:52`. So `EMAIL_FROM`, `DNS`, and `EXTERNAL_ORIGINS` are captured into `config`/`registerProjectConfig({ http.cors.allowedOrigins })` **before** any secret-manager pointer can be resolved. If any of those three are pointer-shaped (`NAME=BASE_V<n>`), the resolved value never reaches the config.
- **Evidence:** import order in `server.ts` (`import '../config'` @17 vs `await resolveSecretsIfConfigured` @52); the code itself carries a `DEV-WARN` acknowledging exactly this for `EMAIL_FROM`/`DNS`/`EXTERNAL_ORIGINS` (`config.ts:242-247`) but the fix (a factory called post-resolve) is not implemented.
- **Impact:** Latent; only bites projects that route CORS origins / email-from through secret-manager pointers. Documented but unmitigated.

### C-05 — Server registers `sentry.client` into a slot that ignores it + warns (LOW)

- **File/line:** `config.ts:261-282` (full `sentry` object incl. `client.*`), `server/server.ts:59` (`registerSentryConfig(sentryConfigInput)` with the whole object).
- **Why it's wrong:** `packages/error-tracking/src/sentryConfig.ts:62-64` explicitly makes `registerSentryConfig({ client })` a **no-op on the server** and emits a boot warning that the `client.*` slots (`tracesSampleRate`, `replaysSessionSampleRate`, `replaysOnErrorSampleRate`) are browser-only and not read by `initializeSentry()`. The client rates ARE consumed — but directly, client-side, via `src/_functions/sentry.ts:45-55` importing `sentry` from `config`, not through the registry.
- **Evidence:** `sentryConfig.ts` warn branch; client consumer at `src/_functions/sentry.ts`.
- **Impact:** Cosmetic — a warning line on every server boot and a redundant registration. Not dangerous. Passing only `{ server }` server-side would silence it.

### C-06 — Duplicate keys across `.env_template` and `.env.local_template` (LOW / hygiene)

- **Files:** `.env_template` vs `.env.local_template`.
- **Duplicated keys:** `DATABASE_URL` (`_template:135` / `.local_template:55`), `EMAIL_FROM` (empty `_template:156` vs `onboarding@resend.dev` `.local_template:64`), `RESEND_API_KEY`, `SMTP_HOST/PORT/SECURE/USER/PASS`, `SENTRY_DSN/SENTRY_ENABLED/VITE_SENTRY_DSN/VITE_SENTRY_ENABLED`, `MICROSOFT_TENANT_ID` (`common` in both), and every OAuth `*_CLIENT_ID`/`*_CLIENT_SECRET` / `DEV_*` pair.
- **Why it's noteworthy:** Layered dotenv (`.env` → `.env.local`, later wins — `packages/core/src/env.ts:65-75`) makes this *function*, and the OAuth-id duplication is a deliberate `ID_IN_ENV_LOCAL` placeholder pattern. BUT pure non-secret config knobs (`SMTP_PORT=587`, `SMTP_SECURE=false`, `MICROSOFT_TENANT_ID=common`) are duplicated into the secrets template with identical values, contradicting `.env.local_template`'s own stated rule ("Only keys that carry a real secret value live here; pure config knobs stay in .env", `.local_template:5`) and the project's "one env key per file" preference. This is exactly the footgun `LUCKYSTACK_ENV_DEBUG=1` warns about (`env.ts:44-63`).
- **Impact:** Confusion / silent-override footgun; every duplicated key triggers the boot duplicate-key warning when the debug flag is on. Consider keeping non-secret knobs only in `.env_template`.

### C-07 — Informational: dev-oriented defaults (INFO, documented / not a bug)

- `SECURE=false` (`.env_template:21`) → http; `config.ports.ts:15` `backend: 80`; `NODE_ENV=development` default (`env.ts:7`). All documented dev defaults; `http.cors.allowLocalhost` is dev-gated (`config.ts:373`), rate limits are real (`defaultApiLimit:60`, `defaultIpLimit:100`, `config.ts:223-225`), and `secretManager.dev.watch:false` is correct given the supervisor restarts on `.env` change. Backend port `80` requires privileges on Linux but is the intended single-instance default; multi-instance uses the `deploy.config.ts` bindings (`:4100-4102`). No action needed — listed for completeness.

---

## Cross-checks that came back CLEAN (verified consumed / consistent)

- **`config.ts` exported knobs** all consumed: `mobileConsole` → `src/main.tsx`; `pageTitle`/`dev` → `src/_providers/SessionProvider.tsx`; `defaultTheme` → `src/_components/TemplateProvider.tsx`; `logging.stream`/`devNotifications`/`socketStartup` → `packages/api|sync/src/_shared/logFlags.ts`, `packages/server/src/{createServer,loadSocket}.ts`; `rateLimiting.redisKeyPrefix` → `packages/core/src/rateLimiter.ts:75`; `secretManager.dev` → `server/bootstrap/initSecrets.ts`; `sentry.server` → `initializeSentry` / `src/_functions/sentry.ts`.
- **`deploy.config.ts`**: `missingServiceErrorCode`, `enableUnhealthyFallback`, `enableFallbackRouting`, `healthPollMs`, `strictBootHandshake`, `synchronizedEnvKeys`, `urlEnvKey` all consumed by `packages/router/src/*` and `packages/core/src/synchronizedEnvHashes.ts`. (Only `switchNewTrafficToLocalWhenHealthy` is dead — see C-01.)
- **Core env vars** (`NODE_ENV`, `SERVER_IP`, `SERVER_PORT`, `SECURE`, `PROJECT_NAME`, `REDIS_HOST/PORT/USER/PASSWORD`, `DNS`, `EXTERNAL_ORIGINS`, `LUCKYSTACK_ENV`, `LUCKYSTACK_ENV_FILES`, `LUCKYSTACK_ENV_DEBUG`) all read via `packages/core/src/{env,redis,checkOrigin,bindAddress}.ts`. `SERVER_PORT` is fed from positional argv by `@luckystack/server/parseArgv` (`server.ts:6`) into `process.env` before `config.ts` reads it — consistent with the template note.
- **`package.json` scripts**: every referenced file exists — all 12 `ai:*` scripts map to real `scripts/generate*.mjs` / `lintInvariants.mjs` / `checkDocStaleness.mjs` / `scoreEval.mjs`; `test`→`scripts/testAll.ts`, `server`→`server/dev/supervisor.ts`, `server:direct`/`prod`→`server/server.ts`/`dist/server.js`, `router`→`scripts/router.ts`, `cluster`→`scripts/cluster.ts`, `prisma:*`→`scripts/prismaWithSecrets.ts`, `generateArtifacts`→`scripts/generateTypeMaps.ts`+`generateServerRequests.ts`, `bundleServer`/`buildPackages`/`bumpVersion`/`publishPackages`/`checkBunCompat`/`help`/`scaffold*` all present in `scripts/`. No broken script paths found.
- **`luckystack.ai.json` / `luckystack.invariants.json`**: valid; `invariants` rules (`no-as-any`, `no-arbitrary-color`, `i18n-jsx`, `doc-coverage`) all report-only (`block: []`) — matches CLAUDE.md's report-only-by-default contract; not a defect.
