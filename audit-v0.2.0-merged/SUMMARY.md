# LuckyStack v0.2.0 — Merged Audit Synthesis

> Reconciles TWO Fable-5 scans against the **current** working tree (chore/package-split-prep, post-commit 302cbf1):
> - reports/ — 22 targets, adversarially verified.
> - review/v0.2.0/ — 252 findings across 5 axes, **unverified** and older.
>
> Every merged finding below was re-checked against live code. Counts and verdicts reflect the **VERIFIED** state, not the raw scan claims. Date: 2026-06-11.

---

## 1. Executive summary — release-readiness verdict

**v0.2.0 is NOT ready to publish.** Both original scans reached the same conclusion, and verification against the current tree confirms it: the hard core of ship-blockers is real and almost entirely still live. Commit 302cbf1 (login page + wizard/CLI flow) and the working-tree edits fixed a meaningful slice of the *consumer-onboarding* and *email-template* surfaces, but left every framework-core security defect untouched.

What is verified as still-live and must land before publishing:

- **Systemic security no-op**: runtime input validation returns unconditional success in production (packages/core/runtimeTypeValidation.ts) — every api **and** sync handler receives raw attacker-shaped data in prod while tests run with validation on. Confirmed in core, api, and sync areas.
- **Token hygiene**: the scaffolded template + copied CLI assets hand the raw HttpOnly session token to browser JS (system/session, settings/listSessions); raw token leaks into the rateLimitExceeded hook payload and dev logs. Confirmed.
- **Auth boundary holes**: _client-only sync routes bypass auth + validation entirely; socket.join(token) happens before session validation; OAuth state is not browser-bound (login CSRF / session fixation); a missing auth export is fail-open at runtime. Confirmed.
- **Single-request DoS**: no top-level error guard in the HTTP pipeline and the socket sync path (validateRequest(user!) crashes on additional-only routes). Confirmed.
- **Dead-on-arrival features**: docs-ui renderer cannot parse the array shape devkit emits (critical); npm run prod builds nothing; add login ships stale assets that import a removed providers export (compile break, now *active* because authMode:none actually deletes the imported files post-302cbf1).
- **Prod secret printing**: auto-registered ConsoleSender reports ok:true and console.logs live reset/email-change tokens in prod.

The packaging north star — "a stranger installs and configures without forking" — still fails on the first-run path (Windows spawnSync EINVAL is confirmed live) and on the documented-but-nonexistent security guarantees. None of these is a redesign; most are days. Fix the **Top live findings** table, re-run the affected area audits, then ship.

---

## 2. Counts by area (verified)

| Area | Confirmed | Already-fixed | Partially-fixed | Refuted | Uncertain | Merged |
|---|---:|---:|---:|---:|---:|---:|
| api | 11 | 0 | 1 | 0 | 0 | 13 |
| sync | 20 | 2 | 1 | 0 | 1 | 24 |
| login | 25 | 2 | 1 | 1 | 1 | 30 |
| core | 40 | 0 | 0 | 0 | 0 | 40 |
| server | 26 | 0 | 0 | 1 | 0 | 27 |
| router | 11 | 0 | 0 | 1 | 0 | 12 |
| presence | 16 | 0 | 1 | 3 | 0 | 22 |
| email | 15 | 2 | 1 | 1 | 0 | 23 |
| error-tracking | 17 | 0 | 2 | 2 | 1 | 26 |
| secret-manager | 15 | 0 | 1 | 0 | 0 | 17 |
| test-runner | 27 | 0 | 1 | 0 | 0 | 9 |
| mcp | 16 | 0 | 0 | 0 | 0 | 16 |
| docs-ui | 21 | 0 | 0 | 0 | 0 | 21 |
| devkit | 24 | 1 | 0 | 0 | 0 | 26 |
| cli | 24 | 0 | 0 | 0 | 0 | 24 |
| create-app-template | 32 | 2 | 1 | 0 | 5 | 40 |
| create-app-wizard | 20 | 3 | 1 | 0 | 1 | 27 |
| extensibility | 22 | 0 | 0 | 1 | 0 | 24 |
| docs-coverage | 20 | 0 | 1 | 1 | 0 | 22 |
| repo-src-tooling | 22 | 3 | 1 | 2 | 3 | 6 |
| **GRAND TOTAL** | **424** | **15** | **13** | **13** | **12** | **477** |

> The per-status columns sum to the status-tagged verdicts the verifiers issued (a single finding can pick up a verdict in more than one area where the two scans split it). "Merged" is the deduplicated finding count the area writer carried; for a few areas (test-runner, repo-src-tooling, presence) the verifier issued more status verdicts than the merged-finding count because one merged finding bundled multiple sub-claims, each separately adjudicated.

**Headline:** 424 verified-live findings, 15 already fixed by current code, 13 partially fixed, 13 refuted, 12 uncertain.

