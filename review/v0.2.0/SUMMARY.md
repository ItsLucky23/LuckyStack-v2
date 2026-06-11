# v0.2.0 Five-Axis Codebase Review — Executive Summary

**Date:** 2026-06-11 · **Branch:** `chore/package-split-prep` · **Repo:** `C:/youcomm/LuckyStack-v2`

This summary ties together the five dimension reports in this folder: [SECURITY.md](./SECURITY.md), [CODE_QUALITY.md](./CODE_QUALITY.md), [CONFIGURABILITY.md](./CONFIGURABILITY.md), [HOOKS.md](./HOOKS.md), and [MISSING_FEATURES.md](./MISSING_FEATURES.md). One combined audit agent reviewed each package/area (all 14 `@luckystack/*` packages plus consumer app/server code, overlays, and tooling), self-verifying findings against existing config options, the hook registry, and `docs/audits/` before reporting. Findings below are referenced by dimension + severity + title; exact IDs live in the per-dimension reports.

---

## 1. Release-Readiness Verdict

**v0.2.0 is not ready to publish as-is.** The package-split architecture is sound and most findings are polish, but a hard core of ship-blockers remains: one critical (the docs-ui renderer cannot parse the JSON shape devkit actually emits — the feature is dead on arrival), several fail-open security defaults that contradict the framework's own documented guarantees (production input validation is a no-op, a missing `auth` export silently becomes public, sockets join token rooms before session validation), two single-request process-crash paths, secrets/tokens printed to production logs (email ConsoleSender auto-registered in prod), and first-run breakage for the two most important consumer entry points (`create-luckystack-app` silently fails `npm install` on Windows; the published `add login` asset imports an export that no longer exists). None of these is a deep redesign — most are days, not weeks — but publishing before fixing them would burn first-impression trust with exactly the external-installer audience the packaging north star targets. Fix the "before publishing" list below, re-run the affected area audits, then ship.

---

## 2. Finding Counts by Dimension × Severity

| Dimension | Report | Total | Critical | High | Medium | Low |
|---|---|---:|---:|---:|---:|---:|
| Security | [SECURITY.md](./SECURITY.md) | 49 | 0 | 12 | 22 | 15 |
| Code quality | [CODE_QUALITY.md](./CODE_QUALITY.md) | 98 | 1 | 17 | 45 | 35 |
| Configurability | [CONFIGURABILITY.md](./CONFIGURABILITY.md) | 45 | 0 | 6 | 24 | 15 |
| Hooks | [HOOKS.md](./HOOKS.md) | 31 | 0 | 3 | 18 | 10 |
| Missing features | [MISSING_FEATURES.md](./MISSING_FEATURES.md) | 29 | 0 | 3 | 18 | 8 |
| **Total** | | **252** | **1** | **41** | **127** | **83** |

---

## 3. Top-10 Priorities (all dimensions)

