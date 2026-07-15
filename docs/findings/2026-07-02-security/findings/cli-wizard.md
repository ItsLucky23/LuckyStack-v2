# CLI + Scaffolder Audit — Install-Flow & Wizard Correctness

**Date:** 2026-07-02
**Scope:** `packages/cli/` (the `luckystack` CLI) + `packages/create-luckystack-app/` (scaffolder + template assets)
**Method:** Full read of every install/spawn/wizard/asset-parity source file in both packages, byte-diff of all four `add`-asset bundles against the template, and verification of the **published `dist/` bundles** (what actually ships) against source.

---

## Headline verdict: the Windows `npm.cmd` CRITICAL is FIXED

The prior-audit CRITICAL (a spaced `C:\Program Files\nodejs\npm.cmd` being split/mis-quoted so installs silently no-op) is **fully fixed today, in BOTH packages, in BOTH source and the published `dist/`.**

Every child-process launch that runs a `.cmd`/`.bat` shim now:
1. Resolves the command to an **absolute path via `PATH` only** (cwd excluded — closes the BatBadBut/CVE-2024-27980 cwd-hijack), PATHEXT-aware. (`packages/cli/src/lib/project.ts:328-346`, `packages/create-luckystack-app/src/index.ts:1212-1230`)
2. Spawns `ComSpec` with the **outer+inner double-quote wrapper** `""<path>" <args>"` and `windowsVerbatimArguments: true`, which is the correct form (`/s` strips the outer pair, the inner pair preserves the spaced path):
   - `runNpmInstall` — `packages/cli/src/lib/project.ts:388-394`
   - `spawnResolved` (npm install + prisma generate) — `packages/create-luckystack-app/src/index.ts:1239-1250`
3. Passes `cwd` as a spawn option (never in the command string), so a spaced/parenthesized **project path** can't break parsing either.

Verified in the shipped artifacts: `packages/cli/dist/index.js:221` and `packages/create-luckystack-app/dist/index.js:943` both carry the `""${resolved}" …"` + `windowsVerbatimArguments: true` pattern. **No src↔dist drift on the install path.**

Package-manager detection is also correct now (no `.includes()` mismatch): `detectPackageManager` uses `packageManager` field `startsWith` + lockfile presence in priority order (`project.ts:351-360`). The CLI's `add`/`manage`/`remove` honor pnpm/yarn/bun.

---

## Severity counts

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 3 |
| Informational | 2 |

No install-halting or project-corrupting defects found in the current tree. The install + wizard + asset surface is in genuinely good shape.

---

## Findings

### LOW-1 — `prismaWithSecrets.ts` uses `shell: true` with a bare `prisma` (inconsistent with the hardened pattern)
**File:** `packages/create-luckystack-app/template/scripts/prismaWithSecrets.ts:35-39`
```ts
const result = spawnSync('prisma', process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});
```
This is the **one** remaining `shell: true` + bare-command spawn in either package. It is NOT the installer path — it runs only via the consumer's `npm run prisma:generate|db:push|migrate:dev` scripts (`template/package.json:34-36`), where `node_modules/.bin` is on `PATH`, so `prisma` (a token with no spaces) resolves to `.bin/prisma.cmd` and works even with a spaced project path (the `.cmd` shim's `%~dp0` handles that internally). Args (`generate`, `db push`, `migrate dev`) are fixed literals, not user input — no injection risk.
**Why flag it:** it's the odd one out — every other shim launch was migrated to the resolved-absolute-path + verbatim-quote pattern precisely because `shell:true` bare-command relies on the ambient `PATH`. It breaks if the script is ever invoked outside an `npm run` context (e.g. a raw `tsx scripts/prismaWithSecrets.ts generate`), and it re-introduces the exact shell-quoting surface the rest of the code was hardened against. Recommend aligning it with `spawnResolved` for consistency and defense-in-depth.
**Failure scenario:** none in the shipped flow; only a latent fragility if the invocation context changes.

