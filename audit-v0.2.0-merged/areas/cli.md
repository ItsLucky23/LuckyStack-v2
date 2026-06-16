# cli — Verified & Merged Audit Findings
Sources: reports/cli.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
22 distinct findings merged across the two scans. The single biggest live issue is fully **CONFIRMED and now actually load-bearing**: the `add login` asset bundle is a stale fork of `template/src`. Its `LoginForm.tsx` (asset only — the lone drifted file of 20) still does `import { providers } from "config"` and gates the form on `providers.includes("credentials")`, but the template config dropped that export and the template's own LoginForm switched to a live `GET /auth/providers` fetch. Worse, the asset LoginForm is **half-merged** — it carries BOTH the broken static import AND the new fetch logic — so it cannot compile against any current scaffold (HB1/QUA-003 CONFIRMED). The companion HB2 (asset `_api` handlers import `server/hooks/notifications.ts` + use `functions.session`, both of which the `authMode:'none'` pruner deletes) is also CONFIRMED, and unlike when the older scan ran, the `authMode:'none'` prune is now real and wizard-reachable (commit 302cbf1), so `add login` into a base scaffold is structurally broken end-to-end. Most other findings (transactional gap in `addPresence`, no tests, closed FEATURES registry, hardcoded ignore lists, no `--version`, no CI exit code, malformed `common/.404` i18n key, unvalidated `updateUser`, raw tokens in `listSessions`, OAuth `deleteAccount` gate) are all CONFIRMED against current code — the CLI core is careful but the `add login` flow and the shipped asset endpoints carry the real defects. Nothing in this area was ALREADY-FIXED by 302cbf1; that commit fixed the *consumer/template* LoginForm but never re-synced the *asset* copy, which is exactly why the drift is now a live compile break.

## Findings

### HB1 / QUA-003 — Stale LoginForm asset imports removed `providers` config export (compile-breaking drift)  ·  severity: high  ·  status: CONFIRMED
- **Sources:** both (reports HB1 + review QUA-003)
- **Current location:** `packages/cli/assets/login/src/_components/LoginForm.tsx:6` and `:177`
- **Original claim:** Asset reads `import { ..., providers, ... } from "config"` and gates `providers.includes("credentials")`; template dropped the `providers` export and the template LoginForm fetches providers live → `add login` produces TS2305 (no exported member 'providers').
- **Verification (current code):** Line 6 still imports `providers` from `config`; line 177 still gates the credentials block on `providers.includes("credentials")`. The same file ALSO contains the newer `oauthProviders` state + `GET /auth/providers` fetch (lines 30-47) — it is a half-merged file. Template `config.ts:325-328` explicitly states "No static `providers` array"; CRLF-normalized diff of the whole asset tree shows `LoginForm.tsx` is the ONLY drifted file (the other 19 are byte-identical). The consumer's own `src/_components/LoginForm.tsx:46` uses `setShowCredentials(body.providers.includes("credentials"))` with no static import — proving the asset is the stale fork. Asset file last touched in commit 98833f6, before the 302cbf1 LoginForm fix.
- **Verdict & why:** CONFIRMED. The import resolves against a non-existent export; `add login` into any scaffold lands this file and the first build fails. Both scans correct; high severity (it breaks the flagship command), not merely Medium.
- **Recommendation:** Re-copy the current template `LoginForm.tsx` into the asset bundle and add a CRLF-normalized asset↔template parity test (QUA-021) so this class of drift fails CI instead of a consumer build.

