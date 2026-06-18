# Branch: main

> Append-only progress log. New entries to the bottom.

## 2026-06-18 — Branch consolidatie: `chore/package-split-prep` + `master` → `main` (nieuwe default)

**Context**: het echte werk van ~april–juni 2026 leefde niet op `master` maar op de feature-branch `chore/package-split-prep`. `master` was de GitHub-default maar liep fors achter. Er bestond daarnaast nog een oude `main` (weer 6 commits achter master). Dit is rechtgetrokken.

**Wat er gebeurd is**:
- **Alle 53 commits van `chore/package-split-prep` (author-dates 2026-04-15 t/m 2026-06-18)** zijn via fast-forward in `main` terechtgekomen — lineair, geen merge-commits, geen conflicten. `main` (`dd1a240`) bevat nu de volledige geschiedenis incl. de v0.2.0-release-voorbereiding.
- `main` is op GitHub als **default branch** gezet.
- `master` (was `2912280`) is verwijderd — lokaal + remote.
- `chore/package-split-prep` (was `dd1a240`) is verwijderd — lokaal + remote, na merge.
- Tag `v0.2.0` wijst naar `dd1a240`.

**Volledige per-prompt historie van dat werk**: zie `branch-logs/chore--package-split-prep.md` (132 entries, 2026-05-20 → 2026-06-18). Dat bestand blijft als archief staan; nieuwe entries komen vanaf nu hier in `main.md`.

**Highlights van wat er in die periode landde** (zie het archief voor details):
- Opsplitsing van de framework-monorepo in 16 `@luckystack/*` packages + `create-luckystack-app`.
- Volledige roadmap-sweep (MEDIUM/LOW/HIGH/refactors), security-hardening, AI-doc/indexing-laag.
- v0.2.0-release-prep: CI build-wave fix (`test-runner` na `login` → TS7016 in verse CI), CI-test-gate van live-server sweep (`npm run test`) naar zelfstandige `npm run test:unit`.

**Open**: v0.2.0 npm-publish via de `publish`-workflow op de tag — eerste run faalde op `ENEEDAUTH` (npm-token); `NPM_TOKEN`-secret toegevoegd, re-run loopt. Uitkomst nog te bevestigen (`npm view @luckystack/core version` → moet `0.2.0`).

**Files**: geen code-wijziging in deze entry — puur git branch-topologie (default-switch + branch-deletes) + dit log.

## 2026-06-18 — DX-fixes na v0.2.0 wizard/server-test (0.2.1-materiaal)

**User goal**: vier punten gevonden bij het testen van een verse v0.2.0-scaffold. Drie opgepakt (1, 3, 4 + counter); per-package-install-restructure deels (zie Open). Keuzes via AskUserQuestion: wizard = volledig per-package ja/nee; port = auto-increment default in dev + loop-guard; prisma = auto-generate + hint.

**Wat ik deed** (2 parallelle agents + zelf de wizard):
- **Port (`packages/server/src/createServer.ts` + `packages/devkit/src/supervisor.ts`)**: auto-increment default AAN in dev / UIT in prod (expliciete `SERVER_PORT_AUTO_INCREMENT` wint altijd; signaal = `isProduction` uit core). Supervisor stopt na 4 opeenvolgende fast-crashes (<3s) met actionable message i.p.v. eindeloze EADDRINUSE-loop.
- **Prisma (`packages/devkit/src/hotReload.ts` + nieuw `prismaClientCheck.ts`)**: dev-boot detecteert schema-aanwezig + client-ontbreekt (`node_modules/.prisma/client`), draait dan eenmalig `npx prisma generate` (geen DB nodig); als type-map alsnog faalt → gerichte hint "run npm run prisma:generate".
- **Wizard (`packages/create-luckystack-app/src/index.ts`)**: `(x/y)` progress-counter, één-regel omschrijving onder elke vraag (noemt de `@luckystack/*` package + functie), intro-regel met de altijd-geïnstalleerde runtime (core/server/api/sync).