---

## 3. Top live findings — fix before publishing

All CONFIRMED / PARTIALLY-FIXED high+critical findings, ordered by severity then area. These are the ship-blockers.

| Severity | Area | ID | Finding | Status |
|---|---|---|---|---|
| **CRIT** | docs-ui | DUI-01 | Renderer JSON-shape mismatch: expects nested object, devkit emits arrays (feature dead on arrival) | CONFIRMED |
| High | core / api / sync | CORE-01 / F1 | Runtime input validation is a no-op in production (docs claim otherwise) | CONFIRMED |
| High | core | CORE-02 | apiRequest per-route abort singleton aborts unrelated concurrent calls | CONFIRMED |
| High | core | CORE-03 | apiRequest internal abort REJECTS while every other path resolves | CONFIRMED |
| High | core | CORE-04 | trustProxy defaults false: per-IP rate-limit buckets collapse behind a proxy | CONFIRMED |
| High | core | CORE-05 | Rate limiter fails OPEN to per-instance memory on Redis error | CONFIRMED |
| High | api | F2 | Per-route rate limit keyed on unvalidated raw token (anonymous bypass) | CONFIRMED |
| High | api | F3 | Raw session token leaked into rateLimitExceeded hook payload + dev log | CONFIRMED |
| High | api | F6 | Blanket eslint-disable on socket API handler hides casts/assertions | CONFIRMED |
| High | sync | SYNC-01 | Client-only sync routes (no _server) bypass auth + input validation entirely | CONFIRMED |
| High | sync | SYNC-02 | Socket sync path has no top-level error guard; validateRequest(user!) crashes (remote DoS) | CONFIRMED |
| High | sync | SYNC-03 | Per-recipient _client filter leaks full serverOutput; docs teach it as field-hiding | CONFIRMED |
| High | sync | SYNC-04 | Sync echoes raw input-validation messages to clients (schema enumeration) | CONFIRMED |
| High | sync | SYNC-11 | No per-route rate limit for sync routes (all share global defaultApiLimit) | CONFIRMED |
| High | server | SEC-10 | socket.join(token) before session validation: forged token subscribes to any room | CONFIRMED |
| High | server | SEC-09 | No top-level error guard in HTTP pipeline (single-request unhandledRejection DoS) | CONFIRMED |
| High | server | QUA-009 | Bootstrap empty catch swallows optional-package /register failures | CONFIRMED |
| High | server | QUA-016 | Overlay loader dynamic-imports consumer .ts at runtime; broken/silently skipped in prod | CONFIRMED |
| High | login | F1 (H1/SEC-18) | OAuth state not bound to initiating browser: login CSRF / session fixation | CONFIRMED |
| High | login | F2 (H3) | session.onConflict rejectNew enforced nowhere (documented cap is a no-op) | CONFIRMED |
| High | login | F6 (M5/SEC-06) | Sliding session refresh never re-tracks activeUsers: revocation misses long-lived sessions | CONFIRMED |
| High | login | F20 (MIS-002) | No email-verification flow for credentials registration (squatting: reset poisoning) | CONFIRMED |
| High | presence | QUA-039 | userBack broadcast not gated by socketActivityBroadcaster; fires when disabled | CONFIRMED |
| High | presence | SEC-07 | Grace-expiry teardown deletes shared session while another tab socket is live | CONFIRMED |
| High | presence | MIS-003 | No userLeft/offline peer event on hard disconnect or grace expiry | CONFIRMED |
| High | email | F1 | preEmailSend stop-signal dispatched but never honored (suppression/rate-limit no-op) | CONFIRMED |
| High | email | F2 | EmailMessage supports neither attachments nor custom headers (contract dead-end) | CONFIRMED |
| High | email | F3 | Auto-registered ConsoleSender in prod reports ok:true + logs live tokens | CONFIRMED |
| High | error-tracking | ET-02 | PostHog adapter identity is a single mutable currentDistinctId (concurrent cross-attribution) | CONFIRMED |
| High | error-tracking | ET-05 | Async PostHog auto-registration races + clobbers a consumer overlay (replace-not-append) | CONFIRMED |
| High | test-runner | HOK-03 | Extension registry never invoked by any runner; webhook doc-comment is false | CONFIRMED |
| High | test-runner | H1/SEC-45 | Layer-5 ctx.session.login() mints non-CSPRNG test-* sessions into real store, no cleanup | CONFIRMED |
| High | test-runner | QUA-014 | Template testAll.ts drifted: missing ../config import + TEST_OUTPUT_FILE writer | PARTIALLY-FIXED |
| High | docs-ui | DUI-02 | Try-it-out runner posts to wrong URL (missing /api/ prefix) | CONFIRMED |
| High | docs-ui | DUI-03 | Try-it-out sends no CSRF token; cookie-mode rejects every POST | CONFIRMED |
| High | docs-ui | DUI-04 | Auto-registered mountDocsUi() shadows consumer customization at /_docs | CONFIRMED |
| High | devkit | DK-01 | Generated-type builtin allow-list hard-aborts on common globals (Uint8Array/URL/Buffer) | CONFIRMED |
| High | devkit | DK-05 | Missing auth export is fail-open at runtime while AST extractor defaults fail-closed | CONFIRMED |
| High | extensibility | EXT-01 | No server start/stop lifecycle hooks or stop() for graceful shutdown | CONFIRMED |
| High | extensibility | EXT-02 | Socket-message handlers bypass any per-message interception seam (no preSocketMessage) | CONFIRMED |
| High | extensibility | EXT-03 | No client-side request interceptor/retry/header-injection seam on apiRequest | CONFIRMED |
| High | extensibility | EXT-04 | No validate/execute lifecycle hooks for sync; failed _server executions invisible | CONFIRMED |
| High | cli | HB1/QUA-003 | Stale LoginForm asset imports removed providers config export (compile-breaking drift) | CONFIRMED |
| High | cli | HB2/MIS-005 | add login copies _api handlers importing files the authMode:none pruner deletes | CONFIRMED |
| High | create-app-template | H1 | settings/listSessions returns raw session tokens of ALL devices to browser JS | CONFIRMED |
| High | create-app-template | H2 | system/session returns full session object incl. token to the client | CONFIRMED |
| High | create-app-template | Hard-1 | npm run prod cannot work: nothing builds dist/server.js | CONFIRMED |
| High | create-app-template | Hard-2 | scaffold:page emits template=dashboard absent from the union: render crash | CONFIRMED |
| High | template / wizard | QUA-004 / F-01 | npm install / prisma generate fail on Windows (spawnSync .cmd + shell:false: EINVAL) | CONFIRMED |
| High | create-app-template | QUA-006 | Consumer-shipped CLAUDE.md is a verbatim framework copy (references absent scaffold surfaces) | CONFIRMED |
| High | create-app-template | QUA-014 | Template scripts drifted: scaffoldRouteTest rejects shipped root routes; testAll.ts missing config import | CONFIRMED |
| High | create-app-wizard | F-02 | Next-steps banner tells SQL users to run a nonexistent prisma:migrate:dev script | CONFIRMED |
| High | repo-src-tooling | SEC-14 | system/session returns raw session token + csrfToken to client JS | CONFIRMED |
| High | docs-coverage | H1 | registerSessionProvider (the 0.2.0 session-decoupling seam) documented nowhere consumer-facing | CONFIRMED |
| High | docs-coverage | QUA-006 | Consumer-shipped framework-docs CLAUDE.md mandates nonexistent npm run ai:index, lists absent components | CONFIRMED |

