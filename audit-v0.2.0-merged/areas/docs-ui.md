# docs-ui — Verified & Merged Audit Findings
Sources: reports/docs-ui.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
Of the merged findings, the standout is a CONFIRMED **critical correctness bug**: the embedded renderer (`docsHtml.ts:339-342`) iterates the artifact as a nested `{page:{name:{version:meta}}}` object, but devkit emits — and the live working-tree artifact (`src/docs/apiDocs.generated.json`) confirms — `apis: { "<page>": ApiDocsEntry[] }` (an ARRAY of flat entries per page). The shipped docs page renders garbage rows against the real artifact, so the package's sole feature is broken out of the box. Both the try-it-out URL bug (no `/api/` prefix → posts miss the API router) and the missing-CSRF bug (cookie-mode POSTs are 403'd) are CONFIRMED, making the runner doubly broken under defaults. Also CONFIRMED: the auto-register route shadowing at `/_docs` (no keyed-replace in the custom-route registry), no `authorize` hook, sync events never rendered, branding CSS injection, several low XSS seams (unescaped `method`, unescaped `onclick` route/version), the unstyled `.badge`, no real-artifact test, and hardcoded English strings. Nothing in this area was fixed by commit 302cbf1 (which touched login/wizard, not docs-ui) — every claim still stands against current code. The two scans agree closely; the only severity tension is the renderer mismatch, which review/ rated Critical and reports/ flagged as a "likely" doc-vs-code mismatch worth verifying — review/ was right: it is a hard, confirmed break, not just a doc gap.

## Findings

### DUI-01 — Renderer JSON-shape mismatch: expects nested object, devkit emits arrays · severity: crit · status: CONFIRMED
- **Sources:** reports (Docs gaps "renderer mis-parses the real artifact") + review (QUA-001 Critical) — both
- **Current location:** `packages/docs-ui/src/docsHtml.ts:339-342` (render loop); artifact `src/docs/apiDocs.generated.json:2-3`; emitter type `packages/devkit/src/typeMap/emitterArtifacts.ts:61-64`
- **Original claim:** `render()` assumes `apis: { page: { name: { version: meta } } }`; devkit emits `apis: Record<string, ApiDocsEntry[]>`, so the page renders nonsense.
- **Verification (current code):** `emitterArtifacts.ts:62` declares `apis: Record<string, ApiDocsEntry[]>`. The live artifact is `"apis": { "playground": [ { "page":"playground","name":"echo","version":"v1","method":"POST", ... }, ... ] }`. The renderer does `for (const [page, names] of Object.entries(apis))` → `for (const [name, versions] of Object.entries(names))` → `for (const [version, meta] of Object.entries(versions))`. With `names` an ARRAY, `Object.entries` yields `["0", entry0], ["1", entry1]` (so `name="0"`), and `Object.entries(entry0)` yields the entry's FIELDS — `["page","playground"], ["name","echo"], ...` — so `version="page"` and `meta="playground"` (a string). `renderEndpoint` then reads `meta.method`/`meta.auth` off a string (undefined → "POST"/"public"), producing one garbage row per field. The string-only tests never feed a real artifact, so it shipped undetected.
- **Verdict & why:** CONFIRMED, critical. The package's only feature is broken against the artifact the framework actually generates. review/ (Critical) was right over reports/ ("likely mis-parses … verify against a live artifact") — verified live: it does.
- **Recommendation:** Rewrite `render()`/`renderEndpoint` to iterate `for (const entry of pageEntries)` using `entry.name`/`entry.version`/`entry.method`/`entry.input`/`entry.output`/`entry.auth`/`entry.meta`. Fix `mounting.md:152` to the array shape. Add the fixture test (DUI-11).

