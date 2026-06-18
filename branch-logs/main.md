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

**Bewust uit de wizard**: router (los infra-proces) + mcp (AI-tooling stdio-server) — geen app-runtime packages; krijg je via `npm i @luckystack/<pkg>` per use-case.

**Commits**: `c0ce5e7` (lean-default wizard) + eerdere `cbfe1f2`/`dec7f44`.

**Files**: packages/create-luckystack-app/src/index.ts, packages/create-luckystack-app/src/index.test.ts, packages/create-luckystack-app/CLAUDE.md.
