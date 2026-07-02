# Security + Correctness Audit — test-runner / devkit / docs-ui / mcp

Date: 2026-07-02
Scope: `packages/test-runner`, `packages/devkit`, `packages/docs-ui`, `packages/mcp` (src read in full; dist ignored).
Method: read every source file; verified control flow against emitter output and tests. Skeptical, false-positive-averse.

## TL;DR

These four packages are unusually well-hardened — prior audit findings (DOCSUI-01, DOCSUI-O9/O11/O13/O14, finding #98 reset bookends, symlink-cycle guards, path-containment guards, ReDoS-safe balanced-brace parsers) are all fixed and in several cases regression-tested. No CRITICAL or HIGH issue was found. **DOCSUI-01 is RESOLVED.** Everything below is MEDIUM/LOW, mostly documented-decision coverage gaps and defense-in-depth completeness notes, not exploitable holes.

---

## DOCSUI-01 — emitter ↔ renderer shape drift: **RESOLVED (verified)**

Prior audits flagged a CRITICAL where the docs emitter produced one shape and the renderer expected another (bare `{page: Entry[]}` map vs `{apis, syncs}`).

Current state:
- Emitter (`packages/devkit/src/typeMap/emitterArtifacts.ts:61-64`) writes `GeneratedDocsData = { apis: Record<string, ApiDocsEntry[]>; syncs: Record<string, SyncDocsEntry[]> }`, serialized to `apiDocs.generated.json` (`writeTypeMapArtifacts`, lines 667-676).
- Renderer (`packages/docs-ui/src/docsHtml.ts`): `render()` (line 527) reads `data.apis` / `data.syncs`; `buildGroups()` (line 463) iterates `Object.entries(apis)` where each value is an array of entries — an exact match for the emitted shape. Every emitted field (page/name/version/method/input/output/stream/rateLimit/auth/meta for APIs; clientInput/serverOutput/clientOutput/serverStream/clientStream/meta for syncs) is consumed by `renderEndpoint` / `renderSyncEntry`.
- Backward compat: `render()` also accepts the legacy bare-map shape and emits a dev `console.warn` (lines 530-536).
- Regression-tested: `packages/docs-ui/src/liveRenderCore.test.ts:199` ("buildGroups — FLAT array artifact shape") drives `buildGroups(apis, syncs, ...)` against a payload that "Mirrors the REAL apiDocs.generated.json".

Verdict: fixed, wired, and covered by tests. Not a live finding.

---

## Findings

### F1 — MEDIUM — Auth-enforcement layer silently drops routes missing from `apiMetaMap` (no skip record, no failure)
Files: `packages/test-runner/src/runAuthEnforcementTests.ts:29-33`, `testLayerHelpers.ts:59-63`, `runAllTests.ts:329-339`

The auth sweep gates every endpoint on `hasAuthRequirement(apiMetaMap, endpoint)`. When a route present in `apiMethodMap` has **no** entry in `apiMetaMap` (or the entry lacks `auth`), `hasAuthRequirement` returns `false` and the route is `continue`d as "truly public" — no `skipped` result is recorded and nothing is asserted. The contract layer still hits it, but the contract layer treats a `success` response as a PASS, so a protected route that erroneously returns `success` unauthenticated would show green everywhere.

`runAllTests` only warns for the *fully empty* meta map (`hasRoutes && !hasMeta`, line 332) — a **partial** meta map (some routes present, others missing) produces no warning and silent zero-coverage for the missing routes.

Failure scenario: consumer passes a stale/hand-trimmed `apiMetaMap`, or a future generator bug drops a route from meta but not method → that route's login guard is never verified and the run is green.

Mitigant (why MEDIUM not HIGH): `apiMethodMap` and `apiMetaMap` are emitted by the SAME function from the SAME walk (`emitterArtifacts.ts` `buildTypeMapArtifacts`), so in normal generated usage they cannot drift. Real risk requires hand-edited or mismatched inputs.

Suggestion: when a route is in `apiMethodMap` but absent from `apiMetaMap`, record a `skipped` result with a "no meta entry — auth unverifiable" reason instead of silently continuing, so partial drift is visible per-route.

### F2 — LOW — `resolveSyncRouteKey` omits the `system` sentinel for root-level syncs (inconsistent with loader + emitter)
File: `packages/devkit/src/routeNamingValidation.ts:198-202`

```js
const routeBaseKey = pageLocation
  ? `sync/${pageLocation}/${syncName}/${version}`
  : `sync/${syncName}/${version}`;   // <-- root sync: two segments, no 'system'
```

Compare `resolveApiRouteKey` in the same file (line 168: `const mappedPageLocation = pageLocation || 'system';`), the dev loader (`loader.ts:42-44` `mapSyncPageLocation` → `'system'`), and the emitter path. The loader comment (`loader.ts:36-41`) explicitly documents that root syncs MUST use `system` or they "silently never dispatch."

Impact: this function is only used by `collectDuplicateNormalizedRouteKeyIssues`, and both colliding root syncs would compute the same (wrong-format) key, so duplicate *detection* still works. The only user-visible effect is that a duplicate-route error message would print `sync/name/v1_server` instead of the runtime-accurate `sync/system/name/v1_server`. Cosmetic, but it's a latent inconsistency that will bite if this resolver is ever reused for real dispatch.

### F3 — LOW — Contract + fuzz sweeps execute real mutations against PUBLIC state-changing routes; only authenticated sweeps are guarded
Files: `runContractTests.ts` (no method gate), `runFuzzTests.ts:26-36`, `runRateLimitTests.ts:70-80`

The fuzz and rate-limit layers skip state-changing (POST/PUT/DELETE) routes only when `isAuthenticatedSweep` (a `Cookie` header is present). In an **unauthenticated** sweep, a PUBLIC (`login:false`, no additional guards) mutating route receives sample bodies (contract) and junk bodies (fuzz) that reach the real handler. The DB is cleaned by the `resetServerState` bookends around the sweep (`runAllTests.ts:167-172, 243-245`), but non-DB side effects a handler may trigger (transactional email, third-party API calls, webhooks) are not undoable by `/_test/reset`.

Impact is low because (a) it requires a genuinely public mutating route with external side effects, (b) fuzz is positioned as nightly, and (c) DB state is cleaned. Worth a doc note that public mutating routes with side effects should be added to `skip`.

### F4 — LOW — `zodEmitter` emits `z.any()` (fail-open input schema) for intersection / unresolved-reference input types
File: `packages/devkit/src/typeMap/zodEmitter.ts:176-180, 114-116`

Intersections (`A & B`) and unresolved `TypeReference`s fall back to `z.any()`, which accepts ANY input. The generated `apiInputSchemas.generated.ts` is consumed both by the test-runner's sampler and by runtime input validation. A route whose `ApiParams.data` is an intersection therefore gets no structural input validation from this layer.

This is the documented DD-DEVKIT-D2 decision and IS surfaced in `apiTypeDiagnostics.generated.json` (`reason: 'zod-any-fallback'`, `emitterArtifacts.ts:206-248`) with a CI-gate available on `fallbackCount`. Flagged only so the security posture is explicit: intersection-typed inputs are fail-open at the generated-schema layer until the emitter learns to merge object intersections. Recommend consumers keep API input types as flat object literals (which get `.strict()`).

### F5 — LOW — `docs-ui` `sanitizeCssValue` strips `url(` but not other resource-loading CSS functions
File: `packages/docs-ui/src/docsHtml.ts:29-38`

`sanitizeCssValue` removes `}`, `;`, `<`, CR/LF, `url(`, and comment delimiters from `brandColor` / `fontFamily`, but not `image-set(`, `-webkit-image-set(`, or `cross-fade(` — modern CSS functions that can reference external resources (in `image-set` even via a bare quoted string, no `url(` token). A value assigned to `--accent` and later used as a `background` could thus fetch an off-origin resource.

Not an external-attacker vector: `branding` comes from the consumer developer's `mountDocsUi({ branding })` call, never from request input, and the page is dev-only / 404 in prod by default. This is a defense-in-depth completeness note only. If hardening, allowlist a safe grammar (hex/rgb/hsl/named colors for `brandColor`; font-family token list) rather than blocklisting function names.

### F6 — LOW — `extractAuth` public-by-default diverges from runtime for non-literal `login` (documented, safe direction)
File: `packages/devkit/src/typeMap/apiMeta.ts:264-266, 241-249`

`login` is recorded `true` only for a literal `TrueKeyword`. A route written `auth: { login: Boolean(true) }` / `login: someFlag` extracts as `login:false` (public) in `apiMetaMap`, while the dev runtime loader evaluates the expression (`loader.ts:248` `auth.login || false`) and may protect it. The auth sweep then skips a route that is actually protected — a coverage false-negative.

This is the deliberate DK-05 "public-by-default; declare a literal `login: true`" policy. The *dangerous* direction (meta says protected, runtime public) cannot occur: a literal `true` in meta also evaluates truthy at runtime. So this is safe-direction only (under-tests, never over-trusts). Flagged for completeness — the code comment claims the extractor "matches the loader," which is exactly true only for literal values.

---

## Areas reviewed and found clean (no finding)

- **MCP path containment** (`packages/mcp/src/artifacts.ts:31-52`): null-byte reject + lexical `path.relative` escape check + `fs.realpath` symlink-escape check. Solid. All tool handlers validate/disambiguate inputs; graph parsing is zod-validated with safe fallback to null. No filesystem/command exposure — strictly read-only under project root.
- **MCP tool input schemas**: every tool uses zod schemas; numeric-id matching is zero-padded-prefix exact (`get_decision`/`get_lesson`) to avoid substring over-match; `get_example` compares frontmatter literally (no user regex). No injection surface.
- **CLI deploy validator** (`packages/devkit/src/cli/validateDeploy.ts:101-128`): path-injection guard (must stay in cwd), extension allowlist, dynamic import wrapped. Note it does execute the consumer's own compiled config as a side effect — expected and in-scope for a local pre-deploy gate.
- **Supervisor** (`packages/devkit/src/supervisor.ts`): the "never merge `.env` into supervisor env" invariant is carefully preserved (imports nothing from core, uses pure `dotenv.parse`); spawn/exit `handled`-once flag prevents double-restart; fast-crash-loop breaker; SIGTERM grace timer for Windows. No resource leak spotted.
- **test-runner probes** (`probeRequest.ts`, `resetServerState.ts`, `streamWatcher.ts`, `customTests.ts`): every fetch/socket has an AbortController+timeout that is always cleared; watchers/sessions are cleaned in `finally`-equivalent paths; symlink-cycle + path-containment guards in custom-test discovery; teardown throws are swallowed so they can't mask real failures.
- **fuzz assertions** actually assert: `fuzzCheck.ts` fails on no-response, non-envelope body, or error-without-errorCode; it does not silently pass. `contractCheck.ts` correctly downgrades "non-empty sample → route error" to `skipped` (avoids counting a validation rejection as a happy-path pass). `csrfEnforcementCheck.ts` guards GET (would false-green) and asserts both errorCode and HTTP 403.
- **webhook reporter** (`runRegisteredLayers.ts:44-70`): warns on plaintext-http-to-non-loopback before sending; timeout-bounded; failure never fails the run. `runRegisteredLayers` is opt-in and not auto-invoked by `runAllTests`.
- **docs-ui output escaping**: all dynamic values in the embedded client script go through `escapeHtml`; the fetched JSON path is `JSON.stringify` + `<`→`<` escaped to prevent `</script>` breakout; logo URL scheme-validated (`isSafeLogoUrl` rejects `javascript:`/`data:`/protocol-relative); route served with `X-Content-Type-Options: nosniff` + `X-Frame-Options: DENY`, 404 in prod / on public bind unless `enabledInProd`, optional `authorize` hook, GET-only, JSON validated before serving (422 on torn artifact), fs path leaked only in non-prod.
- **balanced-brace extractors** (`templateInjector.ts` extractClientInput*, `zodEmitter.ts`): depth-counted single-pass loops with explicit "never balanced → return null" guards; no catastrophic-backtracking regexes. `$`-in-replacement handled via replacer functions to avoid backref reinterpretation.

---

## Severity tally
- CRITICAL: 0
- HIGH: 0
- MEDIUM: 1 (F1)
- LOW: 5 (F2–F6)
- DOCSUI-01: RESOLVED
