# SESSION_STATE — read me first

> **Last full rewrite: 2026-06-11 ~11:20 — by the test/verification pass (Claude).**
> ⚠️ **Multiple AIs are working in this tree in parallel.** This file was rewritten from
> scratch by the testing agent and only covers ITS work + the shared facts every agent needs.
> Other agents: APPEND your own dated `## section` below — do not silently overwrite this one;
> the user will reconcile. For a fresh AI: read `CLAUDE.md` first, then this file top-to-bottom.
> Blow-by-blow history lives in `branch-logs/chore--package-split-prep.md`. Canonical
> optional-package spec: `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md`.

Branch: `chore/package-split-prep` · Base: `master`

---

## 0. TL;DR — where we are (2026-06-11)

- **npm has 0.1.8 published. Working tree is 0.2.0 (15 `@luckystack/*` pkgs + `create-luckystack-app`).**
- **HEAD = `46d6f27`** (my test-infra commit, see §2). On top of HEAD there is **heavy uncommitted parallel WIP from other AIs** (~40 files: decision-memory protocol, `packages/mcp/`, dead-knob features, runbooks/graph generators, email/error-tracking/sync changes). **I did NOT author or verify that WIP** — see §4.
- **My gate sweep was GREEN** when measured at/just-after `46d6f27` on an otherwise-clean tree (§1). **It is NOT a statement about the current tree** — the parallel WIP landed afterward and is unverified by me (there is already ≥1 known TS error in it, §4).

---

## 1. What the test pass verified (2026-06-11, all GREEN at commit 46d6f27)

| Gate | Result |
|---|---|
| `lint` (client+server) · `lint:packages` | 0 errors / 0 warnings |
| `build:packages` | 15/15 |
| `test:unit` | 782/782 |
| `npm run build` (full prod: tsc + vite + bundleServer) | exit 0 |
| `publish:dry` | 15 packages validated, 0 npm warnings |
| `.smoke-test/run.mjs` matrix (full + no-presence) | GREEN — typecheck/build/lint 0, opt-out prune OK |
| `npm run test` integration sweep (live server) | **113 passed · 0 failed · 11 legit skips** |

**Live runtime (browser E2E via agent-browser).** Because the user's other app `matchrix`
occupies :80/:5173, I ran LS-v2 on **alt-ports** (backend :4100 + Vite :5180) and drove the
browser via the `?backend=4100` dev override. Confirmed: **F7** (5 OAuth buttons render,
`/auth/providers` returns JSON, Google redirect builds correctly) · **F1** (register →
auto-login → /playground) · credentials login → /playground · **F4** (logout clears the
HttpOnly cookie → `/auth/csrf` 401 after) · HttpOnly (cookie not JS-readable) · **F11** (CSRF
minted when authed, 401 when not) · API echo + 10-chunk API stream over the socket.

> **F8/F9 (devkit supervisor env-hot-reload) were NOT re-drilled this session** — the offline
> smoke gate proves they BUILD on the dist path, and the supervisor served correctly on :4100,
> but the "edit `.env` → child restarts with fresh value" runtime check from 2026-06-10 was not
> repeated. Re-verify in a fresh scaffold before publishing if you touched devkit.

---

## 2. Committed this session — `46d6f27`

`test(infra): decouple unit suite from built dist + reconcile lockfile + HydrateFallback`

1. **`vitest.config.ts` — unit suite no longer resolves against built `dist`.** Root
   `tsconfig.json` has no `paths`, so vitest's `tsconfigPaths:true` only mapped `@luckystack/*`
   for `src/`-rooted importers; tests under `packages/<pkg>/src` fell through to
   `node_modules → dist`, so a skipped `build:packages` silently broke 145 tests with cryptic
   `"X is not a function"`. Added explicit `resolve.alias` built from `tsconfig.server.json`'s
   path map (parsed via the TS JSONC reader — single source of truth, no drift). **Proven** by
   physically removing `packages/core/dist` → `test:unit` still 782/782.
2. **`package-lock.json`** reconciled — `npm install` had never been run after the committed
   `@vitejs/plugin-react-swc → @vitejs/plugin-react` swap (the full build was failing on
   `Cannot find module '@vitejs/plugin-react'`).
3. **`src/main.tsx` + template `main.tsx`** — `HydrateFallback: () => null` on the root route,
   silencing React Router 7's hydration warning from the lazy-routes conversion.

Branch-log entry appended; INDEX row bumped.

---

