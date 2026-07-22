# Two-week change + codebase correctness/security review — 2026-07-21

Last updated: 2026-07-21

## Scope and method

- Commit window: **2026-07-07 through 2026-07-21**, 105 commits, from the tree after `ed156cbe94815123f129d056aa98c3664e1e90c1` through `52b63af`.
- Diff reviewed: **382 files**, **26,871 insertions**, **2,131 deletions**.
- General pass: auth/2FA/email OTP, sessions, cron, CLI/scaffold/ORM switching, secret manager/Redis, OAuth redirects, server lifecycle/readiness, router HTTP/WS proxying, error tracking, email, CI/release dependencies, Date/wire projection, Bun/runtime gates, and all three ORM surfaces.
- Existing findings ledgers, especially `2026-07-02-security`, were checked before classifying candidates. Closed findings are not reopened or duplicated here.
- Static matches were treated as candidates only. Rows below survived control-flow inspection, contract/doc comparison, blame/history checks, or a reproducible gate failure.
- The initial review changed no runtime code. A follow-up remediation wave fixed every finding that did not require dependency installation or a new trust/cancellation/key-rotation policy. The pre-existing `.claude/settings.local.json` worktree change remained excluded and untouched.

## Status ledger

| ID | Finding | Severity | Status | Found | Resolved | Evidence / impact |
|---|---|---:|---|---|---|---|
| TW-01 | A combined `luckystack manage` pass can undo its own ORM switch through stale in-memory `project.pkg` state. | **HIGH** | **fixed** | 2026-07-21 | 2026-07-21 | `switchOrm()` now synchronizes the shared package snapshot after writing; a combined ORM + feature-transition regression test preserves the new dependency/script state. |
| TW-02 | Cron's fire-and-forget Redis paths can reject outside their advertised error boundary, permanently wedge state, or become unhandled rejections. | **HIGH** | **fixed** | 2026-07-21 | 2026-07-21 | Background promises now terminate in observers, leadership/running state and timers reset in `finally`, and infrastructure failures are logged without wedging later ticks; rejection regressions pass. |
| TW-03 | Email OTP reissue and verification are not atomic, so a superseded code can authenticate and delete the newly issued code. | **HIGH** | **fixed** | 2026-07-21 | 2026-07-21 | Issue and verify are now complete Redis Lua transactions. Deterministic reissue/verify interleavings prove an old generation cannot authenticate, delete the replacement, or consume its attempt budget. |
| TW-04 | Automatic secret refresh overwrites a consumer-registered default Redis client with the framework's plain ioredis client. | **HIGH** | **fixed** | 2026-07-21 | 2026-07-21 | Redis registration now tracks framework-default ownership. Automatic rotation replaces/disconnects only that client; a consumer custom client retains precedence and lifecycle ownership. |
| TW-05 | The HTTP router does not handle errors emitted by the upstream response stream after headers arrive. | **HIGH** | **fixed** | 2026-07-21 | 2026-07-21 | Upstream response `error`/`aborted` events are observed before piping; pre-header failures return the standard 502 and post-header truncation destroys only that downstream response. |
| TW-06 | The provenance release gate was red on high dependency advisories. | **HIGH** | **fixed** | 2026-07-21 | 2026-07-21 | Lock refresh + constrained overrides moved brace-expansion, js-yaml, body-parser, fast-uri and hono to fixed releases. The exact publish gate (`--omit=dev --audit-level=high`) is green. Two moderate `@hono/node-server`/SDK nodes remain because SDK 1.29 only permits vulnerable 1.x; MCP is stdio-only and the compatible upstream fix is pending. |
| TW-07 | Windows scaffold re-rendering joins dynamic CLI arguments into an unquoted `cmd.exe` command. | **MEDIUM** | **fixed** | 2026-07-21 | 2026-07-21 | Manifest values are allowlisted, temp names use the scaffolder's canonical slug, and every Windows argument is rejected if it contains shell metacharacters before the single `cmd.exe` boundary. |
| TW-08 | `runOnStart` is ignored when a cron job is registered or replaced after leadership was already acquired. | **MEDIUM** | **fixed** | 2026-07-21 | 2026-07-21 | A `runOnStart` registration now sets its first fire to the current time, so the active leader's next scheduler tick runs it once; ordinary late jobs retain their normal computed schedule. |
| TW-09 | Secret-manager file reload cannot transition an env name from a remote pointer back to a plain value. | **MEDIUM** | **fixed** | 2026-07-21 | 2026-07-21 | Active pointers are composed from ambient ownership plus a replacing file-owned map; pointer→plain and pointer removal drop stale file pointers while unrelated shell pointers remain. |
| TW-10 | A documented relative OAuth `postLoginRedirect` resolves against the callback/backend origin, not the frontend fallback origin. | **MEDIUM** | **fixed** | 2026-07-21 | 2026-07-21 | Valid relative resolver results are normalized against the trusted absolute frontend fallback before returning; split-origin regressions now produce an absolute frontend URL. |
| TW-11 | Router `x-forwarded-proto` hardening still trusts any inbound literal `https` value without a trusted-proxy boundary. | **MEDIUM** | **fixed** | 2026-07-21 | 2026-07-21 | HTTP/WS now accept HTTPS only from an immediate peer matching explicit `routing.trustedProxyCidrs`; empty trusts nobody, malformed CIDRs fail boot, and mapped IPv4/IPv6 cases are covered. ADR 0033. |
| TW-12 | PostHog and Datadog message context can shadow canonical, scrubbed telemetry fields. | **MEDIUM** | **fixed** | 2026-07-21 | 2026-07-21 | Both adapters now spread context first and canonical scrubbed message/severity/request identity last; collision regressions cover all affected keys. |
| TW-13 | The full unit gate reproducibly times out the large TypeScript fixture hook under suite load. | **MEDIUM** | **fixed** | 2026-07-21 | 2026-07-21 | The known-heavy fixture setup has a targeted 30-second budget. A fresh full run passed all 1892 tests, including its 27 assertions. |
| TW-14 | `/readyz` stays green after dev-tool initialization fails even though every API and sync route is forced to 503. | **MEDIUM** | **fixed** | 2026-07-21 | 2026-07-21 | The readiness handler reads the shared dev-tool status and returns 503 with `checks.devTools: false` after a fatal initialization. |
| TW-15 | Email send timeout stops waiting but does not stop the provider send, enabling late success plus retry duplicates. | **MEDIUM** | **fixed** | 2026-07-21 | 2026-07-21 | Optional adapter context carries cooperative cancellation + stable idempotency. Timeout/late abort reports `deliveryOutcome: 'unknown'`; Resend forwards native idempotency and SMTP no longer claims cancellation certainty. ADR 0034. |
| TW-16 | TOTP enrollment confirmation is not serialized, so concurrent success responses can return recovery-code sets that are immediately invalid. | **MEDIUM** | **fixed** | 2026-07-21 | 2026-07-21 | Confirmation is serialized with a short per-user lease; a concurrent regression proves at most one recovery-code set succeeds and persists. The documented setup re-call behavior (replace the pending secret) remains unchanged. |
| TW-17 | TOTP ciphertext has no key identifier or legacy-key path, so rotating `TOTP_ENCRYPTION_KEY` makes every existing encrypted enrollment undecryptable. | **MEDIUM** | **fixed** | 2026-07-21 | 2026-07-21 | New `enc:v2` ciphertext carries a key id; a JSON decrypt-only legacy ring reads old v2/`gcm:` rows and successful proofs lazily migrate to the primary. Env templates and rotation runbook updated. ADR 0035. |

