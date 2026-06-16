# LuckyStack v2 — Capability Gaps & Proposed Framework Primitives

> **Audit:** WAVE 2 (run 4) codebase audit — feature-lens synthesis
> **Scope:** Capability gaps + proposed new framework packages/primitives, ranked by gap status and priority.
> **North-star:** Every item is scored by how much it advances the **100%-AI-driven-after-install** goal — i.e. whether a freshly-installed package gives the AI a *generated, typed, lookup-not-guess* contract instead of a hand-rolled, drift-prone footgun.

---

## TL;DR

LuckyStack ships 16 `@luckystack/*` packages with a strong generated-types-for-routes story. The feature gaps cluster into **two families**:

1. **Missing runtime primitives** an app inevitably hand-rolls — durable background work, file storage, inbound/outbound webhooks, audit, metrics, RBAC, migrations. These are the classic "Rule 12a — don't hand-roll a cross-cutting capability" traps.
2. **Missing AI-trust tooling** — the framework's own generated contracts (types, docs, indexes, coverage, config) have *silent-degradation* and *doc⇄code drift* holes, so the AI confidently builds on guarantees production never delivers (`runWithErrorTrackerIdentity` never bound, validator silent fail-open *now fixed*, `method` vs `httpMethod` doc drift, placeholder type extraction).

The single highest-leverage theme: **the AI cannot tell when a green build is actually a broken/insecure app**, because the only correctness check (`verifyBootstrap`) runs at server-boot, which the AI cannot trigger autonomously.

---

## How to read this report

- **status** — `gap` (nothing exists), `partial` (some pieces exist but incomplete/unwired), `shipped` (largely resolved since the scan; recorded so it is not re-opened).
- **wave1_status** — `new` (first surfaced this wave) vs `confirms-wave1` (corroborated from prior waves).
- **priority** — High / Medium / Low, weighted by AI-drivability leverage + security/compliance impact.
- Severity/confidence notes call out **refuted or disputed** adversarial-verification results explicitly.

---

## 1. Runtime capability gaps (new framework packages)

### Top items

| # | Package / Primitive | Status | Priority | wave1 | One-line gap |
|---|---|---|---|---|---|
| R1 | `@luckystack/jobs` | gap | **High** | confirms (6/6) | No durable async-work/queue/cron primitive — deferred work blocks the request or fires a crash-prone floating promise |
| R2 | `@luckystack/storage` | gap | **High** | confirms (6/6) | `processUpload` punts persistence to a callback; `serveAvatar` is disk-only — every app re-rolls S3/signed-URL/traversal-safe serving |
| R3 | `@luckystack/webhooks-in` | gap | **High** | confirms (6/6) | Inbound webhook HMAC + raw-body capture + replay-dedupe is copy-pasted, security-critical, easy to get wrong |
| R4 | `@luckystack/audit` | gap | **High** | confirms (6/6) | Hooks already emit audit-worthy events; nothing durably records who-did-what-when |
| R5 | `@luckystack/metrics` | gap | **High** | new | Error-tracking covers exceptions, not numeric observability (latency/rate/counters); no `/metrics` |
| R6 | `@luckystack/webhooks` (outbound) | gap | Medium | confirms (1/6) | No signed outbound delivery + retry/backoff/dead-letter/delivery-log |
| R7 | `@luckystack/rbac` | **partial** | Medium | confirms (1/6) | Two incompatible authZ mechanisms (`auth.additional[]` vs page `switch(path)`), no unified `can()` |
| R8 | `@luckystack/migrate` | gap | Medium | new | Prisma migrate is DDL-only; no idempotent ordered data-migration + seed runner |
| R9 | `@luckystack/email/testing` (`MemorySender`) | gap | Low | confirms (1/6) | No in-memory email test adapter — consumers spy on `console.log` |

---

### R1 — `@luckystack/jobs` — durable async work / queue / cron

- **status:** gap · **priority:** High · **wave1_status:** confirms-wave1 (6/6, most-corroborated gap)
- **Evidence:** Only low-level `lease.ts` (`acquireLease`/`renew`/`release`) exists; the renew loop is left to app code. `processUpload` encodes inline in-request. The floating-promise crash class is confirmed live (`presence` lifecycle unhandled-rejection findings).
- **Impact:** Every deferred task (welcome-email, nightly cleanup, off-request upload encoding, webhook retry, report generation) forces the consumer to block the handler, fire an unguarded floating promise, or hand-roll BullMQ. A correct delay-queue + worker + exponential backoff + dead-letter + leader-elected cron is hard to get right once and pointless to re-derive per app.
- **AI-driven value:** Reuses the existing file-based + generated-typemap pattern: `src/_jobs/<name>_v1.ts` exporting `main({data,functions})` + optional `retry`/`schedule`, called via a typed `enqueue({name,version,data})` with route/version literals (no casts — honors Rule 21). devkit emits a job typemap; the sweep can walk jobs; `preJobRun`/`postJobRun`/`jobFailed` hooks give documented seams.
- **Fix:** New optional package. Required peers: `ioredis@^5.10.0` (ZSET delay-queue + leader-election via `acquireLease`), `@luckystack/core` (hooks, function injection, `formatKey` for tenant prefixing). Dev peers: `@luckystack/devkit` (typemap), `@luckystack/test-runner` (sweep). Keep separate so apps that never defer work don't pull the worker loop.
- **Foundation for:** R3 (verified-then-deferred), R6 (delivery queue *is* a job), R4 (async audit flush), R8 (long backfills).

