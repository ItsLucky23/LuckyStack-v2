# secret-manager — Verified & Merged Audit Findings
Sources: reports/secret-manager.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary

`packages/secret-manager/src/index.ts` is **unchanged** since both scans ran — commit 302cbf1 ("login/wizard/cli") did not touch this package, and `git status` for `packages/secret-manager/` is clean. Every line number cited by both scans still lands on the exact offending code, so nothing here is "already-fixed by a later commit" — the older review/ scan was NOT stale for this area. Of 13 distinct (de-duplicated) findings: **12 CONFIRMED**, **1 REFUTED** (the "drops boot-captured pointers" half of QUA-078 is by-design idempotent-reset behavior, while its "non-atomic half-applied state" half is confirmed → recorded as PARTIALLY-FIXED/mixed under SM-09). No critical or high findings — the reports/ scan's adversarial pass (top of `reports/secret-manager.md`) found zero crit/high and that holds. The two genuinely live transport issues are both medium: **SM-01** plain-HTTP accepted silently for a secrets channel, and **SM-02** no request timeout — a hung server freezes boot in every mode AND silently voids hybrid's fail-open contract (the await never settles, so the `catch` never runs). The most consequential design gap is **SM-10** (no `onApplied`/rotation hook) which makes the package's headline rotation feature a no-op for any client that captured a secret at construction time. Where the two scans overlap they agree on severity; the review/ scan adds the timeout finding at the same medium severity as reports/ M2 — consistent.

## Findings

### SM-01 — Plain-HTTP transport to the secret server accepted with no warning or guardrail  ·  severity: med  ·  status: CONFIRMED
- **Sources:** reports(M1)
- **Current location:** `packages/secret-manager/src/index.ts:121-123` (validateUrl); token sent at `:178`
- **Original claim:** `http://` URLs pass `validateUrl` unchallenged, so the bearer token and every resolved secret travel in cleartext for a channel whose only job is moving secrets. No warning, no loopback-only carve-out, no docs guidance.
- **Verification (current code):** `validateUrl` only rejects non-`http(s)` schemes (`:121`); `http:` is explicitly allowed alongside `https:`. `fetchResolve` sends `Authorization: Bearer <token>` (`:178`) and returns plaintext secrets over whatever scheme was configured. No `allowInsecureHttp` flag exists in `SecretManagerConfig` (`:37-74`). Confirmed.
- **Verdict & why:** CONFIRMED. Live as described.
- **Recommendation:** Require `https:` by default; permit `http:` only for loopback hosts or behind an explicit `allowInsecureHttp: true` flag, and emit a loud warning when used. Document the transport expectation in `docs/architecture.md` "Auth model".

### SM-02 — No request timeout: a hung secret server blocks boot forever and silently voids hybrid fail-open  ·  severity: med  ·  status: CONFIRMED
- **Sources:** reports(M2) + review(CFG-20) — same root cause, merged
- **Current location:** `packages/secret-manager/src/index.ts:175-183` (fetchResolve); hybrid catch at `:258-264`; dev poll/reload at `:302,:338`
- **Original claim:** `fetchFn(endpoint, {...})` attaches no `AbortSignal`/timeout and none is configurable. A server that accepts the TCP connection but never responds hangs `initSecretManager` (whole-app boot) until undici's ~300s default; in `'hybrid'` the documented "warn and keep local env" never fires because the `await` never settles. A transient blip is also an immediate hard boot crash in `'remote'` with no retry.
- **Verification (current code):** `:175-183` — fetch options are `method`, `headers`, `body` only; no `signal`. `SecretManagerConfig` (`:37-74`) has no `timeoutMs`/`retries`. Hybrid's fail-open is in the `catch` at `:259-261`, which can only run on a *rejected* promise — a hanging fetch never rejects, so the analysis is correct. Confirmed.
- **Verdict & why:** CONFIRMED. Both scans agree at medium severity; both right. This is the single most impactful production correctness gap (k8s crashloop on transient blip + boot-hang on a black-hole server).
- **Recommendation:** Add `timeoutMs?: number` (default ~10_000, via `AbortSignal.timeout(...)` — Node ≥20 already required) and optional `retries?: { count; delayMs }` (default 0) to `SecretManagerConfig`; pass the signal to fetch. Document that `'remote'` still throws after exhaustion.