### LOW-2 — Scaffolder always runs `npm`, ignoring the invoking package manager
**File:** `packages/create-luckystack-app/src/index.ts:1252-1263` (`runNpmInstall` hardcodes `resolveCommandPath('npm')`)
Unlike the CLI (which detects pnpm/yarn/bun), the scaffolder always installs with `npm`. A user running `pnpm create luckystack-app` / `yarn create luckystack-app` gets a `package-lock.json` and an npm-resolved tree in a project they intended for another PM.
**Why it's LOW not higher:** the project still builds and runs; it's a lock-file/PM-hygiene mismatch, not a broken project. Fixing it means detecting `npm_config_user_agent`.

### LOW-3 — `manage` `declaredKeys` snapshot can skip re-adding a placeholder block in a same-pass off→on→off→on env cycle
**File:** `packages/cli/src/commands/reconfigure.ts:169-181` (documented in-code)
`declaredKeys` is read once before the apply loop. If a user hand-filled a provider key (no sentinel), toggled it off, then back on within a single wizard pass, the stale snapshot still shows the key as declared and `upsertEnvBlock` skips re-adding the placeholder template — the user must add it by hand. This is a **deliberate** trade-off (value-safety > re-hydration) and is documented; noting it only for completeness. No data loss.

### Informational-1 — Asset↔template parity is intact (no drift)
Byte-diffed (CRLF-normalized) all four `add`-asset bundles — `login`, `docs-ui`, `error-tracking`, `router` — against `packages/create-luckystack-app/template/`. **Zero drift**, every asset file has a template counterpart, and `ASSET_AHEAD_OF_TEMPLATE` in `assetParity.test.ts:38` is empty (the desired lockstep end-state). The prior "stale LoginForm shipped a removed export" class of bug is closed and now guarded by `assetParity.test.ts` (parity suite + secret-manager block-parity + `PROVIDER_OPTIONS`↔`featureOptions` parity + registry↔`OPTIONAL_PACKAGES` parity). The `--secret-manager` triad (config.ts / server.ts / **scripts/prismaWithSecrets.ts**) block-parity is explicitly tested (`assetParity.test.ts:149-186`).

### Informational-2 — Version pinning / `resolveLuckyStackRange` footgun is handled
`resolveLuckyStackRange` (`project.ts:128-148`) reuses an existing `@luckystack/*` range **only** when it's a plain semver/dist-tag, explicitly skipping `file:`/`link:`/`git`/`http(s)`/`workspace:`/`portal:` protocol specs and falling back to `^<cliVersion>` — the prior `file:`-spec mis-point bug is fixed. Template deps pin `^{{LUCKYSTACK_VERSION}}` consistently; scaffolder-injected optional deps use `^${luckystackVersion}` consistently.

---

## Flag / variant matrix — spot-checked, no broken combos found
- `--auth=none` prune path removes login UI/API/shims, drops `@luckystack/login`, rewrites `config.ts`/`page.tsx`/`dashboard`/`Home.tsx`/server-overlay/README, and `pruneAuthNone` leaves a **buildable** no-auth project (`index.ts:1665-1820`). `editScaffoldFile` throws on any token miss (drift fails loud during smoke scaffold), and a scaffold failure `rmSync`-rolls-back the partial dir (`index.ts:2290-2301`).
- `--auth=credentials+oauth` with no `--oauth` → plain credentials + no buttons (not broken); `normalizeChoices` clears stale oauth under `--no-prompt` (`index.ts:876-880`).
- Opt-in packages (`--presence/--error-tracking/--docs-ui/--secret-manager/--router`) each have symmetric prune(off)/wire(on) paths and matching `add`/`remove` CLI handlers; `--no-prompt` layers typed flags over `DEFAULT_CHOICES` and mirrors the wizard's cross-field invariants.
- Non-TTY → `runPromptsFallback` (numbered prompts); every raw-mode prompt (`wizard.ts`, scaffolder `runWizard`) has a non-TTY early-return guard, so CI/pipes never hang. Invalid flag values `process.exit(2)`; unknown flags `process.exit(2)`.

---

## Bottom line
The #1 concern — fragile Windows install spawning — is resolved and regression-hardened (absolute-path resolution + verbatim double-quote wrapper, verified in the published `dist/`). Asset/template parity, version pinning, PM detection, and the prune/wire variant matrix are all sound. The three LOW items are hygiene/defense-in-depth, not breakages; the single most worthwhile follow-up is aligning `prismaWithSecrets.ts` (LOW-1) with the hardened `spawnResolved` pattern used everywhere else.