### HB2 / MIS-005 — `add login` copies `_api` handlers that import files the `authMode:'none'` pruner deletes  ·  severity: high  ·  status: CONFIRMED
- **Sources:** both (reports HB2 + review MIS-005)
- **Current location:** `packages/cli/assets/login/src/settings/_api/changePassword_v1.ts:5`; `updateUser_v1.ts:81`; `updatePreferences_v1.ts:45`; pruner `packages/create-luckystack-app/src/index.ts:1213,1231,1236`
- **Original claim:** Asset handlers `import '../../../server/hooks/notifications'` and call `functions.session.saveSession`, but the base-scaffold pruner deletes `server/hooks/notifications.ts` and `functions/session.ts`, so the copied handlers can't compile/resolve.
- **Verification (current code):** `changePassword_v1.ts:5` imports `sendPasswordChangedNotification` from `../../../server/hooks/notifications`. `updateUser_v1.ts:81` and `updatePreferences_v1.ts:45` call `functions.session.saveSession(...)`. The pruner's `authMode === 'none'` branch (index.ts:1213) removes both `functions/session.ts` (:1231) and `server/hooks/notifications.ts` (:1236). `addLogin.ts` does a plain `copyDirIfAbsent` + `addDependency` with NO preflight existence check (contrast `addPresence.ts:83`, which verifies its targets). Crucially, commit 302cbf1 made `authMode` a real wizard/CLI choice, so the `'none'` prune is now reachable — the older scan's "latent" caveat no longer applies.
- **Verdict & why:** CONFIRMED, and now active rather than latent. `functions.session` is also an injected namespace removed when `functions/session.ts` is pruned, so even the runtime shim disappears. Combined with HB1 this makes `add login` into a base project non-compiling with no CLI path to fix.
- **Recommendation:** Preflight like `addPresence` — check `server/hooks/notifications.ts`, `functions/session.ts`, the needed `_locales` namespaces, and the `preferences` Prisma field before copying; on a miss either ship the missing pieces in the asset bundle (+ a locale-merge step) or fail with an actionable message.