### SM-03 — `getCachedResolution()` hands out a live, mutable reference to plaintext secrets, framed as "diagnostics"  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(L1) + review(SEC-42) — same root cause, merged
- **Current location:** `packages/secret-manager/src/index.ts:417-418`
- **Original claim:** `getCachedResolution` returns the internal `cachedResolution` object directly; `values` is `pointer -> RAW secret`. No copy, no freeze, no masking. The "diagnostics" JSDoc invites dumping it into a `/health` endpoint or log line, leaking every secret; the live reference is also mutable so callers can corrupt the cache.
- **Verification (current code):** `:418` is verbatim `export const getCachedResolution = (): CachedResolution | null => cachedResolution;` — returns the module-global reference with no defensive copy. JSDoc at `:417` says "for diagnostics" with no sensitivity warning. CLAUDE.md function index repeats the "for diagnostics" framing. Confirmed.
- **Verdict & why:** CONFIRMED, low. Both scans agree on severity (low — requires consumer misuse; secrets already live in `process.env` so this is incremental exposure). reports/ notes the response-filtering half of the original SECURITY_AUDIT item 11 was implemented but the "treat output as sensitive" half was not — accurate.
- **Recommendation:** Return a deep copy; add a prominent JSDoc warning ("contains raw secret values — never serialize into responses/logs"); consider a redacted default (`{ fetchedAt, pointers: string[] }`) with an explicit `{ unmasked: true }` opt-in.

