# SESSION_STATE

> Branch: `chore/package-split-prep` · Base: `master`
> **Pick up here at home: publish `@luckystack/* 0.1.2` and verify a fresh `npx create-luckystack-app` install works.**

## Session Summary

This session started as a device-2 "can't build" fix and turned into a full publish + hardening cycle for the 14 `@luckystack/*` packages. We: (1) unblocked the local build, (2) published **0.1.0** to npm, (3) did a TypeScript-6 migration and republished **0.1.1**, then (4) used a real `npx create-luckystack-app` fresh-install test to discover that **0.1.1's scaffold is broken on a fresh machine** — two TS6-fallout bugs. We fixed both (reverting the *consumer template* to TS 5.7.3 while keeping the framework repo + libs on TS6), bumped everything to **0.1.2**, and verified a fresh scaffold is fully green via the `.smoke-test/run.mjs` gate. **0.1.2 is ready but NOT yet published.** The currently-published `@latest` is the broken **0.1.1**.

## Completed Tasks

- **Device-2 build unblock**: root `package.json` TS was fought between `^6.0.0`/`~5.7.3`; final resolution landed via the devkit peer (see below). `tsconfig.shared.json` `ignoreDeprecations` is `"6.0"` (repo is on TS6).
- **Published 0.1.0** (all 14) and **0.1.1** (TS6 migration) to npm under the `@luckystack` org (publisher npm user `lucky23m`). Both are immutable/live.
- **dotenv** unified to `^17.0.0` across all packages (was 16 in core, 17 in login) — zero external-dep drift.
- **TS6 emitter de-risk**: proved devkit's `checker.typeToString` output is **byte-identical** between TS 5.7.3 and 6.0.3 (generated `apiTypes.generated.ts` + `apiInputSchemas.generated.ts` diff = 0). This justified the broad peer.
- **Found via fresh `npx` test — 2 bugs in the published 0.1.1 template, both now fixed locally:**
  - **Bug 1 (baseUrl)**: `template/tsconfig.json` had `baseUrl: "."` → TS6 hard error (TS5101). Fixed: removed `baseUrl`, `./`-prefixed the paths, **added `"luckystack/*": ["./luckystack/*"]`** (the bare-root import `import 'luckystack/i18n/locales'` in `src/main.tsx` relied on baseUrl and broke vite/import-x even though tsc passed).
  - **Bug 2 (eslint-plugin-react-x)**: `react-x@1.x` peer caps at TS `^4.9.5 || ^5.3.3`; template's `typescript: ^6.0.0` → ERESOLVE on fresh install. Investigated whole eslint stack: react-x TS6 support starts at 3.x which needs **ESLint 10**, and `eslint-plugin-react` + `jsx-a11y` have **no ESLint-10 release at all**. So keeping the template on TS6 is currently impossible without dropping plugins.
- **Decision = Pad B** (revert template to TS5, broaden devkit peer): `devkit` peer `^6.0.0` → **`>=5.7.3 <7.0.0`**; template `typescript` → **`~5.7.3`**. Repo + libs stay TS6. devkit docs (`CLAUDE.md`, `docs/ts-program-cache.md`) updated to match.
- **Bumped all 14 → 0.1.2**, internal `@luckystack/*` refs → `^0.1.2`. Final audit: all 14 @ 0.1.2, zero drift, internal refs `^0.1.2`, devkit peer broad, template TS `~5.7.3`.
- **Fresh-scaffold smoke test GREEN** (`.smoke-test/run.mjs`): pack 14/14 → scaffold → install ✅ → prisma ✅ → generateArtifacts ✅ → **typecheck 0 · build PASS · lint 0/0**. The fixed scaffold installs `typescript@5.7.3 + eslint-plugin-react-x@1.53.1` side-by-side with no ERESOLVE.
- Branch-log + INDEX kept current (entries → 103). Memory `project_npm_scope_registration.md` updated (0.1.0 + 0.1.1 published).

## Pending Logic / Known Bugs