### DUI-02 — Try-it-out runner posts to wrong URL (missing `/api/` prefix) · severity: high · status: CONFIRMED
- **Sources:** review (QUA-007 High) — review (reports/ did not separately raise the missing-prefix; it focused on CSRF)
- **Current location:** `packages/docs-ui/src/docsHtml.ts:217`; matcher `packages/server/src/httpRoutes/apiRoute.ts:23`
- **Original claim:** `fetch('/' + route + '?stream=false')` with `route = page/name/version` posts to `/playground/echo/v1`; API router only matches `/api/`, so every Send misses the endpoint.
- **Verification (current code):** Line 217 is verbatim `await fetch('/' + route + '?stream=false', …)`. `runEndpoint` is invoked (line 314) with `page + '/' + name + '/' + version` — no `/api/`. `apiRoute.ts:23` is `if (!routePath.startsWith('/api/')) return false;`. The displayed path on line 269 is correctly `'/api/' + page + …`, confirming the runner path is the buggy one. The `version` param of `runEndpoint` (line 204) is also dead (never used in the body).
- **Verdict & why:** CONFIRMED. The runner can never reach an endpoint; requests fall through to SPA/static.
- **Recommendation:** Post to `'/api/' + route + '?stream=false'`; drop the dead `version` param; reconcile mounting.md:192 (already says `/api/…`) with html-generation.md:112 ("no leading /api/").