### R2 — `@luckystack/storage` — pluggable, traversal-safe file storage

- **status:** gap · **priority:** High · **wave1_status:** confirms-wave1 (6/6)
- **Evidence:** `processUpload` delegates all persistence to a consumer `encodeAndSave` callback; `serveAvatar` is hard-wired to local disk (avatar-only, missing a stream `error` listener). Concrete incidents this wave: `GET /server.js` source-disclosure and avatar path-traversal hardening prove "serve files safely" is solved exactly once.
- **Impact:** Every app re-rolls disk-vs-S3/GCS/R2 dispatch, signed-URLs, content-type + max-size validation, path-traversal safety, read-serving.
- **AI-driven value:** One documented surface — `registerStorage(adapter)` + `put/get/delete/signedUrl/serve`. Built-in `LocalDiskStorage` is safe-by-default (lifts the traversal guard, enforces `maxBytes` + `allowedContentTypes`), so an AI wiring an upload route can't ship a traversal/unbounded hole. Tenant key-prefixing reuses the existing formatter.
- **Fix:** Required: `@luckystack/core`. Lazy/optional peers (mirroring email's `resend`/`nodemailer` gating): `@aws-sdk/client-s3` for S3/R2. Base `LocalDiskStorage` needs no extra deps.

### R3 — `@luckystack/webhooks-in` — inbound webhook verification

- **status:** gap · **priority:** High · **wave1_status:** confirms-wave1 (6/6; r1/r5 rank High)
- **Evidence:** Framework ships only a ~90-line hand-rolled GitLab example; the consumer must read the **raw body before any cap/parse**, compute HMAC, constant-time compare, parse provider headers, enforce a timestamp/skew window, and dedupe replays. Getting the compare or raw-body capture wrong is a silent auth-bypass.
- **Impact:** Every Stripe/GitHub/Twilio integration re-copies a security-critical sequence that must run **before** `main()` and **before** the body cap.
- **AI-driven value:** Declarative `src/_webhooks/<provider>_v1.ts`: `verify = hmacVerifier({header, secretEnv, algo, skewMs})` with stripe/github/gitlab/svix presets + `main({event, raw, functions})`. Framework auto-registers the origin-exempt prefix (reusing the existing HTTP origin-exempt seam), captures raw body pre-cap, runs constant-time HMAC + timestamp window, idempotency-dedupes per event-id via Redis `SETNX`, returns 401 before `main`.
- **Fix:** Required: `@luckystack/core` (origin-exempt route reg, injection), `@luckystack/server` (raw-body seam), `ioredis@^5.10.0` (dedupe). Node `crypto` is built-in. Share the HMAC primitive with R6 so both sides use an identical signature shape.

### R4 — `@luckystack/audit` — durable who-did-what-when

- **status:** gap · **priority:** High · **wave1_status:** confirms-wave1 (6/6; High-by-weight, Medium-by-most-runs)
- **Evidence:** The hook bus already emits `sessionCreated/Revoked`, `apiAuthRejected`, `rateLimitExceeded`, `csrfMismatch`, `corsRejected`, `onUploadComplete`, `postApiExecute`; hook comments literally say "audit logs subscribe via registerHook." The confirmed OAuth-hijack/account-link event is exactly what it should capture. Nothing consumes these into a queryable trail.
- **Impact:** For the explicit multi-tenant SaaS target this is a compliance/incident-response gap.
- **AI-driven value:** Single `registerAuditSink(sink)` auto-subscribing the security hooks + `functions.audit.record(...)` for business events. Records `{actorId, action, target, ip, requestId, before?, after?, ts}` via the existing `sanitizeForLog` (PII redaction automatic). The AI gets a typed audit primitive instead of reconstructing it from scattered hook tables.
- **Fix:** Required: `@luckystack/core` (hooks, `sanitizeForLog`). Default Prisma `AuditEvent` sink uses `@prisma/client@^6.19.0`. Optional: R1 for async/batched flush; append-only file/SIEM sink (no extra dep). Append-only + hash-chained for tamper-evidence.

### R5 — `@luckystack/metrics` — numeric observability + `/metrics`

- **status:** gap · **priority:** High · **wave1_status:** new
- **Evidence:** Packages ship error-tracking (exceptions) and `/_health`, but **no** request rate/latency histograms, rate-limit-hit counters, auth-failure counters, sync fan-out size, queue depth, or Redis-store-error rate. The hook bus already emits exactly these events (`postApiExecute`, `rateLimitExceeded`, `csrfMismatch`, `corsRejected`).
- **Impact:** Every production consumer hand-rolls `prom-client` wiring. Not covered by error-tracking (exceptions ≠ metrics).
- **AI-driven value:** `registerMetricsSink(...)` + `functions.metrics.increment/observe(...)` auto-subscribing the security/lifecycle hooks; a generated capability index lists available metric names so the AI never invents one that doesn't exist.
- **Fix:** Lazy peer-gated `prom-client` (mirroring email gating) for the Prometheus exporter; optional `@opentelemetry/api`. Built on the hook bus + a `/metrics` route owned by `@luckystack/server` (loopback-or-token gated by default per the docs-ui prod-gate finding).

### R6 — `@luckystack/webhooks` (outbound delivery)

- **status:** gap · **priority:** Medium · **wave1_status:** confirms-wave1 (1/6, r6; high-leverage for the SaaS target)
- **Evidence:** `ARCHITECTURE_HTTP.md` covers inbound only; zero support for outbound (`order.created` → external systems with signed payloads, per-endpoint subscriptions, retries, delivery-log).
- **Impact:** Every API-product consumer re-implements signing/retry/backoff/replay and diverges from the inbound HMAC contract.
- **AI-driven value:** `registerWebhookEvent(...)` + `webhooks.emit(event, payload)` → enqueues a signed delivery per matching endpoint with `X-LuckyStack-Signature`, exponential backoff + jitter, dead-letter, per-endpoint delivery-log + manual replay — generated/typed, not re-derived in consumer code (a Rule 7b violation otherwise). Sharing the signature helper with R3 keeps inbound/outbound machine-consistent.
- **Fix:** Required: `@luckystack/core`, **`@luckystack/jobs`** (the retry/backoff/dead-letter queue *is* a job type — why R1 ranks High as a foundation), `@prisma/client@^6.19.0` (`WebhookEndpoint` + delivery-log).

### R7 — `@luckystack/rbac` — unified `can(user, permission)`

- **status:** **partial** · **priority:** Medium · **wave1_status:** confirms-wave1 (1/6, r6; flagged top security-error class)
- **Evidence:** RBAC exists in **two incompatible forms** — `auth.additional[]` predicate arrays on routes **and** hand-written `switch(path)` middleware in `page.tsx` — with no registry to answer "who may X." An AI adding an admin route must guess which mechanism a sibling used; authZ is the highest security-severity AI-error class (Rule 19).
- **Impact:** Inconsistent, un-surfaceable authorization; the most dangerous AI guess.
- **AI-driven value:** One `definePermissionSet` + `can(user, permission)` that both `auth.additional[]` and page middleware route through; a generated per-route "required permission" column in `AI_PROJECT_INDEX` so the AI reads, not infers, the authZ contract.
- **Fix:** Required: `@luckystack/core` (could fold into core as `registerPermissions` if fewer packages preferred). Composes with `@luckystack/login`. No new external deps.

### R8 — `@luckystack/migrate` — data-migration + seed runner

- **status:** gap · **priority:** Medium · **wave1_status:** new
- **Evidence:** Prisma migrate is schema-DDL only. The scans already show incomplete hand-rolled data migrations leaking through (`sanitizeSessionRoomKeys` applied on 2 of 3 session writers — `server#11`; the legacy `code/codes` strip silently incomplete).
- **Impact:** Multi-tenant/multi-DB SaaS needs idempotent, ordered, leader-elected data backfills + reproducible seeds; every consumer hand-rolls a one-off the next agent can't find.
- **AI-driven value:** File-based `src/_migrations/<NNN>_<name>.ts` (`up`/`down`, idempotent, recorded in a `_Migration` table) + a seed entrypoint; a generated migration index + "pending migrations" check in `doctor` (T1).
- **Fix:** Required: `@luckystack/core` (typed project-Prisma accessor), leader-election via existing Redis `acquireLease`, ideally R1 for long backfills. Per-provider seed transforms reuse the SQLite schema-transform work.

### R9 — `@luckystack/email/testing` — `MemorySender`

- **status:** gap · **priority:** Low · **wave1_status:** confirms-wave1 (1/6, r2)
- **Evidence:** Email ships Console/Resend/SMTP but **no** in-memory test adapter, so consumers asserting "a welcome mail was sent" spy on `console.log` — brittle, wrong layer.
- **AI-driven value:** A first-class `MemorySender` (from `@luckystack/email/testing`) recording sent `EmailMessage`s for direct assertion; pairs with a typed `EmailFailureReason` taxonomy.
- **Fix:** Subpath export of the existing `@luckystack/email` package — zero new deps, loads only in tests.

---

## 2. AI-trust & developer-experience tooling gaps

These do not add runtime features; they close the **silent-degradation / doc⇄code-drift / unwired-guarantee** holes that make a green build lie to the AI. This is the report's highest-leverage cluster for the 100%-AI-driven goal.

### Top items

| # | Tool / Primitive | Status | Priority | wave1 | One-line gap |
|---|---|---|---|---|---|
| T1 | `luckystack doctor` — static, no-server-start preflight (`--json`) | gap | **High** | new (4/6 theme) | Only correctness check runs at server-boot — AI can't verify its own wiring |
| T2 | Per-package `luckystack.manifest.json` + MCP package-surface tools + offline catalog | gap | **High** | new | Package exports/hooks/env/config live only as lossy prose |
| T3 | `ai:verify` — end-to-end "actually wired + typed" gate + deterministic-regen drift gate | gap | **High** | confirms (3/6) | Lint/build pass even when the validator fell open or a typed call degraded |
| T4 | Extractor fidelity — `apiContracts.coverage.json` (EXACT/FELL_BACK/DEGRADED) | **partial** | **High** | confirms | Type/Zod extraction degrades to placeholder silently — fuzz/validation OFF, AI unaware |
| T5 | `ai:doccheck` — type-check fenced TS snippets in CLAUDE.md/ARCHITECTURE docs | gap | **High** | confirms | `export const method` vs `httpMethod` ships in the always-read contract file |
| T6 | Generated errorCode + i18n key catalogs (`ai:errorcodes`/`ai:i18n`) + per-locale flags | gap | **High** | new | Mandatory i18n + error-envelope contracts are un-indexed; AI guesses every time |
| T7 | `AI_CONFIG_REFERENCE.md` + `AI_SECURITY_DEFAULTS.md` + boot `verifySecurityPosture` | gap | **High** | confirms (6/6 theme) | ~100 config keys + insecure-but-default postures live as scattered prose |
| T8 | Asset/template/script drift gate (`ai:check-template-drift`) + scaffold matrix smoke | **partial** | **High** | confirms (≤6/6) | Hand-synced triplets drift silently; AI-indexed copy is often the buggier one |
| T9 | Schema-aware fuzz + sync auto-sweep + JSON/JUnit run-report | **partial** | **High** | confirms (H10 6/6) | Fixtures unused by fuzz, sweep skips sync, no machine-readable report |
| T10 | Contract-honesty / unwired-guarantee lint (`@wired-by`/dead-export) | gap | Medium | confirms (6/6 theme) | Documented + unit-tested primitives have zero prod call-sites |
| T11 | Coverage map: real-test vs scaffold-stub (`ai:coverage`) | **partial** | Medium | confirms | Binary `tested:fileExists` reads a `throw 'TODO'` stub as "tested" |
| T12 | Typed shapes for hooks/adapters/providers/config + `scaffold:hook`/`scaffold:adapter` | gap | Medium | new | 40+ hooks + adapter slots exist only as markdown tables |
| T13 | MCP `graph_status`/freshness + `generatedAt` + null-prototype guards | **partial** | Medium | confirms (2/6) | MCP serves stale graph with no signal; fictitious prototype-chain nodes |
| T14 | Dist-consumer typed-call parity smoke-test | **partial** | Medium | confirms | Augmentation verified vs in-repo `src/`, not published `/client` `.d.ts` |
| T15 | Type/Zod diagnostics JSON + `functions/`/`shared/` shim parity gate | gap | Medium | new | `functions.redis.default` is typed but stripped at runtime → TypeError |
| T16 | Shared `scripts/_lib/scan.mjs` for the `ai:*` generators | **partial** | Low | confirms | The AI-context generators themselves drift across copies |
| T17 | npm publish provenance + CI publish job + committed generated artifacts | gap | Medium | confirms (1/6) | 16 public packages publish from a laptop, no provenance, CI builds gitignored artifacts |

---

### T1 — `luckystack doctor` — static wiring/posture preflight (no server-start, AI-autonomous)

- **status:** gap · **priority:** High · **wave1_status:** new (4/6 corroboration)
- **Evidence (verified):** `packages/cli/src/commands/` has only `addLogin`/`addPresence`/`addBackendOnly`/`checkEnv`/`checkI18n` — **no `doctor`**. The only correctness check, `verifyBootstrap`, runs at server-boot — a developer action (Rule 8) the AI cannot trigger.
- **Impact:** Installed-but-unregistered packages silently downgrade security (login without `registerSessionProvider` → `auth.login:true` routes become **public**); missing env/overlay-imports, typed routes resolving to unregistered runtime keys, errorCodes lacking locale keys, capability-detection degraded on Node <20.6 — all yield a **green lint+build** and a broken/insecure app with zero signal.
- **AI-driven value:** An autonomous (lint/build-class) verb — `npx luckystack doctor --json` → `{severity, package, missing:'register'|'env'|'overlay-import'|'peer', fix}`. Becomes **step 0 of every verify runbook** — the single highest-leverage AI self-check because the failure mode is silent and security-relevant.
- **Fix:** CLI command in `@luckystack/cli`. Cross-checks installed manifests (T2) × `config.ts` × `.env_template` × generated route-keys. No runtime peer-deps.

### T2 — Per-package `luckystack.manifest.json` + MCP package-surface tools + offline catalog

- **status:** gap · **priority:** High · **wave1_status:** new
- **Evidence (verified):** MCP ships exactly 9 tools (`blast_radius`, `who_imports`, `god_nodes`, `who_calls`, `list_decisions`, `get_decision`, `find_route`, `get_runbook`, `get_capability`) — **zero** tools for any `@luckystack` package surface, and no per-package manifest exists. Exports, hooks `{mutable,stopCapable,payloadType}`, registries, env-vars `{default,required,secret}`, config keys, and self-wire entrypoints live only as lossy prose. For an **uninstalled** package, no local machine-readable detail exists at all.
- **Impact:** The largest break in the docs→types→MCP loop; the AI reconstructs package surfaces from prose and guesses.
- **AI-driven value:** A generated manifest is the foundation that `doctor` (T1), the env/config/errorcode catalogs (T6/T7), and the hook/adapter scaffolders (T12) all consume. Adds MCP `get_package`/`find_hook`/`find_export`/`package_env` + an offline catalog for not-yet-installed packages.
- **Fix:** Generated from the devkit `ts.Program` pass; aggregated in the consumer repo at install.

### T3 — `ai:verify` — end-to-end "actually wired + typed" gate + drift gate

- **status:** gap · **priority:** High · **wave1_status:** confirms-wave1 (3/6)
- **Evidence (verified):** Absent from `package.json` scripts (only `ai:index`/`capabilities`/`project-index`/`decisions`/`runbooks`/`product`/`graph`/`lint`). Runbooks chain `generateArtifacts → lint && build → test`, but nothing proves the end-to-end contract held — lint/build pass even when the extractor degraded to a placeholder (T4) or a typed call would need a cast. No CI drift gate regenerates indexes to a tempdir and `git diff`s (generators are deterministic), so a poisoned/stale generator passes green.
- **AI-driven value:** One command whose pass/fail **is** the contract: regenerate → assert route in maps → assert a synthetic typed `apiRequest` has no `any` against **DIST** types → assert `validateType` doesn't fall open on the declared input → run the route's sweep. Directly serves Rule 1a (verifiable goals) + Rule 20 (self-review).
- **Fix:** Reuses devkit generators + test-runner sweep + the coverage map (T4/T11). Pairs with a CI `git diff --exit-code` regen gate.

### T4 — Extractor fidelity: `apiContracts.coverage.json` + loud marker (no silent placeholder)

- **status:** **partial** · **priority:** High · **wave1_status:** confirms-wave1
- **Evidence (verified):** `packages/devkit/src/typeMap/extractors.ts` — on any `catch` the extractor logs `console.error` then **returns the DEFAULT placeholder** (`{}` input / `'never'`) and generation continues (lines 255-293). The `__RUNTIME_UNRESOLVED__` path aborts, but the catch-to-DEFAULT degradation does **not**, so a route can silently ship a placeholder contract with its runtime fuzz/validation effectively **OFF** while the AI trusts "generated types are truth." No coverage artifact is emitted (`docs/*.coverage.json` absent).
- **Impact:** The most dangerous silent lie in the AI-driven model — a placeholder contract reads identical to a real one.
- **AI-driven value:** Emit per-route `{coverage: EXACT|FELL_BACK|DEGRADED, reason}` + a queryable signal (index "validated" column / MCP) so the AI knows which contracts it can trust before building.
- **Fix:** Devkit extractor change; surfaces via `doctor` (T1) + `AI_PROJECT_INDEX` + MCP; pairs with `ai:verify` (T3).

### T5 — `ai:doccheck` — type-check fenced TS snippets in docs

- **status:** gap · **priority:** High · **wave1_status:** confirms-wave1
- **Evidence (verified, LIVE DRIFT):** `CLAUDE.md` line 169 ships `export const method: ...`, but `docs/ARCHITECTURE_API.md` line 74 and the codegen (`apiMeta.ts`) read **`httpMethod`**. The always-read contract file tells the AI to export the **wrong** symbol → a silently-ignored method (defaults to inference) that lint+build+test all pass; Rule 21 forbids casting around it. Nothing type-checks doc snippets, so this recurs on every doc edit. The API Pattern block is the most-copied snippet in the framework.
- **AI-driven value:** Makes the always-on contract machine-true; eliminates a whole class of "I followed the docs and shipped a no-op."
- **Fix:** Reuse devkit `ts.Program`; extract fenced `ts` blocks, wrap in a synthetic module importing `@luckystack/core/client` + generated maps, map diagnostics back to `docfile:line`, exit 1.

### T6 — Generated errorCode + i18n key catalogs + per-locale flags + MCP lookups

- **status:** gap · **priority:** High · **wave1_status:** new
- **Evidence (verified):** No `ai:errorcodes`/`ai:i18n` scripts; locale files appear in no generated index. An AI writing `{status:'error', errorCode}` or a `useTranslator` call has zero contract for which codes/keys exist or how to register one; the missing-key fallback renders the raw `'some.code'` string to users — a guaranteed Rule 13 violation that passes lint+build+test. The existing `checkI18n` is regex-only and reports helper-accessed keys as "unused," inviting an LLM to delete live keys.
- **AI-driven value:** A generated catalog with per-locale coverage flags turns two mandatory contracts (Rule 13 i18n + the error envelope) from guess-on-every-path into lookup; the AI can catch an untranslated string it just introduced. Adds MCP `find_error_code`/`find_i18n_key`.
- **Fix:** Walk all `_api`/`_sync` + framework codes + `src/_locales/*.json`; add a missing-locale-key column to `AI_PROJECT_INDEX`.

### T7 — `AI_CONFIG_REFERENCE.md` + `AI_SECURITY_DEFAULTS.md` + boot `verifySecurityPosture`

- **status:** gap · **priority:** High · **wave1_status:** confirms-wave1 (6/6 theme)
- **Evidence (verified):** ~100 `registerProjectConfig` keys live as one comma-list in `core/CLAUDE.md` prose; defaults + security implications are scattered across package `CLAUDE.md` + `SEC-NN` code comments — `healthHash:'plain'` fingerprint leak, `trustProxy` XFF-spoof, `requireRoomMembership:false` not enforced on HTTP, `providerAccountStrategy:'unified'` OAuth-hijack, `sync.allowClientReceiverAll:true`. An AI asked to harden picks the insecure-but-documented default because the security note isn't co-located with the key.
- **Impact:** AuthZ/config is the highest security-severity AI-error class (Rule 19).
- **AI-driven value:** A generated config + security-defaults reference (key/type/default/security-note/recommended-prod) lets the AI reason about the secure choice; the same checks run statically in `doctor` (T1) and as a boot warning.
- **Fix:** Generated from `ProjectConfig` + `DEFAULT_PROJECT_CONFIG` + structured `//! security:` annotations.

### T8 — Asset/template/script drift gate + scaffold matrix smoke-test

- **status:** **partial** · **priority:** High · **wave1_status:** confirms-wave1 (≤6/6)
- **Evidence (verified):** `scripts/` exist in root **and** duplicated into `template/scripts/`; `cli/assets/login/src/**` is a second hand-synced copy of `template/src/**`; `// KEEP IN SYNC` markers are unenforced; `pruneOptionalPackages` is ~240 literal `[find,replace]` pairs that must byte-match the template. Confirmed live drift: `template/scripts/generateAiCapabilities.mjs` is missing the entire `hasTestFile`/Tests column the root copy has (no marker, no `checkTemplateSync`), so scaffolded consumers ship a stale capabilities generator. The CLI/template `updateUser_v1` + `deleteAccount_v1` drift findings show the AI-indexed `src/` copy is often the **buggier** one (Rule 12 points agents there first).
- **AI-driven value:** Make divergence a build error so the AI can't be misled by a stale copy or silently desync a triplet.
- **Fix:** CI `cmp` over every dual-existing file + `KEEP-IN-SYNC` marker; a scaffold-matrix smoke (`--auth=none`/`--no-i18n`/`--no-presence`/`--db=*`) asserting each combination still builds. Best long-term: a single-source generator emitting both copies.

### T9 — Schema-aware fuzz + sync auto-sweep + machine-readable run-report

- **status:** **partial** · **priority:** High · **wave1_status:** confirms-wave1 (H10 6/6)
- **Evidence (verified):** `registerTestFixture`'s invalid payloads are never consumed by the fuzz sweep; `schemaSampleInput` is a partial Zod walker (enum/refined/tuple/intersection → `null`, so the contract layer exercises the error path not happy path); the auto-sweep walks **API endpoints only, not sync**; `runAllTests` never threads `reauthenticate` (false-negatives on authed sweeps); authed sweeps **omit the CSRF header** the server enforces; output is human-readable console only. (See also the orphaned CSRF-enforcement layer below.)
- **AI-driven value:** A JSON/JUnit run-report makes results agent-consumable (parse pass/fail per route vs scraping console); wiring fixtures + schema-derived boundary values, extending the sweep over sync, threading `reauthenticate`+CSRF means the green/red the AI relies on stops lying. Pairs with R9 (`MemorySender`) for assertable side-effects.
- **Fix:** `@luckystack/test-runner` (`runAllTests`/`contractCheck`/`fuzzCheck`) + devkit (schema source).

> **Disputed/related (test-runner):** `csrfEnforcementCheck` is **fully built + tested but orphaned** — not exported, never called by `runAllTests`. Originally filed **high**; **verified-down to medium**: it is a test-coverage gap (runtime CSRF still fires regardless), not a runtime vuln — *and* if wired naively the probe would send a real authed POST/PUT/DELETE and execute the mutation (M193), so "wire it in as-is" would itself be wrong.

### T10 — Contract-honesty / unwired-guarantee lint

- **status:** gap · **priority:** Medium · **wave1_status:** confirms-wave1 (6/6 theme)
- **Evidence (verified):** Critical primitives are exported, documented, **unit-tested**, but have **zero production call-sites** — `runWithErrorTrackerIdentity` never bound in the request lifecycle; `flushErrorTrackers` never called on shutdown; `apiRequest`'s `onDrop` (now wired) was a prior instance; `registerTestFixture` never consumed by fuzz; `socketLeaveRoom`'s body never calls `socket.leave`. The usual counter-check (does the unit test pass?) also passes because the seam is tested in isolation.
- **AI-driven value:** An `ai:lint` rule flagging `@wired-by <symbol>`/`@guarantee` JSDoc whose symbol has no real (non-test, non-barrel) caller, plus dead-param detection. Marking such symbols `status:unwired` in `AI_PROJECT_INDEX` stops the AI building on a dead guarantee.
- **Fix:** `ai:lint` rule + `ai-graph` `who_calls == only-tests` query (uses the existing graph).

### T11 — Coverage map: real-test vs scaffold-stub

- **status:** **partial** · **priority:** Medium · **wave1_status:** confirms-wave1
- **Evidence (verified):** The only coverage signal is the binary `tested: fileExists(route.tests.ts)` flag. It cannot tell a real test from the scaffold stub (`throw new Error('TODO')`) inside a valid `customTests` export, so a placeholder reads as `tested:yes`; it is also shape-blind to which sweep layers apply.
- **AI-driven value:** A `none`/`stub`/`real` distinction lets the AI honestly surface the gap (and not declare done on a stub).
- **Fix:** Emit `docs/coverage.generated.json` per route `{perRouteTest: none|placeholder|real, applicable sweep layers}`; MCP `coverage_gaps`/`route_coverage`; make `scaffold:test` coverage-aware.

### T12 — Typed shapes for hooks/adapters/providers/config + scaffolders

- **status:** gap · **priority:** Medium · **wave1_status:** new
- **Evidence (verified):** Routes are reliably AI-driveable because their shapes are **generated**, but the 40+ hooks, the `SessionProvider`/`UserAdapter`/`EmailSender`/`RateLimitStrategy` slots, and the `registerProjectConfig` bag exist only as scattered markdown tables. An AI writing a hook-handler or custom adapter reconstructs the shape from prose and guesses a wrong payload field or a missing required method.
- **AI-driven value:** Extends "generated shape → reliable AI authoring" from routes to every extension point. Typed `scaffold:hook`/`scaffold:adapter` from the installed declarations.
- **Fix:** Builds on the per-package manifest (T2); emits `AI_EXTENSION_INDEX.md` + MCP `get_hook`/`get_adapter`.

### T13 — MCP `graph_status`/freshness + `generatedAt` + null-prototype guards

- **status:** **partial** · **priority:** Medium · **wave1_status:** confirms-wave1 (2/6)
- **Evidence (verified):** Every MCP tool reads a committed artifact, so an uncommitted working tree serves a stale graph with **no signal** — the AI works against a tree it just changed. `who_calls` exists only on graph version ≥2; `god_nodes` advertises `max(100)` but the producer caps lower (false promise); prototype-chain keys (`toString`/`constructor`) resolve as fictitious nodes → confidently-wrong "Nothing imports."
- **AI-driven value:** A `graph_status` tool `{version,nodeCount,edgeCount,generatedAt,stale}` (`stale` = artifact older than newest `src/` file) + `generatedAt` on every response lets the AI know to regenerate before trusting an answer.
- **Fix:** Read-only `graph_status` tool; align `god_nodes` cap; `Object.hasOwn`/null-prototype guards in the reader.

### T14 — Dist-consumer typed-call parity smoke-test

- **status:** **partial** · **priority:** Medium · **wave1_status:** confirms-wave1
- **Evidence (verified, user's recorded open blocker):** The whole "install package → AI implements with full typing" premise assumes a fresh consumer gets the same zero-cast typed `apiRequest` as in-repo dev, but the generated module-augmentation is verified against **in-repo `src/` paths**, not the published `@luckystack/core/client` `.d.ts`. No end-to-end test exists; `apiRequest` is also uncallable (`name` typed `never`) until `apiTypes.generated.ts` exists, giving a fresh consumer a cryptic compile error.
- **AI-driven value:** If typed calls don't actually work for a freshly-installed consumer, the entire 100%-AI-driven-after-install premise fails at the first route. A packaging smoke-test makes the core promise machine-verified.
- **Fix:** Add to the `create-luckystack-app` smoke or a devkit fixture; target the augmentation at the published `/client` declarations; pairs with `ai:verify` (T3).

### T15 — Type/Zod diagnostics JSON + `functions`/`shared` shim parity gate

- **status:** gap · **priority:** Medium · **wave1_status:** new
- **Evidence (verified):** `functions.redis.default` / `functions.sentry.default` were **typed but stripped at runtime** → `TypeError` (the dead-export class; `functions/redis.ts` + `functions/sentry.ts` are now fixed to no-`default` re-exports, but no gate prevents recurrence). `ARCHITECTURE_FUNCTION_INJECTION.md` documents the opposite of the runtime. No way to ask "which routes have a trustworthy contract?" before building.
- **AI-driven value:** Emit `apiTypeDiagnostics.generated.json` per route `{resolved, fellBackToDefault, unresolvedSymbols, zodFallback}` + a shim parity-check in `generateTypeMapFile()` comparing emit-keys vs `resolveFunctionModule`-keys and **failing the build** on mismatch.
- **Fix:** Devkit (loader + emitter) + the consumer `functions/` shims. Composes with `ai:verify` (T3) + `doctor` (T1).

### T16 — Shared `scripts/_lib/scan.mjs` for the `ai:*` generators

- **status:** **partial** · **priority:** Low · **wave1_status:** confirms-wave1
- **Evidence (verified):** 16 generator scripts with `safe`/`walkFiles`/`extractImports`/`extractExports`-style helpers duplicated across them **and** duplicated again into `template/scripts/`. The regex export extractors miss valid TS forms and mis-count `additional[]` predicates — the AI-context artifacts the AI depends on are themselves generated by drift-prone code.
- **AI-driven value:** If the generators that build `AI_PROJECT_INDEX`/capabilities/graph drift, the AI's primary context silently degrades. One shared zero-dep scanner (ideally reusing `generateGraph`'s `ts.Program` pass) makes the AI-context layer trustworthy.
- **Fix:** Extract `scripts/_lib/scan.mjs` imported by all generators + shipped in template; CI diff-check on the source/template pairs.

### T17 — npm publish provenance + CI publish job + committed generated artifacts

- **status:** gap · **priority:** Medium · **wave1_status:** confirms-wave1 (1/6; real supply-chain gap)
- **Evidence (verified):** 16 public `@luckystack/*` packages ship from a dev laptop — `npm publish` runs with no `--provenance`, no integrity/audit gate, no CI publish job; CI lints/builds against an **uncommitted gitignored** generated artifact (only non-empty checked) so a poisoned generator passes green with no reviewable diff. The scaffolder wires all three MCP servers with `@latest` (no integrity floor).
- **AI-driven value:** A deterministic, reviewable pipeline means the artifacts the AI reasons over in-repo are the same ones shipped — closing the gap where a poisoned/stale generated type could ship undetected. Doubles as T3's drift gate.
- **Fix:** Tag-triggered GH Actions publish via OIDC + `npm publish --provenance` from clean `npm ci` + `npm audit --omit=dev`; commit generated artifacts + a CI `git diff --exit-code` regen gate; pin the `@latest` MCP entries.

---

## 3. Observability-wiring gaps (request-scoped telemetry)

These overlap the metrics/error-tracking lanes but are listed separately because they are **wiring** gaps in shipped code, not new packages.

### O1 — Request-scoped telemetry/identity as a first-class lifecycle seam (`withRequestTelemetry`)

- **status:** **partial** · **priority:** High · **wave1_status:** confirms-wave1
- **Evidence (verified):** `runWithErrorTrackerIdentity` (per-request ALS identity) is exported, documented, unit-tested but has **zero production call-sites** — only tests bind it. So PostHog/Datadog adapters cross-attribute concurrent requests' user id (**PII bleed**), and the Datadog adapter never even reads the ALS. `flushErrorTrackers` is never called on shutdown (buffered events lost every SIGTERM/redeploy).
  - *Note:* the adapter-path ALS **was** wired this wave (`runWithErrorTrackerIdentityScope` now opened in all four handlers, `setCurrentErrorTrackerIdentity` after `readSession`), so the *adapter* path is fixed; the **legacy `initializeSentry()` slot** remains the weak spot — it still passes raw context to `Sentry.captureException(err, {extra})` and relies on a process-global `setUser` (verified high: cross-request PII bleed + unredacted context on the framework's documented default Sentry path).
- **AI-driven value:** One framework-owned `withRequestTelemetry(user, requestId, fn)` at the api/sync handler entry makes identity/request-id/trace-id correct-by-construction for **every** adapter; plus an adapter-conformance test-kit (`@luckystack/error-tracking/testing`) enforcing identity isolation under concurrency — so the AI's mental model and the runtime finally agree.
- **Fix:** `node:async_hooks` (already used by core) wired into the shared request-lifecycle pipeline + a `preServerStop` hook for flush. **Beware:** must not drag `async_hooks` into the client bundle (the repo `shared/tryCatch.ts` → `sentrySetup` → `errorTrackerRegistry` `AsyncLocalStorage` edge currently **does** break the login client bundle — verified high, repo-internal drift; the shipped template copy is clean).

### O2 — `tryCatch({capture:false})` / benign-error classifier

- **status:** **partial** · **priority:** Low · **wave1_status:** confirms-wave1 (1/6)
- **Evidence:** `tryCatch` sends **every** caught error to `captureException`, so expected control-flow errors (validation failures, not-found) flood the error tracker; callers can't opt out.
- **AI-driven value:** An optional `{capture?:false}` (or a registered benign-error classifier) gives the AI a typed way to mark an expected failure benign — keeping the tracker's signal-to-noise high.
- **Fix:** `@luckystack/core` (`tryCatch`) + the registered error-tracker. Pairs with O1.

---

## 4. Shipped / refuted — do NOT re-open

Recorded so a future AI does not re-file a closed gap or a refuted finding.

| Item | Resolution | Note |
|---|---|---|
| **Runtime input-validator fail-open (F2)** | **shipped** | `runtimeTypeValidation.ts` now fails **closed** — terminal branch errors, Record values validated, array element types fail-closed, proto-pollution keys rejected, `__RUNTIME_UNRESOLVED__` surfaced as errors, `MAX_VALIDATION_DEPTH=64`. Prod no-op is opt-in only via `validation.runtimeMode:'off'`. **Residual:** surface *which* shape is validated (folds into T4). |
| **`apiRequest` offline-queue `onDrop` hang (6/6 wave1)** | **shipped** | `onDrop` now wired with `suppressOnDrop`; promise resolves with `offline.dropped`/`offline.queueFull` instead of hanging. |
| **`functions.*.default` dead-but-typed exports** | **shipped** | `functions/redis.ts` + `functions/sentry.ts` are now no-`default` re-exports. A parity gate (T15) is still wanted to prevent recurrence. |
| **`ActiveSession` stale interface (H5 scaffolder)** | **shipped** | Interface (`handle`/`expiresInSeconds`/`isCurrent`) matches `listSessions_v1` return shape. |

### Refuted / downgraded adversarial-verification results (respected here)

- **"Socket transport enforces no HTTP method ⇒ high security vuln"** — **refuted to low/footgun.** Factual core (no method check on the socket path) is true, but the security framing is wrong: the socket is origin-gated + auth-gated; an authenticated client calling an authorized route over the socket gains nothing, and the CSRF-exempt-GET hazard lives entirely in the HTTP transport (which *does* enforce the method). The genuine residual is a route-authoring hazard (don't name a mutation `get*`), not a transport vuln. Not a feature gap.
- **`trustProxy` leftmost-XFF spoof** — **verified down to medium** (default `trustProxy:false`; documented single-overwriting-proxy posture). Real, opt-in-gated hardening gap; informs the `AI_SECURITY_DEFAULTS` catalog (T7), not a new package.
- **Legacy Sentry raw-context leak** — split verdict: the **identity-bleed** half is **verified high**; the **`{extra:context}` PII** half was **downgraded to low** by one verifier (no framework call-site feeds secrets as context) but **re-affirmed high** on the documented-default-path basis by another. Treated as a real defense-in-depth gap feeding O1, not a feature.
- **CSRF-enforcement test layer orphaned** — **verified down to medium** (test-coverage gap, not a runtime vuln; naive wiring would execute mutations — M193). Feeds T9.
- **docs-ui renderer shape mismatch** — **verified down to high** (real shipped break, but a dev-only docs tool: 404 in prod, no data/security impact). Not a feature gap; a bug for the docs-ui owner.
- **Email `preEmailSend` stop-signal ignored** — **verified high** (real advertised-but-unimplemented abort/suppression seam). This is a **bug in the email package**, listed here only because it is the kind of unwired-guarantee T10 would catch.

---

## Priority rollup (do-first)

1. **T1 `luckystack doctor`** — the autonomous self-check that turns "green build" into "actually wired"; unblocks the whole AI-trust cluster.
2. **T2 per-package manifest + MCP surface tools** — the foundation T1/T6/T7/T12 all consume.
3. **R1 `@luckystack/jobs`** — the most-corroborated runtime gap (6/6) and the foundation for R3/R4/R6/R8.
4. **T4 / T5 / T3** — kill the silent-degradation + doc-drift + end-to-end-verify holes (the AI is currently lied to on each).
5. **R2 / R3 / R4 / R5** — the high-leverage cross-cutting runtime primitives apps will otherwise hand-roll (Rule 12a).
6. **T7 + O1** — security-posture catalog + request-scoped telemetry wiring (the highest security-severity AI-error surfaces).