| # | Severity | Dimension | Title | File | Why first |
|---|---|---|---|---|---|
| 1 | Critical | Quality | Renderer JSON-shape mismatch: docs-ui expects nested `{page:{name:{version:meta}}}` but devkit emits `{page: ApiDocsEntry[]}` | `packages/docs-ui/src/docsHtml.ts` | The package's core feature cannot render at all — shipping it as-is publishes a known-dead package. |
| 2 | High | Security | Runtime input validation is a no-op in production — and docs claim otherwise | `packages/core/src/runtimeTypeValidation.ts` | Every consumer believes their API inputs are validated in prod; they are not. Doc-vs-code contradiction on a security guarantee. |
| 3 | High | Security | Missing `auth` export is fail-open at runtime while generated meta claims login-required | `packages/devkit/src/loader.ts` | A forgotten one-line export silently makes an endpoint public while tooling reports it protected — worst-case silent auth bypass. |
| 4 | High | Security | `socket.join(token)` before session validation lets a forged token subscribe to any room, bypassing `preRoomJoin` | `packages/server/src/loadSocket.ts` | Undermines the entire room-based sync authorization model with a trivially forgeable input. |
| 5 | High | Security | Unhandled rejection in HTTP pipeline crashes the whole process (single-request DoS) — sync socket path has the same gap | `packages/server/src/createServer.ts`, `packages/sync/src/handleSyncRequest.ts` | One malformed request takes down every connected user; cheapest possible DoS against any deployment. |
| 6 | High | Security | Auto-registered ConsoleSender in production reports `ok:true` and prints password-reset/email-change tokens into server logs | `packages/email/src/register.ts` | Account-takeover tokens land in log aggregators, and the documented `required: true` guard is silently defeated. |
| 7 | High | Security | Per-recipient `filter` pattern leaks full `serverOutput` to every recipient — docs teach it as a way to hide fields | `packages/sync/src/_shared/clientFanout.ts` | Consumers following the official docs believe they are redacting data while broadcasting it to everyone. |
| 8 | High | Quality | `npm install` / `prisma generate` silently fail on Windows (`spawnSync` .cmd with `shell:false` → EINVAL) | `packages/create-luckystack-app/src/index.ts` | First-run experience is broken for every Windows consumer — the framework's own dev platform. |
| 9 | High | Quality | Stale LoginForm asset imports removed `providers` config export — compile-breaking mirror drift (framework and CLI asset have DRIFTED) | `packages/cli/assets/login/src/_components/LoginForm.tsx` | `luckystack add login` — the flagship optional-feature flow of 0.2.0 — produces a project that does not compile. |
| 10 | High | Hooks | `preEmailSend` stop signal is dispatched but never honored — documented suppression/rate-limit patterns silently fail to block sends | `packages/email/src/sendEmail.ts` | A documented safety control (suppression lists, rate limits) silently does nothing; consumers will only find out after the unwanted email is sent. |

Near-misses that just fell off the table but belong in the same fix wave: **Security/High** router never sets/sanitizes `X-Forwarded-For` (`packages/router/src/httpProxy.ts` — IP spoofing + rate-limit bypass); **Security/High** adapter `beforeSend` transformed event silently discarded (`packages/error-tracking/src/adapters/sentry.ts` — redaction never applied); **Configurability/High** `--no-prompt` hard-locks CI/AI agents to Mongo+credentials+console (`packages/create-luckystack-app/src/index.ts`); **Quality/High** CI "Test sweep" step can never pass (no server/Redis/Mongo booted, `.github/workflows/ci.yml`).

---

## 4. Suggested Order of Attack

### Before publishing 0.2.0 (ship-blockers)

- All Top-10 items above.
- Remaining **high-severity security**: raw session token in `rateLimitExceeded` hook payload (pkg-api); sliding-session refresh never re-tracks `activeUsers` (pkg-login); grace-expiry teardown kills multi-tab sessions (pkg-presence); router `X-Forwarded-For` spoofing (pkg-router); error-tracking `beforeSend` discard; unsalted secret hashes on unauthenticated `/_health` (core + server).
- Remaining **broken-on-arrival quality**: email adapter boot crash swallowed by bootstrap's empty catch (violates the fail-loud peer-dep guard policy); ghost `packages/env-resolver/dist` feeding a phantom package into the shipped AI index; stale repo overlay `luckystack/login/oauthProviders.ts` masking the canonical 0.2.0 auto-wiring; template `testAll.ts` dropping the load-bearing `import ../config` registration; docs-ui try-it-out wrong URL + missing CSRF; consumer-shipped CLAUDE.md mandating scripts the scaffold does not have; dead wizard choices (AUTH_MODE / I18N etc. produce identical scaffolds — either wire them or remove the questions); CI test-sweep step.
- Rationale: everything here is either a security guarantee the docs already promise, or a first-run failure a stranger hits in their first hour. The packaging north star ("a stranger can install + configure without forking") fails on all of them.