---

## 4. Resolved since the scans

These are findings the **older review/v0.2.0 scan** (and in two cases the reports/ scan) reported as live, but current code already fixes. This directly answers the premise that the big unverified scan missed code changes — it was run before commit 302cbf1 and several working-tree edits.

| Area | Now fixed | What the scan claimed | What current code does |
|---|---|---|---|
| api | partially | QUA-002 blanket eslint-disable + QUA-018 unannotated cast on **both** transports | HTTP handler (handleHttpApiRequest.ts) converted to narrow per-line disables + annotated formatter-boundary cast; only the socket handler still has the blanket form |
| sync | yes | QUA-044 RuntimeSyncServerEntry.validation ignored; QUA-013 dev loader drops validation/errorFormatter | Honored via new resolveSyncValidationMode helper in both transports; devkit/loader.ts fixed — both carry in-code comments citing the finding IDs |
| login | yes | CFG-04 unified account strategy silently dead; CFG-05 reset/email-change copy bypasses template registry | accountStrategy.ts now implements unified lookup; flows dispatch through @luckystack/email built-in password-reset/email-change templates |
| email | yes (2) | CFG-05 framework reset/email-change copy bypasses registerEmailTemplate; QUA-067 built-in password-reset fallback missing | login/forgotPassword.ts dispatches via template:password-reset; sendEmail.ts resolves getBuiltInEmailTemplate; builtInTemplates.ts implements both. Review even cites a stale path (senders/console.ts, now adapters/console.ts) |
| error-tracking | refuted + downgraded | SEC-05 adapter beforeSend redaction-by-return is a no-op; QUA-012 adapter spans wholly broken | runBeforeSend.ts rewritten so all three adapters forward the resolved/transformed payload (refutes SEC-05); legacy Sentry path wires a real startInactiveSpan (span finding: partially-fixed) |
| presence | yes | AFK event emits io.to(room).emit({ token }) with recipientCount:-1 sentinel; one cross-instance path | afkEvent.ts refactored to route through informRoomPeers emitting { userId, endTime } with real counts; token-broadcast leak gone, all three framework broadcasts now local-only. Only shipped docs still describe old behavior (QUA-041) |
| devkit | yes | QUA-013 sync dev/prod divergence (loader drops errorFormatter/validation) | loader.ts forwards errorFormatter + validation at all four sync/api assignment sites, with explicit QUA-013/QUA-044 comments |
| create-app-template | yes (2) + partial | CFG-01 no non-interactive flags (locked to Mongo+credentials); QUA-061 --ai-browser ignored; QUA-005 wizard answers discarded | Full --db/--auth/--oauth/--email/--monitoring/--i18n/--ai-docs flag set pre-seeds + skips wizard steps (CFG-01, QUA-061 fixed); authMode/i18n honored via editScaffoldFile/pruneOptionalPackages (QUA-005 partial — only named template-variable placeholders remain cosmetically dead) |
| create-app-wizard | yes (3) + partial | CFG-01 no non-interactive flags; QUA-005 wizard choices silently discarded | Every wizard choice has a matching CLI flag that pre-fills its step; authMode=none/i18n-off now drive real pruneOptionalPackages edits |
| repo-src-tooling | yes (2) | listSessions/revokeSession raw-token leak; workspaces host-shell PTY RCE (SEC-31) | SHA-256 fingerprints replaced raw tokens; PTY hook deleted when the workspaces prototype moved to workspaces-handoff/. Review also cites a wrong path src/_functions/socketInitializer.ts (real: src/_sockets/socketInitializer.ts) |
| docs-coverage | partial | D9 create-app flag drift | create-luckystack-app/CLAUDE.md added --no-presence + --ai-browser; --i18n/--ai-docs still undocumented |