### HB3 / QUA-019 — `addPresence` two-file edit is not transactional; idempotency guard masks the half-applied state  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** both (reports HB3 + review QUA-019)
- **Current location:** `packages/cli/src/commands/addPresence.ts:92` (guard), `:25-77` (applyPresenceEdits), `:97-104`
- **Original claim:** `applyPresenceEdits` writes `main.tsx` before validating `TemplateProvider.tsx` tokens; if the latter's tokens are missing, `main.tsx` is already rewritten. The re-run guard (`includes('@luckystack/presence/client')`) then sees the wired `main.tsx`, prints "already present — skipped", and reports success while `SocketStatusIndicator` is never wired.
- **Verification (current code):** `editFile` is per-file atomic (project.ts:129-149, single write after all in-memory edits) but `applyPresenceEdits` calls it for `main.tsx` first (line 27) then `TemplateProvider.tsx` (line 41) with no upfront dry-run of both. The guard at line 92 reads only `mainPath`; on a half-applied state it sets `mainAlreadyWired=true`, skips the JSX injection (line 98), and proceeds to dep+install reporting success. The line-24 comment ("a throw can't half-edit it") is true per file, false across the two-file pair.
- **Verdict & why:** CONFIRMED exactly as described. Real but bounded (only triggers when a consumer has edited `TemplateProvider.tsx`'s anchor lines).
- **Recommendation:** Dry-run validate every `find` token in BOTH files in memory and only write when all match (split into planEdits/applyEdits, or add a validateOnly mode to `editFile`); make the idempotency guard check both files and warn on the mixed state.

### SEC-M1 / SEC-16 — `listSessions_v1` ships every device's raw bearer session token to the browser  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** both (reports M1 + review SEC-16)
- **Current location:** `packages/cli/assets/login/src/settings/_api/listSessions_v1.ts:28-42` (`:33`)
- **Original claim:** The handler returns `{ token, expiresInSeconds, isCurrent }` per active session — the full raw Redis session tokens of every signed-in device — defeating HttpOnly-cookie XSS protection across all devices.
- **Verification (current code):** Lines 28-37 map each token to `{ token, expiresInSeconds, isCurrent }` and return them all (line 41). The token IS the bearer credential; only `isCurrent`/expiry are needed client-side. Byte-identical to the template copy (confirmed by diff). The settings UI only shows `…slice(-8)` but the full tokens still cross the wire/land in JS memory.
- **Verdict & why:** CONFIRMED. Both scans agree Medium — correct: it ships in the published package and every `add login` consumer, but the file is consumer-owned-after-copy and exploitation requires a separate XSS/extension foothold.
- **Recommendation:** Return an opaque id (e.g. `sha256(token).slice(0,12)`) plus expiry/`isCurrent`, and have `revokeSession_v1` resolve that id server-side by iterating `activeUsers` and comparing hashes. Apply to asset, template, and consumer demo together.

### SEC-L3 / SEC-17 — `updateUser_v1` writes name/theme/language with no runtime validation (bypasses `auth.nameMaxLength`)  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** both (reports L3 + review SEC-17)
- **Current location:** `packages/cli/assets/login/src/settings/_api/updateUser_v1.ts:67-83`
- **Original claim:** `name`/`theme`/`language` copied straight from `data` into the Prisma update + saved session with no runtime validation; `SessionLayout['theme']` is compile-time only; bypasses the register-path `nameMaxLength` policy. Contrast `updatePreferences_v1` which allow-lists.
- **Verification (current code):** Lines 69-72 build `newData` from raw `data` fields with only truthiness checks (`if (name)`, `if (theme)`, `if (language)`); line 76-81 persist + `saveSession` unconditionally. No length cap, no theme/language enum check. The sibling `updatePreferences_v1.ts:27-29` explicitly type-checks `typeof ... === 'boolean'` per field — proving the project's own allow-list pattern is absent here.
- **Verdict & why:** CONFIRMED. Both Medium — correct (size bounded by the body cap, values not used in raw queries, but it's the framework's reference impl teaching an input-trust anti-pattern and bypassing the documented name policy).
- **Recommendation:** Mirror `updatePreferences`' allow-list: enforce `getProjectConfig().auth.nameMaxLength` on `name`, validate `theme` against the known union and `language` against the locale list, reject before write.

### SEC-L4 / HOK-05 — `deleteAccount_v1` skips re-auth for OAuth (password-less) users + has no pre/post hook  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** both (reports L4 [re-auth gap] + review HOK-05 [missing hook])
- **Current location:** `packages/cli/assets/login/src/settings/_api/deleteAccount_v1.ts:28-41`
- **Original claim (reports L4):** When `password` is null (OAuth user) the password gate is skipped entirely; the typed-`DELETE` string is the only confirmation, so a hijacked session can irreversibly delete an OAuth account. **(review HOK-05):** No `dispatchHook` calls — account deletion is the only auth mutation without a vetoable pre-hook + post-hook, so add-ons can't veto/audit/cascade-clean.
- **Verification (current code):** Line 29 gates re-auth on `if (dbUser?.password)` — password-less (OAuth) users bypass it; the only barrier is `data.confirmation !== 'DELETE'` (line 23). Grep confirms zero `dispatchHook`/`preAccountDelete`/`accountDeleted` in the file. Sibling `changePassword_v1.ts:52-71` shows the project's own pre/post-hook pattern, absent here. Byte-identical across all four shipped copies (confirmed by the review's diff).
- **Verdict & why:** CONFIRMED on both axes. Medium for the re-auth gap (requires a hijacked session), Medium for the missing hook (no veto/audit/cascade seam for the most irreversible mutation).
- **Recommendation:** Require a recent-login/re-auth (or email confirmation) for password-less accounts; add vetoable `preAccountDelete` + fire-and-forget `postAccountDelete` hooks (declare payloads in `packages/login/src/hookPayloads.ts`) before revocation and after the Prisma delete; sync all four copies.

