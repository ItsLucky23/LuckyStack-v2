# SESSION_STATE — 2026-06-04 (publish-ready handoff, device 1 → device 2)

> **Purpose:** continue this session on another machine and **do the npm publish together** with the AI.
> **As soon as you (the AI on device 2) have read this: DELETE this file.**
> **Branch:** `chore/package-split-prep` · **Base:** `master` · **Git user:** ItsLucky23
> **Status:** the 14 `@luckystack/*` packages @ **0.1.0** are **fully publish-ready & verified**. Only the actual `npm publish` remains — that's the part we do together.

---

## ⚠️ STEP 0 — GET THE CODE ONTO DEVICE 2 FIRST (read this before anything)

The **entire working tree is UNCOMMITTED** (all the publish-prep work lives only in the working dir on device 1). For device 2 to have it, device 1 must **commit + push**, then device 2 **pulls**.

**On device 1 (before/while leaving):**
```bash
git add -- . ':!src/workspaces' ':!handoff'   # exclude the parallel session's folders (see Orientation)
git commit -m "release prep: @luckystack/* v0.1.0 — scaffold type-safety + devkit // hardening

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git tag v0.1.0
git push origin chore/package-split-prep
git push origin v0.1.0
```
**On device 2:**
```bash
git fetch && git checkout chore/package-split-prep && git pull
npm install        # REQUIRED — restores node_modules + the @luckystack/* workspace symlinks
node -v            # confirm >= 20.19 (ideally 22). See "Device-2 gotchas" below.
```

**Gotchas for device 2 setup:**
- `.smoke-test/` is **gitignored** → it does NOT travel via git. The smoke-runner script is pasted in full at the **bottom of this file** (Appendix A) if you want to re-verify on device 2. You don't strictly need it — `npm run publish:dry` is the necessary pre-publish gate; the smoke test is extra confidence.
- **Stray `node` npm package gotcha:** on device 1 a `node` package once sat at `~/node_modules/node` (v20.5.0) and shadowed real Node for home-dir scripts. If `node -v` on device 2 shows something weird (e.g. 20.5.0), check for a stray `node`/`node_modules` in your home dir. Real Node 22 is what you want.
- **Never read `.env.local`** (real secrets). Template `_dot_env*` placeholder files are fine.

---

## ORIENTATION / CONSTRAINTS (carry these verbatim)

- **A second AI works in parallel on this same branch** under `src/workspaces/**` (+ `handoff/`, `server/hooks/workspacesTerminal.ts`, deps like `motion`/`@xterm`/`node-pty`). **IGNORE all of `src/workspaces/**` + `handoff/`** — not ours; they sometimes break lint/tsc only inside `src/workspaces/**` — their problem. Some uncommitted files in `packages/devkit` (`supervisor.ts`, `ambientEnvSnapshot.ts`, `tsconfig.json`, `CLAUDE.md`, `docs/supervisor.md`) are also **not from our work** — leave them.
- **`src/playground/` STAYS** (permanent dev tool, ships nowhere).
- **Autonomy:** `npm run lint/build/build:packages`, git read-cmds, `git add`+`git commit` = autonomous. `npm install`, **publish**, `rm`, force-push, branch-delete = **ask first**. Server start = developer action.
- **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Nothing is committed unless the user explicitly asks.**

---

## CURRENT STATUS — EVERYTHING IS DONE EXCEPT PUBLISHING

All three "remaining items" the user wanted before publishing are **done + verified end-to-end**. A freshly-scaffolded `create-luckystack-app` project (built from the new local tarballs) passes **`tsc --noEmit` = 0 errors · `vite build` = PASS · `lint` = 0 errors / 0 warnings**. All 14 packages: **v0.1.0, not private, `access: public`**.

### ✅ Verification snapshot (all green, on device 1)
- `npm run build:packages` → **14/14**
- devkit unit tests → **25/25** (`npx vitest run packages/devkit/src/typeMap/*.test.ts` from repo root)
- `npm run lint:packages` → **0**
- Fresh-scaffold smoke test (`.smoke-test/run.mjs`) → pack **14/14**, scaffold/install/prisma/generateArtifacts ✅, **tsc 0 · build PASS · lint 0 errors / 0 warnings**
- Generated `apiTypes.generated.ts` in the scaffold proved **strict** (53 literal-status discriminated unions, 0 loose `{ status: string }`; `apiRequest`/`syncRequest` augmented via `declare module "@luckystack/core/typemap"`; injected `tryCatch` is a clean strict generic). **Type strictness was NOT weakened by any of this work.**

---