Areas where **nothing** was fixed (every merged finding verifies live): **core, server, router (code), secret-manager, test-runner, mcp, docs-ui, cli, extensibility**. Commit 302cbf1 touched login page + wizard/CLI only.

---

## 5. Scan disagreements resolved

Where reports/ and review/v0.2.0 conflicted, or where one hedged, here is the verified verdict.

| Topic | reports/ said | review/ said | **Verified verdict** |
|---|---|---|---|
| docs-ui renderer shape mismatch | hedged: likely mis-parses the real artifact | **Critical** dead-on-arrival | **CONFIRMED CRITICAL** — renderer expects a nested object, devkit emits arrays; the feature cannot render at all |
| router X-Forwarded-For spoofing | **REFUTED** (inert under default trustProxy:false + documented edge-proxy topology) | **High** (IP spoof + rate-limit bypass), unverified | **REFUTED as High** — backend trustProxy defaults false so XFF is ignored; router is a documented internal hop behind a TLS-terminating edge proxy: operator-gated config tradeoff, not a high vuln |
| GitHub unverified-email OAuth takeover | **REFUTED** — primary-email selection blocks it | (not separately raised) | **REFUTED** — primary-email selection blocks the takeover path |
| email header injection | **REFUTED** — nodemailer is injection-safe | listed among real issues but not headlined | **REFUTED** — nodemailer sanitizes headers |
| error-tracking adapter beforeSend redaction | (not a headline) | **High** — transformed event silently discarded | **REFUTED** — runBeforeSend.ts was rewritten to forward the transformed payload (resolved since scan) |
| extensibility: sync post-authorize observability | (n/a) | implied sync lacks post-authorize hook | **Imprecise** — postSyncAuthorize exists in core types; the genuine gap is missing validate/execute-stage + error-path hooks (captured in EXT-04) |
| server CSRF doc drift (QUA-082) | (n/a) | doc drift flagged as defect | **Inverted** — code is AHEAD of the doc: csrfMiddleware already has the credentials-bootstrap exemption + login-absent double-submit branch the doc omits; it is a doc bug, not a code bug |

---

## 6. How to read this folder

- **Per-area verified detail** lives in audit-v0.2.0-merged/areas/*.md — one file per package/area, each finding tagged CONFIRMED / ALREADY-FIXED / PARTIALLY-FIXED / REFUTED / UNCERTAIN with the live file/line and which scan(s) sourced it.
- **This file** (SUMMARY.md) is the top-level synthesis: the publish verdict, cross-area counts, the ship-blocker list (section 3), what is already fixed (section 4), and resolved scan conflicts (section 5).
- **COMPLETENESS.md** cross-checks that every area + top finding named in reports/000-SUMMARY.md and review/v0.2.0/SUMMARY.md is accounted for in the merged output — the honesty check on coverage.
- **Originals** are preserved: reports/ (verified scan) and review/v0.2.0/ (5-axis unverified scan). When a number here disagrees with an original, **this folder wins** — it is reconciled against the current tree.
