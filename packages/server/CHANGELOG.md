# Changelog

All notable changes to `@luckystack/server` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `collectOverlayEntries(packageDir)` — the single owner of what a `luckystack/<pkg>/` folder contributes at boot, exported so `scripts/bundleServer.mjs` decides identically instead of reimplementing the walk (ADR 0047).

### Fixed

- Test files in a `luckystack/<pkg>/` overlay folder are no longer imported at boot or bundled into the production server. A test file that only performs side effects (registering a stub adapter, say) previously ran in production without failing loudly. Covers `.tests.` / `.test.` / `.spec.` plus `__tests__` / `__mocks__` folders.
- A subdirectory inside an overlay package folder is now reported instead of skipped in silence. The walk is flat by design, so overlay code parked one level down never ran and nothing pointed at it.

- Composed presets accept a repeated NESTED function namespace. Equivalence is now checked recursively, so a namespace object rebuilt per preset (any function module living in a subdirectory of a `serverFunctionDirs` root) no longer reads as a differing implementation and rejects the compose at boot. A genuinely differing leaf implementation still fails closed.

## [0.8.4] - 2026-08-17

### Changed

- Port resolution is now `options.port > positional argv registry override >
  options.defaultPort > 80`. The legacy `SERVER_PORT` environment fallback and
  argv-to-environment writeback are removed. Migrate by editing
  `config.ports.ts`, passing `port` / `defaultPort`, or supplying the second
  positional argv.
- `@luckystack/server/parseArgv` now registers its port through the browser-safe
  `@luckystack/core/config` registry, keeping consumer OAuth config and server
  listen resolution aligned without environment mutation.

### Fixed

- Declare `@luckystack/cron` as an optional peer so the auto-detected cron overlay is represented in the server package contract.
- Programmatic `options.port` can now rewrite an OAuth callback that still names
  `options.defaultPort`, while explicit local router/reverse-proxy ingress ports
  remain authoritative.

## [0.8.2] - 2026-07-27

### Fixed

- Processes can compose non-overlapping atomic presets whose generated maps repeat the same full function registry; equivalent function entries deduplicate while conflicting function implementations and duplicate API/sync ownership still fail closed.

## [0.8.1] - 2026-07-27

### Fixed

- Production route maps, dev-tool startup, cookie security, bootstrap checks and port auto-increment now follow `NODE_ENV`; named topology environments remain available for health and routing identity.

## [0.8.0] - 2026-07-27

### Added

- Routed GET API calls can carry a lossless typed payload through the reserved `__luckystack_data` query value while public key-per-query callers remain compatible.

## [0.7.6] - 2026-07-23

### Fixed

- A successfully listening server now refreshes its boot-UUID TTL every third
  of the configured lifetime and stops the heartbeat during shutdown. Healthy
  long-running servers therefore no longer become not-ready after one hour.

## [0.7.4] - 2026-07-22

### Fixed

- `/readyz` now includes the recorded dev-tool initialization state. When
  devkit boot failed and API/sync routes deliberately return 503, readiness is
  503 too instead of advertising a hollow-green instance.
- Port resolution is now explicitly validated and regression-tested as
  `options.port > argv > options.defaultPort > SERVER_PORT > 80`; invalid values
  fail before `listen`, `65535` never retries to `65536`, and `listen(0)` registers,
  advertises, and logs the OS-assigned port from `httpServer.address()`.
- Auto-increment, dev advertisement, and OAuth now use the same canonical
  `resolveEnvKey()` environment classification (`LUCKYSTACK_ENV` first).
- Dev port-file cleanup is PID-owned, so an exiting old backend cannot remove a
  newer backend's advertisement.

## [0.7.3] - 2026-07-20

### Fixed

- **Stale-port bug class after a dev auto-increment hop.** When the dev server
  auto-incremented off a busy port (`:80` → `:81`), the bind-address registry
  still held the INTENDED port, so `checkOrigin`'s same-origin CORS entry pointed
  at a port nothing listened on. `listenLuckyStackServer` now re-registers the
  ACTUALLY-bound port inside the listen callback, so every `getBindAddress()`
  reader (CORS foremost) sees reality.