### DUI-03 — Try-it-out sends no CSRF token; cookie-mode rejects every POST · severity: high · status: CONFIRMED
- **Sources:** reports (#2 Medium) + review (QUA-008 High) — both
- **Current location:** `packages/docs-ui/src/docsHtml.ts:217-222`; enforcement `packages/server/src/httpRoutes/csrfMiddleware.ts:21-37`
- **Original claim:** Default config is cookie mode (`session.basedToken: false`); CSRF middleware 403s state-changing `/api/*` POSTs lacking the `x-csrf-token` header. The runner sends only `Content-Type` + `credentials:'include'`, never fetches `/auth/csrf`.
- **Verification (current code):** The fetch (lines 217-222) sends `headers: { 'Content-Type': 'application/json' }`, `credentials: 'include'`, no CSRF header. `csrfMiddleware.ts:21-37`: when `!basedToken` (cookie mode) AND state-changing AND `routePath.startsWith('/api/')`, it requires a matching `x-csrf-token` (header vs cookie double-submit when login absent, header vs session token when login present) or returns 403 `auth.csrfMismatch`. So once DUI-02 is fixed, the POST still 403s under default cookie mode.
- **Verdict & why:** CONFIRMED. Two scans agree on the defect; severity reconciles to High (review/'s rating) — it fully breaks the feature under the framework's own default, beyond reports/'s "limited impact" Medium framing (which is fair only because the feature is off by default + dev-only). Live impact: High when enabled.
- **Recommendation:** In the runner, `GET /auth/csrf` once with `credentials:'include'`, cache the token, send it under the configured header name on each POST. Document the token-mode (`basedToken:true`) path where the header isn't required.

### DUI-04 — Auto-registered mountDocsUi() shadows consumer customization at /_docs · severity: high · status: CONFIRMED
- **Sources:** review (CFG-03 high) — review (reports/ noted the auto-register env-gate breadth in #4 but not the shadowing)
- **Current location:** `packages/docs-ui/src/register.ts:19`; registry `packages/server/src/customRoutesRegistry.ts:27-48`
- **Original claim:** `register.ts` unconditionally `registerCustomRoute(mountDocsUi())` at boot (before the consumer overlay); the registry is append-only with first-match-wins, so a consumer's customized mount at the same `/_docs` is permanently shadowed — branding/`enabledInProd` silently ignored.
- **Verification (current code):** `register.ts:19` is `registerCustomRoute(mountDocsUi());` (no options). `customRoutesRegistry.ts:30-39` `registerCustomRoute` only honors `phase`; the default path is `handlers.push(handler)` — append-only, no `key`/replace. Dispatch returns the first handler that returns `true`. The only removal is `clearCustomRoutes()` (nukes all). So a later overlay mount at `/_docs` runs AFTER the auto instance and never gets the request. register.ts's own comment (lines 8-9) promising overlay override is false for this registry.
- **Verdict & why:** CONFIRMED. The documented customization path silently no-ops; `enabledInProd:true` is dead because the plain auto instance 404s `/_docs` first in prod.
- **Recommendation:** Add keyed-replace semantics to `registerCustomRoute(handler, { key })` (last write per key wins) and key register.ts as `'docs-ui'`; or have register.ts store options in a package singleton the overlay's `mountDocsUi()` updates. Until then, document the routePath workaround.

### DUI-05 — No authorize/guard hook on MountDocsUiOptions · severity: med · status: CONFIRMED
- **Sources:** reports (Hooks "no auth/authorization hook") + review (HOK-01 High) — both
- **Current location:** `packages/docs-ui/src/index.ts:44-83` (`MountDocsUiOptions`)
- **Original claim:** No `authorize`/`guard` seam; once the route matches, the handler serves HTML + the full `apiDocs.generated.json` to any requester. The documented "internal portal with its own auth layer" can't be built (compounded by DUI-04 shadowing).
- **Verification (current code):** `MountDocsUiOptions` (index.ts:44-83) has `routePath`, `pageTitle`, `enabledInProd`, `apiDocsPath`, `branding`, `template`, `enableTryItOut` — no `on*`/`authorize`/`guard`. The handler (index.ts:99-157) does the NODE_ENV/enabledInProd gate then serves unconditionally; no auth callback.
- **Verdict & why:** CONFIRMED as a real extensibility gap. Severity reconciles to Medium: it's a missing hook on an opt-in, default-off, dev-intended tool — review/'s "High" overstates given `enabledInProd` defaults false and is explicitly opt-in; reports/'s Low/Hooks framing undersells the prod-portal use case the docs advertise. Medium is the honest middle.
- **Recommendation:** Add `authorize?: (req: IncomingMessage) => boolean | Promise<boolean>`, checked after route match and before any response; on false, return the same 404 as prod-lockdown so the route stays unprobeable. Consider a boot warning when `enabledInProd` is true without one.

### DUI-06 — Sync events never rendered despite emitter producing them · severity: med · status: CONFIRMED
- **Sources:** reports (Hard blocks + Docs gaps) + review (MIS-007 medium) — both
- **Current location:** `packages/docs-ui/src/docsHtml.ts:329`; emitter `packages/devkit/src/typeMap/emitterArtifacts.ts:61-64`; claim `packages/docs-ui/CLAUDE.md:7`
- **Original claim:** Package CLAUDE.md says "Sync events appear alongside APIs." The emitter emits `syncs: Record<string, SyncDocsEntry[]>`, present in the artifact. But `render()` reads only `data.apis` (line 329); no code touches `data.syncs`.
- **Verification (current code):** `emitterArtifacts.ts:63` declares `syncs: Record<string, SyncDocsEntry[]>` with clientInput/serverOutput/clientOutput/serverStream/clientStream. `docsHtml.ts:329` is `const apis = data && data.apis ? data.apis : data;` — grep of the file shows zero references to `syncs`. CLAUDE.md:7 still claims sync rendering.
- **Verdict & why:** CONFIRMED. In a socket-first framework, the entire `_sync/` surface is invisible and the CLAUDE.md claim misleads.
- **Recommendation:** Render a per-page sync group from `data.syncs` (event name, version, clientInput, serverOutput/clientOutput, stream shapes). If deferred past 0.2.0, correct CLAUDE.md:7 to say sync rendering is not yet implemented.

### DUI-07 — brandColor / fontFamily interpolated unescaped into <style> (CSS injection) · severity: med · status: CONFIRMED
- **Sources:** reports (#1 Medium) — reports (review/ did not separately raise this)
- **Current location:** `packages/docs-ui/src/docsHtml.ts:36-39` (`renderDocsCss`), defaults `:395-396`
- **Original claim:** `renderDocsCss(accent, fontFamily)` interpolates both raw into the `:root` block; `accent`=`branding.brandColor`, `fontFamily`=`branding.fontFamily`, with no validation/escaping (unlike pageTitle/logoUrl/jsonPath which use `escapeHtml`). A `}`-bearing value can break the rule; `</style>` could break out into script context.
- **Verification (current code):** Lines 36-39 are `--accent: ${accent};` / `--font-family: ${fontFamily};` / `--post: ${accent};` — raw. `renderDocsHtml` (lines 395-396) feeds `branding.brandColor` / `branding.fontFamily` straight in; only `pageTitle`/`logoUrl`/`jsonPath` go through `escapeHtml`. theming.md documents fontFamily as interpolated "as-is".
- **Verdict & why:** CONFIRMED but config-trust-bounded: branding is developer-supplied `mountDocsUi({ branding })` config, not request input — not remotely exploitable. Medium is correct.
- **Recommendation:** Validate `brandColor` against a CSS-color allowlist (hex/`rgb()`/`hsl()`/named); reject or escape `}`/`<` in `fontFamily`; or document the trust boundary as accepted.

### DUI-08 — meta.method interpolated unescaped into class + label · severity: low · status: CONFIRMED
- **Sources:** review (SEC-36 low) — review
- **Current location:** `packages/docs-ui/src/docsHtml.ts:273`
- **Original claim:** `<span class="method ${method}">${method}</span>` where `method = (meta.method||'POST').toUpperCase()` comes from the fetched JSON with no `escapeHtml`, against html-generation.md:125's "never inserts unescaped user-supplied strings" guarantee and the doc's foreign-JSON acceptance.
- **Verification (current code):** Line 273 is `<span class="method ${method}">${method}</span>` — `method` (line 265) is unescaped; every sibling interpolation uses `escapeHtml`. Normally devkit types method as a 4-value union, so exploitation needs a tampered/foreign artifact — but the renderer's `JSON_PATH` fetch and html-generation.md:39 explicitly accept foreign JSON, making it a stored-XSS seam into the developer's browser.
- **Verdict & why:** CONFIRMED, low (trusted data source by default; foreign-JSON is the documented-but-edge input). Also falsifies html-generation.md:125's escaping guarantee.
- **Recommendation:** `${escapeHtml(method)}` for the label and whitelist the class: `['GET','POST','PUT','DELETE'].includes(method) ? method : 'POST'`.

### DUI-09 — Try-it-out route/version interpolated into inline onclick unescaped · severity: low · status: CONFIRMED
- **Sources:** review (SEC-37 low) — review
- **Current location:** `packages/docs-ui/src/docsHtml.ts:241`
- **Original claim:** `'<button onclick="runEndpoint(this,\'' + route + '\',\'' + version + '\',…)">'` — `route`/`version` from JSON page/name/version with no HTML-attr or JS-string escaping; a `'`/`"` in a route name breaks out into script.
- **Verification (current code):** Line 241 builds the `onclick` exactly as claimed, concatenating raw `route`/`version`. POSIX filenames can contain quotes, and foreign JSON is accepted, so a quote-bearing name injects into the `onclick` JS string.
- **Verdict & why:** CONFIRMED, low — `enableTryItOut` is off by default and route names rarely contain quotes; trusted source by default.
- **Recommendation:** Drop inline `onclick`: render escaped `data-route`/`data-version` attributes and bind via `addEventListener` in the same pass as the `.endpoint` toggle binding (also unblocks DUI-10).

### DUI-10 — Docs page requires script-src 'unsafe-inline' (CSP-incompatible) · severity: low · status: CONFIRMED
- **Sources:** review (SEC-38 low) — review
- **Current location:** `packages/docs-ui/src/docsHtml.ts:196-387` (inline `<script>`), inline `onclick` at `:241`
- **Original claim:** The page is one inline `<script>` plus inline `onclick`; any strict CSP (no `'unsafe-inline'`) silently breaks it. The framework invites consumers to register a CSP via `registerSecurityHeaders` applied to every response including this one.
- **Verification (current code):** `renderDocsScript` (lines 196-387) emits a single inline `<script>`; line 241 adds an inline `onclick`. No nonce is generated or stamped. A consumer-registered strict CSP applies to this response and would block both.
- **Verdict & why:** CONFIRMED, low (dev-only by default), but the advertised `enabledInProd` portal collides directly with a hardened CSP.
- **Recommendation:** Generate a per-response nonce in `mountDocsUi`, stamp the `<script>` tag, expose it to the template builder, and replace inline `onclick` with `addEventListener` (DUI-09). Document the interaction in theming.md until implemented.

### DUI-11 — No test exercises the render pipeline against a real artifact shape · severity: med · status: CONFIRMED
- **Sources:** reports (Code quality "renderDocsScript … untested") + review (QUA-030 Medium) — both
- **Current location:** `packages/docs-ui/src/docsHtml.test.ts`; `packages/docs-ui/src/index.test.ts` (`'{"apis":{}}'` stubs)
- **Original claim:** docsHtml.test.ts only string-asserts produced HTML; index.test.ts covers routing/gating with empty stubs. Nothing executes the embedded `render()`/`renderEndpoint()` against a representative artifact — exactly why DUI-01 and DUI-02 shipped unnoticed.
- **Verification (current code):** docsHtml.test.ts asserts substring presence in the HTML string; the inline script is never executed. index.test.ts (verified at the stub site) uses empty `{"apis":{}}`-style stubs. The ~190-line embedded program (lines 196-387) has zero runtime coverage.
- **Verdict & why:** CONFIRMED. The devkit↔renderer contract is untested on both sides; this is the proximate cause of the critical DUI-01.
- **Recommendation:** Add a JSDOM (or extracted-function) test loading a fixture matching `GeneratedDocsData` (arrays of ApiDocsEntry + syncs) and assert rows render with correct paths/methods/counts. Longer term: extract `render`/`renderEndpoint`/`renderAuth`/`passesFilter` into a testable module bundled into the HTML string.

### DUI-12 — Two `as unknown as` casts in index.test.ts (zero-cast policy) · severity: low · status: CONFIRMED
- **Sources:** review (QUA-065 low) — review
- **Current location:** `packages/docs-ui/src/index.test.ts:64, 68`
- **Original claim:** `({ url, method }) as unknown as IncomingMessage` and `res as unknown as ServerResponse` — test doubles, reported per the zero-tolerance instruction.
- **Verification (current code):** Line 64 is `({ url, method }) as unknown as IncomingMessage`; line 68 is `res as unknown as ServerResponse`. Both carry explanatory comments (lines 66-67) noting the handler only touches `setHeader`/`end`/`statusCode`.
- **Verdict & why:** CONFIRMED present, but the documented-exception case — structural test doubles with justification. Low; arguably acceptable.
- **Recommendation:** Use `Pick<IncomingMessage,'url'|'method'>` / a minimal interface, or `satisfies` + one shared documented cast helper, if strict zero-cast is desired.

### DUI-13 — Inline `.badge` class for tags has no CSS rule (unstyled) · severity: low · status: CONFIRMED
- **Sources:** review (QUA-066 low) — review
- **Current location:** `packages/docs-ui/src/docsHtml.ts:305`; CSS `renderDocsCss` `:27-187`
- **Original claim:** Tags render `<span class="badge">` but the stylesheet defines no `.badge` rule — tags render as plain unstyled text, unlike the styled `.auth-tag`, though extension-fields.md documents tags as "tag badges".
- **Verification (current code):** Line 305 emits `'<span class="badge">' + escapeHtml(String(t)) + '</span>'`. The CSS block (lines 27-187) defines `.auth-tag` (172-180) but no `.badge`. Confirmed unstyled.
- **Verdict & why:** CONFIRMED, low — a documented visual feature silently degraded; also a signal the extension-field path was never visually exercised (cf. dead `version` param in DUI-02).
- **Recommendation:** Add a `.badge` rule mirroring `.auth-tag`, or reuse the `auth-tag` class for tags.

### DUI-14 — docs-ui UI strings hardcoded English, no `strings` option · severity: low · status: CONFIRMED
- **Sources:** reports (Hooks "no localization hook") + review (CFG-34 low) — both
- **Current location:** `packages/docs-ui/src/docsHtml.ts:239, 331, 360-363, 415` (+ auth tags 251-259)
- **Original claim:** User-visible strings are fixed ("Try it out (live request)", "No matches.", "No API docs available…", "Filter by route name…", endpoints/pages pills, "login required"/"public") with no `strings` knob; only escape is full template replacement. Framework Rule 13 mandates i18n.
- **Verification (current code):** Strings are inline at the cited lines (e.g. line 239 "Try it out (live request)", line 331 empty-state, line 363 "No matches.", line 415 placeholder, lines 360-361 pills, lines 251/259 auth tags). `MountDocsUiOptions`/`RenderDocsHtmlOptions` expose no `strings`.
- **Verdict & why:** CONFIRMED, low — dev tool, template escape hatch exists, but a non-English `enabledInProd` portal can't translate without forfeiting the renderer.
- **Recommendation:** Add `strings?: Partial<DocsUiStrings>` merged over English defaults, threaded into `renderDocsCss`/`renderDocsScript`.

### DUI-15 — enabledInProd serves docs with zero built-in auth + live runner · severity: low · status: CONFIRMED
- **Sources:** reports (#3 Low) — reports
- **Current location:** `packages/docs-ui/src/index.ts:107-156`
- **Original claim:** With `enabledInProd:true` the handler does no auth of its own — it relies on the consumer placing an auth layer in front (which DUI-04 + DUI-05 show is impossible without forking). With `enableTryItOut` a misconfigured portal exposes the full catalog + a one-click live-POST runner.
- **Verification (current code):** index.ts:107 gates only on `NODE_ENV==='production' && !options.enabledInProd`. When `enabledInProd` is set, no auth check runs before serving HTML/JSON (lines 121-156). Confirms the same surface as DUI-05.
- **Verdict & why:** CONFIRMED, low — documented and opt-in. It is effectively the consumer-facing symptom of the missing DUI-05 hook + DUI-04 shadowing.
- **Recommendation:** Close via the DUI-05 `authorize` hook; until then, document that any internet-reachable prod mount needs an external auth proxy.

### DUI-16 — Production gate keys solely on NODE_ENV==='production' + auto-register · severity: low · status: CONFIRMED
- **Sources:** reports (#4 Low) — reports
- **Current location:** `packages/docs-ui/src/index.ts:107`; auto-mount `packages/docs-ui/src/register.ts:19`
- **Original claim:** Staging/preview hosts that don't set `NODE_ENV=production` (common) expose `/_docs` + the catalog by default the moment the package installs (auto-registers via register.ts:19) — no consumer code edit gates it.
- **Verification (current code):** index.ts:107 is the only prod gate and it is env-string-only. register.ts:19 unconditionally mounts at boot. So on a non-prod-labelled but internet-reachable host, `/_docs` is live by default.
- **Verdict & why:** CONFIRMED, low — documented default + dev-intended, but auto-register + env-only gate widen the blast radius on non-prod public hosts.
- **Recommendation:** Document that any internet-reachable non-prod host must set prod-equivalent gating explicitly, or gate auto-register behind an env opt-in.

### DUI-17 — Doc drift: extension-fields.md / mounting.md document the wrong artifact shape · severity: low · status: CONFIRMED
- **Sources:** reports (Docs gaps) — reports (review/ folds this into QUA-001)
- **Current location:** `packages/docs-ui/docs/mounting.md:152`; `packages/docs-ui/docs/extension-fields.md`
- **Original claim:** Both docs show `apis` as nested `{ "<page>": { "<name>": { "<version>": {...} } } }`; the emitted artifact is `apis: { "<page>": [ flat entries ] }`.
- **Verification (current code):** mounting.md:152 reads `{ "apis": { "<page>": { "<name>": { "<version>": { ... } } } } }`. The artifact and emitter are the array shape (see DUI-01). Doc is wrong.
- **Verdict & why:** CONFIRMED — same root cause as DUI-01; fix together.
- **Recommendation:** Update mounting.md:152 and extension-fields.md to the array shape after fixing the renderer.

### DUI-18 — Doc contradiction + false escaping guarantee in html-generation.md · severity: low · status: CONFIRMED
- **Sources:** reports (Security #2 + verdict) — reports (review/ touches via QUA-007 doc note + SEC-36)
- **Current location:** `packages/docs-ui/docs/html-generation.md:112, 125`; vs `mounting.md:192`
- **Original claim:** html-generation.md:112 says the runner posts with "no leading /api/" while mounting.md:192 says it posts to `/api/<page>/…`; and :125 claims "the renderer never inserts unescaped user-supplied strings."
- **Verification (current code):** The code posts WITHOUT `/api/` (DUI-02), matching html-generation.md:112 but contradicting mounting.md:192 — and the no-`/api/` behavior is itself the bug. :125's escaping guarantee is false given the unescaped `method` (DUI-08).
- **Verdict & why:** CONFIRMED. Two doc files disagree on the runner URL, and the escaping guarantee is violated.
- **Recommendation:** After fixing DUI-02/DUI-08, reconcile both docs to the corrected `/api/` behavior and remove/qualify the absolute escaping claim.

### DUI-19 — escapeHtml duplicated ("must stay identical") with no enforcement · severity: low · status: CONFIRMED
- **Sources:** reports (Code quality) — reports
- **Current location:** `packages/docs-ui/src/docsHtml.ts:7` (core import) + `:246-248` (inline JS copy); contract `html-generation.md:118-125`
- **Original claim:** The inline JS `escapeHtml` (lines 246-248) must match core's `escapeHtml` (imported line 7) but nothing tests equivalence; drift would silently open a client-side XSS gap.
- **Verification (current code):** Line 7 imports `escapeHtml` from `@luckystack/core`; lines 246-248 define an independent inline copy mapping `& < > " '`. No test compares the two. html-generation.md:118-125 documents the "must stay identical" requirement.
- **Verdict & why:** CONFIRMED, low — currently equivalent, but unenforced.
- **Recommendation:** Add a test importing both and comparing output over a fixed corpus.

### DUI-20 — Minor config/code-quality gaps (no-store cache, hardcoded runner path/?stream, fixed logo size, filter scope, stateByKey leak) · severity: low · status: CONFIRMED
- **Sources:** reports (Missing config options + Code quality) — reports
- **Current location:** `packages/docs-ui/src/index.ts:135` (no-store), `docsHtml.ts:217` (hardcoded `?stream=false`), `index.ts:398` (logo `height:32px`), `docsHtml.ts:320-324` (filter page/name only), `docsHtml.ts:199, 369` (`stateByKey` unbounded)
- **Original claim:** JSON read from disk every request with `Cache-Control: no-store` hardcoded; runner path + `?stream=false` hardcoded; logo size fixed; filter is name/page only; `stateByKey` grows unbounded for page lifetime.
- **Verification (current code):** All confirmed at the cited lines: index.ts:135 `res.setHeader('Cache-Control','no-store')`; docsHtml.ts:217 hardcoded `?stream=false`; index.ts:398 `height:32px;width:auto`; passesFilter (320-324) matches only `page + '/' + name`; `stateByKey` is a module-lifetime `Map` never pruned.
- **Verdict & why:** CONFIRMED, all low/negligible — acceptable for a dev tool; bundled here as minor polish items.
- **Recommendation:** Optional knobs (cache-control, `apiBasePath`, logo size, filter scope) only if the `enabledInProd` portal use case is prioritized; the `stateByKey` leak is negligible.

### DUI-21 — DocsTemplateBuilder starved of enableTryItOut / req context · severity: low · status: CONFIRMED
- **Sources:** reports (Hooks) — reports
- **Current location:** `packages/docs-ui/src/index.ts:38-42` (type), `:149-151` (call site)
- **Original claim:** Custom templates receive only `{ jsonPath, pageTitle, branding }` — not `enableTryItOut` nor `req` (cookies, locale, CSP nonce), limiting the documented "full replacement" escape hatch.
- **Verification (current code):** `DocsTemplateBuilder` (lines 38-42) is `(input: { jsonPath; pageTitle; branding }) => string`; the call (lines 149-151) passes exactly those three. No `req`/`enableTryItOut`/nonce.
- **Verdict & why:** CONFIRMED, low — reasonable for a dev tool, but a structural limit (and blocks a nonce-based CSP fix per DUI-10).
- **Recommendation:** Extend the builder input with `enableTryItOut`, `req`, and (for DUI-10) a per-response `nonce`.