**Verificatie**: `npm run build:packages` 16/16 · `npm run lint:packages` 0 (na fix nested-ternary in createServer.ts) · `npm run ai:lint` 0 · server-package DTS-build OK.

**Commits**: `f548c8d` (port), `1427019` (prisma), `cbfe1f2` (wizard).

**Open / gemeld (Rule 3b)**: "volledig per-package ja/nee" is maar deels haalbaar — alleen presence/login(auth)/email/i18n zijn echt in de template gedraad en toggle-baar. `error-tracking` zit dieper verweven (sentry-shim); `secret-manager`/`docs-ui`/`router`/`mcp` zitten NIET in de scaffold → opt-in maken = per package nieuw wiring-werk (template-files/providers/env), een aparte taak. Deze fixes zijn 0.2.1-materiaal: vereisen later een version-bump + republish (v0.2.0 tag blijft op de oude commit).

**Files**: packages/server/src/createServer.ts, packages/devkit/src/supervisor.ts, packages/devkit/src/hotReload.ts, packages/devkit/src/prismaClientCheck.ts (nieuw), packages/create-luckystack-app/src/index.ts.

## 2026-06-18 — Wizard punt 1 volledig: per-package opt-toggles

**User goal**: punt 1 (elke optionele package een eigen ja/nee-vraag) volledig verwerken in de wizard; pas publishen als 0.2.1 als alles werkt.

**Wat ik deed** (`packages/create-luckystack-app/src/index.ts`):
- `ScaffoldChoices` + `DEFAULT_CHOICES` + `CliArgs` uitgebreid met `errorTracking` (opt-out, default aan), `docsUi` + `secretManager` (opt-in, default uit).
- Wizard- én fallback-prompts kregen de drie nieuwe vragen mét omschrijving; conversie + preset-builders + `--no-prompt`-pad bijgewerkt.
- CLI-flags `--no-error-tracking`, `--docs-ui`, `--secret-manager` (+ VALID_FLAGS + help-tekst).
- `injectOptionalDeps`: voegt `@luckystack/docs-ui` / `@luckystack/secret-manager` toe wanneer gekozen.
- `pruneErrorTracking`: `dropDependency('@luckystack/error-tracking')` + `removeScaffoldPath('functions/sentry.ts')` (enige actieve referentie; rest zijn comments/externals).
- **Bewust uitgesloten**: `router` + `mcp` — geen app-runtime packages (router = los infra-proces, mcp = AI-tooling stdio-server). Gemeld aan user.

**Verificatie**: scaffolder build (tsup) OK · `lint:packages` + `ai:lint` 0 · 68/68 unit-tests (3 shape-asserts bijgewerkt) · **echte end-to-end scaffold** van 2 configs: defaults → error-tracking aanwezig, docs-ui/secret-manager afwezig, `functions/sentry.ts` aanwezig; `--no-error-tracking --docs-ui --secret-manager` → error-tracking weg + sentry.ts verwijderd, docs-ui + secret-manager toegevoegd.

**Open**: nog niet getest met echte `npm install` + build van een gescaffold project (user doet dat); is 0.2.1-materiaal → version-bump + republish voordat het op npm staat.

**Commits**: `cbfe1f2` (counter+descriptions), `dec7f44` (per-package toggles).

**Files**: packages/create-luckystack-app/src/index.ts, packages/create-luckystack-app/src/index.test.ts, packages/create-luckystack-app/CLAUDE.md.

## 2026-06-18 — Lean-by-default wizard: alles opt-in, volledig gewired bij "ja"

**User goal**: na vraag over opt-in/opt-out inconsistentie → twee beslissingen: (1) docs-ui/secret-manager volledig wiren bij "ja" (gelijk aan presence), (2) alles opt-in, niks vooraf aan ("magere default-app"). Plus uitleg waarom router/mcp niet in de wizard horen.