## Detailed evidence and fix direction

### TW-01 — stale package state after ORM switch

- **Files:** `packages/cli/src/transitions.ts:422-462`, `packages/cli/src/commands/reconfigure.ts:210-227`, `packages/cli/src/commands/switchOrm.ts:224-255`, `packages/cli/src/lib/project.ts:170-256`.
- **Execution path:** the wizard applies `planOrm` first. `switchOrm()` writes a separately parsed `pkg` to disk. A later change invokes helpers such as `addDependency()`/`removeDependency()`, which mutate and serialize the original `project.pkg` snapshot.
- **Resolution:** `switchOrm()` now replaces the shared `project.pkg` fields after its atomic package write. A same-pass ORM + auth transition regression asserts that the final dependencies, scripts and in-memory snapshot all retain the selected ORM.

### TW-02 — cron rejection boundaries are incomplete

- **Files:** `packages/cron/src/scheduler.ts:76-103`, `:140-181`, `:209`, `:224-230`.
- **Failure modes:**
  1. Redis rejection in leader acquire/renew/release skips every assignment after the `await`, including resetting `leaderTickInFlight`.
  2. `void leaderTick()` has no rejection handler.
  3. `runJob()` says “Never throws”, but lease acquisition, renewal, release, skip stats, run stats and post-hook calls are not all inside one guarded `try/finally`.
  4. A failed cleanup can leave `runtime.running = true` and its renewal interval alive.