### 0.2.x patch releases

- Remaining **high** configurability/hooks/missing: dead `providerAccountStrategy` knob; hardcoded English email copy bypassing the template registry; no email-verification flow for credentials registration; no docs-ui authorize hook + un-overridable auto-mounted `/_docs`; presence never emits userLeft/offline; per-route sync rate limits; test-runner extension registry never invoked; `registerRoutingRules`/srcDir only partially honored in devkit.
- **Medium clusters** worth batching: (a) token/PII redaction sweep — session tokens in presence/sync/Sentry logs, OAuth secrets in debug logs, template `session_v1` logging full sessions; (b) timeouts everywhere — `apiRequest`, `syncRequest`, router upstream proxy, secret-manager `/resolve`, email adapters; (c) the blanket `/* eslint-disable */` cleanup across api/core/devkit/sync (the zero-tolerance policy is currently fiction in ~10 files); (d) test coverage for the untested orchestrators (`sendEmail.ts`, `login.ts`, sync transport handlers, core security primitives); (e) framework↔template mirror drift (5 of 11 scripts, `changePassword_v1` ×3 copies, non-capturing template `tryCatch`).

### Later

- Low-severity polish: i18n for docs-ui/email/LoginForm strings, `--version` flags, hardcoded styling/timing constants, doc drift fixes (presence lifecycle.md, sync room-fanout.md, security-defaults.md), `.publish-dry.out` scratch file, dead config fields.
- Larger features that deserve their own design pass: PKCE + 2FA in login, graceful shutdown / `close()` lifecycle, error-tracking client/browser entry + flush lifecycle, presence multi-instance fan-out + roster query, server-initiated typed sync emit, `luckystack remove`, custom scaffold templates.

---

## 5. Methodology & Limitations

One combined audit agent per package/area covered all five dimensions for its area in a single pass, self-verifying each finding against the actual config surface, hook registry, and prior `docs/audits/` content before reporting. **There was NO separate adversarial verification pass this run** — unlike previous audits, no second agent re-derived findings from scratch. Findings marked **confidence: medium or low** in the dimension reports therefore deserve a manual double-check before acting (notably: the sliding-session revocation gap, the overlay runtime-`.ts`-import production-path concern, the PostHog identity race, and the sync default-receiver-authorization finding). Counts in section 2 are as reported by the area agents; merged duplicates were consolidated by the dimension report writers.

---

## 6. Branch-Log Entry (paste once the agent session is done)

```markdown
## 2026-06-11 — v0.2.0 five-axis codebase review (lean)

**User prompt:** Run a full multi-agent review of the repo ahead of the v0.2.0
release across five axes (security, code quality, configurability, hooks,
missing features), one combined audit agent per package/area, and write the
results to review/v0.2.0/.

**What I did:** Spawned per-area audit agents over all 14 @luckystack/*
packages plus consumer app/server, overlays, and tooling; each agent
self-verified findings against config options, the hook registry, and
docs/audits/. Five dimension writers consolidated 252 findings (1 critical,
41 high, 127 medium, 83 low) into per-dimension reports; a summary writer
produced the executive summary with top-10 priorities and a
before-0.2.0 / 0.2.x / later order of attack. Verdict: not ready to publish
as-is — 1 critical (docs-ui renderer shape mismatch) plus a hard core of
fail-open security defaults and first-run breakage must land first.

**Files touched:**
- review/v0.2.0/SUMMARY.md
- review/v0.2.0/SECURITY.md
- review/v0.2.0/CODE_QUALITY.md
- review/v0.2.0/CONFIGURABILITY.md
- review/v0.2.0/HOOKS.md
- review/v0.2.0/MISSING_FEATURES.md

**Notes:** Lean run — no separate adversarial verification pass; findings
marked confidence medium/low need a manual double-check before acting.
Review docs are read-only analysis; no source files were changed.
Remember to update branch-logs/INDEX.md row for chore/package-split-prep.
```