## 3. Uncommitted in the tree FROM ME (user chose: leave for them to fold into their WIP commit)

**F10 fix — raw session tokens removed from the demo (consumer `src/settings`):**
- `listSessions_v1.ts` — returns an **opaque SHA-256 `id`** (fingerprint of the token) instead
  of the raw bearer token.
- `revokeSession_v1.ts` — accepts `{ id }`, resolves it back to the real token by scanning the
  **caller's own active-session set** (ownership guaranteed by set membership; raw token never
  leaves the server). Bonus: cross-user revoke now returns `session.invalid` (unresolvable id),
  not `auth.forbidden` — no existence/enumeration signal.
- `settings/page.tsx` — uses `id` for key/display/revoke.
- `listSessions_v1.tests.ts` + `revokeSession_v1.tests.ts` — rewritten to the opaque-id
  contract; assert the raw token never appears.
- **Verified:** `lint:client` 0, client typecheck clean for these files, `generateArtifacts`
  regenerated (the `{ id }` input shape is in the gitignored generated maps). **NOT** run live
  (`npm run test` for these two routes) — do that with a running server before publish.

**Docs scrub (also from me):** removed the test-account block (emails + passwords + a personal
gmail) from this file's old §2 — credentials must not live in the repo. Register fresh via
`/register` (auto-logs-in) or let `npm run test` self-register; the dev DB is disposable.

---

## 4. ⚠️ Parallel WIP from other AIs — NOT verified by the test pass

The working tree (on top of `46d6f27`) carries large uncommitted work I did not author and did
not gate: decision-memory protocol (`docs/decisions/`, `DECISION_MEMORY_PROTOCOL.md`,
generators), `packages/mcp/`, dead-knob feature build-outs (accountStrategy, sync validation
mode, email template fallback, error-tracking beforeSend forwarding), runbooks/graph tooling,
plus edits across core/email/login/sync/error-tracking. **Known issue:** at least one TS error
exists in it — `packages/error-tracking/src/adapters/beforeSendForwarding.test.ts` (unused
`id`). **Do not treat the current tree as green.** Re-run the full gate (§1) after the WIP is
consolidated.

---

## 5. Infra / how to run locally (what I used this session)

- **Redis** up on :6380 · **Mongo** on **:27018** (the real `DATABASE_URL` lives in `.env.local`
  — never read it unless re-granted; `.env` has only public keys, one-key-per-file).
- `matchrix` (the user's OTHER app) runs on **:80 + :5173** — leave it alone.
- **Alt-port recipe (avoids the matchrix clash):** `SERVER_PORT=4100 npm run server` (supervisor
  passes its env to the child) + `npm run client -- --port 5180`, then browse
  `http://localhost:5180/?backend=4100` (dev override persists in sessionStorage).
- agent-browser: installed its managed Chrome into `~/.agent-browser/browsers`; drive via
  `npx agent-browser`. Note: login uses a plain `fetch` to `/auth/api/credentials` (HTTP, not
  socket) and reads inputs by `name`; the form's submit button is `type="button"`.
- `config.ts` currently: `sessionBasedToken: false` (cookie mode), `allowMultipleSessions: true`,
  presence + socket-status indicator ON.

---

## 6. Publish blocker + open items

- **Nothing of 0.2.0 is published.** After the tree is consolidated + green: commit, then
  publish. **Publish is gated on the npm 2FA wall** — on npmjs.com set Two-Factor Auth to
  "Authorization only", then `npm run publish:packages` (builds + publishes in dependency order).
  Fallback: `npm config set auth-type legacy` + OTP. Re-run `publish:dry` first (expect 0 warns).
- A human security review of the CSRF double-submit fallback (login-absent path,
  `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md` §7) is wise before publish.
- **F10 is now fixed (§3)** — was the standing "raw tokens leak" report-only item.
- `.env` may still duplicate OAuth secrets from `.env.local` (one-key-per-file convention; the
  user may want to clean it). DevTools lag after lazy-loading is much reduced (~127→17 modules on
  `/login`) — confirm acceptable. Splat+lazy: the per-page `/*` route remounts on subpath nav
  (only affects the `src/workspaces` prototype).

---

## 7. Key references

- Full work log: `branch-logs/chore--package-split-prep.md` (parts 1–9s + the 2026-06-11 entry).
- Optional-package architecture: `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md` · adding features
  later: `docs/LUCKYSTACK_ADD_GUIDE.md` · audits: `docs/audits/*`.
- AI browser testing: `docs/AI_BROWSER_TESTING.md` · package matrix: `docs/PACKAGE_OVERVIEW.md`.
- Workspaces project: ALL workspaces-related code/docs/prototypes were consolidated into
  `workspaces-handoff/` (2026-06-11) and removed from the rest of the repo (`handoff/`,
  `sparring/`, `src/workspaces/`, `ui-builder/`, and the `workspacesTerminal` hook + its
  registration). `workspaces-handoff/` is a self-contained drop-in handoff package —
  **ignore it in all subsequent steps** (codebase scans, lint, indexing). It stays in the
  repo for now but is slated to be removed soon.

---

## 8. AI2 (2026-06-11, later session) — v0.2.0 "dead-knob" features + scaffolder wizard/CLI flow

> Written by a SECOND agent (AI2), after the test-pass author's §0–§7 above. I authored the
> dead-knob feature build-out that §4 lists as "unverified parallel WIP" — **it is now COMPLETE,
> green, and gated.** The §4 "known TS error in beforeSendForwarding.test.ts" is FIXED. This
> section supersedes §4 *for those specific items only*; the rest of §4's WIP (decision-memory,
> packages/mcp, runbooks/graph) is a different agent's — I did not touch or verify it.

