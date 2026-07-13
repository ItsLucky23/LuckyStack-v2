# Upgrading LuckyStack (AI-actionable runbook)

> This is the golden path an AI agent (or a developer) follows when the user
> says **"upgrade LuckyStack"**, **"bump to the latest version"**, or names a
> target version. It is written so an AI can execute it end-to-end and — this is
> the important part — **proactively surface what changed and OFFER new
> features**, rather than silently bumping numbers.

---

## The one rule that makes this good

**Never bump the version silently.** Before touching `package.json`, read the
CHANGELOGs between the installed and target version, and tell the user in plain
language what they'd gain — especially security features (e.g. 2FA / email-code
login) and breaking changes — then ask whether they want to adopt any new
feature. A version bump the user didn't understand is a bad upgrade even if it
compiles.

---

## Step 0 — Find the version gap and read the changes

1. **Installed version:** read `node_modules/@luckystack/core/package.json`
   (`version`). All `@luckystack/*` packages move in lockstep, so one is enough.
2. **Latest version:** `npm view @luckystack/core version` (or the version the
   user named).
3. **What changed:** read the `CHANGELOG.md` of the relevant installed packages
   (`node_modules/@luckystack/<pkg>/CHANGELOG.md`) OR the framework docs copied
   into `docs/luckystack/` after step 3 below. Focus on entries BETWEEN the
   installed and target version. Summarize for the user:
   - **New features** (call out security ones like 2FA / email-code login).
   - **Bug fixes** relevant to their stack (e.g. MikroORM codegen, Windows).
   - **Breaking changes** (rare; LuckyStack keeps new features OFF by default).

4. **Surface + offer.** Say something like:
   > "v0.5.0 → v0.6.1 adds passwordless email-code login + 2FA (authenticator
   > apps, via the open TOTP standard) and fixes N bugs. 2FA is off by default.
   > Want me to enable 2FA + email-code login as part of this upgrade?"

   Then act on their answer. Adopting a feature adds steps 5b/5c below.

---

## Step 1 — Bump the dependencies (developer action)

Bump EVERY `@luckystack/*` entry in `package.json` — including the
`@luckystack/cli` **devDependency** — to the same target version, then install:

```
npm install
```

`npm install` is a developer action — if you're an AI, ask the user to run it
(or `! npm install` in this session). This delivers all **package code**
(runtime, framework routes, the whole library) automatically. New config
DEFAULTS also arrive here — they deep-merge from core, so a new config key is
present with a safe default without editing `config.ts`.

> Keep the cli version equal to the other `@luckystack/*` versions — `luckystack
> update` re-renders at the CLI's version and warns on a mismatch.

---

## Step 2 — Refresh the framework-authored files

`npm install` cannot deliver files that live in YOUR tree (docs, scripts, and —
after a feature release — `src/` UI + routes). Two commands close that gap:

```
npx luckystack update          # docs/luckystack, CLAUDE.md, skills, scripts, templates
npx luckystack update --app    # ALSO src/ UI + routes, functions/, config.ts, tsconfig
```

Both re-render a fresh scaffold with your RECORDED choices
(`.luckystack/scaffold.json`) as the single source of truth, then per file:

- **new framework file** (you didn't have it) → delivered (e.g. a feature's new
  UI component).
- **file you never edited** (hash matches the manifest baseline) → refreshed.
- **file you edited** → a `<file>.new` sidecar next to it — **never
  overwritten** — plus an AI-merge note in `dump/UPDATE_<hash>.log`.

Your own app code (never in the fresh render) is untouched. `prisma/`, `.env`,
`.env.local`, and `package.json` are never touched, even by `--app`.

---

## Step 3 — Merge the `.new` sidecars

For each `<file>.new` the report lists: merge its changes into `<file>`,
preserving your local edits, then delete the `.new` sidecar. An AI can apply the
`dump/UPDATE_<hash>.log` report directly. Review with `git diff` before
committing.

---

## Step 4 — Adopt a feature the user opted into (feature-specific)

Enabling a new feature usually needs three things the safe auto-update can't do
for you:

- **Flip the config flag** in `config.ts` (e.g. `auth.twoFactor: 'optional'`,
  `auth.emailCodeLogin: true`). `--app` sidecars the new commented options into
  `config.ts.new` so you can see them.
- **Add data-layer columns** (schema is NEVER auto-edited — too risky). For 2FA:
  add `twoFactorEnabled Boolean @default(false)`, `totpSecret String?`,
  `recoveryCodes Json?` to your `User` model (or your data layer's user table)
  and migrate (`prisma db push` / `migrate`, `db:schema:update`, …). If you
  forget, enrollment fails LOUDLY with a server log naming the exact columns.
- **Wire prerequisites** the feature needs (e.g. `@luckystack/email` installed +
  a sender registered for email-code login; `TOTP_ENCRYPTION_KEY` in
  `.env.local` to encrypt TOTP secrets at rest).

Each feature ships a runbook — for 2FA / email-code login see
`docs/luckystack/ARCHITECTURE_AUTH.md` (§"Enabling email-code login / 2FA on an
EXISTING project").

---

## Step 5 — Verify

```
npm run generateArtifacts   # regenerate the typed route maps
npm run typecheck           # tsc --noEmit — 0 errors
npm run build               # optional: prod bundle
```

Then smoke-test the flows you touched in a browser (server-start is a developer
action). Commit once green.

---

## What arrives how (summary)

| Change kind | Delivered by | Automatic? |
| --- | --- | --- |
| Runtime / framework routes / library code | `npm install` | Yes |
| New config VALUE (with a default) | `npm install` (deep-merge) | Yes — safe default, feature OFF |
| Framework docs / scripts / CLAUDE.md | `luckystack update` | Yes (pristine) / sidecar (edited) |
| Framework `src/` UI + routes, `config.ts` | `luckystack update --app` | New→delivered, edited→`.new` sidecar |
| Your own app code | — | Never touched |
| Data-layer schema columns (2FA, …) | Manual (documented) | No — fails loudly if a feature needs them |
| Real secrets / `.env.local` | Manual | No — never touched |