- **Resolution:** leadership and run state now reset through `finally`; timer cleanup precedes fallible release/stats work; all background entry points have terminal rejection observers. Regressions cover rejected acquire/renew/release/stats paths and recovery on later ticks.

### TW-03 — e-mail code reissue/verify race

- **Files:** `packages/login/src/emailOtp.ts:51-55`, `:74-103`, callers in `emailCodeLogin.ts` and `twoFactor.ts:287-316`.
- **Interleaving:** verifier A reads `hash(old)`; reissuer B stores `hash(new)` and resets attempts; A increments the new slot's counter, compares the submitted old code with its previously read old hash, then deletes the current key (`hash(new)`). The delete count is 1, so A returns `valid` with the superseded code and B's newly mailed code is now expired. In-flight invalid verifies can similarly consume attempts from, or burn, a newly issued code.
- **Contract conflict:** `docs/decisions/0024-email-code-login-and-totp-2fa.md` promises one active code per slot and a “winner-take-all consume”. The current delete-count check correctly serializes two verifies of the same generation, but does not bind the consume to that generation's hash.
- **Resolution:** issue and verify now each execute as one Redis Lua transaction against the current generation. Controlled issue-vs-verify races prove the old code expires and cannot delete or spend attempts from its replacement.

### TW-04 — custom Redis client loses precedence on rotation

- **Files/docs:** `packages/core/src/secretsResolved.ts:32-60`, `packages/core/src/redis.ts:141-170`, `packages/core/docs/redis-adapter.md:7-27`, `docs/ARCHITECTURE_EXTENSION_POINTS.md:21`.
- **Resolution:** the registry tracks `framework-default` versus `consumer` ownership. Secret refresh rebuilds only the former; tests prove custom registrations are neither replaced nor disconnected, while framework defaults still rotate.

### TW-05 — upstream response errors escape the router

- **File:** `packages/router/src/httpProxy.ts:244-258`.
- **Resolution:** the response stream gets `error`/`aborted` listeners before `pipe()`. Pre-header failures use the normal sanitized 502; post-header truncation destroys the downstream leg. Tests cover both without an uncaught process error.

### TW-06 — new advisory set blocks publishing

- **Reproduction:** `npm audit --omit=dev --audit-level=low` on 2026-07-21: 7 vulnerabilities (1 low, 3 moderate, 3 high).
- **Paths:**
  - `eslint-plugin-jsx-a11y -> minimatch@3 -> brace-expansion@1.1.15` (high; tooling).
  - `eslint -> @eslint/eslintrc@3.3.5 -> js-yaml@4.2.0` (high; tooling/workspace peer accounting).
  - `@luckystack/mcp -> @modelcontextprotocol/sdk@1.29.0 -> ajv -> fast-uri@3.1.2` (high; MCP validation path).
  - The same SDK pulls `@hono/node-server@1.19.14` (moderate), `hono@4.12.25` (three moderate advisories in one package), and `express -> body-parser@2.2.2` (low). MCP currently uses stdio rather than those HTTP transports, limiting reachability but not the publication gate.
- **Available/tested releases:** `brace-expansion@1.1.16`, `@eslint/eslintrc@3.3.6` / `js-yaml@4.3.0`, `fast-uri@3.1.4`, `hono@4.12.31`, and `body-parser@2.3.0` are compatible. The fixed `@hono/node-server@2.0.11` is not: SDK 1.29 constrains that dependency to 1.x. npm's suggested all-fix path incorrectly requires a forced SDK downgrade to 1.24.3 despite 1.29.0 being current, so that downgrade was rejected.
- **Resolution:** with install permission, the lock and bounded overrides moved every high/low affected package to a fixed release. The publish gate is green without lowering its threshold. `@modelcontextprotocol/sdk@1.29.0` still constrains `@hono/node-server` to vulnerable 1.x; npm's only suggestion is a forced SDK downgrade to 1.24.3. The remaining two moderate nodes are accepted temporarily because LuckyStack's MCP entrypoint is stdio-only and never mounts Hono's HTTP static-file handler.