### SM-04 — Dev hot-reload gate is `NODE_ENV === 'production'` exact-match; unset/`prod`/`staging` get dev behavior  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(L2)
- **Current location:** `packages/secret-manager/src/index.ts:310-311`
- **Original claim:** The gate disables dev reload only on the exact string `'production'`. A host with `NODE_ENV` unset, or set to `prod`/`staging`, starts the `.env` file watchers and the rotation poll while the operator believes it is production — contradicting "no-op in production" (`:27`, README).
- **Verification (current code):** `:311` is `if (process.env.NODE_ENV === 'production') return;` — exact-match. Anything other than the literal `'production'` falls through to start watchers/poll. Confirmed.
- **Verdict & why:** CONFIRMED, low. The blast radius is bounded (extra fs watchers + a poll, both `unref()`'d), but it does silently contradict the documented contract.
- **Recommendation:** Invert the gate (enable only when `NODE_ENV === 'development'` or `'test'`), or at minimum log which decision was taken at init.

### SM-05 — Resolved values not validated as strings before entering `process.env` and the cache  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(L3) + review(QUA-077) — same root cause, merged
- **Current location:** `packages/secret-manager/src/index.ts:203-204` (cast); injection at `:231`; guard comment `:189-191`
- **Original claim:** The runtime guard at `:194` only checks `values` is a non-null object; individual entries are reached via `Object.entries(values as Record<string, string>)` with no per-value type check. A server returning `{ PTR: 123 }` or `{ PTR: { nested } }` flows the non-string into `process.env[name] = value`, coercing to `'123'`/`'[object Object]'` — the missing half of the comment's own "response is attacker-influenced" threat model.
- **Verification (current code):** `:203` is `for (const [key, value] of Object.entries(values as Record<string, string>))` — a plain `as` cast (not `as unknown as`), no `typeof value === 'string'` guard before `filtered[key] = value` (`:204`); later written to env at `:231`. The `:189-191` comment does claim shape is "not assumed". Confirmed.
- **Verdict & why:** CONFIRMED, low. Both scans agree (low — plain `as`, requires a buggy/compromised server). They describe the identical defect.
- **Recommendation:** Per-entry guard in the filter loop: skip or (in `'remote'` mode) throw on `typeof value !== 'string'`, treating a non-string like a missing pointer.

### SM-06 — Overly broad default pointer pattern can exfiltrate non-pointer local values and hard-fail boot  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(L4) + review(CFG-39) — overlapping root cause (loose default pattern + whole-env scan), merged
- **Current location:** `packages/secret-manager/src/index.ts:83` (`DEFAULT_POINTER_PATTERN`); scan at `:126-134` (capturePointers)
- **Original claim (merged):** Any `process.env` value ending in `_V<digits>` — including a genuine local secret or an identifier like `RELEASE_TAG=build_2024_V2` — is captured (`:129`), POSTed to the external server (off-host leak of an unrelated value), and in `'remote'` mode causes a hard boot failure when the server can't resolve it (`:216-221`). review/CFG-39 adds that `capturePointers` scans the ENTIRE inherited environment (not just `.env`-loaded keys) with no name allowlist, and that `pointerPattern` is shape-tuning, not scoping.
- **Verification (current code):** `:83` `const DEFAULT_POINTER_PATTERN = /^(.+)_V(\d+)$/;` — loose. `:128` `for (const [name, value] of Object.entries(process.env))` confirms the full inherited-env scan. No `envNames` allowlist in `SecretManagerConfig`. Confirmed.
- **Verdict & why:** CONFIRMED, low. reports/L4 (tighten the pattern) and review/CFG-39 (add a name allowlist) are two recommendations for the same value-suffix-collision failure mode; merged. Both right.
- **Recommendation:** Tighten the default (e.g. require uppercase `[A-Z0-9_]+_V\d+$`) AND/OR add `envNames?: string[] | ((name: string) => boolean)` to scope which env entries are pointer-eligible (default: all). Document the inherited-environment scan in `docs/architecture.md`.

### SM-07 — Security validators (validateUrl, validateToken, isSafeEnvFile, env-key regex) have zero test coverage  ·  severity: med  ·  status: CONFIRMED
- **Sources:** review(QUA-042)
- **Current location:** `packages/secret-manager/src/index.test.ts` (untested: `index.ts:114-124, 136-149, 93-97, 280-282`)
- **Original claim:** The hardening added for SECURITY_AUDIT item 11 — validateUrl (rejects non-http(s)/relative), validateToken (rejects empty, warns on "Bearer " prefix), isSafeEnvFile (rejects `..` traversal), the POSIX env-key regex in parseEnvFile — has NO test. A future refactor can silently drop these checks with green tests.
- **Verification (current code):** Grepped the full test file for `file:///`, `not-a-url`, whitespace/empty token, `../`, `BAD-KEY`/`INVALID`, `validateUrl`/`validateToken` — zero matches. The only `throws` assertions present are for unresolved pointers (`:160`), non-2xx (`:171`), missing `values` object (`:181`), and transport errors (`:190`) — none exercise the security validators. Confirmed.
- **Verdict & why:** CONFIRMED, medium (regression-risk on security-critical code with no net under it). review/ was the only scan to catch this; reports/ noted the test suite "covers all three modes, atomicity, token-file auth" but missed that the validators themselves are untested — review/ is right here.
- **Recommendation:** Add focused cases: init throws on `url: 'file:///etc'` and `'not-a-url'`; init throws on `token: '  '`; warn + skip for `envFiles: ['../outside.env']` (drivable via `reloadSecretManagerFromFiles` without fs.watch); `parseEnvFile` warns + skips `BAD-KEY=value`. All fit the existing public-surface test pattern.

### SM-08 — Stale JSDoc: `dev.watch` claims an optional `dotenv` peer that does not exist  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(docs-gap) + review(QUA-079) — same root cause, merged
- **Current location:** `packages/secret-manager/src/index.ts:65-66`; also `src/index.test.ts:320` comment, `README.md:91`
- **Original claim:** The `dev.watch` JSDoc says "Requires the optional `dotenv` peer to parse the files." — but `parseEnvFile` (`:267-296`) is an in-package parser, the `:267` comment + CLAUDE.md + `docs/architecture.md` all say the package is dependency-free, and README says "Peer dependencies: None." This wrong claim ships inside the published `.d.ts` hover text where an AI/developer reads it and may wrongly `npm install dotenv`.
- **Verification (current code):** `:65-66` verbatim "...pointer-shaped values are re-resolved against the server. Requires the / optional `dotenv` peer to parse the files." while `:267` says "Minimal .env parser kept in-package so the resolver stays dependency-free." Direct contradiction, present. Confirmed.
- **Verdict & why:** CONFIRMED, low (docs/typing defect, not runtime). Both scans flag it identically.
- **Recommendation:** Delete the dotenv sentence from the `watch` JSDoc and the `index.test.ts:320` comment. Optionally rephrase the package's "dependency-free" claims to "no third-party env-parsing dependency" (it does depend on `@luckystack/core` for `tryCatchSync`).

### SM-09 — `reloadSecretManagerFromFiles` non-atomic on failure; replaces (not merges) the pointer map  ·  severity: low  ·  status: PARTIALLY-FIXED (mixed: one half confirmed, one half refuted)
- **Sources:** reports(code-quality) + review(QUA-078) — same root cause, merged
- **Current location:** `packages/secret-manager/src/index.ts:405-414`; atomic boot contrast at `:216-222`
- **Original claim (two parts):** (a) plain values are written into `process.env` at `:410` BEFORE `doResolve` at `:414`, which throws in `'remote'` mode on an unresolved pointer — leaving half-applied state, unlike the deliberately atomic boot path; (b) `pointerMap = freshPointerMap` (`:413`) replaces the boot-captured map with ONLY pointers parsed from the env files, so a pointer supplied as a real env var (CI export, docker `-e`) silently vanishes from subsequent polls.
- **Verification (current code):** (a) Confirmed: `:410` `process.env[name] = value` runs inside the loop before `:414` `await doResolve(config)`; a remote-mode throw at `:220` leaves the plain values already applied — non-atomic, contrary to the boot path's check-before-mutate. (b) The replace at `:413` is real, but the surrounding comment (`:402-404`) states this is deliberate: "Swap in the fresh pointer set so this resolve + later polls use it (this is also how a pointer added after boot gets picked up)." Treating the env files as the source of truth on a file-reload is an intentional idempotent-reset semantic, not an accidental drop — the "silently stops rotating an env-var-only pointer" edge is a real but niche consequence of a documented design choice.
- **Verdict & why:** PARTIALLY-FIXED / mixed. The non-atomicity (a) is a genuine CONFIRMED defect (low). The pointer-map replace (b) is REFUTED as a "bug" — it is documented intentional behavior; at most it warrants a doc note about mixed env-var+env-file setups. Neither scan is wrong about what the code does; review/QUA-078 over-frames (b) as a silent defect.
- **Recommendation:** For (a): stage plain-value injection until after `doResolve` succeeds (or snapshot+rollback), mirroring the atomic boot path. For (b): if mixed env-var+env-file pointer setups are supported, either merge (`{ ...pointerMap, ...freshPointerMap }`) or document the reset semantic next to `dev.envFiles`.

### SM-10 — No rotation/resolution notification hook; long-lived clients keep stale credentials  ·  severity: med  ·  status: CONFIRMED
- **Sources:** reports(H1) + review(HOK-14) — same root cause, merged
- **Current location:** `packages/secret-manager/src/index.ts:209-233` (applyResolved); config surface `:37-74`
- **Original claim:** `applyResolved`/`refreshSecretManager`/the dev poll overwrite `process.env` on rotation, but `SecretManagerConfig` has zero callbacks (`onApplied`/`onRotated`/`onChange`). A client that captured the secret at construction time (Prisma from `DATABASE_URL`, Redis, Stripe/OpenAI SDK) silently keeps the old credential — defeating the package's headline rotation feature for anything except lazy `process.env` readers. The framework idiom exists elsewhere (router's `onReady`/`onHealthChange`).
- **Verification (current code):** `SecretManagerConfig` (`:37-74`) contains `url`, `token`, `source`, `pointerPattern`, `fetchImpl`, `dev` — no `on*` callback. `applyResolved` (`:224-232`) writes `process.env[name] = value` and returns void; nothing emits which names changed. Confirmed.
- **Verdict & why:** CONFIRMED, medium. Both scans agree on severity and substance. This is the highest-value live finding after SM-02 because it neuters the package's primary value proposition for the common case.
- **Recommendation:** Add `onApplied?: (changes: { name: string; pointer: string }[]) => void | Promise<void>` to `SecretManagerConfig`, invoked from `applyResolved` with only the env NAMES whose value changed (never the secret values). Consumers re-create pools/SDK clients after a rotation lands.