- **OAuth now targets the actually-bound port after a hop.** The `/auth/api/<provider>`
  authorize route rewrites a `localhost` OAuth `redirect_uri` to the port the
  server bound (via core's `resolveDevCallbackUrl`), matching the token-exchange
  side in `@luckystack/login` — so the OAuth round-trip reaches the live dev
  server even after an auto-increment hop, instead of a frozen dead port.
- **Loud OAuth port-drift warning on a hop.** The framework auto-targets the bound
  port for OAuth, but a provider console still exact-matches its registered
  redirect URI — so the server now warns (naming both ports) to add the bound port
  to the provider's authorized redirect URIs, or pin the port with
  `SERVER_PORT_AUTO_INCREMENT=0`.

## [0.7.1] - 2026-07-18

### Fixed

- **A failed dev-tooling init no longer fails silently.** When `initializeAll()`
  throws at boot, `createLuckyStackServer` cleared `devApis`/`devSyncs` but kept
  serving — with only a `warn` — so every `/api` and `/sync` route died with no
  explanation (it once read as a per-route type-validation bug across restarts).
  The init failure is now logged at `error` level with the full cause + recovery
  step (hot reload is off, restart after fixing), and recorded so the API/sync
  HTTP routes answer with a `503` naming the real cause instead of a misleading
  `404` on an empty registry. New internal `devToolsStatus` module.
- **Dev port auto-increment now explains the zombie-process consequence.** When a
  restart hops off a busy port, the warning spells out that a previous/zombie dev
  server is still holding the old port and that any client pinned there (an old
  browser tab, the Vite proxy's cached target) keeps talking to the OLD process,
  not the restart.

## [0.7.0] - 2026-07-16

### Fixed

- **Under Bun, EVERY optional package was reported as absent.** `capabilities.ts`
  cached a detached `import.meta.resolve`. Node calls a detached reference happily;
  Bun throws `import.meta.resolve must be bound to an import.meta object`, and the
  detection catches that and returns `false`. So on Bun, `@luckystack/login`,
  `sync`, `presence`, `cron`, `docs-ui`, `error-tracking` and `devkit` were all
  silently disabled while the server booted and served a green `/_health`.

  Node-only deployments were never affected. Fixed by calling `resolve` as a member
  of the `import.meta` object rather than caching the method — `obj.method()` binds
  `this`, `const m = obj.method; m()` does not.

### Fixed

- **Redis secret-manager pointer boot** (ADR 0026): fixes the `WRONGPASS ... REDIS_PASSWORD_V<n>`
  boot failure with no consumer code — the `registerRedisClient(...)` workaround can be removed.
  The rebuild is triggered by `@luckystack/secret-manager` firing core's secrets-resolved channel
  at resolve time (see the `@luckystack/core` changelog). An intermediate 0.6.3/0.6.4 attempt did
  this from `createLuckyStackServer` gated on `config.secretManager.url`, but that gate is always
  falsy (the scaffold doesn't register `secretManager` into `projectConfig`) — that vestigial gate
  is now REMOVED; the channel is the single trigger.

## [0.6.0] - 2026-07-12

### Added

- **Email-code login + 2FA routes** (ADR 0024, `authSecondFactorRoutes.ts`):
  POST `/auth/api/email-code/request|verify`, `/auth/api/2fa` (completes a
  pending challenge through the session-cookie seam), `/auth/api/2fa/email-code`,
  and the authenticated enrollment routes `/auth/api/2fa/setup|enable|disable|
  recovery-codes` (fresh user re-read via the UserAdapter — the session copy is
  sanitized). Registered before the `/auth/api/*` catch-all; per-IP shields.
- `/auth/providers` now advertises `emailCodeLogin` so the login form can show
  the passwordless entry point.

### Changed

- `/auth/api/credentials` relays the 2FA challenge envelope
  (`requiresTwoFactor`, `challengeToken`, `twoFactorMethods` — no session
  transport) when the account has a second factor enrolled.
- CSRF middleware: the login-completing email-code/2FA routes joined the
  auth-bootstrap exemption set; the authed enrollment routes stay enforced.

## [0.5.0] - 2026-07-11

### Added

- `OVERLAY_ORDER` exported (consumed by the consumer's `bundleServer.mjs` at
  build time — kills the hardcoded-copy drift that silently dropped overlay
  slots from prod bundles). New `cron` overlay slot + `@luckystack/cron` in
  `OPTIONAL_PACKAGES` (boot auto-wiring).
- `/readyz` database check is pluggable (core `registerDbHealthCheck`):
  registered probe → built-in Prisma ping (when Prisma is present) →
  `'skipped'` for deliberately DB-less projects. Response gains the
  tri-state `checks.database`; `checks.prisma` kept for compatibility.

### Changed

- Overlay files that fail to import abort boot with an actionable error
  naming the file (was: raw ERR_MODULE_NOT_FOUND).
- Dev SIGINT/SIGTERM dispatches `preServerStop` (2s cap) before exiting so
  subscribers (e.g. the cron leader lease) release cleanly.
- `@prisma/client` peer dependency is now optional (ADR 0020).

## [0.1.5]

### Changed

- **OAuth post-login redirect no longer reads the `DNS` env var.** `authCallbackRoute`
  now redirects to `projectConfig.app.publicUrl` (the public origin where users
  browse) after a callback, instead of `process.env.DNS || app.publicUrl`. The
  callback is handled on the backend origin but must send the browser back to the
  public origin. Set `app.publicUrl` in your `config.ts` (the scaffold does this).

### Fixed

- **CSRF no longer blocks credentials login/register when a session cookie already
  exists.** `POST /auth/api/credentials` is the session bootstrap, so requiring a
  pre-existing session's CSRF token to authenticate is circular and broke
  legitimate same-site re-login/register (403 `auth.csrfMismatch`). That endpoint
  is now exempt from CSRF enforcement. This removes no real protection: the session
  cookie is `SameSite=Strict`, so a cross-site POST never carries it and the guard
  wouldn't have fired anyway. All other `/auth/api/*`, `/api/*`, and `/sync/*`
  state-changing routes remain protected.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
