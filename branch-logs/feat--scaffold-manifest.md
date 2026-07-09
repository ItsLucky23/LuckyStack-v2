# Branch log — feat/scaffold-manifest

## 2026-07-09 09:08 — Fase 0: scaffold-manifest (.luckystack/scaffold.json) bij elke scaffold

**User prompt:** vervolg op de goedgekeurde fasering (ADR 0021, op debug/devtools-lag): fase 0 = bij scaffold-tijd vastleggen met welke versie, keuzes en file-hashes een project is gegenereerd — de fundering voor `luckystack update` én voor het later herconfigureren van migratie-dragende assen (ORM/dbProvider).

**Wat ik deed:**
- Nieuwe module `packages/create-luckystack-app/src/scaffoldManifest.ts`: `writeScaffoldManifest(targetDir, { luckystackVersion, projectName, choices, isTextFile })` schrijft `.luckystack/scaffold.json` = `{ schemaVersion: 1, luckystackVersion, createdAt, projectName, choices, files: [{ path, sha256 }] }`, gesorteerd + forward slashes. Helpers `collectFileHashes`/`hashFileContent` geëxporteerd voor de latere update-tooling.
- Hash-semantiek: sha256 over de GERENDERDE bytes ({{VAR}}-substitutie zit dus in de hash), CRLF→LF-genormaliseerd voor tekstfiles (zelfde conventie als assetParity) zodat een git-autocrlf-checkout niet als "alles gewijzigd" leest; `isTextFile`-predicaat via dependency-injection vanuit index.ts (voorkomt runtime-import-cycle met de CLI-entry).
- Uitsluitingen: `node_modules`, `.git`, `.env`, `.env.local`, `.secret-manager-token`, het manifest zelf. Env-files bewust nooit update-managed én geen hash-orakel voor secrets. `.env*_template` (framework-shipped) tellen wél mee. `.gitignore` negeert `.luckystack/` niet → manifest wordt gecommit (baseline overleeft clones).
- Aanroep in `main()` als LAATSTE file-producerende stap (na alle prune/wire-stappen, vóór `npm install`); `choices` gespreid (`{ ...choices }`) omdat een interface geen impliciete index-signature heeft (root-tsc-fout gevangen en gefixt).
- Tests: `scaffoldManifest.test.ts` (CRLF-stabiliteit, binaire bytes exact, exclusions/sortering/slashes, pristine-vs-modified detectie, manifest-shape + zelf-exclusie). Package-suite 87/87 groen.
- Runtime-smoke: échte scaffold-run (`node dist/index.js smoke-app --no-prompt --no-install` in scratchpad) → manifest aanwezig met 218 file-hashes, keuzes (mongodb/none), env-exclusie klopt.
- Gates: root build (tsc+vite) groen, lint:packages 0/0, ai:lint schoon.
- CLAUDE.md van het package bijgewerkt (Function Index-rij + main()-flow).

**Files touched:** packages/create-luckystack-app/src/scaffoldManifest.ts (nieuw), src/scaffoldManifest.test.ts (nieuw), src/index.ts (import + aanroep in main), packages/create-luckystack-app/CLAUDE.md.

**Notes:** ADR 0021 (de "why") staat op branch debug/devtools-lag en merget onafhankelijk. Backfill-verhaal voor bestaande stempel-loze projecten hoort bij fase 1a (`luckystack update`): manifest afwezig ⇒ nooit blind overschrijven, sidecar-only. Fase 1a (update-command) en 1b (ORM-wizard) bouwen hierop voort.