### TW-07 — dynamic Windows cmd arguments

- **Files:** `packages/cli/src/commands/update.ts:138-165`, `:371-385`, `:403-419`.
- **Resolution:** temp names are normalized with the scaffold's exact slug algorithm; manifest-derived choices are runtime-allowlisted; Windows arguments are reject-validated before command construction. Tests cover spaces, shell metacharacters and hostile manifest values.

### TW-08 — late `runOnStart` registration waits for the ordinary schedule

- **Files:** `packages/cron/src/registry.ts:21-51`, `packages/cron/src/scheduler.ts:65-73`, `:202-209`.
- **Resolution:** a `runOnStart` registration initializes its first fire to `Date.now()`; the existing scheduler tick sees it without another leadership transition. A regression registers a daily job after leadership and proves it runs on the next tick.

### TW-09 — pointer-to-plain reload is sticky

- **Files/docs:** `packages/secret-manager/src/index.ts:175-179`, `:927-947`; `docs/ARCHITECTURE_SECRET_MANAGER.md:115-119`.
- **Resolution:** ambient pointers and file-managed names are tracked separately and recomposed on each reload; file ownership leaves a tombstone so a removed pointer cannot be recaptured from its last resolved value. Tests cover pointer→plain, removal (including a pointer-shaped secret value) and preservation of unrelated shell pointers.

### TW-10 — relative OAuth redirect has the wrong base

- **Files/docs:** `packages/login/src/login.ts:741-748`, `:1140-1172`, `packages/login/src/redirectResolver.ts`; `packages/login/docs/redirect-validation.md`.
- **Resolution:** relative resolver output is validated as relative, then resolved against the trusted absolute fallback URL. Split frontend/backend origins and invalid fallback inputs are covered.

### TW-11 — forwarded proto has no trust boundary

- **Files:** `packages/router/src/proxyUtils.ts:160-173`, `packages/router/src/httpProxy.ts:228-243`, equivalent WS forwarding in `wsProxy.ts`.
- **Prior-review note:** the 2026-07-02 router review correctly observed that inbound forwarding headers are stripped, but did not follow the captured proto value that is reintroduced afterward.
- **Resolution:** default direct peers resolve to `http`; only immediate peers matching `routing.trustedProxyCidrs` may assert HTTPS. One compiled IPv4/IPv6 matcher is shared by HTTP and WS; docs include same-host and managed-ingress examples. ADR 0033.

### TW-12 — canonical telemetry fields are spread in the wrong order

- **Files:** `packages/error-tracking/src/adapters/posthog.ts:147-159`, `packages/error-tracking/src/adapters/datadog.ts:165-180`.
- **Resolution:** both built-in adapters spread context first and canonical scrubbed fields last. Regressions cover message/severity/user collisions with secret-bearing inputs.

### TW-13 — full-suite-only Vitest timeout

- **Reproduction:**
  - Full suite run 1: hook timed out after 14.169 s; 1840 passed, 27 skipped.
  - Targeted file: 27/27 passed; total 9.90 s, tests 7.53 s.
  - Full suite run 2: hook timed out after 12.623 s; 1840 passed, 27 skipped.
- **File/history:** `packages/devkit/src/typeMap/tsProgram.test.ts:195-198`, introduced in `54d89957` on 2026-07-15.
- **Resolution:** the fixture's `beforeAll` receives a local 30-second budget rather than weakening the suite globally. A fresh full-suite run passed all 1892 tests.

### TW-14 — readiness ignores the dev-tool fatal state

- **Files:** `packages/server/src/createServer.ts:99-119`, `packages/server/src/devToolsStatus.ts`, `packages/server/src/httpRoutes/apiRoute.ts:84-92`, `syncRoute.ts:119-127`, `healthRoutes.ts:77-106`.
- **Resolution:** `/readyz` reads the same shared `DevToolsStatus` as API/sync dispatch. It exposes only `checks.devTools` and returns 503 on a recorded failure; `/livez` remains process-only.

### TW-15 — timeout is not cancellation

