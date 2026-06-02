# Publish-Readiness Audit — `@luckystack/*` (14 packages)

> Master audit report. Multi-agent audit (2026-06-01 19:50) → safe-fix completion pass (20:12) → post-audit fixes + full package test coverage (22:15). Branch `chore/package-split-prep`.
> Cross-checked against repo ground truth (`git status`, `git diff`, on-disk sweep, and re-run gates) on the final tree.

---

## 1. Executive Summary

**All machine-verified hard gates pass for all 14 packages. Verdict: 14 GO · 0 CONDITIONAL · 0 BLOCKED.** What remains before `npm publish` is the developer-action sweep in §6 (boot the server, live integration test, OAuth/SMTP smoke, npm org, publish) plus the optional recommendations in §4 — no blocker remains in the working tree.

Final-tree gates (all green):

- **G1 build** — `build:packages` 14/14 (tsup, 5 waves).
- **G2 lint** — `lint:packages` zero warnings (`**/*.test.ts` excluded from the packages lint surface by design).
- **`tsc -b`** — clean (the full-build typecheck step, incl. all unit-test files).
- **G3 pack** — `pack:dry` 14/14; every tarball ships `LICENSE` + `CHANGELOG.md`; devkit ships `dist/templates/*`; no `src/` / `*.test.ts` / `*.tsbuildinfo` leakage.
- **G8 unit tests** — `vitest run`: **47 files / 712 tests / 0 failed** (Node env, no live server). All 14 packages now carry unit tests (was 5).

### Resolved since the initial audit

| Item | Status |
|---|---|
| Missing per-package `LICENSE` (was 7/14) | **DONE** — 14/14, byte-identical MIT, verified in `pack:dry`. |
| `CHANGELOG.md` stubs (was 0/14) | **DONE** — 14/14 Keep-a-Changelog `## [0.1.0]` stubs, whitelisted in every `files[]`. |
| Unit tests (was core/api/login/sync/server only) | **DONE** — added for the other 9; 712 tests total, 0 failures. |
| `error-tracking` static `@sentry/node` import | **FIXED** — `sentry.ts` now lazy-loads via `createRequire` inside `initializeSentry()`; default export is a lazy Proxy. `import '@luckystack/error-tracking'` is import-safe without `@sentry/node`. |
| `devkit` templates not shipped to `dist` | **FIXED** — `tsup` copies `src/templates → dist/templates`; verified in tarball. Plus a new consumer template-customization system (see below). |
| `validator` named-import server crash | **FIXED** — `requestEmailChange_v1.ts` (consumer + scaffold template) uses the default-import idiom. |
| `tsc -b` breakage from authored test files | **FIXED** — type errors in the new test files corrected (no `as any`, assertions intact). |

### New capability delivered this pass — devkit consumer template customization

`@luckystack/devkit`'s scaffold-template injection is now fully consumer-customizable. The **selection logic** (which template a new file gets) is a rule engine (`registerTemplateRule` / `registerTemplateKind` / `resolveTemplateKind`), and `create-luckystack-app` ships an editable `.luckystack/templates/` folder (the 6 template bodies + a `templateRules.ts` that devkit auto-loads in dev). Consumers can remove/edit/add selection rules and template kinds as code. Spec: `packages/devkit/docs/template-customization.md`.

---

## 2. GO / NO-GO Matrix

**Gates** — G1 build · G2 lint(zero-warning) · G3 pack(files incl. LICENSE+CHANGELOG, no leakage) · G4 private:false+public · G5 manifest complete · G6 peer-deps valid+lockstep · G7 no undocumented casts · G8 unit tests exist+pass.

Cell values: `P` pass · `~` pass-with-recommendation · `F` fail.

| Package | G1 | G2 | G3 | G4 | G5 | G6 | G7 | G8 | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **@luckystack/core** | P | P | P | P | P | ~ | ~ | P | **GO** |
| **@luckystack/api** | P | P | P | P | P | ~ | ~ | P | **GO** |
| **@luckystack/login** | P | P | P | P | P | ~ | ~ | P | **GO** |
| **@luckystack/sync** | P | P | P | P | P | ~ | ~ | P | **GO** |
| **@luckystack/server** | P | P | P | P | P | ~ | ~ | P | **GO** |
| **@luckystack/email** | P | P | P | P | P | P | P | P | **GO** |
| **@luckystack/presence** | P | P | P | P | P | ~ | P | P | **GO** |
| **@luckystack/error-tracking** | P | P | P | P | P | P | P | P | **GO** |
| **@luckystack/router** | P | P | P | P | P | P | P | P | **GO** |
| **@luckystack/devkit** | P | P | P | P | ~ | P | P | P | **GO** |
| **@luckystack/test-runner** | P | P | P | P | P | ~ | P | P | **GO** |
| **@luckystack/docs-ui** | P | P | P | P | P | P | P | P | **GO** |
| **@luckystack/secret-manager** | P | P | P | P | P | P | P | P | **GO** (replaced env-resolver; re-audited this pass) |
| **create-luckystack-app** | P | P | P | P | P | P | P | P | **GO** (CLI) |