**Onderzoek** (Explore-agent op `@luckystack/cli` `add` + docs-ui/secret-manager): de CLI `add` bevat de wiring al; docs-ui is "fully wired" met alléén de dep (`./register` mount `/_docs`); secret-manager = dep + uncommenten van de config.ts/server.ts blokken (config.ts `export default config` draagt de slot; server.ts leest via default-import).

**Wat ik deed** (`packages/create-luckystack-app/src/index.ts`):
- **Lean defaults**: `DEFAULT_CHOICES` + wizard- + fallback-defaults → auth=none, email=none, presence/error-tracking/docs-ui/secret-manager/i18n allemaal UIT; aiInstructions blijft AAN (docs, geen runtime-gewicht). db blijft mongodb.
- **Opt-out → opt-in flags**: `--no-presence`/`--no-error-tracking` → `--presence`/`--error-tracking` (CliArgs `noPresence`/`noErrorTracking` → `presence`/`errorTracking`); VALID_FLAGS + parseArgs + preset-builders + help-tekst bijgewerkt.
- **secret-manager fully-wired bij ja**: nieuwe `wireSecretManager()` uncomment de config.ts `secretManager`-slot + de server.ts init-block (dormant tot `LUCKYSTACK_SECRET_MANAGER_URL` gezet); aangeroepen in `main()` na de prune-stap. docs-ui = dep-only (self-wired).
- `asOption`-fallbacks 'credentials'/'console' → 'none'.

**Verificatie**: scaffolder build + `lint:packages` + `ai:lint` 0 · 68/68 unit-tests (shape-asserts + presence-flag-test bijgewerkt) · **echte scaffold van beide extremen**: alles-uit → prune-combo (presence+error-tracking+auth+i18n) componeert zonder errors, deps = alleen core/api/server/sync(+devkit/test-runner), sentry.ts/login/nl.json weg; alles-aan → alle 12 packages, secret-manager config+server uncommented, sentry.ts aanwezig.

**Niet verifieerbaar in-repo** (gemeld): consumer `npm install`+build — template pint `^0.2.0`, nog niet op npm (kip-ei). User's gate na publish.

**Bewust uit de wizard**: router (los infra-proces) + mcp (AI-tooling stdio-server) — geen app-runtime packages; krijg je via `npm i @luckystack/<pkg>` per use-case. (Herzien — zie volgende entry: nu wél behandeld.)

**Commits**: `c0ce5e7` (lean-default wizard) + eerdere `cbfe1f2`/`dec7f44`.

**Files**: packages/create-luckystack-app/src/index.ts, packages/create-luckystack-app/src/index.test.ts, packages/create-luckystack-app/CLAUDE.md.

## 2026-06-18 — Volledige package-dekking in de wizard (router/mcp/cli)

**User-inzicht**: de wizard IS de enige echte setup (`npm i @luckystack/core` in lege map werkt niet — by design; je hebt het hele project-skelet nodig). Dus de wizard moet ALLE packages behandelen. Beslissingen: mcp auto-wiren bij AI-docs; router als opt-in optie; cli als devDep.

**Wat ik deed** (`packages/create-luckystack-app/src/index.ts` + template):
- **router**: nieuwe opt-in choice `router` (+ `--router` flag, wizard- + fallback-vraag). `wireRouter()` voegt `@luckystack/router` dep + een `"router": "luckystack-router"` script toe (los proces; topologie in de al-gescaffolde deploy.config.ts).
- **mcp**: `wireGraphMcp()` voegt `@luckystack/mcp` devDep + een `.mcp.json` `luckystack`-server toe wanneer `aiInstructions` aan staat → AI krijgt graph-queries (blast_radius/who_imports) over het project. Aangeroepen in de aiInstructions-tak.
- **cli**: `@luckystack/cli` als vaste template-devDep zodat `npx luckystack add` lokaal resolvet.