### HOK-20 — No profile-updated hook around updateUser/updatePreferences  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review (HOK-20)
- **Current location:** `packages/cli/assets/login/src/settings/_api/updateUser_v1.ts:76-81`, `updatePreferences_v1.ts:31-45`
- **Original claim:** `updateUser_v1`/`updatePreferences_v1` write the user row + re-save the session with no `dispatchHook`, so audit-logging/moderation/cache-invalidation of identity changes (display-name = impersonation vector) have no framework seam.
- **Verification (current code):** Neither file dispatches a hook around the mutation (only `updateUser`'s avatar branch gets hooks indirectly via `processUpload`). Confirmed.
- **Verdict & why:** CONFIRMED, Low — files are consumer-owned after copy and the change set is low-risk vs credential mutations.
- **Recommendation:** Add an optional `profileUpdated` post-hook for parity with the other settings mutations; low priority.

### QUA-020 — Malformed i18n key `common/.404` in LoginForm fetch-failure path  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review (QUA-020)
- **Current location:** asset `packages/cli/assets/login/src/_components/LoginForm.tsx:123`; template `LoginForm.tsx`; consumer `src/_components/LoginForm.tsx:122`
- **Original claim:** On a failed credentials POST the code calls `notify.error({ key: 'common/.404' })` — the stray `/` means the key never resolves (locales define `common.404`); the user sees a raw key. check-i18n can't catch it because `isTranslationKey` rejects strings containing `/`.
- **Verification (current code):** Asset line 123 and consumer line 122 both literally contain `notify.error({ key: 'common/.404' })`. `checkI18n.ts:18` regex `^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)+$` rejects the `/`, so the bad key is silently dropped from the used-set rather than flagged. The bug is present in all three mirrored copies (not fixed by 302cbf1).
- **Verdict & why:** CONFIRMED. Most-visible failure path (login while server unreachable) shows a raw key, and the shipped lint tool is structurally blind to the typo class.
- **Recommendation:** Fix to `common.404` in all three copies; make check-i18n report literal `key:'...'` values that FAIL the dotted regex as a suspicious-key section instead of discarding them.

### QUA-022 — check-i18n blind to template-literal keys; its report tells an LLM to delete live keys  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review (QUA-022)
- **Current location:** `packages/cli/src/commands/checkI18n.ts:52` (used-key regex), `:58` (dynamic-site regex); victim `packages/cli/assets/login/src/settings/page.tsx`
- **Original claim:** Used-key harvest matches only quoted literals; the dynamic detector matches only bare identifiers; neither matches backtick template literals. The shipped settings page uses `` translate({ key: `settings.language.${lang}` }) ``, so `settings.language.{nl,en,de,fr}` are listed UNUSED, and the report header instructs "delete each truly-unused key" → breaks the language picker.
- **Verification (current code):** `checkI18n.ts:52` is `/\bkey:\s*['"]([^'"]+)['"]/` (single/double quotes only). `:58` dynamic detector is `/\bkey:\s*([A-Za-z_$][...]*)\s*[,})]/` — bare identifiers, no backticks. The unused-report header (lines 98-103) ends with "Feed this to an LLM: delete each truly-unused key." Template-literal call sites are matched by neither pattern and not surfaced for review.
- **Verdict & why:** CONFIRMED. In a 100%-AI-driven workflow the tool's own instructions cause deletion of in-use keys.
- **Recommendation:** Add a third pattern for backtick keys, treat a captured `${` prefix as a wildcard marking matching locale keys used, and list backtick sites in the dynamic-review section.

### QUA-021 — Zero tests in @luckystack/cli — no asset↔template parity / prune↔add round-trip  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review (QUA-021)
- **Current location:** `packages/cli/package.json:46`
- **Original claim:** Test script is `vitest run --passWithNoTests`; no `*.test.ts` exists. Neither the FEATURES↔OPTIONAL_PACKAGES mirror nor the asset↔template lockstep is tested — the latter has already drifted (QUA-003).
- **Verification (current code):** `package.json:46` = `"test": "vitest run --passWithNoTests"`. `find packages/cli -name '*.test.ts' -o -name '*.spec.ts'` returns nothing. The lack of a parity test is exactly what let HB1/QUA-003 ship.
- **Verdict & why:** CONFIRMED. The next template edit can break `add <feature>` for every consumer with nothing in CI to notice.
- **Recommendation:** Three vitest suites: (a) CRLF-normalized file-equality asset↔template; (b) FEATURES keys (minus 'sync') ⊆ OPTIONAL_PACKAGES; (c) tmp-dir prune→add round-trip equals the original template files.

### QUA-058 — Shipped LoginForm hardcodes English UI strings despite mandatory-i18n rule  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review (QUA-058)
- **Current location:** `packages/cli/assets/login/src/_components/LoginForm.tsx:14-18`, `:239`
- **Original claim:** "Sign in to your account", "Create a new account", "Log in", "Sign up", etc. are hardcoded while the same file uses `useTranslator` for toasts; CLAUDE.md Rule 13 makes i18n mandatory.
- **Verification (current code):** Lines 14-18 hardcode `title`/`subtitleText`/`subtitleLink`/`buttonText`; line 239 hardcodes `"Loading..."`. The file imports + uses `useTranslator` for the field labels (lines 182, 193, 204) but not the headings/buttons. Inconsistent and English-only.
- **Verdict & why:** CONFIRMED, Low — cosmetic/i18n-completeness, consumer-owned after copy.
- **Recommendation:** Replace the literals with `translate({ key: 'login.*' })` keys, add them to the four template locales, and update asset+template together.

### CFG-07 / E2 — check-env FRAMEWORK_ENV_KEYS / IGNORED_PREFIXES hardcoded despite "edit per project" comment (+ stale `DNS`)  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** both (reports E2 + review CFG-07)
- **Current location:** `packages/cli/src/commands/checkEnv.ts:14-15` (comment), `:16-29` (FRAMEWORK_ENV_KEYS), `:32` (IGNORED_PREFIXES)
- **Original claim:** The comment says "Edit/extend per project as needed" but the set is compiled into `dist/index.js` in node_modules — a consumer can't extend it (no config file/flag/env var). List also stales: still contains `DNS` after the DNS origin model was removed.
- **Verification (current code):** Lines 14-15 comment "Edit/extend per project as needed."; `FRAMEWORK_ENV_KEYS` (16-29) includes `'DNS'` (line 19); `IGNORED_PREFIXES = ['VITE_', 'TEST_']` (line 32). `isIgnored` (34-35) reads only these compiled constants — no consumer override. Only `LUCKYSTACK_ENV_FILES` (the file list) is overridable; the key ignore list is not.
- **Verdict & why:** CONFIRMED. Any consumer with framework-adjacent keys read outside scanned code (docker-compose, CI, a later @luckystack package, a custom `*_CLIENT_ID`) gets permanent false "unused" findings in a log whose header tells an LLM to DELETE them.
- **Recommendation:** Read extra ignore entries from a consumer-owned source (`luckystack.invariants.json` `checks.env.ignoreKeys/ignorePrefixes`, or a `--ignore` flag) merged over the built-in set; drop the stale `DNS` entry.

### CFG-08 / E1 — FEATURES registry is closed; no plugin/manifest mechanism for third-party packages  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** both (reports E1 + review CFG-08)
- **Current location:** `packages/cli/src/index.ts:30-37`
- **Original claim:** `FEATURES` is a hardcoded `Record`; a consumer or third-party `@luckystack/*`-style package can't register its own `add` recipe without forking the CLI; CLAUDE.md confirms the OPTIONAL_PACKAGES sync is manual.
- **Verification (current code):** `index.ts:30-37` hardcodes login/presence/email/sync/error-tracking/docs-ui. `packages/cli/CLAUDE.md` Notes: "Mirror it against `OPTIONAL_PACKAGES` in `@luckystack/server` when adding a new optional package." No manifest/fallback lookup. `@luckystack/secret-manager` is absent from both the list and the ADD_GUIDE.
- **Verdict & why:** CONFIRMED, Medium — backend-only packages still self-wire via plain `npm i`, so only asset-injecting features are truly blocked.
- **Recommendation:** Manifest-driven fallback: on a registry miss, look for `node_modules/@luckystack/<feature>/luckystack.add.json` (`{pkg, assets, edits, note}`) executed through the existing `copyDirIfAbsent`/`editFile` helpers; make the built-in FEATURES bundled instances of the same format.

### E3 — Presence injection has no manual/`--force` fallback on token drift  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (E3)
- **Current location:** `packages/cli/src/commands/addPresence.ts:25-77`; `editFile` throw at `project.ts:142-144`
- **Original claim:** `applyPresenceEdits` anchors on exact pristine-template strings; any consumer edit/reformat of `main.tsx`/`TemplateProvider.tsx` makes `editFile` throw with no documented manual wiring and no escape hatch.
- **Verification (current code):** The edits (lines 27-72) are exact-string `find` tokens; `editFile` throws `edit failed — token not found` on any miss. The error is returned as a `Result` (clean message) but there's no `--force`, no printed manual-wiring steps. Confirmed.
- **Verdict & why:** CONFIRMED, Low — the throw is loud and non-destructive (per-file atomic), but the consumer has no guided recovery.
- **Recommendation:** On a token miss, print the exact manual JSX/import edits the consumer should apply; optionally a `--print-edits` mode.

### MIS-004 — check-env / check-i18n always exit 0 (no CI fail mode)  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review (MIS-004)
- **Current location:** `packages/cli/src/index.ts:77-86`; `checkEnv.ts`, `checkI18n.ts` (both return void)
- **Original claim:** The scan commands run, write logs, print counts, and `return` — neither influences the exit code, so a CI pipeline passes even with 50 missing keys.
- **Verification (current code):** `index.ts:83-85` calls `checkEnv`/`checkI18n` then `return` with no exit handling. Both commands return `void` (checkEnv.ts:72, checkI18n.ts:47) — counts are only printed, never returned to the entry, no `process.exit`/`exitCode`.
- **Verdict & why:** CONFIRMED. For a framework pitching automated AI hygiene, the audits can only be consumed interactively.
- **Recommendation:** Add a `--fail-on-findings` (or `--ci`) flag that sets `process.exitCode = 1` when any count > 0; return the counts from the commands so the flag logic stays in `index.ts`.

### MIS-022 — No `--version` flag on the `luckystack` CLI  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review (MIS-022) + reports config-gap #5
- **Current location:** `packages/cli/src/index.ts:64-104`
- **Original claim:** The entry parses only `add`/`check-env`/`check-i18n`/`-h`; `luckystack --version` falls through to "Unknown command" + exit 2, even though `cliVersion` is already loaded at line 19.
- **Verification (current code):** Line 19 loads `cliVersion` (used only for dep ranges). `main()` (64-104) handles `--help`/`-h`, then `check-env`/`check-i18n`, then `add`, else "Unknown command" `process.exit(2)`. No `--version`/`-V` branch. Confirmed.
- **Verdict & why:** CONFIRMED, Low — standard CLI expectation; the version data is already in hand and would identify which asset/template snapshot a consumer received.
- **Recommendation:** Handle `--version`/`-V` before command dispatch, print `cliVersion`, exit 0.

### MIS-023 — No `luckystack remove <feature>` (add is one-way)  ·  severity: low  ·  status: CONFIRMED (acknowledged-future)
- **Sources:** review (MIS-023)
- **Current location:** `packages/cli/CLAUDE.md` "When to NOT suggest" (defers remove to a future command); inverse edit lists exist in `create-luckystack-app/src/index.ts` (pruner) + `addPresence.ts` (re-adder)
- **Original claim:** A consumer who runs `add presence` and reverses course must hand-undo the JSX + dep line; CLAUDE.md explicitly defers `remove` to the future.
- **Verification (current code):** `packages/cli/CLAUDE.md` "When to NOT suggest" lists "Removing a feature — that is the scaffold pruner's job (a future `luckystack remove`)." No `remove` command exists. The pruner and `addPresence` hold the two inverse edit lists with no shared source.
- **Verdict & why:** CONFIRMED as a documented roadmap gap (not an undocumented defect), Low.
- **Recommendation:** When implemented, single-source the prune/add edit lists (shared module or JSON manifest) so remove/add/prune can't drift.

### L1 / config-gap #1 — Windows `npm.cmd` `shell:true` current-dir hijack + package manager hardcoded to npm  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (L1 [security] + config-gap #1 [pm hardcode])
- **Current location:** `packages/cli/src/lib/project.ts:180-184` (`runNpmInstall`)
- **Original claim (L1):** `spawnSync('npm.cmd', ['install'], { cwd: root, shell: true })` on win32 — `cmd.exe` resolves `npm.cmd` against `cwd` before PATH, so a malicious `npm.cmd` at the project root runs attacker code. **(config-gap #1):** No `--pm`/pnpm/yarn/bun support and no lockfile detection; `npm install` in a pnpm project creates a conflicting `package-lock.json`.
- **Verification (current code):** Lines 181-182: `const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'; spawnSync(npm, ['install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })`. Hardcoded npm, `shell:true` on Windows with `cwd` set. Confirmed both.
- **Verdict & why:** CONFIRMED. L1 is genuinely Low (the marginal risk over `npm install` running the repo's own lifecycle scripts is small). The pm-hardcode is a real correctness gap for pnpm/yarn consumers.
- **Recommendation:** Resolve an absolute npm path (e.g. `process.env.npm_execpath`) and spawn without `shell`; detect `pnpm-lock.yaml`/`yarn.lock` and run the matching installer, or add a `--pm` flag.

### L2 — `findProjectRoot` walks to filesystem root and will patch + install in any ancestor  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (L2)
- **Current location:** `packages/cli/src/lib/project.ts:57-76`
- **Original claim:** The `for(;;)` walk stops only at the filesystem root; running the CLI in a subdir of a tree with a crafted `package.json`+`config.ts` higher up silently selects that ancestor, rewrites its `package.json`, and runs `npm install` there. The chosen root is printed but not confirmed.
- **Verification (current code):** Lines 59-75 loop upward, returning the first dir with `package.json` + `config.ts` + an `@luckystack/*` dep (or `packages/core`); the only stop is `parent === dir` (filesystem root). `index.ts:111` prints the chosen root but never confirms it.
- **Verdict & why:** CONFIRMED, Low — requires an attacker-controlled ancestor and the user running the CLI from a nested subdir.
- **Recommendation:** Print + confirm when the resolved root ≠ CWD, or bound the walk at a `.git` boundary.

### CQ-4 — `resolveLuckyStackRange` copies the first @luckystack range in object order (incl. `file:`/`workspace:`)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (code-quality #4)
- **Current location:** `packages/cli/src/lib/project.ts:96-104`
- **Original claim:** Picks the first `@luckystack/*` range in object order; in a consumer using `file:`/`workspace:` overrides for one package, that non-semver range is copied onto the newly added dependency.
- **Verification (current code):** Lines 98-101 iterate `Object.entries(deps)` and return the first `@luckystack/*` range with length > 0 — no semver-vs-`file:`/`workspace:` discrimination. Confirmed.
- **Verdict & why:** CONFIRMED, Low — only bites consumers using path/workspace overrides.
- **Recommendation:** Prefer a semver-shaped range; skip `file:`/`workspace:`/`link:` ranges when choosing the lockstep version.

### CQ-2 — Duplicated ignore-dir sets drifted (scan IGNORED_DIRS vs check-i18n LOCALE_IGNORED_DIRS)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (code-quality #2)
- **Current location:** `packages/cli/src/lib/scan.ts:12-15` (IGNORED_DIRS); `packages/cli/src/commands/checkI18n.ts:33` (LOCALE_IGNORED_DIRS)
- **Original claim:** `IGNORED_DIRS` includes `.next`, `.turbo`, `.vite`, `uploads`; `LOCALE_IGNORED_DIRS` re-declares the list WITHOUT those four — so locale JSON inside e.g. `uploads/` or `.vite/` would be scanned by `findLocaleFiles` but not the source scan.
- **Verification (current code):** `scan.ts:12-15` = `node_modules, dist, .git, .cache, dump, .smoke-test, build, coverage, .next, .turbo, .vite, uploads`. `checkI18n.ts:33` = `node_modules, dist, .git, .cache, dump, .smoke-test, build, coverage` — missing `.next`, `.turbo`, `.vite`, `uploads`. Confirmed drift.
- **Verdict & why:** CONFIRMED, Low — only matters when a project keeps locale JSON under one of those dirs.
- **Recommendation:** Export a single shared ignored-dirs set from `scan.ts` and reuse it in `checkI18n.ts`.

### config-gap #2/#3 — Scan ignore lists + `dump/` output dir are hardcoded (no consumer override)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (config-gaps #2 + #3)
- **Current location:** `scan.ts:12-15` (IGNORED_DIRS), `:17` (SOURCE_EXTENSIONS), `:176-183` (writeDumpLog → `<root>/dump/`)
- **Original claim:** A consumer with a custom build/output dir (`out/`, `storybook-static/`) can't exclude it; `dump/` is always written to `<root>/dump/` with no flag for an alternate location or stdout.
- **Verification (current code):** `IGNORED_DIRS`/`SOURCE_EXTENSIONS` are module constants with no override path. `writeDumpLog` (176-183) hardcodes `path.join(root, 'dump')`. Confirmed.
- **Verdict & why:** CONFIRMED, Low — false positives for non-standard output dirs; no CI-friendly stdout mode.
- **Recommendation:** Accept consumer ignore entries (same config knob as CFG-07) and a `--out <dir>`/`--stdout` flag for the dump destination.

### config-gap #5 (flag validation) — No strict flag validation; a typo'd `--no-instal` silently runs npm install  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (config-gap #5)
- **Current location:** `packages/cli/src/index.ts:73`
- **Original claim:** `const install = !argv.includes('--no-install')` — a typo like `--no-instal` is silently ignored and `npm install` runs anyway; contrast `create-luckystack-app` which `process.exit(2)`s on unknown flags.
- **Verification (current code):** Line 73 is exactly `const install = !argv.includes('--no-install');`. No unknown-flag rejection anywhere in `main()`; an unrecognized `--foo` after a valid command is silently ignored.
- **Verdict & why:** CONFIRMED, Low — usability footgun, no correctness/security impact beyond the surprising install.
- **Recommendation:** Validate argv against a known-flags allowlist and `process.exit(2)` on unknown flags, mirroring `create-luckystack-app`'s parser.

### config-gap #6 — `addDependency` only checks `dependencies`, can dupe a devDependency  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (config-gap #6)
- **Current location:** `packages/cli/src/lib/project.ts:108-118`
- **Original claim:** `addDependency` checks only `project.pkg.dependencies`; if the package already sits in `devDependencies`, a duplicate entry is added to `dependencies`.
- **Verification (current code):** Line 110 = `if (project.pkg.dependencies[name]) return false;` — only the `dependencies` map is consulted (`resolveLuckyStackRange` reads both, but the dedupe check does not). A package in `devDependencies` would be re-added to `dependencies`.
- **Verdict & why:** CONFIRMED, Low — uncommon for `@luckystack/*` runtime deps to live in devDependencies, but the duplicate is real if so.
- **Recommendation:** Check both `dependencies` and `devDependencies` before adding (and consider leaving an existing devDependency in place).

### CQ-5 — `package.json` rewrite normalizes formatting (2-space LF), clobbering consumer style  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (code-quality #5)
- **Current location:** `packages/cli/src/lib/project.ts:116`
- **Original claim:** `addDependency` always rewrites with `JSON.stringify(pkg, null, 2)` + LF, clobbering a consumer's 4-space/tab/CRLF formatting in an otherwise one-line change (noisy diff).
- **Verification (current code):** Line 116 = `fs.writeFileSync(project.pkgPath, \`${JSON.stringify(project.pkg, null, 2)}\n\`)` — fixed 2-space indent, LF, regardless of the original file's style. Confirmed.
- **Verdict & why:** CONFIRMED, Low — cosmetic (noisy diff), no functional impact. The dependency-sort (lines 113-114) is also a deliberate normalization.
- **Recommendation:** Detect and preserve the original indent/EOL (or accept it as intentional and document it); low priority.

## Notes on scan disagreements & what the older scan got wrong
- **Severity reconciliation:** reports/ rated HB1/HB2 as "Hard blocks" and review/ rated QUA-003 "High" / MIS-005 "Medium"; verified against current code these are correctly **high** — they break the flagship `add login` command end-to-end, now that the `authMode:'none'` prune is live.
- **The review/ scan's "latent" caveat on HB2/MIS-005 is now outdated:** it said the missing-file imports were "latent" because "the pruner only prunes presence." Current code (commit 302cbf1) made `authMode` a real choice and the pruner deletes `functions/session.ts` + `server/hooks/notifications.ts` on `authMode:'none'` — so the break is active, not latent.
- **Nothing in this area was fixed by 302cbf1.** That commit fixed the *consumer/template* LoginForm (live `/auth/providers` fetch) but never re-synced the *asset* copy — which is the entire root cause of HB1/QUA-003. The asset LoginForm last changed in 98833f6, two commits earlier.