- **Files/docs:** `packages/email/src/sendEmail.ts:344-363`, `packages/core/src/emailRegistry.ts:89-93`, `packages/email/CLAUDE.md:76`.
- **Resolution:** optional `EmailSendContext` preserves old adapters while exposing an abort signal and stable caller key. Resend forwards native idempotency; built-ins skip pre-aborted work; timeout/abort after dispatch is explicitly unknown and appears on the post-send hook. ADR 0034.

### TW-16 — concurrent confirmation returns stale recovery codes

- **File:** `packages/login/src/twoFactor.ts:397-466`.
- **Resolution:** confirmation uses the core lease primitive with a per-user lock key and re-reads pending state inside the lease. A concurrent test asserts one success and one persisted recovery-code set. Setup re-calls remain intentionally last-write-wins as documented.

### TW-17 — no TOTP encryption-key rotation path

- **Files/docs:** `packages/login/src/twoFactor.ts:38-87`, `docs/ARCHITECTURE_AUTH.md:198-206`.
- **Resolution:** v2 stores a domain-separated key fingerprint, decrypts through the primary plus JSON legacy ring, retains plaintext/legacy `gcm:` compatibility, and best-effort rewrites only after valid TOTP proof. Missing IDs and malformed rings fail closed with actionable logs. ADR 0035.

## Explicitly reviewed but not findings

- **Config-gated relaxations:** `rateLimiting.auth.enabled`, localhost CORS, cookie-mode bearer acceptance, docs UI in production, origin exemptions, loopback test behavior, and 2FA email fallback are explicit opt-ins/defaults with visible tradeoffs; their existence alone is not a defect.
- **Router public bind:** already tracked and mitigated as `R9`; not duplicated.
- **Bun-hosted Vitest:** the known `z.object` loader failure remains the terminal `OR-05`/upstream limitation; Node-hosted Vitest plus direct Bun gates is the accepted evidence model.
- **Router on Bun:** remains intentionally Node-only until Bun's upgrade-socket primitive works; Bun application backends remain supported.
- **Shutdown deadline:** `stopServer` uses one documented total deadline rather than a full timeout per step. Later steps receiving the remaining budget is intentional, not a new finding.
- **Session projection:** stored/broadcast session values remain token-stripped, 2FA secrets are removed, and cookie-mode bearer handling is config-gated; no new credential-exposure finding survived review.
- **Date/wire types and ORM runtime support:** the v0.7.0 fixes and deep Prisma/Drizzle/MikroORM × Node/Bun evidence remain coherent; no additional wire-projection or ORM runtime defect was substantiated in this pass.

## Verification snapshot

| Check | Result (2026-07-21) |
|---|---|
| Original targeted remediation regression set | **PASS** — 198/198 across 13 files |
| Follow-up TW-06/11/15/17 + test-runner regression set | **PASS** — 148/148 across 12 files |
| `npm run test:unit` (full, final) | **PASS** — 1907/1907 across 176 files |
| `npm audit --omit=dev --audit-level=high` (exact publish threshold) | **PASS** — no high advisories |
| `npm audit --omit=dev --audit-level=low` | **FAIL** — 2 moderate `@hono/node-server` advisories constrained by MCP SDK 1.29; stdio entrypoint does not mount the affected Hono handlers |
| MCP SDK stdio initialize smoke test | **PASS** — protocol `2025-03-26`, server `0.7.3` |
| Deep Prisma/Drizzle/MikroORM wire gate | **PASS** — Node and Bun |
| `npm run lint:packages` + `npm run lint` | **PASS** |
| `npm run build` | **PASS** — 17/17 packages plus artifacts, TypeScript, Vite client and server bundle |
| `npm run pack:dry` | **PASS** — 17/17 package tarballs |
| `npm run ai:lint` | **PASS** |
| `npm run ai:changelog-check` | **PASS** |
| `npm run ai:doc-staleness` | **PASS** |
| `npm run ai:index` | **PASS** |
| `git diff --check` | **PASS** |
| Runtime source changes made by remediation | **yes** — all 17 findings now have implemented resolutions |

The current branch's earlier v0.7.3-fix verification (1867/1867 at that time, lint/build, standalone scripts, 17 package builds and 17 dry packs) remains valuable historical evidence. The final remediation run supersedes its unit/build evidence with 1907/1907 and a fresh 17-package build. All 17 findings are closed and the unchanged high-severity provenance audit gate is green; the two documented moderate SDK transitives remain an upstream-constrained, stdio-unreachable residual risk.
