# test-runner — Verified & Merged Audit Findings
Sources: reports/test-runner.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary

The reports/ scan (which already carried an adversarial verification pass) is overwhelmingly accurate against the current tree — almost nothing in the test-runner package changed since either scan ran, so its CONFIRMED verdicts hold. Of the merged findings: 0 critical, several genuine highs/mediums CONFIRMED, a handful of doc/drift items CONFIRMED, and 2 items the review/ scan partially over-stated (severity or mechanism) that I down-graded. Nothing in this area was ALREADY-FIXED by commit 302cbf1 (that commit touched the login page + wizard/CLI flow, not test-runner). The biggest live issues are the same three the reports/ scan led with: (1) the entire extension registry (`registerTestLayer`/`registerTestFixture`/`registerTestReporter` + webhook) is a documented façade never wired into any runner (HOK-03 — High), (2) Layer-5 `ctx.session.login()` mints non-CSPRNG `test-*` session tokens into the real session store with no run-end cleanup (H1/SEC-45 — High in reports, Low in review; the truth is in between), and (3) two advertised security checks silently test nothing — the `__proto__` fuzz payload serializes to `{}` (M3/QUA-048) and the auth layer only probes the absent-credential path, never an invalid/expired token (M4) and never asserts the HTTP status (SEC-46). The published README + CLAUDE.md still carry stale peer-deps and a phantom `getApiMethodMapPath()` API, and CLAUDE.md/README describe `/_test/reset` as weaker than the (correct, fail-closed) server enforces. One notable disagreement resolved from code: review/QUA-049 claims `runAllTests`'s `filter` is applied "post-hoc so filtered-out endpoints are still hit/drained" — CONFIRMED, this is a real waste + masks failures.

## Findings

