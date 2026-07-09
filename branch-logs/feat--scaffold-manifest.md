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


## 2026-07-09 09:20 — Fase 1a: `luckystack update` (framework-owned files verversen)

**User prompt:** vervolg fasering ADR 0021: het expliciete update-command bovenop het fase-0-manifest.

**Wat ik deed:**
- Nieuw commando `luckystack update` (`packages/cli/src/commands/update.ts` + dispatch/help in `index.ts`). Scope = bucket-(a) allow-list: `docs/luckystack/`, `skills/`, `.claude/commands/`, `.luckystack/templates/`, `scripts/`, plus `CLAUDE.md`, `branch-logs/README.md`, beide gedeelde eslint-configs, `eval/README.md`+`scoreEval.mjs`. Raakt src/, functions/, config, prisma en .env* per definitie NIET.
- Template-bron = de scaffolder zelf: `npx create-luckystack-app@<cli-versie>` in een temp-dir met de in het manifest OPGENOMEN keuzes (`choicesToFlags`), Windows-veilig gespawnd (zelfde cmd `/s /c ""<path>" …"`-patroon als runNpmInstall, Bug-H). De verse scaffold schrijft zijn eigen manifest → geen dubbele template-logica; hash-vergelijking leest beide manifesten.
- Classificatie per file (pure `planUpdate`): ontbreekt→**add**; hash==vers→**unchanged**; hash==manifest-baseline→**pristine→overwrite**; anders→**user-modified→`<file>.new` sidecar** (nooit overschrijven). Manifest-loos project (pre-0.4.1) → sidecar-only. Na afloop: manifest-refresh (alleen geschreven files krijgen de nieuwe hash; sidecars houden de oude baseline; luckystackVersion+updatedAt bijgewerkt; nooit een manifest fabriceren) + rapport `dump/UPDATE_<hash>.log` met AI-merge-instructie voor de sidecars.
- `renderFreshScaffold` injecteerbaar (DI) → 9 nieuwe unit-tests op fixtures (safe-surface allow/deny, flags-mapping incl. forward-compat, add/overwrite/sidecar/unchanged, CRLF-only=unchanged, stamp-less nooit-overschrijven, manifest-refresh, rapport, faal-pad). CLI-suite 142/142.
- Kruis-check op ECHTE scaffolds: twee onafhankelijke `--no-prompt`-scaffolds → planUpdate classificeert alle 132 safe-surface files als `unchanged` → bewijs dat de cli-hashing (lokale kopie, sha256+CRLF→LF) byte-exact overeenkomt met de scaffolder-manifest-hashing.
- Docs: cli/CLAUDE.md (command + Function Index-rij), create-luckystack-app/CLAUDE.md ("refresh" verwijst nu naar `luckystack update`), docs/ROADMAP.md §sync-docs-CLI VERWIJDERD (dit command vervangt het — protocol: geland item eruit).

**Files touched:** packages/cli/src/commands/update.ts (nieuw), update.test.ts (nieuw), packages/cli/src/index.ts, packages/cli/CLAUDE.md, packages/create-luckystack-app/CLAUDE.md, docs/ROADMAP.md.

**Notes:** De npx-registry-route (default render-pad) is bewust alleen via verdaccio-e2e te testen — staat gepland als slotverificatie samen met `luckystack add cron`. Hash-implementatie is bewust gedupliceerd in cli (zero-dep-policy); de kruis-check hierboven is de drift-bewaker — overweeg later een parity-test in CI.