- **`@latest` on npm = the broken 0.1.1.** Every `npx create-luckystack-app@latest` currently produces a scaffold whose `npm install` fails (Bug 2). Publishing 0.1.2 fixes this.
- **0.1.2 is NOT published** — only built + smoke-tested locally.
- **Residual unverified gap**: the smoke test uses local `@luckystack/*` tarballs + an `overrides` block (because 0.1.2 isn't on the registry yet). The react-x/TS conflict resolution there is identical to a real install (TS + eslint come from the real registry), but the **real-registry resolution of `@luckystack/*@0.1.2` itself** can only be tested after publishing.
- **Nothing is committed.** The entire session's work sits in the working tree (uncommitted). No `v0.1.x` tag exists.

## Exact Next Step

**Publish 0.1.2, then verify a fresh install at home.** Recommended (safe, staged) route since the fresh-install scaffold broke twice already:

1. Make sure npm 2FA is on **"Authorization only"** (npmjs.com → Account → 2FA), else publish demands an OTP per package.
2. **Staged publish** under the `next` dist-tag (keeps `@latest` = 0.1.1 until proven): the publish script (`scripts/publishPackages.mjs`) currently hardcodes `--tag latest` — **add a `--tag next` option first** (small change), OR publish manually per package with `npm publish --tag next`. Then:
   ```
   npx create-luckystack-app@0.1.2 testfix
   cd testfix && npm i && npm run build && npm run lint
   ```
3. Green? Promote: `npm dist-tag add create-luckystack-app@0.1.2 latest` (and ideally the same for the scoped packages if you tagged them `next` too).
4. Or **direct route** (trust the smoke test): just `npm run publish:packages` → 0.1.2 becomes `@latest` and fixes the live-broken scaffold immediately.
5. After it's live + verified: **commit everything + tag `v0.1.2`** (still pending).
6. Optional: `npm deprecate create-luckystack-app@0.1.1 "broken scaffold on fresh install; use >=0.1.2"`.

## Technical State

**Files modified this session (uncommitted):**
- `SESSION_STATE.md` — this handoff (the earlier publish-handoff one was deleted mid-session; this is new).
- `package.json` (root) — TS back to `^6.0.0` (round-tripped; net vs committed may be clean) — repo stays TS6.
- `tsconfig.shared.json` — `ignoreDeprecations: "6.0"` (round-tripped to committed value).
- `packages/*/package.json` (all 14) — `version: 0.1.2` + internal `@luckystack/*` refs `^0.1.2`.
- `packages/core/package.json` — `dotenv ^17.0.0`.
- `packages/devkit/package.json` — peer `typescript: ">=5.7.3 <7.0.0"`.
- `packages/devkit/CLAUDE.md` + `packages/devkit/docs/ts-program-cache.md` — peer wording → broad range + verified-identical note.
- `packages/create-luckystack-app/template/package.json` — `typescript: ~5.7.3`.
- `packages/create-luckystack-app/template/tsconfig.json` — removed `baseUrl`, `./`-prefixed paths, **added `luckystack/*` path** (the actual fix).
- `package-lock.json`.
- `branch-logs/chore--package-split-prep.md` + `branch-logs/INDEX.md` (entries → 103).
- **Not ours** (parallel `src/workspaces/**` session, ~29 files): leave out of any commit.

**Dev-only / cleanup:**
- `.smoke-test/` — gitignored fresh-scaffold gate (`run.mjs` recreated this session; `app/`, `tarballs/`, `logs/` are throwaway). Re-run with `npm run build:packages && node .smoke-test/run.mjs`. Expect: typecheck 0 · build PASS · lint 0/0.
- A `C:\youcomm\test123` + `C:\youcomm\testfix`(?) scaffold may exist from manual `npx` runs — disposable.

**Environment:**
- Repo + all 14 libs build/run on **TS 6.0.3**; consumer template ships **TS 5.7.3** (intentional — its eslint stack isn't TS6-ready).
- Nothing committed; no tag. npm publisher = `lucky23m`. Org `@luckystack` is live.
- Verify gates (all green this session): `npm run build` · `npm run lint` (0/0) · `npm run lint:packages` (0) · `npm run test:unit` (754/754) · `npm run build:packages` (14/14) · `.smoke-test/run.mjs` (GREEN).
