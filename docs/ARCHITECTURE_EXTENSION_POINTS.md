# Architecture — Extension Points Reference

> Every registry, adapter slot, and hook a consumer can use to customise
> LuckyStack without forking. Grouped by package. Code samples assume the
> overlay layout in `luckystack/<package>/index.ts`.

The framework's design rule is **per-package config + composable adapter
slots over a central ProjectConfig bag**. Each `@luckystack/*` package
owns its own registry surface and re-exports it for one-import-path use.

---

## `@luckystack/core`

| Symbol | Purpose |
|---|---|
| `registerProjectConfig({...})` | Top-level app config (logging, rate-limit, session, auth, socket, sync, offline queue, paths, http, cors). |
| `registerLogger(logger)` | DI slot for any `Logger`-shaped object (pino, winston, console). |
| `registerNotifier(notifier)` | DI slot for client-side toast UI. |
| `registerPrismaClient(client)` | Swap the Prisma client (multi-tenant, test mocks). |
| `registerRedisClient(client)` | Swap the Redis client. |
| `registerAvatarConfig({...})` | Tune avatar uploads dir + max size. |
| `registerLocaleReloader(cb)` | i18n hot-reload tap. |
| `registerEmailSender(sender)` | Legacy single-adapter slot. |
| `registerEmailSenders({ default, transactional, marketing, ... })` | Multi-adapter — framework routes by convention. |
| `registerRateLimitStrategy(strategy)` | Plug a custom rate-limit backend (token-bucket / sliding-window / edge-KV). Default = in-memory + Redis. |
| `registerRedactedLogKeys([...])` | Extend the masked-keys set for logged payloads. |
| `registerHook(name, handler)` | Subscribe to lifecycle hooks (see below). |
| `registerSocketMiddleware(mw)` | New. Wedge an `io.use(...)` middleware into the framework socket bootstrap (license-key gates, observability tags, custom auth). Runs before any `connect` handler. |
| `registerCsrfConfig({...})` | New. Override CSRF cookie name, header name, token length, or cookie options for integration with legacy gateways / FIPS-grade tokens. |

### Hooks fired from core / api / sync

| Hook | When | Stop-signal capable |
|---|---|---|
| `preApiValidate` | Before Zod input check. | yes |
| `postApiValidate` | After validation, before execute. | no |
| `preApiExecute` | Before handler runs. | yes |
| `postApiExecute` | After handler completes. | no |
| `preApiRespond` | Before sending response — **mutable**. | yes |
| `transformApiResponse` | New. After preApiRespond, before emit — **mutable**. | no |
| `postApiRespond` | After emit (observation-only). | no |
| `preSyncAuthorize` | New. After auth check, before rate-limit. Use for room-membership rules. | yes |
| `preSyncFanout` | Before fanout to recipients. | yes |
| `postSyncFanout` | After fanout completes. | no |
| `preSyncStream` | Per chunk before emit (fire-and-forget). | no |
| `postSyncStream` | Per chunk after emit (fire-and-forget). | no |
| `apiError` / `syncError` | Caught errors. | no |
| `rateLimitExceeded` | A request hit a rate cap. | no |
| `corsRejected` | An origin was denied. | no |
| `csrfMismatch` | CSRF token check failed. | no |
| `preSessionRefresh` / `postSessionRefresh` | Sliding-TTL refresh on session reads. | yes / no |
| `onUploadStart` / `onUploadComplete` | Upload lifecycle. | no |
| `preHttpRequest` | New. Before route dispatch on raw HTTP. | yes |

---

## `@luckystack/login`

| Symbol | Purpose |
|---|---|
| `registerOAuthProviders([...])` | Provider list (Google, GitHub, Discord, Facebook, Microsoft, + custom). |
| `registerUserAdapter(adapter)` | Swap the Prisma `User` model behind auth. |
| `registerPostLoginRedirect(resolver)` | Dynamic post-login redirect URL. |
| `registerSessionAdapter(adapter)` | New. Storage backend for sessions (default Redis; supports DynamoDB / Postgres / signed-JWT). |
| `validatePassword(plaintext)` | New. Validates against the active `passwordPolicy`. |
| `PasswordPolicyError` | New. Thrown by `updatePasswordHash` on policy violation. |