**Roll-up: 14 GO · 0 CONDITIONAL · 0 BLOCKED.** `~` cells are non-blocking recommendations (peer-dep declarations / documented casts / devkit `homepage`+`bugs`) detailed in §4 — none prevent publish.

---

## 3. Per-Package Notes (changes + open recommendations)

Every package now ships `LICENSE` + `CHANGELOG.md` and has passing unit tests; only deltas + open recommendations are listed.

- **core** — 9 unit-test files (tryCatch, normalizers, origin/CORS, page-path, csrf, cookies, projectConfig, rate-limiter). Rec: React peer floor `^19.0.0` vs sync/presence `^19.2.0`; declare `@luckystack/devkit` as optional peer (dev-only lazy import); 7 documented eslint-AST casts (info).
- **api** — unit tests for the HTTP pipeline. Rec: `@prisma/client` redundant direct peer; `@luckystack/error-tracking` declared-unused dep (re-verify the tracing load path before dropping); 3 documented `as unknown as` formatter casts; narrow the blanket `eslint-disable` in `handleApiRequest.ts`.
- **login** — unit tests (validatePassword branches, oauth guards, session keys, redirect resolver, userAdapter). Rec: `dotenv` declared-unused; `@prisma/client` peer only via core re-export; CLAUDE.md INDEX overstates surface; `package.json` description omits Microsoft though `microsoftProvider` is exported.
- **sync** — unit tests (stream throttle, route parsing, fanout, offline-queue). Rec: React floor skew; mark `react` optional (only `/client` uses it); `@prisma/client` redundant peer; 4 documented casts; README client API table stale.
- **server** — unit tests (parseServerArgv, security headers, error-formatter + custom-route registries). **Fixed:** the mid-table CSRF note in `docs/http-routes.md` is now below the route table. Rec: declare `@luckystack/devkit` optional peer (dev-tools dynamic import); `@prisma/client` redundant peer.
- **email** — unit tests (renderEmailLayout, autoSelect, template registry, config merge, Console/SMTP/Resend with mocked peers). Clean G1–G7. Rec: CLAUDE.md `docs/sending.md` dangling links.
- **presence** — unit tests (config merge, activity-event registry + refractory, disconnect-grace timers). Rec (G6): `react-router-dom` imported by `/client` but undeclared — add `^7.0.0` optional peer (resolves transitively via core today). README signatures drift. (`socket.io` correctly optional — type-only in dist.)
- **error-tracking** — unit tests incl. a guard that importing the package without `@sentry/node` does not throw. **Fixed:** lazy `@sentry/node` load (was the top runtime risk). Rec: CLAUDE.md hook list omits `postLogout`; README documents only the legacy Sentry surface.
- **router** — unit tests (parseServiceFromPath, resolver order, binding-port validation). Rec: README `startRouter`/`startHealthPoller` signatures stale; lone `console.error` vs `getLogger()`.
- **devkit** — unit tests (validateDeploy finding codes, template rule engine, route-naming predicates). **Fixed:** `dist/templates` now shipped + consumer template-customization system added. Rec (G5): add `homepage`/`bugs` to `package.json` (only package missing them); CLAUDE.md lists some internal symbols as exports. Note: `sync_client.template.ts` ships but is unreferenced by any kind — harmless, candidate for cleanup.
- **test-runner** — unit tests (walkEndpoints, sampleSchemaInput, extension registries). Rec (G6): `socket.io-client` imported top-level but undeclared — add `^4.8.0` peer (resolves via core today); README Quickstart code is stale.
- **docs-ui** — unit tests (renderDocsHtml, mountDocsUi route handling, prod-gating). Clean G1–G7. Rec: CLAUDE.md lists internal `renderDocsHtml` as export.
- **secret-manager** (replaced env-resolver) — unit tests (pointer detection, resolve mapping, local/remote/hybrid modes, missing-pointer throw, token-from-file, dev poll). **Re-audited this pass: all gates G1–G8 pass** — zero runtime deps (global `fetch` + `node:fs`), no banned casts, builds + packs clean with LICENSE/CHANGELOG, in `buildPackages.mjs` wave 2. No open recommendations. GO.
- **create-luckystack-app** — unit tests (slugify, titleCase, replacePlaceholders, renameDotFile, isTextFile, parseArgs, readSelfVersion). Now ships the `.luckystack/templates/` overlay. Rec: mongodb next-step prints `prisma:db:push` which the template lacks.

---

## 4. Global Backlog (Prioritized) — all non-blocking