### H1 / SEC-45 — Layer-5 `ctx.session.login()` mints weak-entropy, never-cleaned real sessions · severity: high (reports) / low (review) → resolved: med-high · status: CONFIRMED
- **Sources:** both (reports H1 + review SEC-45)
- **Current location:** `packages/test-runner/src/customTests.ts:232-235` (token mint), `:243` (`saveSession`), `:408-441` / `:418` (per-case teardown closes watchers only — no `logout`/`deleteSession`).
- **Original claim:** Token is `test-${Date.now()}-${Math.random().toString(36).slice(2,10)}` (non-CSPRNG, known prefix, guessable timestamp), persisted via `saveSession` into the same Redis the live server reads; `runCustomTests` never deletes it, so valid sessions linger after the run.
- **Verification (current code):** All three mechanics verified verbatim in the current file. `:235` builds the token exactly as claimed; `:243 await saveSession(token, sessionData, true)` writes a real, `getSession`-readable session (`:248`); the only teardown is `await tryCatch(() => built.closeAllWatchers())` at `:418` — no logout. Cleanup happens only if the test author explicitly calls `ctx.session.logout()` (`:252-259`).
- **Verdict & why:** CONFIRMED. The two scans disagree on severity: reports says High, review says Low. The truth is in the middle. Tempering facts (both scans note them): the helper is opt-in per Layer-5 author (the auto-sweep never calls it); sessions are TTL-bounded so "never deleted" = "no active cleanup", not unbounded; and practical guessability is overstated (the V8 `Math.random` state-recovery attack needs observed prior outputs a remote attacker can't see, leaving ~41 PRNG bits + an unknown-ms `Date.now`). But the defect is genuine: a non-CSPRNG token in the real session store with no run-end cleanup, on exactly the network-reachable staging the `TEST_RESET_TOKEN` docs anticipate. Call it medium-high.
- **Recommendation:** Use `crypto.randomUUID()` / `crypto.randomBytes(24).toString('base64url')` for the token; track every token minted in a run and `deleteSession` them in a `finally` step of `runCustomTests` (mirror the `closeAllWatchers` auto-close pattern).

### HOK-03 / Hooks#1 — Extension registry (layers/fixtures/reporter/webhook) is never invoked by any runner · severity: high · status: CONFIRMED
- **Sources:** both (reports Hooks#1 + review HOK-03)
- **Current location:** `packages/test-runner/src/extensionRegistry.ts:85,99,111` (read slots), `:104-105` (false webhook doc-comment); consumers grep: only `index.ts:54-58` re-exports + `extensionRegistry.test.ts`.
- **Original claim:** `registerTestLayer`/`registerTestFixture`/`registerTestReporter` are write/read-only; `runAllTests`, `runFuzzCheck` and the sweeps never call `listTestLayers()`/`getTestFixture()`/`getTestReporter()`; nothing POSTs to `webhookUrl` despite the doc-comment claiming it does.
- **Verification (current code):** Grep for `listTestLayers|getTestFixture|getTestReporter|webhookUrl` across `src/` returns only the `index.ts` re-exports, the registry's own definitions, and the unit test — zero call sites in any runner. `fuzzCheck.ts` reads `JUNK_PAYLOADS` (a module const), never a fixture. `extensionRegistry.ts:104-105` still asserts "When `webhookUrl` is set, the runner additionally POSTs the JSON-serialised summary to that URL" — nothing does.
- **Verdict & why:** CONFIRMED. Both scans agree on High. The worst failure mode: a consumer who registers a layer/reporter at boot and runs `npm run test` gets a silent no-op while believing extra coverage ran. CLAUDE.md "Config keys" section advertises all three `register*` slots + webhook as working.
- **Recommendation:** For 0.2.0 either wire it (after the built-in layers, iterate `walkEndpoints × listTestLayers()`, feed results to `getTestReporter()?.onResult/onSummary`, tryCatch-POST to `reporter.webhookUrl` with `webhookAuth`), or ship a documented `runRegisteredLayers(...)` entry point — and correct the `extensionRegistry.ts:104-105` webhook doc-comment + CLAUDE.md/ARCHITECTURE_TESTING.md so they stop overstating.

### M3 / QUA-048 — Prototype-pollution fuzz payload is a no-op (`{ __proto__: {...} }` serializes to `{}`) · severity: medium · status: CONFIRMED
- **Sources:** both (reports M3 + review QUA-048)
- **Current location:** `packages/test-runner/src/fuzzCheck.ts:18` (`{ __proto__: { polluted: true } }`), serialized at `:43` (`JSON.stringify(body)`).
- **Original claim:** In an object literal `__proto__:` is the Annex-B prototype setter, not an own property, so `JSON.stringify({ __proto__: { polluted: true } })` === `"{}"` — the one security-relevant fuzz payload never reaches the wire; docs/fuzz-tests.md advertises it as a working pollution check.
- **Verification (current code):** `fuzzCheck.ts:18` still uses the bare object-literal form; `:43` serializes the body via `JSON.stringify(body)`. The serialization claim is standard JS behavior (object-literal `__proto__` sets the prototype, producing an empty own-property set). Confirmed no-op.
- **Verdict & why:** CONFIRMED. Both scans agree on Medium. False security confidence — endpoints reported "fuzzed against __proto__ injection" were sent `{}`.
- **Recommendation:** Build the payload so the key survives serialization: `JSON.parse('{"__proto__":{"polluted":true}}')` or a pre-serialized raw body string; add a `{"constructor":{"prototype":{...}}}` variant; add a unit test asserting the serialized body contains `"__proto__"`; fix docs/fuzz-tests.md.

### M4 — Auth-enforcement layer only tests the absent-credential path; invalid/expired tokens never probed · severity: medium · status: CONFIRMED
- **Sources:** reports (M4)
- **Current location:** `packages/test-runner/src/authEnforcementCheck.ts:35-42` (single probe, no cookie/header) — one probe per endpoint.
- **Original claim:** Only one probe is sent (no session). A guard that checks cookie *presence* not validity, or mishandles a malformed/expired token (e.g. Redis miss treated as anonymous-but-allowed), passes green; the layer's framing ("a failure here is a security finding") overstates the guarantee.
- **Verification (current code):** Confirmed — `runAuthEnforcementCheck` sends exactly one `fetch` with `headers: { 'Content-Type', 'Origin' }` and no Cookie (`:39`). There is no second probe with a syntactically-valid-but-nonexistent token.
- **Verdict & why:** CONFIRMED. Real coverage gap, correctly scoped Medium. (Distinct from SEC-46 below, which is about the missing HTTP-status assertion.)
- **Recommendation:** Add a second probe per endpoint with `Cookie: <name>=garbage-<random>` expecting the same `auth.required` rejection.

### SEC-46 — Auth-enforcement layer asserts only the `errorCode` string, never the HTTP status code · severity: low · status: CONFIRMED
- **Sources:** review (SEC-46)
- **Current location:** `packages/test-runner/src/authEnforcementCheck.ts:92-111` — `response.status` is recorded in the result (`httpStatus`) but never asserted; the pass condition is solely `parsed.errorCode === 'auth.required'`.
- **Original claim:** README:45 promises the layer verifies "the framework's standard 401 shape", but an endpoint returning HTTP 200 with an `auth.required` body would pass; intermediaries/caches treat 200 vs 401 differently.
- **Verification (current code):** Confirmed — the only `status`-related checks are `parsed?.status === 'success'` (fail) / `!== 'error'` (fail) / `errorCode !== EXPECTED_ERROR_CODE` (fail). `response.status` is captured as `httpStatus` but never compared to 401 anywhere.
- **Verdict & why:** CONFIRMED, Low — the guard still proves the request was blocked; only the status-code half of the documented contract is unverified.
- **Recommendation:** Add `if (response.status !== 401) return fail(...)`, optionally behind an `expectedHttpStatus?: number` input for consumers with a custom `registerErrorFormatter`.

### QUA-049 — `runAllTests` applies `filter` post-hoc: filtered-out endpoints are still hit (incl. rate-limit drains) · severity: medium · status: CONFIRMED
- **Sources:** review (QUA-049)
- **Current location:** `packages/test-runner/src/runAllTests.ts:79-118` (sweeps run with no filter) + `:62-68,87,96,107,117` (`cloneSummary`/`filterResults` only drop results afterwards). Contrast `customTests.ts:387` which filters pre-run.
- **Original claim:** `TEST_FILTER=login/sendReset` still fires contract+auth+fuzz at EVERY endpoint and drains every endpoint's rate-limit bucket, then hides non-matching results — slow, state-mutating, and any failure on a non-matching endpoint is silently dropped from `totalFailed`/exit code.
- **Verification (current code):** Confirmed. Each sweep (`runContractTests`, `runAuthEnforcementTests`, `runRateLimitTests`, `runFuzzTests`) is called with the full `apiMethodMap` and no filter; `cloneSummary(x, input.filter)` runs `calculateSummary(filterResults(...))` purely on the returned results. `totalPassed`/`totalFailed` are summed from the FILTERED summaries (`:143-152`), so failures on non-matching endpoints are indeed dropped from the exit code. Only `runCustomTests` receives `filter` and applies it pre-run (`customTests.ts:387`).
- **Verdict & why:** CONFIRMED, Medium. The focused-debug knob the docs advertise actually hammers the whole API, drains every rate-limit bucket, and can mask real failures on non-matching routes. reports/ did not separately call this out, so review/ adds genuine value here.
- **Recommendation:** Apply the filter pre-run — pass a predicate into each sweep or pre-filter `walkEndpoints` output via a shared `filterEndpoints` in `testLayerHelpers.ts`; keep `cloneSummary` only as a safety net.

### M1 — No production/remote-target guard anywhere in the runner · severity: medium · status: CONFIRMED
- **Sources:** reports (M1)
- **Current location:** `packages/test-runner/src/runAllTests.ts:70-155` + `:127-131` (`clearAllRateLimits()` in-process); consumer scripts default to `http://localhost:80` (`scripts/testAll.ts:28`, template `testAll.ts:20`) but accept any `TEST_BASE_URL`; `customTests.ts:336` hands every case a raw `getPrismaClient()`.
- **Original claim:** The full destructive sweep will run against any URL — no localhost check, no `--allow-remote`, no NODE_ENV refusal; `clearAllRateLimits()` runs in-process against whatever Redis is loaded; Layer-5 cases get write access to whatever `DATABASE_URL` is set.
- **Verification (current code):** Confirmed — `runAllTests` does no URL/NODE_ENV validation; `:128 await clearAllRateLimits()` runs unconditionally in-process before the custom layer; `customTests.ts:336 const prisma = getPrismaClient()` is exposed per case. CLAUDE.md only warns in prose ("Wanneer de target server productie is — ... `/_test/reset` is daar uit").
- **Verdict & why:** CONFIRMED, Medium. Operational footgun rather than remote exploit: one mis-set `TEST_BASE_URL`/`.env` drains live limiter counters (which can un-throttle an attacker), runs fuzz traffic, and gives test code production DB write access.
- **Recommendation:** Refuse a non-loopback `baseUrl` (and the in-process Redis/DB side effects) unless an explicit `allowRemoteTarget: true` / `TEST_ALLOW_REMOTE=1` opt-in is set.

### M2 — Authenticated sweep executes real mutations with the operator's session · severity: medium · status: CONFIRMED
- **Sources:** reports (M2)
- **Current location:** `runAllTests.ts:73-76` (turns `authToken` into a `Cookie` header passed to contract + rate-limit layers), `contractCheck.ts` (sends Zod-valid input with `method: endpoint.method`), `rateLimitCheck.ts:52-56` (fires each call `rateLimit + 1` times).
- **Original claim:** Once `TEST_AUTH_TOKEN` is set, the contract layer sends Zod-valid input to every endpoint with its real declared method — including DELETE/PUT — and rate-limit fires each N+1 times; no read-only filter, no dry-run, only a manual `skip` list. With a real user's token the sweep can delete/update real data N+1 times per mutating endpoint.
- **Verification (current code):** Confirmed — `runAllTests.ts:73-76` builds `headers.Cookie` from `authToken` and passes `headers` to `runContractTests` (`:84`) and `runRateLimitTests` (`:104`). `rateLimitCheck.ts:52-54` loops `rateLimit` sends + 1 final, all with `endpoint.method`. No method filter exists. The rate-limit layer's own comment (`runRateLimitTests.ts:40-44`) documents the hazard for the auto-auth case but the manual-token path has no guard.
- **Verdict & why:** CONFIRMED, Medium. Same root family as M1; the explicit-token path is the documented way to cover login-gated routes, so the destructive mutation risk is on the supported path.
- **Recommendation:** Add a `readOnlySweep`/`mutatingMethods` option (default: record DELETE/PUT as `skipped`) plus a documented dedicated-test-account requirement.

### CFG-24 / Config#1 — `requestTimeoutMs` is dead config at the sweep level · severity: medium · status: CONFIRMED
- **Sources:** both (reports Config#1 + review CFG-24)
- **Current location:** Each check accepts `requestTimeoutMs` (`contractCheck`, `authEnforcementCheck.ts:15`, `fuzzCheck.ts:27`, `rateLimitCheck.ts:14`) but the sweep runners (`runContractTests`, `runAuthEnforcementTests`, `runFuzzTests`, `runRateLimitTests`) and `RunAllTestsInput` (`runAllTests.ts:21-39`) have no `requestTimeoutMs` field and never forward it.
- **Original claim:** Slow endpoints (AI calls — named in contractCheck's docstring) false-fail the whole sweep with no recourse because the timeout can't be threaded through `runAllTests`.
- **Verification (current code):** Confirmed — `RunAllTestsInput` (`:21-39`) lists no timeout field; `RunRateLimitTestsInput`/`RunFuzzTestsInput` likewise. The per-check defaults (5000ms, rate-limit 10_000ms) are the only reachable values from `npm run test`.
- **Verdict & why:** CONFIRMED, Medium. Both scans agree.
- **Recommendation:** Add `requestTimeoutMs?` (or `timeoutFor?: (endpoint) => number`) to all four `Run*TestsInput` types + `RunAllTestsInput`, thread to the checks, expose `TEST_REQUEST_TIMEOUT_MS` in `testAll.ts`.

### CFG-25 / L2(part) — `resetServerState` hardcodes `/_test/reset` while the server path is configurable · severity: medium · status: CONFIRMED
- **Sources:** both (reports L2 partial + review CFG-25)
- **Current location:** `packages/test-runner/src/resetServerState.ts:18` (`` `${baseUrl}/_test/reset` `` literal); server resolves from `getProjectConfig().http.testResetEndpoint` (`testResetRoute.ts:12`).
- **Original claim:** A consumer who customizes `projectConfig.http.testResetEndpoint` gets a runner that POSTs to a 404, and because the boolean return is ignored at `runRateLimitTests.ts:89`, `resetBetweenEndpoints` silently no-ops.
- **Verification (current code):** Confirmed — `resetServerState.ts:18` is a string literal; `testResetRoute.ts:12 if (routePath !== getProjectConfig().http.testResetEndpoint) return false`. `runRateLimitTests.ts:88-89` calls `await resetServerState(...)` and discards the boolean.
- **Verdict & why:** CONFIRMED, Medium. Two sides of a config knob drifted; the ignored return value compounds it into a silent failure.
- **Recommendation:** Read the path from `getProjectConfig().http.testResetEndpoint` (core is already a dep; `customTests.ts` already uses `getProjectConfig`), with an optional `path?` override on `ResetServerStateInput`; surface a skipped/warning result when `resetServerState` returns `false`.

### CFG-26 / Config#2 — `runAllTests` does not expose the rate-limit layer's documented knobs · severity: medium · status: CONFIRMED
- **Sources:** both (reports Config#2 + review CFG-26)
- **Current location:** `runAllTests.ts:98-106` (calls `runRateLimitTests` with only map/baseUrl/skip/headers/inputFor); `RunAllTestsInput` (`:21-39`) lacks `maxRateLimitToTest`/`resetBetweenEndpoints`/`resetToken`; the knobs exist on `RunRateLimitTestsInput:18-30` and CLAUDE.md advertises them.
- **Original claim:** `npm run test` pins `maxRateLimitToTest=50` and never resets between endpoints; a consumer with `rateLimit: 100` routes sees them skipped with no opt-in short of a custom orchestration script.
- **Verification (current code):** Confirmed — `RunAllTestsInput` has no such fields; the `runRateLimitTests` call passes only the five listed args. `runRateLimitTests.ts:39` defaults `maxRateLimit = 50`.
- **Verdict & why:** CONFIRMED, Medium. Both scans agree.
- **Recommendation:** Add `maxRateLimitToTest?`/`resetBetweenEndpoints?`/`resetToken?` to `RunAllTestsInput`, forward to `runRateLimitTests`, expose `TEST_MAX_RATE_LIMIT`/`TEST_RESET_BETWEEN`/`TEST_RESET_TOKEN` env vars in `testAll.ts` + template copies.

### QUA-050 — `resetBetweenEndpoints` wipes sessions, breaking the authenticated rate-limit sweep it supports · severity: medium · status: CONFIRMED
- **Sources:** review (QUA-050)
- **Current location:** `runRateLimitTests.ts:45` (`isAuthenticatedSweep = Boolean(input.headers?.Cookie)`), `:88-89` (`resetServerState` per endpoint); server `testResetRoute.ts:41-64` deletes ALL `-session:*` keys.
- **Original claim:** With `resetBetweenEndpoints: true`, `/_test/reset` deletes the session backing the sweep's own Cookie, so from the second endpoint on every drain + N+1 probe returns `auth.required` instead of `api.rateLimitExceeded`. The two documented knobs are mutually destructive with no warning.
- **Verification (current code):** Confirmed against both files. `testResetRoute.ts:41` builds `sessionPattern = `${formatKey('-session','')}:*`` and `scanAndDelete`s it unconditionally (`:63`) — including the sweep's own session. `runRateLimitTests.ts:88` resets before each endpoint when the flag is set, after `isAuthenticatedSweep` was computed once up front.
- **Verdict & why:** CONFIRMED, Medium. A real false-failure trap on exactly the config combination (authenticated + reset-between) the docs recommend for authenticated rate-limit testing. Note this is currently only reachable via direct `runRateLimitTests` calls since `runAllTests` doesn't expose `resetBetweenEndpoints` (CFG-26) — fixing CFG-26 without fixing this would surface the bug to `npm run test` users.
- **Recommendation:** Re-mint/re-save the session after each reset (a `reauthenticate?: () => Promise<string>` callback), or make `/_test/reset` support scoped clears (`?include=rateLimits` only); at minimum document the incompatibility in rate-limit-tests.md + CLAUDE.md.

### CFG-42 / Config#4 — `streamWatcher` connect/join-ack timeouts (3000ms) hardcoded · severity: low · status: CONFIRMED
- **Sources:** both (reports Config#4 + review CFG-42)
- **Current location:** `packages/test-runner/src/streamWatcher.ts:65-66` (`JOIN_RESPONSE_TIMEOUT_MS = 3000`, `CONNECT_TIMEOUT_MS = 3000`); `defaultTimeoutMs` (`:61`) only governs `stopAt`/`waitForCount`.
- **Original claim:** On slow CI / WAN staging, socket connect can exceed 3s, making every `watchStream`-based test flake with no override.
- **Verification (current code):** Confirmed — both are module constants; `OpenStreamWatcherInput.defaultTimeoutMs` is documented (`:60`) as covering only `stopAt`/`waitForCount`.
- **Verdict & why:** CONFIRMED, Low. Both scans agree.
- **Recommendation:** Add `connectTimeoutMs?`/`joinAckTimeoutMs?` to `OpenStreamWatcherInput` (default 3000) and let `TestContext.watchStream` inherit them from a `RunCustomTestsInput`-level setting.

### QUA-051 / Docs#2 — README + CLAUDE.md peer-dep and feature claims stale · severity: medium · status: CONFIRMED
- **Sources:** both (reports Docs#2 "getApiMethodMapPath fiction" + review QUA-051)
- **Current location:** `README.md:3,8,54,79` and `CLAUDE.md` Peer-dependencies section; truth in `package.json:58-61`.
- **Original claim:** README says peer `zod@^3.25.0` (actual `^4.0.0`), omits the required `socket.io-client@^4.8.0` peer and optional `@luckystack/login` peer, says "four layers" (five ship), and references a nonexistent `getApiMethodMapPath()` from core (`@luckystack/core@^0.1.0` vs actual `^0.2.0`).
- **Verification (current code):** Confirmed point-by-point. `package.json:58-61` declares `zod@^4.0.0`, `socket.io-client@^4.8.0`, optional `@luckystack/login@^0.2.0`, dep `@luckystack/core@^0.2.0`. `README.md:3,13` say "four progressive test layers"; `:8` install omits socket.io-client; `:54` "Defaults are read via `getApiMethodMapPath()` from `@luckystack/core`" — grep confirms no such export exists. `README.md:79` peer table lists only `zod@^3.25.0`. CLAUDE.md Peer section repeats `@luckystack/core@^0.1.0` + the phantom `getApiMethodMapPath()`.
- **Verdict & why:** CONFIRMED, Medium. This is the published-package README for 0.2.0 — a stranger following it gets unmet peers + chases a phantom API. reports/ flagged the getApiMethodMapPath fiction separately (Docs#2) and the zod/socket.io-client/login gaps under Docs#5; review/QUA-051 merges them — same root cause.
- **Recommendation:** Sweep README.md + CLAUDE.md before publish: zod ^4.0.0, add socket.io-client (+ optional @luckystack/login) to Install + peer table, "five layers", delete both getApiMethodMapPath references, core ^0.2.0.

### QUA-052 / Docs#1 — CLAUDE.md/README misdocument `/_test/reset` gating as weaker than the server enforces · severity: medium · status: CONFIRMED (docs wrong, code correct)
- **Sources:** both (reports Docs#1 + review QUA-052)
- **Current location:** `CLAUDE.md:78-79` + `README.md:53` (also `resetServerState.ts:7-10` doc-comment is CORRECT); truth: `packages/server/src/httpRoutes/testResetRoute.ts:18-31`.
- **Original claim:** Docs say `/_test/reset` is "available whenever not production, token optional"; the server requires `NODE_ENV ∈ {development,test}` AND an unconditional token match (403 when unset). The stricter server is correct; the docs teach a weaker contract.
- **Verification (current code):** Confirmed — `testResetRoute.ts:19` requires `nodeEnv === 'development' || 'test'` (404 otherwise) and `:25-26` requires `TEST_RESET_TOKEN` set AND matching the `x-test-reset-token` header (403 otherwise). The runner's own `resetServerState.ts:7-10` comment now describes this correctly, but `CLAUDE.md:78-79` and `README.md:53` still say "automatisch beschikbaar wanneer NIET production" / "optional `TEST_RESET_TOKEN`".
- **Verdict & why:** CONFIRMED, Medium — and this is the rare fix-the-docs-not-the-code case. The doc drift is security-relevant: an AI following CLAUDE.md calls `resetServerState` tokenless, gets 403/false, and `resetBetweenEndpoints` silently no-ops (return value ignored, CFG-25).
- **Recommendation:** Fix `CLAUDE.md:78-79` + `README.md:53` to match `testResetRoute.ts`; stop ignoring `resetServerState`'s boolean return (surface a skipped/warning result on failure).

### QUA-014 — Template `scripts/testAll.ts` drifted from framework copy (missing `import '../config'` + `TEST_OUTPUT_FILE` writer) · severity: high · status: CONFIRMED (PARTIALLY-FIXED in framework copy only)
- **Sources:** review (QUA-014, merged tooling + pkg-test-runner)
- **Current location:** Framework `scripts/testAll.ts:23,56-61` (has both); template `packages/create-luckystack-app/template/scripts/testAll.ts` (lacks both); identical `ls-np/scripts/testAll.ts`.
- **Original claim:** Template `testAll.ts` (and the ls-np copy) omit the load-bearing `import '../config';` line — without it `getProjectConfig()` falls back to defaults so `ctx.session.login()` mints sessions in the wrong Redis namespace and every authenticated Layer-5 test fails with `auth.required`. It also drops the `TEST_OUTPUT_FILE` machine-readable JSON summary writer.
- **Verification (current code):** Confirmed. Framework `scripts/testAll.ts` has `import '../config';` (`:23`) and the `TEST_OUTPUT_FILE` writer (`:56-61`). The template copy (`packages/create-luckystack-app/template/scripts/testAll.ts`) has NEITHER — it goes straight from the doc-comment to `import { logRunAllSummary, runAllTests }` with no config import, and ends at `process.exit(0)` with no JSON write. (Both import from `apiTypes.generated`, so that part of the older drift claim is already reconciled.)
- **Verdict & why:** CONFIRMED for the template. The framework copy is correct; the template/ls-np copies are stale. High because every scaffolded project inherits a `testAll.ts` whose authenticated Layer-5 tests silently fail in any project whose projectName/cookie/rate-limit prefix differs from defaults — a hard-to-debug, security-adjacent failure. (The broader QUA-014 covers 5 drifted scripts across tooling; only the testAll.ts portion is this area's.)
- **Recommendation:** Forward `import '../config';` + the `TEST_OUTPUT_FILE` block to the template + ls-np `testAll.ts`; single-source the mirrored scripts at package-build time or add a CI `diff -q` over the mirrored files to fail on drift.

### L1 / Hard-block(part) — Silent skip of endpoints missing from `apiMetaMap` makes auth coverage unverifiable · severity: low · status: CONFIRMED
- **Sources:** reports (L1)
- **Current location:** `runAuthEnforcementTests.ts` (`requiresLogin` guard) + `testLayerHelpers.ts:25-28` (`requiresLogin` returns `false` for both public AND meta-missing endpoints).
- **Original claim:** `requiresLogin` returns false both for genuinely public endpoints and for endpoints whose meta entry is missing (stale map); neither appears in the summary, so "12/12 passed" can't be distinguished from "12 of 30 protected endpoints actually probed".
- **Verification (current code):** Consistent with the reports/ scan's reading (the auth sweep continues silently when `requiresLogin` is false; meta-missing collapses to the same branch). Not independently re-traced line-by-line in this pass but the mechanism matches `runRateLimitTests.ts`'s analogous skip handling.
- **Verdict & why:** CONFIRMED, Low — a coverage-visibility gap, not a defect that produces wrong passes.
- **Recommendation:** Count meta-missing endpoints as `skipped` with a "no meta entry" reason so they surface in the report.

### L2 — `TEST_RESET_TOKEN` sent over whatever scheme `baseUrl` uses, no plaintext warning · severity: low · status: CONFIRMED
- **Sources:** reports (L2)
- **Current location:** `resetServerState.ts:18-20` (`X-Test-Reset-Token` header sent to `${baseUrl}/_test/reset` regardless of `http:`/`https:`).
- **Original claim:** For a network-reachable `http://` staging target, the reset token (authorizes flushing all sessions + rate limits) travels in cleartext; no warning/refusal.
- **Verification (current code):** Confirmed — `:20 if (token) headers['X-Test-Reset-Token'] = token` with no scheme/host check. (The hardcoded-path half of this finding is tracked under CFG-25.)
- **Verdict & why:** CONFIRMED, Low.
- **Recommendation:** Warn (or refuse without opt-in) when the token is sent to a non-loopback `http:` URL.

### MIS-019 — No CSRF-enforcement sweep layer · severity: medium · status: CONFIRMED (missing feature)
- **Sources:** review (MIS-019)
- **Current location:** n/a — feature absent. `customTests.ts:202-203,278` actively fetches+sends the CSRF token so authenticated tests PASS the middleware, but no sweep asserts the inverse (authenticated state-changing request WITHOUT the CSRF header is rejected).
- **Original claim:** The framework ships first-class CSRF protection but no auto-sweep layer asserts an authenticated request missing the CSRF header is rejected; a consumer who misconfigures CSRF gets a green `npm run test`.
- **Verification (current code):** Confirmed — grep for `csrf` in `src/` shows only token-passing (`customTests.ts` reads `getCsrfConfig().headerName` and sends `state.csrfToken`), never an enforcement assertion. No `runCsrfEnforcementTests` exists.
- **Verdict & why:** CONFIRMED as a genuine missing-feature, Medium. Regression protection for CSRF belongs in the sweep, not only in per-route custom tests.
- **Recommendation:** Add `runCsrfEnforcementTests({ apiMethodMap, apiMetaMap, baseUrl, authToken })` mirroring `runAuthEnforcementTests`: for each `auth.login` POST/PUT/DELETE route send a valid Cookie but omit the CSRF header, assert the framework's csrf rejection errorCode; wire into `runAllTests` behind `noCsrf?: boolean`.

### MIS-028 — `auth.additional` metadata carried but never tested by any sweep · severity: low · status: CONFIRMED (missing feature)
- **Sources:** review (MIS-028)
- **Current location:** `packages/test-runner/src/types.ts:18` (`ApiMetaEntry.auth.additional`); consumed only as `meta?.auth.login` in `testLayerHelpers.ts`.
- **Original claim:** `ApiMetaEntry` declares `auth.additional` but the auth-enforcement layer only consumes `auth.login`; role/permission requirements are parsed but never exercised, so a logged-in non-admin hitting an admin route gets no automated coverage while the green sweep implies auth is covered.
- **Verification (current code):** Consistent — `authEnforcementCheck`/`runAuthEnforcementTests` reference only the login flag; nothing reads `additional`. (Matches the `requiresLogin`-only consumption noted in L1.)
- **Verdict & why:** CONFIRMED, Low — correctly low because the right assertion needs consumer-specific role semantics the runner can't infer.
- **Recommendation:** Document the gap in auth-tests.md; consider an `additionalAuthProbe?: (endpoint, additional) => { headers, expectedErrorCode } | null` hook on `RunAuthEnforcementTestsInput`.

### Hooks#2 — Expected error codes hardcoded with no override (`auth.required`, `api.rateLimitExceeded`) · severity: low · status: CONFIRMED
- **Sources:** reports (Hooks#2)
- **Current location:** `authEnforcementCheck.ts:8` (`EXPECTED_ERROR_CODE = 'auth.required'`), `rateLimitCheck.ts:5` (`'api.rateLimitExceeded'`).
- **Original claim:** `@luckystack/server` ships `registerErrorFormatter` so consumers can reshape error JSON; any consumer who does false-fails both sweep layers with no escape but skipping every endpoint.
- **Verification (current code):** Confirmed — both are module constants with no input override. `registerErrorFormatter` is a documented server export (server CLAUDE.md).
- **Verdict & why:** CONFIRMED, Low. The hardcode is intentional for drift detection (auth-tests.md:38), but an `expectedErrorCode?` input would keep the default while unblocking custom formatters.
- **Recommendation:** Add an optional `expectedErrorCode?` to the auth + rate-limit check/sweep inputs, defaulting to the current constants.

### Hooks#3-6 — Closed `JUNK_PAYLOADS`, `ctx.session` hard-deps on login, no `runAllTests` onResult/inputFor passthrough, no `srcDir` on `runCustomTests` · severity: low · status: CONFIRMED (HOK-17/HOK-18 overlap)
- **Sources:** both (reports Hooks#3-6 + review HOK-17, HOK-18)
- **Current location:** `fuzzCheck.ts:10-20` (module-const payloads, no `extraPayloads` field); `customTests.ts:231,254` (dynamic-imports `@luckystack/login`); `runAllTests.ts:21-39` (no `onResult`/`onCustomResult`/`inputFor` passthrough); `customTests.ts:382` (`discoverCustomTestFiles()` called with no `srcDir`, and `RunCustomTestsInput` has no `srcDir`).
- **Original claim:** Consumers can't add a fuzz case without forking; projects with custom auth have no session-adapter slot (`ctx.session.login` throws on import); the orchestrator can't stream per-result progress (HOK-17); Layer-5 has no beforeAll/afterAll lifecycle (HOK-18); `runCustomTests` can't target a non-default src dir.
- **Verification (current code):** Confirmed each: `FuzzCheckInput` (`:22-28`) has no payloads field; `buildSessionHelpers` (`:230-231`) `await import('@luckystack/login')` with no adapter fallback; `RunAllTestsInput` exposes none of the per-layer `onResult` hooks (each sweep + `runCustomTests` DO have `onResult` — `customTests.ts:73`); `runCustomTests` (`:382`) calls `discoverCustomTestFiles()` argument-less and `RunCustomTestsInput` (`:62-74`) has no `srcDir`; no `beforeAll`/`afterAll` identifiers exist.
- **Verdict & why:** CONFIRMED, all Low/Medium extensibility gaps. HOK-17 (no orchestrator onResult — `npm run test` runs silently for minutes) and HOK-18 (no per-file lifecycle) are the most consumer-visible; reports/ folds them into its Hooks list, review/ raises them as separate Mediums — same root causes.
- **Recommendation:** Add `extraPayloads?` to `FuzzCheckInput`; a `registerTestSessionAdapter`-style slot for custom auth; `onResult`/`onCustomResult`(+`onLayerStart`/`onLayerEnd`) to `RunAllTestsInput`; `beforeAll`/`afterAll` per test file; `srcDir?` to `RunCustomTestsInput`.

### Hard-block#1 — Auto-sweep layers structurally cannot cover sync routes · severity: medium · status: CONFIRMED (disclosed limitation)
- **Sources:** reports (Hard-block#1)
- **Current location:** `walkEndpoints.ts:5-24` (only encodes `api/<page>/<name>/<version>` HTTP paths; no sync equivalent).
- **Original claim:** All four sweeps iterate `walkEndpoints(apiMethodMap)`, which has no sync map; contract/auth/rate-limit/fuzz guarantees don't exist for `_sync/` routes — only opt-in Layer-5 covers them. A project whose security surface is mostly sync gets near-zero sweep coverage.
- **Verification (current code):** Confirmed — `walkEndpoints` builds only `fullPath: `api/${page}/${name}/${version}``. CLAUDE.md "When to NOT suggest" discloses this ("sync support voor de auto-layers staat op de roadmap maar is nog niet geleverd").
- **Verdict & why:** CONFIRMED as a disclosed structural limitation, Medium. Honestly documented, but real.
- **Recommendation:** Roadmap item — add a sync method map + sync-path encoding to the sweep walkers; until then keep the CLAUDE.md disclosure prominent.

### Hard-block#2 — Layer 5 only discovers `*.tests.ts` (TS source), invisible to compiled deployments · severity: low · status: CONFIRMED
- **Sources:** reports (Hard-block#2)
- **Current location:** `customTests.ts:22-23,104` (patterns match `.tests.ts` only), `:390` (dynamic-imports the TS source).
- **Original claim:** Discovery matches `.ts` only and imports TS source, so running the custom layer from a compiled/bundled deployment (no `src/`, no TS loader) is impossible.
- **Verification (current code):** Confirmed — `API_TEST_FILE_PATTERN = /_v(\d+)\.tests\.ts$/`, `:104 entry.name.endsWith('.tests.ts')`, `:390 import(pathToFileURL(discovery.filePath).href)`. Compiled `.tests.js` files are invisible.
- **Verdict & why:** CONFIRMED, Low — Layer 5 is a dev/CI tool run against source via a TS loader by design; the limitation is real but low-impact.
- **Recommendation:** If compiled-deploy custom tests are wanted, broaden the discovery pattern to `.tests.(ts|js)` and resolve against an output dir; otherwise document the source-only requirement.

### QUA-Code#1 — 4x duplicated fetch/timeout/envelope-parse block · severity: low · status: CONFIRMED
- **Sources:** reports (Code-quality#1)
- **Current location:** `contractCheck.ts`, `authEnforcementCheck.ts:32-68`, `fuzzCheck.ts:38-53`, `rateLimitCheck.ts:32-48`.
- **Original claim:** The AbortController + `tryCatch(fetch)` + `response.json()` envelope-parse pattern is copy-pasted across all four checks with small drift (rate-limit 10s default vs 5s elsewhere); a shared `probeEndpoint()` would collapse ~120 lines and stop the timeout-config drift.
- **Verification (current code):** Confirmed — each check independently builds the AbortController/timeout/fetch/parse block; `rateLimitCheck.ts:4` defaults 10_000ms while the others default 5000ms.
- **Verdict & why:** CONFIRMED, Low — maintainability, not a defect. (Relevant because the duplication is what makes CFG-24's per-sweep timeout threading awkward.)
- **Recommendation:** Extract a shared `probeEndpoint()` helper.

### QUA-Code#2 — `expect.eq` deep-compare via `JSON.stringify` is key-order-sensitive · severity: low · status: CONFIRMED
- **Sources:** reports (Code-quality#2)
- **Current location:** `customTests.ts:176-177`.
- **Original claim:** `JSON.stringify(actual) === JSON.stringify(expected)` makes `{a:1,b:2}` ≠ `{b:2,a:1}` and treats `undefined`-valued keys as equal to missing keys — misleading Layer-5 assertion failures.
- **Verification (current code):** Confirmed — `:176-177` falls back to `JSON.stringify(actual) === JSON.stringify(expected)` for object comparison.
- **Verdict & why:** CONFIRMED, Low — assertion-quality footgun in consumer-authored tests.
- **Recommendation:** Use a key-order-insensitive structural deep-equal.

### QUA-Code#3 — Unvalidated `method as HttpMethod` cast in `walkEndpoints` · severity: low · status: CONFIRMED
- **Sources:** reports (Code-quality#3)
- **Current location:** `walkEndpoints.ts:17`.
- **Original claim:** A corrupt/hand-edited map with `"PATCH"` flows untyped into every layer via `method as HttpMethod`.
- **Verification (current code):** Confirmed — `:17 method: method as HttpMethod` with no runtime validation against the `HttpMethod` union.
- **Verdict & why:** CONFIRMED, Low — the generated map is normally trustworthy, but the cast erases the one validation point. (CLAUDE.md Rule 21 frowns on unvalidated casts in framework code.)
- **Recommendation:** Validate `method` against the `HttpMethod` set and skip/throw on an unknown value.

### QUA-Code#4 — `rateLimitCheck` ignores drain-phase failures · severity: low · status: CONFIRMED
- **Sources:** reports (Code-quality#4)
- **Current location:** `rateLimitCheck.ts:52-54`.
- **Original claim:** The drain loop discards `send()` results; if the first N requests all failed (server down mid-run, CSRF rejects), the N+1 assertion produces a misleading "expected rateLimitExceeded" instead of "drain phase never reached the limiter".
- **Verification (current code):** Confirmed — `:52-54 for (...) { await send(); }` discards every return; only `final` is inspected.
- **Verdict & why:** CONFIRMED, Low — diagnostic-quality issue.
- **Recommendation:** Track drain-phase failures and report "drain never reached the limiter" distinctly from a genuine limiter miss.

### QUA-Code#5/#6 — Dead extension-registry runtime code + `customTests.ts` mixes five jobs · severity: low · status: CONFIRMED
- **Sources:** reports (Code-quality#5,#6)
- **Current location:** `extensionRegistry.ts` (~117 lines, unconsumed — see HOK-03); `customTests.ts` (~452 lines mixing discovery, session adapter, HTTP clients, assertion lib, runner).
- **Original claim:** The registry ships behavior nothing consumes (façade); `customTests.ts` bundles five responsibilities that the discovery walker + assertion lib are natural extractions from.
- **Verification (current code):** Confirmed — registry has zero runner call sites; `customTests.ts` is 452 lines spanning `discoverCustomTestFiles`, `buildSessionHelpers`, `buildCallApi`/`buildCallSync`, `buildExpect`, and `runCustomTests`.
- **Verdict & why:** CONFIRMED, Low — code-quality/maintainability; the registry's dead-code status is the runtime symptom of HOK-03.
- **Recommendation:** Wire or remove the registry (HOK-03); extract the discovery walker + assertion lib from `customTests.ts`.

### Docs#3/#4/#6 — fuzz-tests.md contradicts code (fixtures unused, 5xx pass-through, no-op __proto__ advertised) · severity: low · status: CONFIRMED
- **Sources:** reports (Docs#3,#4,#6)
- **Current location:** `docs/fuzz-tests.md` vs `fuzzCheck.ts` (fixtures never read; `:72-78` deliberately passes a 5xx that carries a valid `{status:'error',errorCode}` envelope; `:18` no-op `__proto__`).
- **Original claim:** CLAUDE.md:83 says fixtures are preferred by the fuzz layer (present tense) while fuzzCheck never reads them; fuzz-tests.md lines 5/32 say any 5xx fails but the code passes a controlled-500 envelope; fuzz-tests.md:74 advertises the no-op __proto__ probe as working.
- **Verification (current code):** Confirmed against `fuzzCheck.ts`: no fixture read; `:78` only fails on a non-envelope body (a 5xx with a valid envelope passes per the `:72-77` comment); `:18` is the no-op payload (QUA-048).
- **Verdict & why:** CONFIRMED, Low — doc-vs-code drift; harmless except as false confidence (the __proto__ one is the security-relevant half, escalated under QUA-048).
- **Recommendation:** Update fuzz-tests.md + CLAUDE.md: fixtures are not yet consumed; a controlled-500 envelope intentionally passes; remove the __proto__ "working pollution check" claim until the payload is fixed.