### Hooks

`preLogin`, `postLogin`, `preRegister`, `postRegister`, `preLogout`,
`postLogout`, `preSessionCreate`, `postSessionCreate`, `preSessionDelete`,
`postSessionDelete`, `passwordResetRequested`, `passwordResetCompleted`,
`passwordChanged`.

### OAuth provider extensions

```typescript
googleProvider({
  clientId, clientSecret, callbackUrl,
  extraScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  extraSessionFields: async ({ accessToken }) => ({
    googleCalendarToken: accessToken,
  }),
});
```

For strict typing, augment the session shape:

```typescript
declare module '@luckystack/core' {
  interface BaseSessionLayout {
    googleCalendarToken?: string;
  }
}
```

### Session config

```typescript
projectConfig.session = {
  perBrowser: 'single' | 'multiple',
  perUser: 'single' | 'multiple',
  maxConcurrentPerUser: number | null,
  onConflict: 'revokeOld' | 'rejectNew',
  notifyOldDeviceOnRevoke: boolean,
  expiryDays: 7,
};
```

`allowMultiple: true` is honored as a deprecated alias for `perUser: 'multiple'`.

---

## `@luckystack/email`

| Symbol | Purpose |
|---|---|
| `registerEmailSender(sender)` | Single global adapter (legacy). |
| `registerEmailSenders({ default, transactional, marketing, ... })` | Multi-adapter — convention-routed. |
| `registerEmailTemplate(name, { subject, render })` | Named templates (`password-reset`, `welcome`, ...). |
| `sendEmail({ template, data, to, adapterHint })` | Send via a registered template + slot. |
| `sendEmail({ to, subject, html, ... })` | Raw mode (legacy). |
| `ResendSender`, `SmtpSender`, `ConsoleSender` | Built-in adapters. |
| `autoSelectEmailSender({...})` | Heuristic picker from env vars. |

Pre/post hooks: `preEmailSend` (stop-signal capable, can abort send),
`postEmailSend` (audit/DLQ).

---

## `@luckystack/sync`

| Symbol | Purpose |
|---|---|
| `createStreamThrottle({...})` | Coalesce stream chunks. |
| `syncRequest({ ..., offlineDropPolicy })` | New. Per-request override of the queue drop policy. |

Hooks: `preSyncAuthorize` (new — room-auth, see core), `preSyncFanout`,
`postSyncFanout`, `preSyncStream`, `postSyncStream`.

---

## `@luckystack/api`

| Symbol | Purpose |
|---|---|
| Per-route metadata | `rateLimit`, `auth`, `httpMethod`, `validation` exports per `_api/*.ts`. |
| Per-route `validation` | New. `'strict'` (default) / `'relaxed'` / `{ input: 'skip' }` for public webhooks. |

Hooks: `preApiValidate`, `postApiValidate`, `preApiExecute`,
`postApiExecute`, `preApiRespond`, `transformApiResponse` (new — mutate
response before emit), `postApiRespond`.

CORS now supports a function resolver: `projectConfig.http.cors.allowedOrigins`
accepts `string[] | (origin) => boolean`.

---

## `@luckystack/server`

| Symbol | Purpose |
|---|---|
| `bootstrapLuckyStack(...)` | Recommended entry point. |
| `createLuckyStackServer(...)` | Lower-level server factory. |
| `verifyBootstrap(...)` | Pre-flight registry check. |
| `registerCustomRoute(handler)` | Pre-fallback HTTP route registration. |
| `registerSecurityHeaders((req) => Record<string, string>)` | New. Customize CSP, HSTS, Permissions-Policy. |
| `registerErrorFormatter(formatter)` | New. Global error-response shape override. Per-route override via `export const errorFormatter` (handler-side dispatch wiring is a pending follow-up). |