1. **[DONE] LICENSE 14/14**, **[DONE] CHANGELOG 14/14**, **[DONE] unit tests 14/14**, **[DONE] error-tracking lazy sentry**, **[DONE] devkit templates in dist + consumer customization**, **[DONE] validator ESM import**.
2. **[MEDIUM — peer-dep declarations]** Add the (currently transitively-resolved) peers for correctness: `presence` → `react-router-dom@^7` optional; `test-runner` → `socket.io-client@^4.8`; mark `sync` `react` optional. Unify the React floor (`^19.0.0` core vs `^19.2.0` sync/presence). Drop confirmed-unused declared deps (`login`→dotenv, `api`→error-tracking — verify tracing path first; `secret-manager` already declares none). Redundant `@prisma/client` direct peers on server/api/sync (harmless; pick one convention).
3. **[LOW — manifest]** `devkit` `package.json` lacks `homepage`/`bugs` (only package without them) — add to match the others.
4. **[LOW — version strategy]** Keep all 14 at `0.1.0` for the first publish; release as one lockstep set, lowest build-wave first (core → wave-2 → error-tracking → api/sync/presence → server). Graph confirmed acyclic. Adopt fixed-mode changesets for future bumps.
5. **[LOW — doc-debt]** README signature/peer drift (api, router, presence, test-runner, error-tracking, sync); CLAUDE.md INDEX rows listing internal symbols as exports (login, devkit, docs-ui, router, server, core-client); `email` `docs/sending.md` dangling links; consider splitting the 129 KB `docs/ARCHITECTURE_PACKAGING.md`. `devkit` ships an unreferenced `sync_client.template.ts` (cleanup candidate).
6. **[LOW — ROADMAP]** `secret-manager` server side lives in a separate, running repo (`luckystack-secret-manager`; wire contract in `docs/ARCHITECTURE_SECRET_MANAGER.md`; client built, falls back to local/hybrid). `npm run ai:index-branchlogs` drift tool still deferred.

---

## 5. Publish-Prep Artifacts Status

| Artifact | Status |
|---|---|
| Per-package `LICENSE` | **14/14 DONE** — repo-root MIT (1096 bytes), byte-identical, in every tarball. |
| `CHANGELOG.md` | **14/14 DONE** — `## [Unreleased]` + `## [0.1.0]` initial-release stub, whitelisted in each `files[]`. |
| Unit tests | **14/14 DONE** — `vitest run` 47 files / 712 tests / 0 failures. |
| `pack:dry` | **PASS** — 14/14, no leakage; devkit ships `dist/templates/*`; create-luckystack-app ships `template/_dot_luckystack/templates/*` (consumer template overlay). |
| Version-bump proposal | Keep all 14 at `0.1.0`; single coordinated lockstep release, lowest build-wave first. |
| Dependency / peer-dep consistency | **PASS with recommendations** (Backlog #2). Graph acyclic; internal deps lockstep `^0.1.0`; shared peer ranges consistent. |

---

## 6. DEVELOPER ACTIONS — machine could not self-verify

> ⚠️ Everything in §1–§5 was harness-verified on the final tree (lint, build, tsc -b, vitest, pack:dry, LICENSE/CHANGELOG on disk, manifests). The items below need a live runtime / network / interactive scaffold / registry access. Do them before `npm publish`.

1. **Boot the dev server** — `npm run server`. Confirm a clean boot (the `validator` crash is fixed) against real Redis + Prisma. *(Server start is always a developer action.)*
2. **Run the full integration sweep** — `npm run test` (contract / auth / rate-limit / fuzz + the Layer-5 per-route tests, incl. the 11 routes authored earlier). Requires step 1.
3. **OAuth end-to-end (Microsoft)** — exercise `microsoftProvider` against a real Azure AD tenant (`MICROSOFT_CLIENT_ID/SECRET` in `.env.local`; registered in `luckystack/login/oauthProviders.ts`). No automated coverage.
4. **SMTP smoke** — `SmtpSender` is unit-tested with a mocked peer, but real delivery needs SMTP creds or Mailpit. Send one transactional mail end-to-end.
5. **Devkit template injection smoke** — in dev, create an empty `src/<page>/_api/x_v1.ts` and confirm injection; optionally edit `.luckystack/templates/templateRules.ts` and confirm the change takes effect.
6. **`create-luckystack-app` scaffold smoke** — `npx create-luckystack-app` (interactive + `--no-prompt`); confirm `.luckystack/templates/` lands and devkit picks it up.
7. **Create the npm org** — `npm org create luckystack`.
8. **Publish** — `npm publish` for all 14, lowest build-wave first, `publishConfig.access: public` (already set). Only after steps 1–7.

---

*End of audit. Final-tree gates: lint PASS · build 14/14 PASS · tsc -b PASS · vitest 47 files / 712 tests PASS · pack:dry 14/14 PASS. Verdict: **14 GO, 0 BLOCKED** — proceed to the §6 developer-action sweep, then publish.*