## 🎯 THE REMAINING JOB: PUBLISH (do this together on device 2)

### One-time prerequisites (the user has NOT published before — walk them through it)
1. **npm account** with a **verified email** (npmjs.com/signup → verify email, or npm blocks publishing).
2. **Create the `luckystack` organization on the WEBSITE** (this creates the `@luckystack` scope; without it `@luckystack/core` publish → 404/403). npmjs.com → avatar → **Add Organization** → name exactly **`luckystack`** → **Free** plan (free = unlimited *public* packages). ⚠️ `npm org create` is NOT a real CLI command — ignore the comment in `scripts/publishPackages.mjs`; use the website.
3. **Log in:** `npm login`, then confirm `npm whoami`.
4. **2FA note:** the script publishes 14 packages back-to-back. If 2FA is set to *"Authorization and writes"*, npm demands a fresh OTP per package (rotates every 30s → painful). Easiest: npmjs.com → **Account → Two-Factor Authentication → "Authorization only"** for the publish. (Cleaner alt: a Granular **Automation** access token in `~/.npmrc` bypasses the per-publish prompt.)

### Publish steps
1. **Commit + tag** (if not already done in STEP 0 above) — clean tree + a `v0.1.0` tag.
2. **Dry run (uploads nothing — proves packing + auth):**
   ```bash
   npm run publish:dry
   ```
   Expect `✅ [dry-run] validated 14 packages`. Auth error → fix prereq 3. Scope/org error → fix prereq 2.
3. **Real publish (clean build, then publishes core → … → create-luckystack-app in dependency order):**
   ```bash
   npm run publish:packages
   ```
4. **Verify:** open `https://www.npmjs.com/package/@luckystack/core` (+ a couple others), then in an empty dir: `npx create-luckystack-app@latest my-test-app`.

### Publish gotchas
- **A version publishes only once.** To re-publish, bump (`0.1.0` → `0.1.1`); npm permanently rejects re-uploading `0.1.0`.
- **If it fails midway**, the script prints which packages already went up. Fix the cause and re-run — npm refuses already-published versions, so just let the rest finish (or `cd packages/<name> && npm publish --access public`).
- **`create-luckystack-app` is published last on purpose** (so every package its scaffold references already exists on the registry when someone runs it).

### Key scripts (in repo `package.json` + `scripts/`)
- `scripts/publishPackages.mjs` — `npm run publish:packages` (real) / `npm run publish:dry` (`--dry-run`). Runs a **fresh `build:packages` first**, then `npm publish --access public` per package in wave order. **Does NOT commit.** Publish waves: `core` → `email,login,devkit,router,test-runner,docs-ui,secret-manager` → `error-tracking` → `api,sync,presence` → `server` → `create-luckystack-app`.
- `scripts/buildPackages.mjs` — `npm run build:packages` (all 14) / `npm run pack:dry` (`--pack-dry-run`).
- `.smoke-test/run.mjs` — the fresh-scaffold gate (gitignored; Appendix A).

---

## FULL CHANGE HISTORY (what produced this publish-ready state)

### Part A (earlier this session, prior context) — `apiRequest`/`syncRequest` typed for DIST consumers
The augmentable stubs `ApiTypeMap`/`SyncTypeMap` live in `packages/core/src/apiTypeStubs.ts`. The devkit emitter used to augment `declare module '@luckystack/core'`, but tsup hoists the stubs into a hashed dts chunk, so augmenting the re-exporting barrel never merged → consumers' `apiRequest` was untyped. **Fix:**
- `packages/core/tsup.config.ts` — added `src/apiTypeStubs.ts` to `entry` → stable `dist/apiTypeStubs.d.ts`.
- `packages/core/package.json` — added `"./typemap": { "types": "./dist/apiTypeStubs.d.ts" }`.
- `packages/devkit/src/typeMap/emitterArtifacts.ts` (~line 482) — augment target `@luckystack/core` → **`@luckystack/core/typemap`** (+ fixed a stale "auto-degrades to unicast" comment ~line 234).
- `tsconfig.client.json` + `tsconfig.server.json` — path `@luckystack/core/typemap` → `packages/core/src/apiTypeStubs.ts`.
- **KEY GOTCHA:** TS merges `declare module 'X'` only with an interface DECLARED in X, never one merely re-exported (barrel/chunk).