### 8.1 What I built (the 5 documented-but-dead config knobs from `review/v0.2.0/` the user chose to BUILD rather than strip)

1. **`ErrorTrackerEvent.forwarded` honored + SEC-05** (`packages/error-tracking/src/adapters/`) — `runBeforeSend.ts` → `resolveExceptionEvent`/`resolveMessageEvent`: drop on `forwarded:false`, and forward the hook's RETURNED (redacted) payload, not the original. 3 adapters updated. Tests: `runBeforeSend.test.ts`, `beforeSendForwarding.test.ts`.
2. **Per-sync `validation`** (QUA-044/QUA-013) — `packages/sync/src/_shared/validationMode.ts`; both sync handlers skip validation on `relaxed`/`{input:skip}`; devkit dev-loader forwards `validation`+`errorFormatter`. Test: `validationMode.test.ts`.
3. **Email built-in template fallback** (QUA-067/CFG-05) — `packages/email/src/builtInTemplates.ts` (`password-reset`+`email-change`); `sendEmail` falls back to built-ins; login forgotPassword/emailChange dispatch via `sendEmail({template,data})` so `registerEmailTemplate` override works without a fork. Tests: `builtInTemplates.test.ts`, `sendEmailTemplateResolution.test.ts`.
4. **`providerAccountStrategy:unified`** (CFG-04) — `UserAdapter.findByEmailAnyProvider` (default Prisma impl); `packages/login/src/accountStrategy.ts` applied at the 3 lookup sites in `login.ts`; warns+falls back if a custom adapter lacks the method. Migration doc in login `README.md`. Test: `accountStrategy.test.ts`.
5. **Wizard/CLI flow — feature 3 (QUA-005), COMPLETE:**
   - **CFG-01**: every scaffold option now has a CLI flag (`--db/--auth/--oauth/--email/--monitoring/--i18n|--no-i18n/--ai-docs|--no-ai-docs` + existing `--no-presence/--ai-browser=`); flags pre-seed+skip the wizard and apply under `--no-prompt`. `index.test.ts` → 68 tests.
   - **`authMode:none`** (gated prune): drops @luckystack/login dep; removes `src/{login,register,reset-password,settings}` + LoginForm + `functions/session.ts` + `server/hooks/notifications.ts`; rewires `page.tsx`/`dashboard`/`Home`/`config.ts`/`luckystack/server/index.ts`. KEEPS anonymous session plumbing (`_api/session_v1` + SessionProvider) so it compiles.
   - **`i18n:false`** (gated prune): single-language English scaffold — drops nl/de/fr locales, reduces `locales.ts`, `LANGUAGES=['en']` + `newLanguage` seed.

   Implemented in `packages/create-luckystack-app/src/index.ts` (`pruneOptionalPackages` + the CFG-01 flag plumbing); helpers `dropDependency`/`removeScaffoldPath`/`editScaffoldFile` (throws on missing token, no-op on missing file). Prunes are GATED on a non-default choice → a buggy prune can never affect a default scaffold.

### 8.2 Verification (what I actually ran)