Hooks: `onSocketConnect`, `onSocketDisconnect`, `preRoomJoin`,
`postRoomJoin`, `preRoomLeave`, `postRoomLeave`, `onLocationUpdate`,
`preHttpRequest` (new — stop-signal capable).

---

## `@luckystack/presence`

| Symbol | Purpose |
|---|---|
| `registerPresenceConfig({ disconnectTimers, afkTimeoutMs, ignoreReasons, allowReasons })` | Tune grace periods + AFK threshold. |
| `registerActivityEvent(name, { trigger, onTrigger, refractoryMs })` | New. Custom activity events (location change, typing, custom AFK semantics). Default `'afk'` event auto-registers. |
| `unregisterActivityEvent(name)` | New. Drop a default event before registering an alternative. |
| `socketLeaveRoom(...)` | Programmatic room leave. |

Hooks: `prePresenceUpdate`, `postPresenceUpdate`, `postSocketReconnect`
(new — fires only on reconnect within the grace window).

---

## `@luckystack/router`

| Symbol | Purpose |
|---|---|
| `startRouter({...})` | Programmatic entry. |
| `registerServiceResolver(resolver)` | New. Host-based / header-based / custom service-key resolution. Return null falls through to first-path-segment default. |

Hooks: `preProxyRequest` (new), `postProxyResponse` (new — includes
latency + status code).

Circuit-breaker SKIPPED for v1.

---

## `@luckystack/error-tracking`

| Symbol | Purpose |
|---|---|
| `ErrorTracker` interface | Adapter contract: captureException, captureMessage, setUser, startSpan, recordMetric, beforeSend. |
| `registerErrorTracker(tracker)` | Single adapter. |
| `registerErrorTrackers([...])` | Multi-adapter fan-out. |
| `captureExceptionAcrossTrackers(...)` | Framework-internal helper. |

Built-in Sentry / Datadog / PostHog adapter implementations are
**pending** — only the adapter interface ships in this release.

---

## `@luckystack/devkit`

| Symbol | Purpose |
|---|---|
| `registerRoutingRules({...})` | Customise `_api`/`_sync` marker segments. |
| `extractValidation(filePath)` | New. AST-reads `export const validation = 'relaxed'` from API source files. |

The emitter's wiring to ship `validation` into the generated apiEntry
output is a small follow-up.

---

## `@luckystack/test-runner`

| Symbol | Purpose |
|---|---|
| `registerTestLayer({ name, run })` | New. Custom test layers (CORS, business rules, GDPR). |
| `registerTestFixture(typeKey, { valid, invalid })` | New. Realistic payloads for the fuzz layer. |
| `registerTestReporter({ onResult, onSummary, webhookUrl })` | New. Per-result + summary + optional webhook POST. |

---

## `@luckystack/docs-ui`

| Symbol | Purpose |
|---|---|
| `mountDocsUi({ routePath, pageTitle, branding, template, enableTryItOut, enabledInProd })` | Mount the docs page. |
| `branding: { logoUrl, brandColor, fontFamily }` | New. Visual customisation. |
| `template: (input) => string` | New. Custom HTML template override. |
| `enableTryItOut: true` | New. Inline live request runner. |

JSDoc extension fields rendered when present in `apiDocs.generated.json`:
`@docs owner`, `@docs tags`, `@docs deprecated`. Devkit-side JSDoc parser
is pending follow-up.

---

## `@luckystack/create-luckystack-app`

| Flag | Purpose |
|---|---|
| `--no-install` | Skip `npm install` + `npx prisma generate`. |
| `--no-prompt` | New. Skip interactive prompts; use defaults (Mongo + credentials + console email). |

Interactive prompts cover: dbProvider, authMode, oauthProviders,
emailProvider, monitoringProvider, i18n. Choices flow into the template
as `{{DB_PROVIDER}}`, `{{AUTH_MODE}}`, `{{OAUTH_PROVIDERS}}`,
`{{EMAIL_PROVIDER}}`, `{{MONITORING_PROVIDER}}`, `{{I18N_ENABLED}}`.