### SM-11 — Hardcoded `console.warn` logger; no injectable logger / onResolveError hook  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(H2) + review(HOK-26) — same root cause (no observability seam), merged
- **Current location:** `packages/secret-manager/src/index.ts:146, 228, 260, 281, 303, 321, 339, 390`
- **Original claim:** All warnings go directly to `console.warn` with no injectable logger / `onWarn` / `onResolveError`. A `'hybrid'`/dev-poll/dev-reload failure (`:260,:339,:303`) can leave a staging/canary booting on stale local env forever with no way to route the failure to Sentry/metrics without monkey-patching `console`. The CC-7 comment (`:248-253`) documents that NOT auto-capturing to the error tracker is deliberate fail-open — fine as a default, but it forecloses opt-in observability.
- **Verification (current code):** Confirmed `console.warn` at `:146, :228, :260, :281, :303, :321, :339, :390` — eight direct call sites, no logger injection point in the config. The hybrid catch at `:260` is exactly the fail-open path. Confirmed.
- **Verdict & why:** CONFIRMED, low. reports/H2 (logger hook) and review/HOK-26 (`onResolveError` hook) describe the same missing observability seam from two angles; merged. The fail-open default is correct (confirmed deliberate per user memory + the CC-7 comment) — the gap is the absence of an OPT-IN seam, not the default.
- **Recommendation:** Add `onResolveError?: (error: unknown, context: { phase: 'boot' | 'refresh' | 'file-reload' }) => void` to `SecretManagerConfig`, invoked alongside the existing `console.warn` in the hybrid/poll/reload catch paths (keeping current behavior when unset). Optionally a broader `onWarn`/`logger` injection.