- `lint:packages` 0 · `build:packages` **16/16** · `test:unit` **818/818** (was 782; +36 new tests — supersedes §1's 782).
- **`.smoke-test/run.mjs` matrix GREEN** — I added two combos (`no-i18n`, `auth-none`) alongside `full`/`no-presence`. All 4: pack 14 tarballs → `file:` deps → `npm install` → `prisma generate` → `generateArtifacts` → `typecheck` (0 TS) → `build` → `lint` (0/0). `full`/`no-presence` green ⇒ my framework-package changes don't regress a default scaffold.
- Smoke caught + I fixed 2 real compile bugs: `newLanguage` seed (no-i18n) + the login-only `postLogin` hook augmentation disappearing (auth-none).

### 8.3 ⚠️ LIMITS of my verification — read before trusting "it works"

- **Build-level only. NO runtime test of my scaffolder work** — no server boot, no browser, no actual login/OAuth/email/socket for the pruned (`auth-none`/`no-i18n`) apps. "Works" = compiles/builds/lints, not runtime-verified.
- **Only DEFAULT option values + the 3 prune combos were smoke-built.** NOT separately built: `--db=postgresql|mysql|sqlite`, `--email=resend|smtp`, `--monitoring=sentry|datadog|posthog`, `--oauth=...`, `--auth=credentials+oauth`, `--no-ai-docs`. Research says these already take effect via env-block + dep-injection + boot auto-wire, but I did not build/run each.
- The **interactive arrow-key wizard** pre-seed/skip is covered by code-reasoning + an empty-steps guard + `parseArgs` unit tests, NOT a live TTY run.

### 8.4 ❌ NOT ready for v0.2.0 — what's still open

I addressed **only the 5 dead knobs + CFG-01** out of the **252-finding `review/v0.2.0/` audit**. Its own **"before publishing 0.2.0" ship-blocker list (`review/v0.2.0/SUMMARY.md` §4)** is largely UNADDRESSED:

- **CRITICAL `QUA-001`**: docs-ui renderer parses the wrong JSON shape → docs page dead-on-arrival. NOT fixed.
- **Security highs — NOT fixed**: `SEC-02` prod input-validation no-op · `SEC-03` missing-`auth` fail-open · `SEC-04` ConsoleSender prints reset tokens in prod · `SEC-09` single-request DoS · `SEC-10` `socket.join(token)` before session check · `SEC-11` sync `filter` leaks `serverOutput` · `SEC-08` XFF spoofing · `SEC-01/06/07/13` · `HOK-02` `preEmailSend` stop-signal ignored. (`SEC-05` IS fixed, bundled with item 1 in §8.1.)
- **Broken-on-arrival quality — NOT fixed**: `QUA-004` Windows `npm install` silently fails (spawn `.cmd` shell:false) · `QUA-009` bootstrap empty-catch swallows register failures · `QUA-010` env-resolver ghost `dist/` pollutes the AI index · `QUA-014` template scripts drift · `QUA-015` stale login overlay · `QUA-017` CI sweep can't pass · `QUA-003` `luckystack add login` asset drift.
- **Configurability (`CONFIGURABILITY.md`, CFG-07..43)** — NOT done: more dead/partial knobs + hardcoded values (e.g. `registerSentryConfig` no-ops in the auto-register flow, hardcoded timeouts/paths). So "no dead configs remain" is NOT true yet.
- **Missing features (`MISSING_FEATURES.md`, 29)** — NOT built: email-verification on signup, 2FA, PKCE, graceful shutdown, presence roster/offline event, router health endpoint, email attachments/headers, per-account brute-force lockout, etc. (User earlier said "build all for 0.2.0" — only the 5 dead knobs got done.)
- **Deletions the user approved but NOT yet done**: `packages/env-resolver/` ghost `dist/`, `.publish-dry.out`, `server/dev/request.py`, the stale `luckystack/login/oauthProviders.ts` overlay. (KEEP `@luckystack/secret-manager` — that is the LIVE third-party env resolver, NOT the dead env-resolver.)
- **Behavior-changing security defaults** the user said apply-now (fail-closed auth, prod validation on, `/_health` hash hiding, sync room-membership) — NOT applied.

### 8.5 How to re-verify the scaffolder after any template/scaffolder change

1. Clean stale combo dirs first (a locked leftover makes `fresh()` silently fail → "Target directory already exists"): `rm -rf .smoke-test/app-full .smoke-test/app-no-presence .smoke-test/app-no-i18n .smoke-test/app-auth-none`.
2. `npm run build:packages` then `node <ABS-PATH>/.smoke-test/run.mjs` (run.mjs is cwd-independent via `import.meta.url`, but pass an ABSOLUTE path so a stray cwd doesn't double-prefix `.smoke-test/.smoke-test/`).
3. Combos live in the `COMBOS` array in `.smoke-test/run.mjs`. Expect `SMOKE MATRIX GREEN`.

### 8.6 Suggested next focus

Work the `review/v0.2.0/SUMMARY.md` §4 **"before publishing 0.2.0"** list in the same gated + smoke-verified style: critical `QUA-001` first, then the security highs, then `QUA-004` (Windows install). Then a **runtime smoke** (boot the server + drive auth / auth-none / i18n flows in a browser per §5's alt-port recipe) — everything I verified is build-level only. Per-finding detail lives in `review/v0.2.0/{SECURITY,CODE_QUALITY,CONFIGURABILITY,HOOKS,MISSING_FEATURES,SUMMARY}.md`.

---

## 9. AI3 (2026-06-11) — the AI-dev-tooling stack (decision memory, MCP, graph, runbooks, intent, ownership)

> Written by a THIRD agent (AI3). **I authored the work that §4 + §8 flagged as "unverified parallel WIP:
> decision-memory protocol, `packages/mcp/`, runbooks/graph generators."** This section claims + documents
> it. It supersedes §4's "decision-memory / packages/mcp / runbooks/graph" line ONLY (the dead-knob/email/
> error-tracking/sync WIP in §4/§8 is AI2's, not mine). My focus was making the framework **AI-driven**:
> the layers an AI reads/writes to understand a codebase. **Nothing is committed.** Verification limits in §9.4.

### 9.1 What I built — the AI-context stack

All ship to consumers when they accept AI tooling in the wizard (`aiInstructions`), via the
`create-luckystack-app` framework-docs copy + `template/` mirror + the consumer pre-commit hook.

| Layer | Files | What it gives the AI |
|---|---|---|
| **Decision memory** | `docs/decisions/NNNN-*.md` (ADRs 0001-0006) + `scripts/generateDecisionsIndex.mjs` → `docs/AI_DECISIONS_INDEX.md` + `docs/DECISION_MEMORY_PROTOCOL.md` | The committed "why" — automatic AI behavior (no slash command), with an empty-memory **backfill offer** that mines git/branch-logs AND **interviews the user** (§8 of the protocol) |
| **Runbooks** | `scripts/generateRunbooks.mjs` → `docs/AI_RUNBOOKS.md` | Task-shaped golden paths grounded in the project's real files |
| **Invariant linter** | `scripts/lintInvariants.mjs` (`ai:lint`) + `luckystack.invariants.json` | Diff-time enforcement of no-as-any / arbitrary-color / i18n-jsx; report-only by default; `--selftest` (10 fixtures) |
| **Dependency graph** | `scripts/generateGraph.mjs` → `docs/ai-graph.json` | File/import blast-radius + god-nodes AND **symbol-level call edges** via the TS compiler (`symbols`/`callEdges`/`symbolBlastRadius`) |
| **MCP server** | `packages/mcp/` (`@luckystack/mcp`, 15th pkg) | 9 read-only tools (`blast_radius`/`who_imports`/`who_calls`/`god_nodes`/`list_decisions`/`get_decision`/`find_route`/`get_runbook`/`get_capability`) over the committed artifacts; runs via `npx`, in `.mcp.json` |
| **Intent/product** | `docs/PRODUCT.md` + `//? intent:` page convention + `scripts/generateProductOverview.mjs` → `docs/AI_PRODUCT_OVERVIEW.md` | Plain-language "what the app + each page is FOR" |
| **Ownership + coverage** | folded into `generateProjectIndex.mjs` | per-route `@docs owner` summary + a `Tested` column (sibling `.tests.ts`) |
| **Sharding toggle** | `luckystack.ai.json` (`docs.sharding`: auto/single/per-folder + threshold) | The read-whole markdown docs split per src folder at scale; graph + MCP unaffected (queried) |

**Wiring:** root + `template/` `package.json` gained `ai:decisions/runbooks/graph/product/lint`; both
pre-commit hooks (framework `.githooks/pre-commit` + the scaffold's `AI_INDEX_HOOK`) regenerate **all 6
generators + git-add** and run `ai:lint`; `@luckystack/mcp` added to `buildPackages`/`publishPackages`
WAVES + `tsconfig.server.json` include; `eslint.config.js` has one scoped exception (MCP-SDK `.js`
subpath resolver quirk, documented). `CLAUDE.md` extended: a **Decision Memory Protocol** section, a
**language rule (2a)** "reply in the user's language" (the English-docs drift fix), self-maintenance in
Rule 12 (the AI keeps memory/graph/docs current itself), a session-start **memory-coverage check** (offer
backfill+interview on a thin-memory existing repo), and Rules 15a/15b + a test-prioritization rule.

**Decisions recorded (the system documenting itself):** ADR 0001 (ship the decision log), 0002 (TS-native
graph over Python graphify), 0003 (hold RAG as the last/optional rung — NOT for v0.2.x), 0004 (file-level
graph first), 0005 (MCP server separate from the browser MCP servers), 0006 (symbol graph in the script,
not devkit).

### 9.2 Design docs
`docs/AI_BOOST_PLAN.md` (the full roadmap, Waves 1-3 shipped, Wave 4 RAG gated) + `docs/AI_BOOST_OVERVIEW.md`
(catalog of every AI surface, updated). The earlier `AI_BOOST_ROADMAP.md` was superseded + removed.

### 9.3 Verified (what I actually ran)
- `lint:all` + `lint:packages` 0/0 · `@luckystack/mcp` build (ESM+DTS) green · scaffold `create-luckystack-app`
  build + bundleFrameworkDocs (5/5) + **68/68** unit tests · `ai:lint --selftest` 10/10.
- All 6 generators **deterministic** (consecutive-run diffs byte-identical) · sharding toggle verified both
  directions (single ↔ per-area shards, stale dir auto-cleaned).
- `@luckystack/mcp` **real MCP handshake probe** (spawn → initialize → tools/list → tools/call): all 9 tools,
  correct `blast_radius`/`who_calls`/`list_decisions` answers from the committed artifacts.
- `npm install` was run once (added the MCP SDK, 0 vulnerabilities) — the lockfile changed.

### 9.4 ⚠️ LIMITS — read before trusting
- **NOT committed.** Everything above is uncommitted working-tree.
- **NOT run through `.smoke-test/run.mjs`.** The new generators (`ai:product`/`ai:graph` TS-compiler pass/
  `ai:decisions`/the enriched project-index) + the consumer `.mcp.json` wiring have NOT been validated in a
  fresh scaffold. The smoke matrix + its COMBOS (§8.5) must be re-run with these before publish. **`ai:graph`
  builds a full `ts.Program` (~4.5s) — the heaviest pre-commit step; SYMBOL_FILE_CAP guards huge repos, but
  consider moving it to CI if commit latency bites.**
- **`@luckystack/mcp` only works for consumers AFTER 0.2.0 is published** (their `.mcp.json` uses
  `npx @luckystack/mcp@latest`). This repo's own `.mcp.json` points at the local dist so it works here now.
- The **backfill/interview has NOT been run** on this repo — only the 6 ADRs from my own session exist.
- A lot of the AI-driven behavior is **CLAUDE.md instruction-driven** (high-probability, not hard-enforced)
  vs the deterministic generators+hooks.

### 9.5 What still needs to happen to make the framework AI-driven (my assessment)
**A. Make it real first (before any new capability):** (1) commit; (2) **smoke-test the new generators in a
fresh scaffold** (§8.5 recipe); (3) publish 0.2.0 (so `@luckystack/mcp` resolves for consumers); (4) run the
backfill/interview once on this repo as the first real test of that behavior.
**B. The biggest remaining capability — the VERIFY/trust loop:** make "done" provable, not promised —
verifiable-goal contracts + auto-verify (the parked `@luckystack/verify`: Rule 1a is prose, not enforced),
autonomous browser/runtime verification in the loop, and an eval-harness for the AI's own output.
**C. Deterministic nudges:** pre-commit warnings when a route changes but `PRODUCT.md`/intent or a decision
isn't updated — turn instruction-reliance into a hard signal where it matters.
**D. Scale frontier (parked, designed-in via the per-folder/threshold approach):** cross-service graph,
multi-agent coordination, per-agent safety boundaries, RAG (ADR 0003).
My recommendation: **A before B.** No point adding capabilities until the current stack is committed,
smoke-green in a real scaffold, and published.

### 9.6 Key references (mine)
`docs/AI_BOOST_PLAN.md` (roadmap) · `docs/AI_BOOST_OVERVIEW.md` (catalog) · `docs/DECISION_MEMORY_PROTOCOL.md`
· `docs/decisions/` (ADRs) · `packages/mcp/CLAUDE.md` · branch-log parts 10–14 in
`branch-logs/chore--package-split-prep.md`.
