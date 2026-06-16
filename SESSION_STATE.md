# SESSION_STATE — chore/package-split-prep (v0.2.0 hardening)

_Last full rewrite: 2026-06-15 — by the scan-merge / fix / live-test session (Claude). Branch `chore/package-split-prep`, HEAD `302cbf1`, ~312 uncommitted changes. Nothing committed this session._

## Session summary

This session merged many AI codebase-scans, fixed everything actionable, implemented the v0.2.0 security/feature decisions, then live-tested the app and found + fixed a showstopper.

- **Merged scans into one combined audit.**
  - Wave-1: merged 6 scan runs → `codebase-scan-14-06-MERGED/` (561 findings). Deleted the 6 source folders, kept MERGED.
  - Wave-2: merged 3 more runs (`codebase-scan--wave2-14-06--{1,3,4}`; run 2 was only the input digest) and reconciled every finding against live code → `codebase-scan-14-06-FINAL/` (FIXED 174 / OPEN 325 / NEW 115 / DEFERRED 36 / FALSE-POS 49).
- **Fixed findings in waves** (each: disjoint-cluster multi-agent + build-gate + adversarial verify).
  - Wave-1 Critical/High/Medium: ~115 fixes; closed C1 (wsProxy crash), C2 (server.js disclosure), C3 (SSRF), ALS PII-bleed.
  - Wave-1 LOW deep-analysis (286 atomic) → 30 fixed + 91 already-fixed; safe-sweep added 12 more.
  - Behavior-preserving refactors (god-functions / shared helpers).
  - Wave-2 NEW blockers: 10 fixes (DOCSUI-1, N-1/N-2 crash guards, N-3/N-4 token-leaks, H-1 proxy timeout, H-4 preEmailSend, H-5/H-6 GDPR self-delete + Redis keys, N-7 CSRF wiring).
- **Implemented the user-approved v0.2.0 decisions** (all except error-tracking privacy, left as-is):
  - Secure-default flips: sync receiver-auth strict, `/_health` hmac (`@bootUuid`), `redactedLogKeys` widened + suffix-match, secret-manager `envNames` allowlist.
  - Wire-contracts: S22 sync-envelope unified, S13 syncCancel server-issued id, A7 one-time tokens hashed-at-rest (`packages/core/src/oneTimeToken.ts`).
  - Features/infra: MIS-016 graceful shutdown (`preServerStop` hook + `stop()/close()` + `flushErrorTrackers`), M-15 login-lockout DoS fix, CI `--provenance` (`.github/workflows/publish.yml`), router health-poller predicate + TTL, api rate-limit scope label.
  - ADRs `docs/decisions/0007-0012` + regenerated `docs/AI_DECISIONS_INDEX.md`.
- **Wave-3 + Wave-4 delta-audits** (separate agent; Sonnet-find + Opus-verify): converged, fixed router boot-handshake hmac + OAuth cookie Secure (`resolveCookieSecure`). Reports: `codebase-scan-14-06-FINAL/WAVE3_DIFF_AUDIT.md`, `WAVE4_DELTA_AUDIT.md`. Their "ship-safe" verdict was WRONG (below).
- **Live browser test found a SHOWSTOPPER that 9 scans + 1213 unit tests missed.**
  - Server (`:80`, Redis/Mongo via the user's SSH tunnel) + client (vite `:5173`), driven with `agent-browser`.
  - Entire frontend rendered BLANK on every page. Cause: `packages/core/src/errorTrackerRegistry.ts:11` imported `node:async_hooks` + `new AsyncLocalStorage()` at module top-level (the ET-02 ALS work); module is client-reachable → vite externalized `node:async_hooks` and threw on access → React never booted. vitest passed because it runs in Node; vite build doesn't error (only browser runtime does).
  - Fixed browser-safe: lazy + `typeof window === 'undefined'` guard (`packages/core/src/errorTrackerRegistry.ts:85-119`). Server ET-02 behaviour unchanged; browser degrades to no-op/null.
  - Re-verified live: all pages render; register + credentials-login + playground (`playground/echo` → success → log drawer) all work. The native-click failure on one playground button was an agent-browser/short-viewport artifact (fixed log drawer overlapped the button), not a product bug.

## Current state

- **Working / verified:** build 0, lint 0, ai:lint clean, `npm run test:unit` 1213/1213. Live app: `/`, `/login`, `/register`, `/playground`, `/settings`, `/admin`, `/docs`, `/reset-password` all render; register/login/playground work against the real backend.
- **Servers may still be running:** `npm run server` (`:80`) + `npm run client` (`:5173`). Redis/Mongo only reachable while the SSH tunnel is up.
- **Nothing committed.** ~312 uncommitted changes on `chore/package-split-prep` (HEAD `302cbf1`).
- Branch-log current; `branch-logs/INDEX.md` count corrected to 125. New project memory `~/.claude/.../memory/project_runtime_test_before_shipsafe.md`.
- The `@luckystack/core` client/server boundary is leaky (a `node:`-only import in a client-reachable module silently breaks the whole client); only the one eager-eval module (errorTrackerRegistry) actually broke and is now fixed — other server modules in core use `node:` lazily so they are fine.

## Next steps

1. **Publish decision (irreversible + public).** User supplies: version (proposed `0.1.0` -> `0.2.0`), which packages (all 15 `@luckystack/*` + `create-luckystack-app`?), dist-tag (`latest` vs `next`/`beta`), npm auth/OIDC readiness. Run a `npm publish --dry-run` / the CI publish job in dry-mode first.
2. **Commit/freeze** before publishing. Suggested split: (a) product changes (`packages/*`, `src/`, `server/`, `shared/`, `luckystack/`, `docs/decisions`, `.github/workflows`, CLAUDE.md, branch-logs); (b) optionally the audit folders (`codebase-scan-14-06-MERGED/`, `-FINAL/`) or gitignore them. End commit messages with the Co-Authored-By trailer.
3. **(Optional, recommended) smoke-test remaining big flows** before publish — sync broadcast across two tabs, an email/reset flow, OAuth redirect — since static "ship-safe" proved unreliable.
4. **(Optional hardening, not a blocker) add a guard** vs the `node:`-into-client-bundle class — capture the agent-browser flow as a committed `@playwright/test` spec, or a check that imports `@luckystack/core/client` under a browser-like env. See the project memory.

## User action required

- **Keep the SSH tunnel up** (Redis + Mongo) for any further live testing; otherwise the server can't boot.
- **Provide the 4 publish parameters** (version, packages, dist-tag, npm auth) before any `npm publish`.
- **Decide** whether to do the optional pre-publish smoke-tests + leak-guard, or publish now on the verified login/register/playground.
- **Choose the commit structure** (one commit vs split; include audit folders or not).