### SM-12 — Endpoint path and auth scheme hardcoded (`/resolve`, `Bearer`)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(H3)
- **Current location:** `packages/secret-manager/src/index.ts:174` (`/resolve` suffix), `:178` (`Authorization: Bearer`)
- **Original claim:** A consumer fronting the secret server behind a gateway expecting a different path, a custom header, or mTLS must tunnel everything through `fetchImpl` (workable for headers/mTLS via an undici dispatcher, awkward for the path since the URL is already final). A `resolvePath?` and/or `headers?` option would close this cheaply.
- **Verification (current code):** `:174` `const endpoint = \`${config.url.replace(/\/+$/, '')}/resolve\`;` — path hardcoded. `:178` `'Authorization': \`Bearer ${resolveToken(config.token)}\`` — scheme hardcoded. No `resolvePath`/`headers` in config. Confirmed.
- **Verdict & why:** CONFIRMED, low (extensibility gap, not a defect; `fetchImpl` is a partial escape hatch).
- **Recommendation:** Add `resolvePath?: string` and/or `headers?: Record<string,string>` to `SecretManagerConfig`.

### SM-13 — Module-singleton state: exactly one secret-manager configuration per process  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(HB1)
- **Current location:** `packages/secret-manager/src/index.ts:101-106` (module-global state); overwrite at `:354`
- **Original claim:** All state (`cachedResolution`, `pointerMap`, `activeConfig`) is module-global; a second `initSecretManager` simply overwrites `activeConfig`. Resolving from two secret servers in one process is structurally impossible — there is no `createSecretManager(config)` factory. (Documented multi-tenancy routes per-workspace tokens to app data, so documented use cases don't hit this.)
- **Verification (current code):** `:101-106` are module-level `let` bindings; `initSecretManager` at `:354` unconditionally assigns `activeConfig = config`. No factory/instance form exported. Confirmed.
- **Verdict & why:** CONFIRMED, low (a structural dead-end for multi-source setups, but the documented use cases avoid it — reports/ rates it correctly as a hard-block-but-low-impact).
- **Recommendation:** If multi-source resolution is ever needed, offer a `createSecretManager(config)` factory returning an instance with its own state; keep the module singleton as a thin default wrapper.

### SM-14 — No config-level path to production rotation pickup (`pollIntervalMs` is dev-only)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(HB2 / missing-config)
- **Current location:** `packages/secret-manager/src/index.ts:69-70` (`pollIntervalMs` under `dev`); dev block gated at `:311`
- **Original claim:** `pollIntervalMs` exists only under `dev`, and the whole `dev` block is disabled when `NODE_ENV === 'production'`. The only production rotation mechanism is the consumer hand-rolling `setInterval(() => refreshSecretManager())`. The config shape itself makes "poll for rotations in prod" impossible as designed.
- **Verification (current code):** `:69-70` place `pollIntervalMs` inside `dev`; `:311` returns early in production before `:336` starts the poll. `refreshSecretManager` IS exported (`:368`) so a hand-rolled prod interval works. Confirmed.
- **Verdict & why:** CONFIRMED, low. Mechanically escapable (the export exists), but the config shape steers against the natural production poll. Closely related to SM-10 (a prod rotation hook needs both a prod poll AND a change notification).
- **Recommendation:** Add a production-capable poll knob (e.g. top-level `pollIntervalMs` or `rotation: { pollIntervalMs }`) that runs regardless of `NODE_ENV`, distinct from the dev-only file watch.

### SM-15 — No public stop/dispose API outside the test-only reset helper  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(MIS-026)
- **Current location:** `packages/secret-manager/src/index.ts:421-438` (`resetSecretManagerForTests`)
- **Original claim:** The only way to tear down the dev poll timer, debounce timer, and fs watchers is `resetSecretManagerForTests()`, documented "Test-only", which also wipes `cachedResolution`/`pointerMap`/`activeConfig`. A consumer embedding the resolver in a worker/CLI/graceful-shutdown has no sanctioned `stop`.
- **Verification (current code):** `:420` JSDoc "Test-only — clear module state and tear down any dev watchers / timers." The function both clears state AND closes watchers/timers; no separate `stopSecretManager`/`dispose` is exported. Confirmed.
- **Verdict & why:** CONFIRMED, low. The handles are `unref()`'d so they don't block process exit, but there is no clean teardown for embedded use.
- **Recommendation:** Export `stopSecretManager(): void` that closes watchers + clears timers WITHOUT wiping the cache, and reimplement `resetSecretManagerForTests` as stop + state clear. List it in CLAUDE.md's function index.

### SM-16 — Code-quality nits: stateful-regex footgun + state-mutated-before-validation  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(code-quality)
- **Current location:** `packages/secret-manager/src/index.ts:129` & `:407` (stateful regex); `:354` vs `:358` (mutate-before-validate)
- **Original claim:** (a) A consumer-supplied `pointerPattern` with a `g`/`y` flag makes `pattern.test(...)` stateful (`lastIndex`), so `capturePointers` (`:129`) and the reload classifier (`:407`) skip alternating entries — silent misclassification. (b) `initSecretManager` sets `activeConfig = config` (`:354`) BEFORE `validateUrl` (`:358`) can throw; after a failed init, a later `refreshSecretManager` runs `doResolve` against the invalid config.
- **Verification (current code):** (a) `:129` `pattern.test(value)` and `:407` `pattern.test(value)` both use the consumer pattern directly with no flag-stripping; a global-flag pattern would indeed alternate. (b) `:354` `activeConfig = config;` precedes `:358` `validateUrl(config.url);`; `refreshSecretManager` (`:368-371`) gates only on `activeConfig` truthiness, so a post-failed-init refresh would proceed. Both confirmed.
- **Verdict & why:** CONFIRMED, low (both are robustness nits, not active exploits).
- **Recommendation:** (a) Strip `g`/`y` flags (or assert their absence) on the configured `pointerPattern` in `initSecretManager`. (b) Run `validateUrl` before assigning `activeConfig`, or null out `activeConfig` on a failed init.

### SM-17 — Docs gaps: CLAUDE.md config table omits `dev.envFiles`; transport/timeout/no-op-in-prod overstatements  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(docs-gaps)
- **Current location:** `packages/secret-manager/CLAUDE.md` "Config keys" table; cross-refs to SM-01/SM-02/SM-04
- **Original claim:** (a) CLAUDE.md lists `config.dev` as `{ watch?, pollIntervalMs? }` while the type (`index.ts:72`) also has `envFiles`. (b) No transport-security (HTTPS) guidance anywhere (see SM-01). (c) "No-op in production" is overstated given the exact-string gate (see SM-04). (d) Timeout/hang behavior undocumented (see SM-02).
- **Verification (current code):** The shipped `CLAUDE.md` "Config keys" table row for `config.dev` reads `{ watch?, pollIntervalMs? }` and omits `envFiles`, while `SecretManagerConfig.dev` (`index.ts:72`) includes `envFiles`. The other three are documentation facets of confirmed findings SM-01/SM-04/SM-02. Confirmed.
- **Verdict & why:** CONFIRMED, low (documentation accuracy). Bundled because they share a fix surface (the package's docs/JSDoc).
- **Recommendation:** Add `envFiles` to the CLAUDE.md config-keys table; add an HTTPS/transport note (SM-01), correct the "no-op in production" wording to "no-op only when `NODE_ENV === 'production'`" (SM-04), and document the hang-on-no-timeout behavior (SM-02).