**Conceptueel vastgelegd**: install-paden = (1) wizard = enige from-scratch weg; (2) `npx luckystack add <feature>` post-scaffold; (3) `npm i @luckystack/<pkg>` voor backend-only self-wire packages. Geen "vanuit niks zonder scaffold"-pad — by design (scaffold = de app). Alle 16 packages nu gedekt.

**Verificatie**: scaffolder build + `lint:packages` + `ai:lint` 0 · 68/68 unit-tests (shape-assert router-veld) · scaffold `--router` → router dep+script ✓; AI-docs aan → mcp devDep + .mcp.json `luckystack` ✓; cli devDep altijd ✓; `--no-ai-docs` → geen mcp/.mcp.json ✓.

**Commit**: `e87a390`.

**Files**: packages/create-luckystack-app/src/index.ts, packages/create-luckystack-app/src/index.test.ts, packages/create-luckystack-app/CLAUDE.md, packages/create-luckystack-app/template/package.json.

## 2026-06-18 — v0.2.1 publish-fix + client `process`-audit + wizard detail-toggle

**Context**: user bumpte/tagde v0.2.1 → publish-gate faalde op `test:unit` (4 tests). Daarna bij testen: `config.ts:69 process is not defined` in de browser. + vraag: error-tracking is onduidelijk in de wizard naast de sentry/monitoring-vraag.

**1. Publish-gate fix (`packages/server/src/listenServer.test.ts`)**: mijn port-fix voegde een `isProduction`-import aan `createServer.ts` toe; de test mockte `@luckystack/core` zonder die export → 4 failures. Mock nu met een mutabele `coreState.isProduction` (getter) + 2 nieuwe tests (dev-default auto-increment aan / expliciet uit). Volledige `test:unit` weer 1283 (was 1281 + 2). **Mijn fout: na de port/prisma-changes wel build+lint maar niet de volledige test:unit gedraaid.** Commit `9e0a7d3`.

**2. Browser-`process` bug + audit**: `wireSecretManager` (en het template-blok) gebruikte `process.env.LUCKYSTACK_SECRET_MANAGER_URL` direct; `config.ts` draait óók in de Vite-browserbundle → ReferenceError. Nu via de bestaande `env()`-guard. **Audit alle packages**: client-gebundelde surfaces (`core/client`, `sync/client`, `presence/client`, `core/src/react/*.tsx`, template `src/**`, login-assets) zijn schoon — geen top-level `process`. Enige latente plek (GEMELD, niet gefixt): `core/projectConfig.ts` `getProjectName()` leest `process.env.PROJECT_NAME` zonder guard, maar staat in een functie-body met alleen server-callers (geen crash bij import). `vite.config.ts` `process.cwd()` = build-time node, veilig.

**3. Wizard detail-toggle**: nieuwe `WizardStep.details` + `?`-keypress die een uitklapbaar detail-blok toont (reset per stap). Ingezet voor `@luckystack/error-tracking`: legt uit dat het de auto-capture-laag is die de in de vorige vraag gekozen backend (Sentry/Datadog/PostHog) voedt — "backend-vraag = WAARHEEN telemetry gaat; dit pakket = de lijm". Beide omschrijvingen aangescherpt.

**Verificatie**: scaffolder build · `test:unit` 1283 · `lint:packages` + `ai:lint` 0 · scaffold `--secret-manager` → config.ts gebruikt `env()` (browser-veilig).

**Commits**: `9e0a7d3` (test-fix), `<deze>` (browser-safe config + detail-toggle).

**Open**: v0.2.1 tag wijst nog naar de pre-fix commit → user moet her-taggen naar de nieuwe HEAD (één re-tag dekt alle fixes), dan re-publish.

**Files**: packages/server/src/listenServer.test.ts, packages/create-luckystack-app/template/config.ts, packages/create-luckystack-app/src/index.ts.