Post-scaffold runs `npm install` + `npx prisma generate`. We do NOT run
`prisma db push` / `migrate dev` — DATABASE_URL isn't populated yet.

---

## `@luckystack/env-resolver` (new)

| Symbol | Purpose |
|---|---|
| `initEnvResolver({ source: 'remote'|'local'|'hybrid', remote, fallback })` | Boot-time call that fetches env from a central server. |
| `refreshEnvResolver(...)` | Hot reload — re-fetches, bypassing cache. |
| `getCachedResolution()` | Inspect the in-memory cache. |

Required local keys when using remote: `LUCKYSTACK_ENV_URL`,
`LUCKYSTACK_ENV_TOKEN`, `LUCKYSTACK_ENV_PROJECT`,
`LUCKYSTACK_ENV_ENVIRONMENT`. Remote values only fill `undefined`
process.env keys — explicit local overrides always win.

Server-side of the remote env system is out of scope (separate SaaS).

---

## Prisma Client extensions

LuckyStack does NOT provide a `prePrismaQuery` / `postPrismaQuery` hook. Instead, Prisma's own `$extends` API in `luckystack/core/clients.ts` is the canonical path for query interception, result transformation, soft-delete logic, multi-tenant routing, audit logging, and so on. A single extended client is registered via `registerPrismaClient(...)` so every framework-internal query AND every project query goes through the same chain.

### Pattern

```typescript
// luckystack/core/clients.ts (consumer-side override)
import { PrismaClient } from '@prisma/client';
import { registerPrismaClient } from '@luckystack/core';

const basePrisma = new PrismaClient({
  log: ['warn', 'error'],
});

export const prisma = basePrisma.$extends({
  name: 'audit-log',
  query: {
    $allModels: {
      async create({ model, args, query }) {
        const start = Date.now();
        const result = await query(args);
        console.log(`[audit] ${model}.create — ${Date.now() - start}ms`);
        return result;
      },
    },
  },
  result: {
    user: {
      displayName: {
        needs: { firstName: true, lastName: true },
        compute(user) {
          return `${user.firstName} ${user.lastName}`;
        },
      },
    },
  },
});

registerPrismaClient(prisma);
```

### Multi-tenant routing example

```typescript
export const prisma = basePrisma.$extends({
  name: 'tenant-scoped',
  query: {
    $allModels: {
      async findMany({ args, query }) {
        const tenantId = getTenantFromContext();
        return query({
          ...args,
          where: { ...args.where, tenantId },
        });
      },
    },
  },
});
```

### Soft-delete example

```typescript
export const prisma = basePrisma.$extends({
  name: 'soft-delete',
  query: {
    $allModels: {
      async findMany({ args, query }) {
        return query({ ...args, where: { ...args.where, deletedAt: null } });
      },
      async delete({ model, args }) {
        return (basePrisma as PrismaClient)[model as Uncapitalize<Prisma.ModelName>].update({
          where: args.where,
          data: { deletedAt: new Date() },
        });
      },
    },
  },
});
```

### What this affects

- Every framework-internal Prisma call (`@luckystack/login`'s session lookups, presence writes, etc.) AND your own handler queries go through the extended client — single source of truth.
- Type-safe: `$extends` produces a new client type with the new methods + result transformations. No casts needed at call sites.
- Composable: chain multiple `.$extends({...})` calls for audit-log + tenant-scope + soft-delete in one client.

### What it does NOT do

- Cannot intercept the underlying database connection (use Prisma's `datasources` config for that).
- Extensions are per-PrismaClient instance — instantiating multiple clients defeats the pattern. Always register the single extended client via `registerPrismaClient(...)` and import the same instance from `clients.ts` everywhere you need it.
- `$extends` runs in the application process; for cross-process invariants (replica routing, connection-pool tuning) reach for Prisma Accelerate or Pulse instead.
