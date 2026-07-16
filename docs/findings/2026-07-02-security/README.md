# Security & Correctness Scan — 2026-07-02

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: all `@luckystack/*` packages + `create-luckystack-app` + consumer `src/`, `server/`, `scripts/`, `shared/`, `functions/`, root config · Tool/agents: 10 parallel audit agents (one per surface), two highest-severity re-verified by hand · Supersedes: —

Last updated: 2026-07-16

> Migrated 2026-07-15 from the legacy root folder `codebase-scan-02-07/` into the
> dated Findings-Protocol layout. The full ranked report is `SCAN_REPORT.md`;
> per-area detail lives in `findings/*.md`. This table is the authoritative status
> record.
>
> ⚠️ **2026-07-16 — this header used to read "No `open` items remain … so this folder is
> safe to archive." That was false, and it is worth understanding why.** `C-04` was written
> up in `SCAN_REPORT.md:117` and `findings/config.md:37` but **never got a row in this
> table**, so the tally counted what was listed rather than what was found, and then invited
> deletion of the evidence. It was re-derived from scratch on 2026-07-16 — from the code, not
> from the report — and it is REAL. A row now exists (C-04, since **fixed** 2026-07-16). The lesson is structural,
> not clerical: a rollup that is assembled from the rows below it can only ever be as complete
> as the migration that produced them, and "safe to archive" is exactly the sentence that
> stops anyone from checking.

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| C1 | Router: unauthenticated prototype-key path (`/api/__proto__/x`) crashes the process in fallback mode | CRITICAL | fixed | 2026-07-02 | 2026-07-02 | `resolveTarget.ts` `ownBinding()` guard + `httpProxy.ts` last-resort `.catch` + regression test `resolveTarget.test.ts` (5 cases) |
| H1 | Consumer: session-bootstrap endpoint + `updateSession` broadcast returned the raw session token to page JS in cookie mode | HIGH | fixed | 2026-07-02 | 2026-07-02 | New `ClientSessionLayout = Omit<SessionLayout,'token'\|'csrfToken'>`; `session_v1` + broadcast strip token; regression test in `session_v1.tests.ts`. ADR 0018 |
| M1 | Auth: OAuth account *creation* did not check `emailVerified` (custom providers) → account squatting | MEDIUM | fixed | 2026-07-02 | 2026-07-02 | `login.ts` `findOrCreateOAuthUser` fail-closed guard + `emailImpliesVerified` provider flag on Facebook |
| M2 | Auth: per-account brute-force lockout ships disabled by default | MEDIUM | wontfix | 2026-07-02 | 2026-07-02 | Kept opt-in by design (force-enabling introduces a bounded victim-lock DoS); one-shot boot warning added when logins fail while disabled |
| M3 | Auth: lockout check is TOCTOU (non-awaited increment) | MEDIUM | fixed | 2026-07-02 | 2026-07-02 | Both wrong-password paths now `await dispatchHook('loginFailed')` before responding |
| M4 | Server: unauthenticated OAuth-init is a Redis write-amplification DoS | MEDIUM | fixed | 2026-07-02 | 2026-07-02 | `authApiRoute.ts` per-IP rate-limit (`ip:<ip>:auth:oauth-init`) before the Redis write |
| M5 | Sync: `purpose`-aware room-formatter mismatch (join uses `'join'`, membership/fanout use `'broadcast'`) breaks multi-tenant sync | MEDIUM (HIGH for multi-tenant) | fixed | 2026-07-02 | 2026-07-02 | All content-room ops in `loadSocket.ts` use canonical `'broadcast'`; registry type-doc codifies the rule |
| M6 | Consumer/Prisma: `email` lacks `@unique`, weakening the email-change race backstop | MEDIUM | wontfix | 2026-07-02 | 2026-07-02 | By-design: `@unique` is opt-in, governed by `auth.providerAccountStrategy` (default `per-provider` omits it). ADR 0019; app-level collision check in `confirmEmailChange_v1` |
| M7 | Error-tracking: PostHog `captureException` bypassed secret scrubbing | MEDIUM | fixed | 2026-07-02 | 2026-07-02 | `posthog.ts` now receives a rebuilt scrubbed Error (mirrors Sentry ET-O2 pattern) |
| M8 | Test-runner: auth sweep silently dropped routes missing from `apiMetaMap` | MEDIUM | fixed | 2026-07-02 | 2026-07-02 | `runAuthEnforcementTests.ts` now records a `skipped`/"auth unverifiable" result instead of a silent continue |
| L-batch | Security-relevant LOW hardening: CORS reflection on exempt paths (server L1), origin-exempt segment-boundary matching (L5), auth rate-limit window predicate (L4), SameSite-Strict boot warning (auth L2), cookie `Secure` default-on in prod (L5), `clearAuthFailures` tryCatch (L6), ConsoleSender prod warning (infra L2) | LOW | fixed | 2026-07-02 | 2026-07-02 | Third follow-up round; 1452 unit + 112 test-runner green |
| L-rest | Remaining LOW items (registration enumeration oracle, pre-params body-cap for streaming, health-probe amplification, error-tracker PII plaintext, docs-ui CSS `image-set`/`cross-fade`, `prismaWithSecrets` dev shell, dup-report cosmetics) | LOW | wontfix | 2026-07-02 | 2026-07-02 | Accepted tradeoffs / cosmetic — report-only, see `findings/*.md` |
| **C-04** | **Module-load-time env reads run BEFORE secret-manager resolution.** `config.ts` read `EMAIL_FROM` and `EXTERNAL_ORIGINS`/`DNS` inside the `registerProjectConfig({...})` literal, i.e. at module load; `server.ts` imports `../config` long before it awaits `resolveSecretsIfConfigured(...)`, so a pointer-shaped value for any of the three froze as the POINTER. `config.ts` even carried a DEV-WARN describing this exact hazard, unimplemented. | LOW | **fixed** | 2026-07-02 | 2026-07-16 | **Verified LIVE first (not from the report), then fixed.** Runtime proof before the fix: with `EXTERNAL_ORIGINS=ORIGINS_BASE_V1` at import and the resolver later writing `https://real.company.com`, `getProjectConfig().http.cors.allowedOrigins` stayed `["ORIGINS_BASE_V1"]` and `email.from` stayed the pointer. Fix uses the framework's OWN mechanism (ADR 0026), not a new one: `email.from` is now a call-time getter, and a `registerSecretsResolvedListener` re-registers `allowedOrigins` when secrets land (a getter can't help there — `registerProjectConfig` deep-merges the value during the call). Applied to repo `config.ts` AND the scaffold template. `registerSecretsResolvedListener`/`notifySecretsResolved` newly exported from the client-safe `/config` subpath (guard still green). Regression proof: `server/configSecretsResolved.test.ts` drives the REAL `config.ts` (both halves verified to fail against the reverted fix, independently) + `packages/core/src/secretsResolvedConfig.test.ts` pins the mechanism incl. "a getter cannot survive the merge". ⚠️ B10 (bun-feasibility) had pre-declared this a false-positive without checking — it was real. Full trail in that ledger's B10 row |

## Detail

- **Ranked master report:** [`SCAN_REPORT.md`](./SCAN_REPORT.md) — headline, per-severity write-ups, three follow-up rounds, and the verified-clean list of prior criticals.
- **Per-area detail:** [`findings/`](./findings/) — one file per audited surface (router, server, auth, api-sync, config, core, cli-wizard, consumer-app, infra-packages, small-packages).
- **Related ADRs:** `docs/decisions/0018-*.md` (session-token exposure contract), `docs/decisions/0019-*.md` (email `@unique` opt-in via `providerAccountStrategy`).