### Part B/C (earlier this session) — template type-correctness (turned 44 tsc errors → 0)
Root causes were broken plumbing, NOT bad handler code. All in `packages/create-luckystack-app/template/`:
- **`tsconfig.server.json`** — devkit's `getServerProgram` (tsProgram.ts) builds its program from this file's list; it lacked the API files → handlers absent → loose `{ status: string }` outputs. Added `src/**/_api/**/*`, `src/**/_sync/**/*`, `src/**/_server/**/*`, `src/**/*_server.ts(x)` to `include`. Also `module: NodeNext→ESNext`, `moduleResolution: NodeNext→bundler` (the server code uses extensionless/bundler-style imports; NodeNext couldn't resolve `SessionLayout` → session result `any`).
- **`config.ts`** — added `export type { AuthProps } from '@luckystack/login';` (every `_api` imports it from config).
- **`prisma/schema.prisma`** — added `preferences Json?`; `avatar`/`avatarFallback` `String?` → `String @default("")`.
- **`useSession<SessionLayout>()`** is the intended pattern — applied in `src/_components/templates/TemplateProvider.tsx` + `src/settings/page.tsx`.
- Null coercions in `Avatar.tsx`, `settings/page.tsx`, `Home.tsx`; `socketStatusProvider.tsx` + `SessionProvider.tsx` fixes; `server/server.ts` `eslint-disable unicorn/no-abusive-eslint-disable`; `reset-password/_api/sendReset_v1.ts` → `import { isEmail } from 'validator'`.
- **`package.json`** — added `"typecheck": "tsc --noEmit"`; engines `>=20.0.0` → **`>=20.19.0`**. **`.github/workflows/ci.yml`** — added a "Type check" step.
- Even earlier prior-session work already in the tree: `vite.config.ts` alias `@luckystack/core`→`/client`; `shared/tryCatch.ts` `//`→`/* */` block comment; `deploy.config.ts` + `services.config.ts` (type exports + `environments: {}`); `src/vite-env.d.ts` (new); renamed 3 eslint configs `_dot_eslint_*` → `eslint.config.js`/`eslint.official.config.js`/`eslint.luckystack.config.js`; `src/_sockets/*` shims; `uuid ^14.0.0`; deprecated-API migrations; email optional-peer in `server/hooks/notifications.ts`; lint `--ignore-pattern "server/prod/**"`; `revokeSession` raw try/catch → `functions.tryCatch`.

### This session (device 1) — the FINAL 3 items
- **Item 3 — cleared the 4 `jsx-no-literals` warnings (proper i18n, no eslint-disable):** `template/src/_components/templates/Home.tsx` ("Settings"/"Sign out" → `home.settings`/`home.signOut`, added `useTranslator`) + `template/src/dashboard/page.tsx` (converted the arrow-component to a hook body; "Dashboard" → existing `dashboard.title`, description → new `dashboard.description`). Added the new keys (`home` namespace + `dashboard.description`) to all 4 locale files `template/src/_locales/{en,nl,de,fr}.json`.
- **Item 4 — devkit type-map `//`-comment hardening (`packages/devkit/src/typeMap/functionsMeta.ts`):** the generator collapses an extracted function-type signature to one line; an inline `//` then commented out the rest → malformed generated TS (`validateGeneratedTypeIdentifiers: unresolved type identifiers [""]`). Added `stripLineComments()` built on `ts.createScanner(skipTrivia:false)` — drops only `SingleLineCommentTrivia`, so `//` inside string/template literals (e.g. `'https://x'`) and block comments survive (a naive regex would corrupt those). Fed it into `normalizeInlineType()` (params/return/inferred) AND routed the **generics clause** through it (it bypassed normalize via a raw `.trim()` slice and was also vulnerable — `.trim()` drops the newline that terminated a `//` in a constraint, pulling `>` into the comment). New test file `packages/devkit/src/typeMap/functionsMeta.test.ts` (8 cases). **This only touches the injected `functions.*` types, NOT api/sync I/O typing (that's `extractors.ts`, untouched).**
- **Item 5 — fresh-from-tarball smoke test (the pre-publish gate):** added `.smoke-test/run.mjs` (gitignored; Appendix A). Rebuilt all 14 packages, packed them, scaffolded a fresh app, rewired its 9 direct `@luckystack/*` deps to `file:` tarballs + a 13-lib `overrides` block, installed, prisma-generated (mongodb), then ran the consumer gates — all green.
- **Bookkeeping:** appended a branch-log entry (`branch-logs/chore--package-split-prep.md`) + bumped `branch-logs/INDEX.md` (entries 88→89). Updated memory `project_scaffold_smoke_test.md` (follow-ups closed).

---

## UNCOMMITTED FILE LIST (device 1 working tree — what travels in the commit)

Our publish-prep changes (the relevant ones to ship; **exclude `src/workspaces/**` + `handoff/`** which are the parallel session's):
- `.gitignore` (added `.smoke-test/`)
- `branch-logs/INDEX.md`, `branch-logs/chore--package-split-prep.md`
- `packages/core/*` (tsup.config.ts, package.json, apiTypeStubs — Part A; built dist)
- `packages/devkit/src/typeMap/functionsMeta.ts` **+ functionsMeta.test.ts (new)**, `emitterArtifacts.ts`
- `packages/create-luckystack-app/src/index.ts`, `template/.github/workflows/ci.yml`, `template/config.ts`, `template/deploy.config.ts`, `template/services.config.ts`, `template/package.json`, `template/prisma/schema.prisma`, `template/tsconfig.server.json`, `template/vite.config.ts`, `template/shared/tryCatch.ts`, `template/server/server.ts`, `template/server/hooks/notifications.ts`, `template/scripts/generateServerRequests.ts`
- `template/src/_components/{Avatar,LoginForm}.tsx`, `template/src/_components/templates/{Home,TemplateProvider}.tsx`, `template/src/_providers/{SessionProvider,socketStatusProvider}.tsx`, `template/src/dashboard/page.tsx`, `template/src/settings/page.tsx`, `template/src/settings/_api/{changePassword,revokeSession,updateUser}_v1.ts`, `template/src/reset-password/_api/{confirmReset,sendReset}_v1.ts`, `template/src/_locales/{en,nl,de,fr}.json`
- New (untracked): `template/src/_sockets/`, `template/src/vite-env.d.ts`, `packages/devkit/src/typeMap/functionsMeta.test.ts`
- **NOT ours (leave / they belong to the parallel session or were already there):** `packages/devkit/src/supervisor.ts`, `packages/devkit/src/ambientEnvSnapshot.ts` (untracked), `packages/devkit/tsconfig.json`, `packages/devkit/CLAUDE.md`, `packages/devkit/docs/supervisor.md`, and everything under `src/workspaces/**` + `handoff/`.
- **Gitignored (won't travel):** `.smoke-test/` (regenerable — Appendix A).

> If you used `git add -- . ':!src/workspaces' ':!handoff'` it will also stage the not-ours devkit files above. That's fine to ship (they're harmless framework changes), or stage selectively if the user prefers a cleaner release commit.

---

## Useful references
- Per-package AI index: `packages/<name>/CLAUDE.md`. Package use-case + peer-deps: `docs/PACKAGE_OVERVIEW.md`.
- Architecture: `docs/ARCHITECTURE_*.md` (PACKAGING, API, SYNC, FUNCTION_INJECTION, …).
- Approved plan from this work: `~/.claude/plans/eerste-ding-wat-mij-fluttering-squirrel.md`.
- Memory (auto-loaded): `memory/MEMORY.md` → `project_scaffold_smoke_test.md`, `project_publish_readiness.md`, `feedback_minimal_change_preference.md`, `feedback_big_task_working_style.md`.

---

## Appendix A — `.smoke-test/run.mjs` (gitignored; recreate on device 2 only if you want to re-verify)

> Optional. `npm run publish:dry` is the necessary gate; this is extra confidence. Put this at `.smoke-test/run.mjs`, run `npm run build:packages` first, then `node .smoke-test/run.mjs`. Expect: tsc 0 · build PASS · lint 0/0.

```js
#!/usr/bin/env node
//? Final pre-publish gate: scaffold a fresh create-luckystack-app project, wire
//? it to the freshly-built local tarballs (file: deps + an overrides block so
//? transitive unpublished @luckystack deps resolve offline), then run the exact
//? gates a real consumer runs: generateArtifacts -> typecheck -> build -> lint.
//? Run AFTER `npm run build:packages` (this script only packs the existing dist).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const tarballsDir = path.join(here, 'tarballs');
const appDir = path.join(here, 'app');
const logsDir = path.join(here, 'logs');
const projectName = 'app';

const PACKAGE_DIRS = [
  'core', 'email', 'login', 'devkit', 'router', 'test-runner',
  'create-luckystack-app', 'docs-ui', 'secret-manager', 'error-tracking',
  'api', 'sync', 'presence', 'server',
];

const DB_URL = 'mongodb://localhost:27017/smoke';
const node = `"${process.execPath}"`;

const steps = [];
const fresh = (p) => { fs.rmSync(p, { recursive: true, force: true }); };

function sh(label, cmd, { cwd = repoRoot, env = {}, allowFail = false } = {}) {
  process.stdout.write(`\n▶ ${label}\n  $ ${cmd}\n  cwd: ${cwd}\n`);
  const res = spawnSync(cmd, {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8', shell: true, maxBuffer: 96 * 1024 * 1024,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  fs.writeFileSync(path.join(logsDir, `${label.replaceAll(/[^a-z0-9]+/gi, '_')}.log`), out);
  const code = res.status ?? (res.error ? 1 : 0);
  const ok = code === 0;
  process.stdout.write(`  ${ok ? '✅' : '❌'} exit=${code}\n`);
  if (!ok) process.stdout.write(`${out.split('\n').slice(-50).join('\n')}\n`);
  steps.push({ label, ok, code, out });
  if (!ok && !allowFail) { summarize(); process.exit(1); }
  return { code, ok, out };
}

function summarize() {
  process.stdout.write('\n── smoke-test summary ──\n');
  for (const s of steps) process.stdout.write(`  ${s.ok ? '✅' : '❌'} ${s.label}\n`);
}

fs.mkdirSync(logsDir, { recursive: true });
fresh(tarballsDir);
fresh(appDir);
fs.mkdirSync(tarballsDir, { recursive: true });

const tarballByName = {};
for (const dir of PACKAGE_DIRS) {
  const pkgDir = path.join(repoRoot, 'packages', dir);
  const { out } = sh(`pack ${dir}`, `npm pack --json --pack-destination "${tarballsDir}"`, { cwd: pkgDir });
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  const { name, filename } = parsed[0];
  tarballByName[name] = filename;
}
process.stdout.write(`\nPacked ${String(Object.keys(tarballByName).length)} tarballs into ${tarballsDir}\n`);

const cli = path.join(repoRoot, 'packages', 'create-luckystack-app', 'dist', 'index.js');
sh('scaffold', `${node} "${cli}" ${projectName} --no-prompt --no-install`, { cwd: here });

const pkgPath = path.join(appDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const fileRef = (name) => `file:../tarballs/${tarballByName[name]}`;
const isLib = (name) => name.startsWith('@luckystack/');

let rewrote = 0;
for (const bucket of ['dependencies', 'devDependencies']) {
  for (const name of Object.keys(pkg[bucket] ?? {})) {
    if (tarballByName[name]) { pkg[bucket][name] = fileRef(name); rewrote += 1; }
  }
}
pkg.overrides = {};
for (const name of Object.keys(tarballByName)) {
  if (isLib(name)) pkg.overrides[name] = fileRef(name);
}
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
process.stdout.write(`\nRewrote ${String(rewrote)} direct deps + ${String(Object.keys(pkg.overrides).length)} overrides to file: tarballs\n`);

sh('install', 'npm install --no-audit --no-fund', { cwd: appDir, env: { DATABASE_URL: DB_URL } });
sh('prisma-generate', 'npx prisma generate', { cwd: appDir, env: { DATABASE_URL: DB_URL } });

sh('generateArtifacts', 'npm run generateArtifacts', { cwd: appDir, env: { DATABASE_URL: DB_URL } });
const tc = sh('typecheck', 'npm run typecheck', { cwd: appDir, env: { DATABASE_URL: DB_URL }, allowFail: true });
const bd = sh('build', 'npm run build', { cwd: appDir, env: { DATABASE_URL: DB_URL }, allowFail: true });
const lt = sh('lint', 'npm run lint', { cwd: appDir, env: { DATABASE_URL: DB_URL }, allowFail: true });

const tsErrors = (tc.out.match(/error TS\d+/g) ?? []).length;
const lintMatch = lt.out.match(/✖ \d+ problems? \((\d+) errors?, (\d+) warnings?\)/);
const lintErrors = lintMatch ? Number(lintMatch[1]) : (lt.ok ? 0 : -1);
const lintWarnings = lintMatch ? Number(lintMatch[2]) : 0;

summarize();
process.stdout.write('\n── gate results ──\n');
process.stdout.write(`  typecheck : ${tc.ok ? 'PASS' : 'FAIL'} (${String(tsErrors)} TS errors)\n`);
process.stdout.write(`  build     : ${bd.ok ? 'PASS' : 'FAIL'}\n`);
process.stdout.write(`  lint      : errors=${String(lintErrors)} warnings=${String(lintWarnings)}\n`);

const green = tc.ok && bd.ok && lintErrors === 0 && lintWarnings === 0;
process.stdout.write(`\n${green ? '✅ SMOKE TEST GREEN — ready to publish' : '❌ SMOKE TEST NOT GREEN — see logs/'}\n`);
process.exit(green ? 0 : 1);
```
