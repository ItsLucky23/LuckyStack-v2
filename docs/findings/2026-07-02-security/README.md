# Security & Correctness Scan — 2026-07-02

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: all `@luckystack/*` packages + `create-luckystack-app` + consumer `src/`, `server/`, `scripts/`, `shared/`, `functions/`, root config · Tool/agents: 10 parallel audit agents (one per surface), two highest-severity re-verified by hand · Supersedes: —

Last updated: 2026-07-15

> Migrated 2026-07-15 from the legacy root folder `codebase-scan-02-07/` into the
> dated Findings-Protocol layout. The full ranked report is `SCAN_REPORT.md`;
> per-area detail lives in `findings/*.md`. This table is the authoritative status
> record. **No `open` items remain** — every finding is `fixed` or `wontfix`
> (by-design, documented in an ADR), so this folder is safe to archive.

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

## Detail

- **Ranked master report:** [`SCAN_REPORT.md`](./SCAN_REPORT.md) — headline, per-severity write-ups, three follow-up rounds, and the verified-clean list of prior criticals.
- **Per-area detail:** [`findings/`](./findings/) — one file per audited surface (router, server, auth, api-sync, config, core, cli-wizard, consumer-app, infra-packages, small-packages).
- **Related ADRs:** `docs/decisions/0018-*.md` (session-token exposure contract), `docs/decisions/0019-*.md` (email `@unique` opt-in via `providerAccountStrategy`).
