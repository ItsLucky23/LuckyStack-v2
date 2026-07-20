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

## 2026-06-18 — v0.2.3: prisma-detectie fix + wizard review/details + CLI-onderzoek

**Context**: 0.2.2 gepubliceerd. Nieuwe user-wensen: `?`-details op elke stap, hint op eigen regel, error-tracking onduidelijk (zeker zonder backend), per-stap package-naam, confirm/review-stap, en prisma:generate die niet runt + geen hint. Plus vraag over wat de CLI kan (list/add/remove wizard).

**Onderzoek (2 agents)**:
- **Prisma root cause**: `isPrismaClientMissing()` werd misleid — `@prisma/client`'s postinstall schrijft een STUB in `node_modules/.prisma/client/` vóór generate, dus de dir bestaat → check `false` → geen auto-gen én hint onderdrukt. ROOT_DIR was correct (geen verdachte). 
- **CLI**: puur flag-gedreven (`add` only), geen list/remove/detectie/interactief; package-lijst staat 4× gedupliceerd (cli FEATURES, scaffolder, server OPTIONAL_PACKAGES, PACKAGE_OVERVIEW.md). `list` makkelijk; interactieve add/remove vereist wizard-extractie + detectie-port + remove-handlers + liefst één gedeelde registry.

**Gedaan**:
- **devkit prisma-fix** (`prismaClientCheck.ts` + `hotReload.ts`): probe de echte marker `.prisma/client/schema.prisma` (alleen ná echte generate) i.p.v. de dir; hint ontkoppeld van die check en gekoppeld aan de error-tekst (`/unresolved type identifiers/`) zodat 'ie altijd verschijnt.
- **wizard** (`create-luckystack-app/src/index.ts`): `details` op ELKE stap (`?`-toggle), de details-hint op een eigen regel, per-stap package-naam in de labels (bijv. "Authentication mode? (@luckystack/login)"), een **review-scherm** als laatste stap (alle keuzes + `← back to edit`, geen dead-end meer), en de error-tracking details leggen nu de backend="none" (no-op) case uit.

**CLI-feature**: NIET gebouwd — toegelicht + voorgesteld als aparte taak (list + interactieve add/remove + één gedeelde package-registry). Wacht op go van user.

**Verificatie**: build:packages 16/16 · test:unit 1283/1283 · lint:packages + ai:lint 0 · smoke-scaffold OK.

**Release**: working tree had een niet-gecommitte `bump patch` (0.2.2→0.2.3); gecommit als `chore(release): v0.2.3`. Commits: `b0aef86` (fix+feat), release-bump-commit.

**Open**: user tagt `v0.2.3` → publisht. CLI-feature na go.

**Files**: packages/devkit/src/prismaClientCheck.ts, packages/devkit/src/hotReload.ts, packages/create-luckystack-app/src/index.ts, packages/create-luckystack-app/CLAUDE.md, packages/*/package.json (0.2.3 bump).

## 2026-06-18 — CLI list + manage(wizard) + remove, single shared registry

**Context**: Vervolg op de vorige entry's voorstel — de CLI kon alleen `add <feature>` (flag-gedreven), package-lijst stond 4× gedupliceerd. Nu: gedeelde registry + `list` + interactieve add/remove wizard + remove-handlers.

**Gedaan** (`packages/cli`, zero runtime deps, strict typing):
- **`src/registry.ts`** (NIEUW): `REGISTRY` typed array = single source of truth (`id, pkg, kind:'login'|'presence'|'backend', description, removable:'safe'|'guarded', note?`). login=guarded (kopieert user-owned pages), backend+presence=safe. `index.ts` dispatch + list/manage/remove deriven hieruit. `assetParity.test.ts` herschreven: importeert REGISTRY direct i.p.v. FEATURES-regex te scrapen; parity met server `OPTIONAL_PACKAGES` blijft afgedwongen.
- **`commands/list.ts`** (NIEUW): read-only tabel installed (vRANGE)/available + "core/other @luckystack" sectie. `installedRegistryIds` (pure).
- **`lib/wizard.ts`** (NIEUW): `runCheckbox` — zero-dep readline-keypress multi-select (↑/↓·space·enter·ctrl-c), `isInteractive` non-TTY guard.
- **`commands/manage.ts`** (NIEUW): `computeManagePlan` (PURE diff installed↔selected, unit-getest) + `applyManagePlan` (adds→removes, daarna ÉÉN npm install).
- **`commands/remove.ts`** (NIEUW): `removeFeature` per kind — backend: drop dep; presence: drop dep + reverse JSX (mirror van scaffolder `prunePresence`, editFile faalt loud op drift); login: GUARDED — drop dep maar KEEP gekopieerde auth-files + warn.
- **`lib/project.ts`**: `dropDependency` (inverse van addDependency), `hasDependency`, `dependencyRange` toegevoegd.
- **`index.ts`**: dispatch herschreven — list/manage/add/remove/check-*; bare `add`/`remove` zonder feature openen de wizard; `main()` nu async.

**Verificatie**: `npx tsup` OK (ESM; dts intentioneel uit — bin entry) · `tsc --noEmit` clean · eslint src clean · eslint test-files clean · `vitest run packages/cli` 41/41 (registry parity, list output tegen temp pkg.json, computeManagePlan, remove backend/presence/login guarded + drift-faalt-loud).

**Guarded beslissing**: login-removal verwijdert NOOIT automatisch de gekopieerde pages (user kan ze geëdit hebben); dep eraf + waarschuwing met de te-verwijderen paden. `--force` bewust NIET als auto-delete geïmplementeerd.

**Open**: versie NIET gebumpt, niet gecommit (per opdracht). PACKAGE_OVERVIEW.md dedup (4e kopie) niet aangeraakt — buiten scope.

**Files**: packages/cli/src/registry.ts, packages/cli/src/commands/{list,manage,remove}.ts, packages/cli/src/lib/wizard.ts, packages/cli/src/lib/project.ts, packages/cli/src/index.ts, packages/cli/src/assetParity.test.ts, packages/cli/src/commands/manage.test.ts, packages/cli/CLAUDE.md.

## 2026-06-18 — socket.io 400 `code:3` fix: admit origin-less handshakes

**User goal**: bij installeren via npm kreeg de client een `GET http://localhost:5173/socket.io/?EIO=4&transport=polling 400 (Bad Request)` (`{"code":3,"message":"Bad request"}`) in de console. Geen push/publish — een andere AI is op het repo actief (cli/prisma), dus conflict-vrij gehouden.

**Diagnose (bewezen, niet gegokt)**:
- Backend draaide wél (`node` PID 44048 op `:80`); Vite-proxy op `:5173` forward `/socket.io` correct — de `ws://` proxy-target was géén probleem (polling is plain HTTP; `http-proxy-middleware` routeert 't gewoon). `backendUrl = window.origin = localhost:5173` in dev is **juist** (same-origin via proxy), niet de bug.
- Isolaat-test met engine.io + exact de `loadSocket` cors-callback: **origin-less handshake → 400 code:3 `MIDDLEWARE_FAILURE`**, zelfde request mét `Origin` → 200. Enige verschil = de `Origin`-header.
- Root cause: `packages/server/src/loadSocket.ts` cors.origin-callback wees **elk request zonder `Origin`** af (tenzij `allowOriginless`, dat de template nóóit zet). Browsers sturen bij een **same-origin GET** géén `Origin`-header — en de Socket.io polling-handshake IS same-origin in **beide** topologieën: dev (Vite-proxy) én prod-met-`@luckystack/router` (frontend+backend één origin). Regressie sinds v0.2.0 `95a1e13` ("security hardening"); de JSDoc-rationale ("last browser-origin gate on the WS path") was misplaatst — dezelfde callback draait op de plain-HTTP handshake.
- Correctie op mijn eerste hypothese: ik dacht even dat `FORBIDDEN`(code 4/403) de match was, maar de `connection_error`-context toonde `MIDDLEWARE_FAILURE` → code 3/400. Locatie (`loadSocket.ts`) bleek wél juist.

**Fix (optie 3 = framework + template, per user-keuze)**:
- `packages/server/src/loadSocket.ts`: origin-less → `callback(null, true)` (CORS geldt niet voor same-origin; de echte auth-gate = session-token in handshake + auth-hooks, onafhankelijk van Origin). Requests mét Origin blijven via `allowedOrigin()` ge-gate.
- `packages/core/src/projectConfig.ts`: `allowOriginless` JSDoc herschreven — flag is nu no-op (behouden voor type-compat), gedocumenteerd als deprecated.
- `packages/create-luckystack-app/template/config.ts`: commentaar maakt expliciet dat origin-less handshake framework-breed wordt toegelaten, zodat een lezer niet elke same-origin variant in `allowedOrigins` hoeft te zetten.

**Verificatie**:
- Isolaat-test met de nieuwe logica: [1] origin-less → **200** ✅, [2] geldige Origin → 200 ✅, [3] **ongeldige** cross-origin (evil.com) → **400** ✅ (CORS blijft afgedwongen voor requests mét Origin).
- `lint:packages` 0 · `build:packages` 16/16 · `test:unit` 1296/1296 · `ai:lint` 0. Geen test asserteerde het oude origin-less-afwĳsgedrag (niets achterhaald).

**Belangrijk**: de draaiende dev-server draait nog de **oude** build — de user moet `npm run server` herstarten om de nieuwe `@luckystack/server` te laden; daarna verdwijnt de 400.

**ADR**: `docs/decisions/0013-admit-originless-socketio-handshake.md` (status: accepted — bewuste beleidswijziging mét verworpen alternatieven: hard-afwijzen behouden, alleen-`allowLocalhost`, en polling-vs-WS onderscheiden in de callback).

**Niet gedaan**: versie niet gebumpt, niet gepubliceerd, niet gecommit (per opdracht — de andere AI doet publish). `allowOriginless` verwijderen = toekomstige major. `PACKAGE_OVERVIEW.md`/andere docs onaangetast.

**Files**: packages/server/src/loadSocket.ts, packages/core/src/projectConfig.ts, packages/create-luckystack-app/template/config.ts, docs/decisions/0013-admit-originless-socketio-handshake.md.

## 2026-06-19 10:30 — Verificatie confusion-fixes (ultracode) + login-doc pruning + allowMultiple volledig weg

**User goal**: de 8 confusion-audit fixes adversarieel verifiëren met sonnet-agents, én borgen dat bij niet-installeren/CLI-verwijderen van login ALLE login-doc-content uit de docs verdwijnt (ook losse regels in een .md), behalve een neutrale "de package bestaat"-verwijzing.

**Verificatie (9-agent Workflow, sonnet)**: 7/8 items volledig bevestigd zonder gaps (raw-keys, README-refs, auth-none-oauth, error-tracking-dev, presence-install, secret-manager, socket-originless). 1 partial + 1 nieuwe eis bleken reëel:
- **allowMultiple (partial)**: packages/ schoon, maar restanten in dev-root `config.ts` (knob + bridge), 2 test-comments, `docs/ARCHITECTURE_PACKAGING.md`, `docs/REFACTOR_ROADMAP.md`.
- **Login-docs lekken (leaks-login-docs)**: geen enkele pruner raakt `.md` aan; `template/README.md` regels 35/43/57/91 beschrijven login als geïnstalleerd en overleven een no-login scaffold.

**Wat ik deed**:
- *allowMultiple volledig weg*: dev-root `config.ts` `allowMultipleSessions:boolean` → `sessionPerUser:'single'|'multiple'` (interface, fallback, 4 dns-map entries, config-veld, `perUser`-derivatie, named export). 2 test-comments → `sessionPerUser: 'multiple'`. `ARCHITECTURE_PACKAGING.md` config-key lijst → `session.perUser`. `REFACTOR_ROADMAP.md` shim-item gemarkeerd als opgelost. Repo-breed nu 0 live refs (alleen branch-log history blijft).
- *Login-doc pruning*: nieuwe `pruneLoginDocs` + `LOGIN_DOC_EDITS` in create-luckystack-app `index.ts`, aangeroepen in `pruneAuthNone` — strips de 3 login-beschrijvende paragrafen en vervangt de auth-pages paragraaf door één neutrale `npx luckystack add login`-pointer. Spiegel in `@luckystack/cli` `commands/remove.ts` (`pruneLoginDocs`, best-effort per-edit zodat een hand-edited README de removal niet breekt) aangeroepen in `removeLogin`.

**Verificatie**: `build:packages` 16/16 · `lint:packages` 0 · `lint` (client+server+config.ts) 0 · `test:unit` 1298/1298. Scaffold-smoketest: `--auth=none` → 0 login-paragrafen + 1 neutrale pointer; `--auth=credentials` → alle 4 behouden.

**Niet gedaan**: README-regel 76 (`/login` als generiek middleware-voorbeeld) bewust gelaten — leert de middleware-API, adverteert geen geïnstalleerde feature. Versie niet gebumpt/gepubliceerd (0.2.4 staat klaar, user-actie).

**Files**: config.ts, docs/ARCHITECTURE_PACKAGING.md, docs/REFACTOR_ROADMAP.md, src/settings/_api/listSessions_v1.tests.ts, src/settings/_api/revokeSession_v1.tests.ts, packages/create-luckystack-app/src/index.ts, packages/cli/src/commands/remove.ts.

## 2026-06-19 14:00 — Dev port-bump desync fix: backend advertises bound port, Vite proxy follows

**User goal**: de huidige port-bump-logica klopt niet. Backend leest `SERVER_PORT` uit `.env` én auto-incrementeert bij EADDRINUSE — maar de Vite-proxy blijft naar de oude poort wijzen, dus de socket.io-websocket (en api/sync) breken. User koos (AskUserQuestion) optie "auto-pick + proxy volgt".

**Root cause**: `npm run server` (backend) en `npm run client` (Vite) zijn losse processen. De backend kan stilletjes naar `port+1` springen, maar `template/vite.config.ts` leest `SERVER_PORT` één keer bij opstart en target dat hardcoded. Geen van beide weet van de ander.

**Fix (proxy-volgt, geen workflow-wijziging)**:
- `packages/server/src/devServerInfo.ts` (NEW): `writeDevServerInfo(ip,port)` schrijft de ÉCHT-gebonden poort naar `node_modules/.luckystack/dev-server.json` (altijd gitignored, gedeelde cwd, ephemeral); `clearDevServerInfo()` ruimt op. Best-effort — een mislukte write neemt de server nooit mee.
- `packages/server/src/createServer.ts`: in de listen-success callback schrijft hij de bound port weg + registreert `process.once('exit', clearDevServerInfo)`. Gated op `!isProduction && NODE_ENV!=='test'` (geen prod-overhead, geen stray files in unit tests).
- `packages/create-luckystack-app/template/vite.config.ts`: `readBackendPort()` leest dat bestand (fallback `.env SERVER_PORT`). Vite's proxy heeft geen `router`, dus een `bypass`-hook muteert per request `options.target` → live-follow. Cruciaal: socket.io doet ALTIJD eerst een HTTP-polling-handshake (gaat door `bypass`, zet de target op het gedeelde options-object) vóór de ws-upgrade (hergebruikt dat object) → de **websocket volgt mee**, ook bij een mid-session port-hop. Reconnect heelt de cold-start race.

**Verificatie**: build:packages 16/16 · lint:packages 0 · test:unit 1298 (listen-tests skippen de write onder NODE_ENV=test — geen stray file bevestigd). Write↔read-contract end-to-end getest: met bestand → target `:8081`, zonder → fallback `:80`. Template gebruikt Vite 6.4.2 (`bypass` + `ProxyOptions` ondersteund). Root dev-app `vite.config.ts` heeft geen proxy (cross-origin via CORS) → bewust niet aangeraakt.

**Niet gedaan**: niet gebumpt/gepubliceerd (0.2.5-materiaal, wacht op user-go).

**Files**: packages/server/src/devServerInfo.ts (new), packages/server/src/createServer.ts, packages/create-luckystack-app/template/vite.config.ts, packages/server/CLAUDE.md.

## 2026-06-19 14:20 — docs-ui ships the editable React API-explorer page (scaffold + CLI)

**User goal**: wie docs-ui kiest/installeert kreeg alleen de 2 generated JSON-files in `src/docs/`, niet de `page.tsx` (de React API-explorer) — die wil de user wél meegeleverd hebben, en de CLI moet 'm ook weer kunnen verwijderen.

**Context**: er waren twee docs-surfaces — het `@luckystack/docs-ui` package (server-HTML op `/_docs`, self-wires via `./register`) en de dev-app's eigen `src/docs/page.tsx` (rijke React-explorer, leest `apiDocs.generated.json` client-side; hangt NIET aan het package). De user wil die page als consumer-asset bij docs-ui. Securitykant (explorer mag niet in prod) geflagd (Rule 3b) → opgelost via de prod-glob-exclusie i.p.v. een grote refactor.

**Wat ik deed**:
- *Asset*: `src/docs/page.tsx` gekopieerd naar `template/src/docs/page.tsx` (scaffold) én `packages/cli/assets/docs-ui/src/docs/page.tsx` (CLI). De `apiDocs.generated.json` is gitignored/dev-generated (devkit emitter) — niet meegeshipt.
- *Scaffold*: `pruneDocsUi` verwijdert `src/docs` als docs-ui NIET gekozen is (toegevoegd aan `pruneOptionalPackages`); bij wél gekozen blijft de page + dep (injectOptionalDeps). Template `main.tsx` prodPages kreeg `'!./**/docs/**'` (mirror dev-app): de explorer is dev-only — voorkomt zowel een prod-build-break op de dev-only JSON als publieke exposure.
- *CLI*: nieuwe `FeatureKind 'docs-ui'`; registry-entry omgezet van `backend` → `docs-ui`; `commands/addDocsUi.ts` (copy page + dep + install, mirror addLogin); `removeDocsUi` in `remove.ts` (delete page + drop dep); dispatch toegevoegd in `index.ts` runSingle + `manage.ts` runAdd + `remove.ts` removeFeature (exhaustive switches dwongen volledige dekking). `addBackendOnly` + CLI CLAUDE.md doc-drift bijgewerkt.

**Verificatie**: build:packages 16/16 · lint:packages 0 · test:unit 1298 (incl. assetParity). Scaffold: default → géén `src/docs/page.tsx`; `--docs-ui` → page + dep `^0.2.5`. CLI round-trip met gebouwde CLI: `add docs-ui` kopieert page + dep; `remove docs-ui` verwijdert page + dep.

**Files**: packages/create-luckystack-app/template/src/docs/page.tsx (new), packages/create-luckystack-app/template/src/main.tsx, packages/create-luckystack-app/src/index.ts, packages/cli/assets/docs-ui/src/docs/page.tsx (new), packages/cli/src/registry.ts, packages/cli/src/commands/addDocsUi.ts (new), packages/cli/src/commands/remove.ts, packages/cli/src/commands/manage.ts, packages/cli/src/index.ts, packages/cli/src/commands/addBackendOnly.ts, packages/cli/CLAUDE.md.

## 2026-06-19 14:50 — CLI reconfigure wizard (laag 1: design + state-detectie)

**User goal**: `luckystack manage` moet de scaffold-wizard spiegelen — per-package sub-opties (login authMode + OAuth-providers, email, monitoring) i.p.v. binair install/remove, mét een duidelijke consequentie-preview per wijziging. Plan ge-reviewd + goedgekeurd (3 beslissingen bevestigd); volledige uitvoering in lagen.

**Beslissingen (ADR 0014)**: D1 `.env.local` mag op KEY-aanwezigheid gelezen worden (nooit values) — bewuste, user-geautoriseerde versmalling van Rule 16. D2 reconfigure→none verwijdert de auth-UI (met confirm), los van de guarded `remove login`. D3 CLI = transitie-source-of-truth + parity-test, geen gedeeld package nu.

**Laag 1 gebouwd (additief, inert tot wiring)**:
- `docs/decisions/0014-cli-reconfigure-wizard.md` — design + 3 beslissingen + verworpen alternatieven.
- `packages/cli/src/featureOptions.ts` — reconfigureerbare opties (authMode/oauth/email/monitoring) + provider→env-key mappings (mirror van scaffolder PROVIDER_OPTIONS).
- `packages/cli/src/lib/envKeys.ts` — leest gedeclareerde env-KEY-namen uit `.env.local` dan `.env`, value-blind (ADR 0014 D1).
- `packages/cli/src/lib/state.ts` — `deriveState` (pure) + `detectProjectState`: leidt authMode/oauthProviders/email/monitoring + installed-packages af uit deps + env-keys + login-UI-aanwezigheid.
- Tests: `envKeys.test.ts` + `state.test.ts` (18 cases).

**Verificatie**: build:packages 16/16 · 18 nieuwe tests groen.

**Nog te doen (volgende lagen)**: step-wizard UI (single/multi-select + navigatie), transition-descriptors (deps/files/env/origins per feature+optie) → preview + apply, `manage`-rework, auth/oauth/email/monitoring transities, parity-test.

**Files**: docs/decisions/0014-cli-reconfigure-wizard.md (new), packages/cli/src/featureOptions.ts (new), packages/cli/src/lib/envKeys.ts (new), packages/cli/src/lib/envKeys.test.ts (new), packages/cli/src/lib/state.ts (new), packages/cli/src/lib/state.test.ts (new).

## 2026-06-19 16:00 — CLI reconfigure wizard L2–L4 + 3× adversarial verification (ultracode)

**User goal** (/goal, away): voer het hele plan uit, gebruik ultracode/sonnet, verifieer daarna alle changes met sonnet, commit+push als alles klopt.

**Gebouwd (L2–L4, bovenop L1)**:
- **L2 step-wizard UI** — `lib/wizard.ts` `runSingleSelect` (single-select + non-TTY/empty guards) naast de bestaande `runCheckbox`.
- **L3 transition-engine** — `transitions.ts` `planChanges(current, desired)` → granulaire `Change[]`, elk met een consequentie-preview (`effects`) + `apply`, afgeleid uit dezelfde feiten (preview↔apply kan niet divergeren). `lib/envFile.ts`: value-SAFE env-bewerking (sentinel-blokken append-if-absent, nooit een gevulde value wissen, EXTERNAL_ORIGINS per line-index, CRLF-veilig). `featureOptions.ts` uitgebreid met env-line/origin/dep-builders.
- **L4 orchestrator** — `commands/reconfigure.ts` `runReconfigureWizard`: detect state → step-menu → sub-screens (auth+oauth multi-select, email, monitoring, toggles) → per-change preview → confirm → apply → één install. `index.ts` routeert `manage` hiernaartoe (oude checkbox-wizard verwijderd). `manage.ts` blijft voor single-feature add/remove.

**Verificatie — 3 ultracode-passes (sonnet)**:
- Pass 1: 5 blockers → o.a. een ECHTE bug: mijn `runSingleSelect` raw-escapes misten de ESC-byte (uit gestripte display overgetypt) → wizard onleesbaar. Plus `dropEnvBlock` wiste gevulde secrets, `removeLoginChange` wiste files die `addLogin` nooit maakt, monitoring backend-switch preview-mismatch. Alle 5 gefixt.
- Pass 2: 0 blockers; majors gefixt (env line-index, preview↔apply parity email/monitoring, state `loginOn` package-based ipv UI, monitoring-loop uit constant, `dropDependency` ook devDeps, editAuth zero-provider/abort-revert, gedeelde `LOGIN_COPIED_PATHS`, HELP/CLAUDE.md docs, `wrap` veilige error).
- Pass 3: 0 blockers; 2 ECHTE CRLF-corruptie-majors (Windows!) — `appendSentinelBlock`/`addOrigin` gebruikten ruwe `\r\n`-text vóór `writeText`'s `\n→\r\n` → `\r\r\n`. Genormaliseerd + regressietest. Plus email apply-scoping + `pruneLoginDocs` ook bij manage→none.

**Tests**: +71 (state/envKeys/envFile incl. value-safety+CRLF, transitions diff+apply+preview-parity, parity). Gate: lint:packages 0 · build:packages 16/16 · test:unit 1356 · scaffold + CLI add/remove round-trip + non-TTY guard geverifieerd.

**Bewust gelaten (geen correctheidsbug)**: `manage.ts` ongebruikte add-pad (correcte generaliteit), OAuth lege-placeholder = "geselecteerd" (bedoeld per ADR 0014 D1), monitoring='none' bij et-installed-zonder-key (geen accidentele removal). ADR 0014 + memory voor de Rule-16 key-only uitzondering eerder vastgelegd.

**Files (nieuw)**: packages/cli/src/{transitions.ts, transitions.test.ts, transitions.apply.test.ts, commands/reconfigure.ts, lib/envFile.ts, lib/envFile.test.ts}. **(gewijzigd)**: packages/cli/src/{index.ts, featureOptions.ts, registry-n/a, lib/wizard.ts, lib/state.ts(+test), lib/project.ts, commands/manage.ts, commands/remove.ts, assetParity.test.ts}, packages/cli/CLAUDE.md.

## 2026-06-19 17:00 — CLI completeness: every scaffolder feature is now CLI-manageable + ships fully + removes cleanly

**User goal**: "weet je zeker dat de cli moet werken en heel breed is — alles mogelijk + alles goed geshipped? doe een laatste scan." → coverage scan (3 sonnet agents) found the CLI was NOT complete. User chose "alles dichtzetten (volledig)".

**Verified gaps (against real code) → all fixed**:
- `add login` was BROKEN: shipped only `src/` (UI+_api), missing `functions/session.ts` (the `functions.session.*` shim the _api handlers need) + `server/hooks/notifications.ts`, and never restored config.ts auth flags / server-index hooks. Now copies the WHOLE bundle + restores `credentials:true`/`forgotPassword:'framework'` + registers the notification hooks (best-effort). Route guards (page.tsx/dashboard) are consumer-owned → explicit post-add warning + LUCKYSTACK_ADD_GUIDE checklist (not auto-edited; substring-overlap made reverse-edits unsafe).
- `add error-tracking` now ships `functions/sentry.ts` (the `functions.sentry.*` shim); reconfigure monitoring→backend ships it too; remove deletes it.
- NEW CLI features: `secret-manager` (uncomment config.ts + server/server.ts blocks, byte-identical to wireSecretManager so remove matches a `--secret-manager` scaffold too), `router` (dep + `router` npm script), `mcp`/ai-docs (devDep + `.mcp.json` graph server). All add/remove + reconfigure toggles.
- remove-symmetry: reconfigure→none deletes the auth bundle (incl. shims) + reverts config/server-index → BUILDABLE; guarded `remove login` warns the build breaks + recommends reconfigure→none + warns on a dangling notifications import.
- Shared `runAddByKind` dispatch (dedups the 3 add-switches); reconfigure toggles data-driven over TOGGLE_IDS (presence/sync/docs-ui/secret-manager/router/mcp); `setScript`/`dropScript`/`addDevDependency` helpers; assetParity extended to the whole login bundle + excludes non-boot-autodetected ids.

**Verification**: 3-agent sonnet workflow → fixed all blockers/majors (test-toggle types, secret-manager token parity, dangling-import warn, page-guard warning). cli: lint 0 · tsc 0 · vitest 105. E2E with the built CLI: list shows all 9 features; add login/error-tracking/secret-manager/router/mcp each ship+wire fully; remove reverses each.

**Note**: a PARALLEL session was concurrently refactoring core/api/template (toError/tryCatch sweep). Committed ONLY the cli completeness files + LUCKYSTACK_ADD_GUIDE; left the parallel core/api/template changes uncommitted for that session. Re-synced the login asset bundle to the (parallel-updated) template so parity passes.

**Files**: packages/cli/src/{commands/{addLogin,addErrorTracking,addSecretManager,addRouter,addAiDocs,addDispatch,manage,remove,reconfigure}.ts, transitions.ts, registry.ts, index.ts, featureOptions.ts, lib/project.ts, assetParity.test.ts, transitions(.apply).test.ts}, packages/cli/assets/{login/{functions,server},error-tracking/functions}, packages/cli/CLAUDE.md, docs/LUCKYSTACK_ADD_GUIDE.md.

## 2026-06-19 17:30 — Repo-brede security/quality/logica-audit + alle fixes toegepast (ultracode Sonnet-team)

**User goal**: codebase scannen op security/SOLID/legacy/logica-gaps/verbeterpunten + open docs-punten verifiëren + npm-publish-readiness; daarna ALLE fixes toepassen. `workspace-handoff` genegeerd.

**Aanpak (2 workflows)**: (1) audit — 18 Sonnet-scanners (per package + sample-app) + open-docs + publish-readiness agents + adversariële verify-pass op alle security-findings (45 agents, 284 findings: 1 critical/51 high/150 med/82 low; 13 security bevestigd, 12 weerlegd). (2) verse herscan van cli/secret-manager/core/scaffolder (gewijzigd door parallelle sessie) + re-verificatie van alle eerdere findings per package, daarna **122 surgical fixes** toegepast door 18 fix-agents (18 deferred als architectureel/policy, 13 geskipt als stale/false-positive — o.a. `theme/language`-validatie blijkt al door gegenereerd Zod-schema gedekt; devkit supervisor-race onmogelijk op single-thread event loop).

**Belangrijkste fixes**: server (x-request-id-sanitisatie, decodeURIComponent path-guard, top-level error-boundary, resolveCookieSecure in logout, socket input-validatie); sync (HTTP-pad pariteit: preSyncFanout stop + preSyncRecipient overrideOutput, receiver-breadcrumb); login (Microsoft avatar MIME-allowlist, bearer-veld-warning extraSessionFields, reset-token uit hook-payload, PII uit logs); router (WS 101-header-stripping, redisHealthStore EXECABORT-log, wsProxy listener-race, bootHandshake SSRF/scheme-validatie); core (tryCatch non-Error-normalisatie, oneTimeToken DEL-check, checkOrigin origin-sanitisatie, rateLimiter expired-first eviction, scrub-regex split); scaffolder-templates (logout_v1 echt deleteSession + `functions.tryCatch`, session_v1 `console.log(user)` weg + rateLimit, notifications.ts veilige Prisma-guard, microsoft.png onError-hide, path-containment, printNextSteps slug); test-runner, docs-ui (XSS-escape + security-headers), email/error-tracking/api docs gecorrigeerd; sample-app (avatar MIME+size-cap, playground uit prod-bundle, server/dev/request.py verwijderd, serveFile extname-check).

**Publish-readiness toegepast**: bin-paden `./`-prefix (devkit/router/create-app/cli), cli/LICENSE toegevoegd, devkit dotenv `^16→^17`, 16× homepage `tree/master→main`, env-resolver README-stub (reserved placeholder). **Deferred (bewust, breaking/policy)**: secret-manager boot-seam `envNames` deny-all (warnt al; gedocumenteerd via JSDoc), `as unknown`-formatter-boundary type-alignment in core, presence cross-package room-formatter, config.ts module-load secret-timing, presence `socket.io` optional-peer.

**Eigen review-vondst (na fix-workflow)**: fix-agent maakte `logout_v1` afhankelijk van `functions.session` maar `pruneAuthNone` verwijdert die shim → no-auth scaffold brak. Opgelost door `src/_api/logout_v1.ts` mee te prunen in auth=none (handler is ongebruikte voorbeeld-code; echte logout loopt via `/auth/logout`).

**Gate (alles groen)**: build (16/16 packages + consumer tsc+vite+server-bundle), lint:all + lint:packages 0, ai:lint 0 invariant-violations, test:unit **1362/1362**. Onderweg gefixte breuken: secret-manager `string|null`-cast, sync ongebruikte `name`-param, 9 lint-regels (eslint-disable/luckystack-allow volgorde-bug, unicorn-stijl, zelf-veroorzaakte initSharedSentry-deprecation ×2), 5 test-assertions (redactToken 8→4 prefix, oneTimeToken MULTI-mock), create-app `printNextSteps` ongebruikte param.

**Niet gecommit** (user heeft niet gevraagd): werktree bevat zowel het parallelle CLI-werk als deze ~100 audit-fixes.

**Files**: ~100 gewijzigd over alle packages/* + src/ + server/ + 16× package.json + nieuwe packages/cli/LICENSE + packages/env-resolver/README.md.

## 2026-06-19 18:15 — Verificatie-ronde v0.2.0..HEAD: diff-review + security + echte npm-install (ultracode, Opus-verified)

**User goal**: alle AI-changes sinds release v0.2.0 (39 commits, ~213 files) reviewen op correctheid/regressies/security; ECHTE npm pack+install+scaffold-smoke; veilige fixes direct toepassen, rest navragen; geen commit. Sonnet voor scan, Opus voor adversariële verify (zuinig). `workspace-handoff` buiten scope.

**Aanpak (1 workflow, 16 agents)**: 9 diff-review-scanners (per package-gebied) + 3 security-sweeps + 1 echte install-verificatie → 54 findings (4 zeker / 11 waarschijnlijk / 39 onzeker). Opus adversariële verify op de 15-item shortlist: 10 CONFIRMED, 1 REFUTED (#5 wizard ANSI — ESC-byte byte-geverifieerd aanwezig, terecht weerlegd), 4 UNCERTAIN.

**Direct toegepast (6 veilige fixes)**: router/wsProxy.ts (`Set-Cookie` strip op WS-101 — code matcht nu de eigen security-comment, #27 ZEKER); router/httpProxy.ts (`x-luckystack-*` strip op response-pad, spiegelt de WS-fix, #44); login/login.ts `consumeOAuthState` (DEL-slot-check fail-closed, spiegelt oneTimeToken-hardening, #38 — replay-gat dicht); core/rateLimiter.ts (shadowing inner `now` weg, #14); cli/addAiDocs.ts (comment `add ai-docs`→`add mcp`, #0); mcp/package.json (bin `./dist/index.js` prefix, install-fix).

**Navraag-lijst (NIET gefixt — risico/twijfel, aan user)**: #4 featureOptions placeholder-defaults → `dropEnvBlock` altijd `'kept'` (ZEKER, API-keuze); #25 sync HTTP stop-signal geeft success i.p.v. error (ZEKER, error-contract-wijziging); #34 sample-app updateUser theme/language-allowlist; #35/#48 CLI-assets avatar MIME-allowlist + size-guard (behavioural — kan uploads weigeren); #13 secret-manager abs-path-warning spamt elke hot-reload (logging-judgment); #11 parseEnvFile inline-comment regressie (UNCERTAIN); #24 verwijderde CLI-flags = breaking (UNCERTAIN); #28 CSRF-warning onderdrukt in prod (UNCERTAIN). Plus ONZEKER-security om te wegen: `allowOriginless`/origin-less WS-CORS onvoorwaardelijk toegelaten (ADR 0013, #39/#42/#46), token-in-URL-fragment based-token mode (#50), EmailAttachment.href schema-loos (#45), scaffolder spawnt npm.cmd zonder abs-path (#49).

**Install-verificatie (echt)**: build:packages 16/16 OK; `npm pack` alle packages; verse temp-project install van create-luckystack-app (536 packages, 0 vuln); scaffold (db=sqlite, auth=none) + `npm install` OK; bins `luckystack`/`luckystack-dev`/`luckystack-mcp` linken + draaien. Bevonden: mcp bin miste `./` (gefixt); mcp+cli files[] noemen CHANGELOG.md die niet bestaat (npm laat 'm stil weg → navraag: stub maken of entry verwijderen).

**Gate (alles groen)**: lint client+server+packages 0, ai:lint 0, build 16/16 + volledige consumer-build, test:unit **1362/1362**. Eigen fixes braken niets.

**Niet gecommit** (per user-instructie). Werktree blijft schoon m.u.v. deze 6 fixes.

**Files**: packages/router/src/wsProxy.ts, packages/router/src/httpProxy.ts, packages/login/src/login.ts, packages/core/src/rateLimiter.ts, packages/cli/src/commands/addAiDocs.ts, packages/mcp/package.json.

## 2026-06-19 19:20 — Navraag-fixes uit de v0.2.0-verificatie toegepast (user-goedgekeurd)

**User goal**: na het verificatie-rapport koos de user per finding wat te fixen. Veilige + goedgekeurde fixes toegepast; #1 (allowOriginless) bewust niet gewijzigd (ADR 0013 = bewuste keuze, uitleg gegeven); #50/#45 als niet-dringend geparkeerd; CLI-flags (#24) niet hersteld (wizard biedt die opties al).

**Toegepast**:
- **#25 (sync, ZEKER)** — `handleHttpSyncRequest.stageFanout` geeft nu een echte error-response bij een `preSyncFanout`-stop i.p.v. stilletjes success (HTTP-pariteit met de socket-handler; deny-hook niet meer omzeilbaar over HTTP). Return-type + `preferredLocale` in de ctx-Pick + call-site `if (fanoutError) return fanoutError`.
- **#34/#35/#48 (security)** — `updateUser_v1` in ALLE DRIE de kopieën (consumer `src/`, CLI-asset, scaffold-template) is nu de secure-superset: avatar MIME-allowlist (`image/jpeg|png|gif|webp`) + 5 MB size-cap vóór de sharp-decode, theme/language-allowlist, en `getProjectConfig().auth.nameMaxLength` i.p.v. hardcoded 100. Fixte meteen de untranslated `profile.nameTooLong` (bestond niet in de locales) → `login.nameCharacterLimit`. Asset↔template byte-pariteit hersteld (assetParity-test).
- **#4 (CLI, ZEKER)** — `dropEnvBlock`/`filledKeysInBlock` zijn placeholder-bewust: een nieuw `blockPlaceholderDefaults(id)` (single source uit de *EnvLines) laat een ONGEWIJZIGDE shipped-default (`EMAIL_FROM=noreply@example.com`, `SMTP_PORT=587`, `MICROSOFT_TENANT_ID=common`, …) NIET meer als "gevulde secret" tellen → een placeholder-only blok wordt nu netjes verwijderd, terwijl een écht getypte secret nog steeds behouden + gewaarschuwd wordt (ADR 0014 D1 secret-safety blijft intact). 2 nieuwe tests.
- **#11 (secret-manager)** — `parseEnvFile` herschreven: laatste-quote als sluiter + trailing inline-comment strippen, zodat `KEY="value" # comment` correct `value` oplevert (oude `endsWith(quote)`-check faalde provable). `#` binnen quotes blijft literal. 1 nieuwe test. Fixte ook de stale comment (#10).
- **#13 (secret-manager)** — abs-path-warning alleen nog bij boot (reload-pad `warnAbsolute=false`), geen log-spam meer per hot-reload.
- **#28 (server)** — CSRF-logout-warning vuurt nu in ALLE envs (prod incl.) maar één keer per proces (module-guard) i.p.v. dev-only/per-request.
- **#49 (scaffolder)** — `runNpmInstall`/`runPrismaGenerate` resolven npm/npx naar een ABSOLUUT pad via PATH (cwd uitgesloten, PATHEXT-aware), gespiegeld van `@luckystack/cli` — geen BatBadBut-achtige relative-resolve meer.
- **Publish-cleanliness** — dangling `CHANGELOG.md` uit `files[]` van `@luckystack/mcp` + `@luckystack/cli` verwijderd (bestond niet op disk; npm liet 'm stil weg).

**Niet gewijzigd (bewust)**: #1 `allowOriginless` — ADR 0013 admit-originless is een correcte, gedocumenteerde keuze (origin-less = same-origin browser-signal; échte auth-gate = sessietoken via `extractTokenFromSocket` + auth-hooks). Default blijft; wie ALLE sockets auth-only wil kan een `applySocketMiddlewares`-token-gate toevoegen (aangeboden). #50 (token-in-fragment, alleen session-storage, prod-afgeraden), #45 (EmailAttachment.href schema), #24 (CLI-flags, wizard dekt het) — geparkeerd op verzoek.

**Gate (alles groen)**: lint client+server+packages 0, ai:lint 0, build 16/16 + volledige consumer-build, test:unit **1365/1365** (+3 nieuw). Onderweg gefixt: 1 nested-ternary (featureOptions), 1 no-lonely-if (consumer updateUser), assetParity-drift (template-kopie meegenomen).

**Niet gecommit** (per user-instructie).

**Files**: packages/sync/src/handleHttpSyncRequest.ts, packages/cli/src/{featureOptions.ts,lib/envFile.ts,lib/envFile.test.ts,transitions.ts,package.json}, packages/secret-manager/src/{index.ts,index.test.ts}, packages/server/src/httpRoutes/authLogoutRoute.ts, packages/create-luckystack-app/src/index.ts, packages/cli/assets/login/src/settings/_api/updateUser_v1.ts, packages/create-luckystack-app/template/src/settings/_api/updateUser_v1.ts, src/settings/_api/updateUser_v1.ts, packages/mcp/package.json.

## 2026-07-01 22:58 — prisma:* resolven secret-manager pointers via wrapper

**User prompt**: "als we de secret manager gebruiken en dan prisma:db:push willen runnen gaat dit niet als de database url geresolved word op runtime" → maak de `prisma:*` commands secret-manager-aware.

**Probleem**: `schema.prisma` leest `url = env("DATABASE_URL")`; de scripts deden `dotenv -e .env.local -- prisma …`. Met secret-manager is `DATABASE_URL` een pointer (`DB_URL_V3`) die pas op boot via `initSecretManager` de echte connection-string wordt → prisma standalone krijgt de pointer → faalt.

**Aanpak (ADR 0017)**: elke `prisma:*` loopt nu via een wrapper `scripts/prismaWithSecrets.ts` die exact het boot-prefix draait — `loadEnvFiles()` (.env + .env.local) → indien `config.secretManager?.url`: `initSecretManager({...cfg, source:'remote'})` → `spawnSync('prisma', argv)` met geresolvede env. GEEN volledige server-start (prisma heeft alleen de env nodig + opent zelf de DB-connectie). **Always-on** wrapper met het secret-blok **gecommentarieerd** (byte-identiek aan `server/server.ts`); `add/remove secret-manager` un-/re-comment het via dezelfde `SERVER_COMMENTED`/`SERVER_ACTIVE` find/replace → geen script-rewrite, geen nieuwe parity-surface.

**Verworpen**: (a) volledige server booten (bindt poorten/connecties voor niets), (b) inject-only-bij-opt-in (4e byte-identiek-te-houden plek = de #1 drift-klasse). Zie ADR 0017.

**Files**: packages/create-luckystack-app/template/scripts/prismaWithSecrets.ts (nieuw), packages/create-luckystack-app/template/package.json (3 scripts), packages/create-luckystack-app/src/index.ts (wireSecretManager +1 uncomment-target), packages/cli/src/commands/addSecretManager.ts (add+remove +1 tryEdit), packages/cli/src/assetParity.test.ts (+2 parity-tests), scripts/prismaWithSecrets.ts (nieuw, root — via resolveSecretsIfConfigured), package.json (2 scripts), docs/ARCHITECTURE_SECRET_MANAGER.md (nieuwe sectie), docs/decisions/0017-*.md (nieuw).

**Gate (groen)**: build:packages 16/16, lint:packages 0, cli-suite 133/133 (incl. 2 nieuwe parity-tests), root `prisma:generate` end-to-end via de wrapper ✔ (Prisma Client gegenereerd, beide env-files geladen, secret-resolution correct overgeslagen zonder URL).

**Flag (niet auto-gefixt, Rule 27)**: `dotenv-cli` (^11) is nu een orphaned devDep in template + root (geen script gebruikt nog `dotenv -e`) — user beslist drop/keep.

**Nog niet geverifieerd**: verse verdaccio-scaffold-smoke van de TEMPLATE-wrapper typecheck (base + na `add secret-manager`) — laag risico (2 triviale imports, al elders in de template gebruikt), maar de definitieve check vóór de volgende publish.

## 2026-07-02 15:55 — Security/correctness scan (report) + 3 obvious fixes

**User prompt**: scan de codebase op security-vulnerabilities + kapotte config/bugs/wizard-flows (alleen rapporteren, niks fixen) → daarna: "als er voorderhand liggende fixes zijn waar je zeker van bent, pas die toe; stel vragen bij twijfel".

**Scan**: 10 parallelle audit-agents (router, server, auth/login, api/sync, cli+scaffold, config, core, infra-packages, consumer-src, small-packages). Volledig gerangschikt rapport in `codebase-scan-02-07/SCAN_REPORT.md`, per-area detail in `codebase-scan-02-07/findings/*.md`. Alle eerder gevlagde criticals GEVERIFIEERD gefixt (wsProxy, server.js-disclosure, OAuth-linking, validateType, MT-3, npm.cmd, DOCSUI-01). Netto: 1 nieuwe CRITICAL (router proto-pollution crash) + 1 HIGH (session-token naar page JS) + 8 MEDIUM + ~30 LOW.

**Fixes toegepast (geverifieerd, getest — 182 pkg-tests groen)**:
- **C1 (CRITICAL) router proto-pollution DoS**: `packages/router/src/resolveTarget.ts` — `ownBinding()` hasOwnProperty-guard op beide binding-lookups (`__proto__`/`constructor`/`toString` → null → schone 502 i.p.v. bogus non-string target). `packages/router/src/httpProxy.ts` — last-resort `.catch` op `void handleRequest(...)` (pre-listener throw → 500 i.p.v. unhandled rejection/process-exit) + `getLogger` import + comment gecorrigeerd. Regressietest: `resolveTarget.test.ts` (5 inherited-key cases).
- **Auth LOW**: `packages/login/src/logout.ts:28` — volledig token in debug-log → `tokenPrefix` (conventie-parity).
- **M7**: `packages/error-tracking/src/adapters/posthog.ts` — `captureException` krijgt rebuilt scrubbed Error i.p.v. raw error (ET-O2-parity met Sentry-adapter).

**Bewust NIET gefixt (open vragen aan user)**: H1 session-token-contract (verweven met framework `session.ts:244` updateSession-broadcast die token bewust naar client stuurt), M6 email `@unique` (schema-migratie, niet-autonoom + multi-tenancy-semantiek), M1/M2 auth-posture-defaults (lockout default-off, OAuth-creation checkt `emailVerified` niet), M5 purpose-formatter multi-tenant mismatch (framework-semantiek te bevestigen). Rest van MEDIUM/LOW in het rapport.

**Files**: packages/router/src/{resolveTarget.ts,httpProxy.ts,resolveTarget.test.ts}, packages/login/src/logout.ts, packages/error-tracking/src/adapters/posthog.ts, codebase-scan-02-07/ (rapport + findings, nieuw).

## 2026-07-02 17:05 — H1/M6 as by-design (ADR 0018/0019) + token-broadcast gate

**User prompt**: unique-email flag moet weg (toggleable in config), token→session mag alleen in sessionStorage-mode (dev config-optie); beide worden vaker geflagd → documenteren waarom. + "wat is er nog over aan punten die gefixt moeten worden?".

**Bevinding (geverifieerd)**: (H1) framework strip't token al bij persist (session.ts:157, LOGIN-M9) maar de `updateSession`-broadcast op :244 stuurde `persisted` mét token ONVOORWAARDELIJK — ook in cookie-mode. Client gebruikt payload-token nergens (socket leest sessionStorage; SessionProvider schrijft token nooit naar sessionStorage). (M6) `confirmEmailChange` doet al een app-level cross-provider collision-check; `email @unique` is opt-in via `auth.providerAccountStrategy` ('per-provider' default = geen @unique, 'unified' = consumer voegt toe).

**Fix toegepast**: `packages/login/src/session.ts:244` — broadcast nu `basedToken ? persisted : persistedWithoutToken` (cookie-mode lekt token niet meer naar page JS; veilig, geen client-gedragswijziging). Login-tests 103/103 groen, tsc+lint clean.

**Docs (zodat scans niet herflaggen)**: ADR 0018 (token-exposure contract) + ADR 0019 (email-uniqueness opt-in), beide accepted; `//? @adr`-tags op session.ts/session_v1.ts/SessionProvider.tsx (0018) en accountStrategy.ts/confirmEmailChange_v1.ts (0019) → `decision_for_file` reverse-map compleet; `ARCHITECTURE_SESSION.md` token-exposure-sectie; `npm run ai:decisions` geregenereerd (19).

**Bewust NIET gefixt (gemeld, Rule 3b)**: session_v1 initial-load geeft token nog steeds terug in cookie-mode — volledig sluiten vergt client session-type wijziging (token niet langer required) = type-generation change, follow-up in ADR 0018. Nog open to-fix: M2/M3 (auth OAuth-creation emailVerified + lockout TOCTOU/default), M4 (unauth OAuth-init Redis DoS), M5 (purpose-formatter multi-tenant), M8 (test-runner silent drop).

**Files**: packages/login/src/session.ts, src/_api/session_v1.ts, src/_providers/SessionProvider.tsx, packages/login/src/accountStrategy.ts, src/settings/_api/confirmEmailChange_v1.ts, docs/decisions/0018-*.md (nieuw), docs/decisions/0019-*.md (nieuw), docs/ARCHITECTURE_SESSION.md, docs/AI_DECISIONS_INDEX.md, codebase-scan-02-07/SCAN_REPORT.md.

## 2026-07-02 17:45 — Fix all remaining scan findings (M1-M5, M8) + H1 client session-type

**User prompt**: "fix alle punten maar bij H1-restant willen we een client-side copy van het user-type zodat de server-sided typing niet beïnvloed wordt."

**Alles geverifieerd: 1451 tests groen, tsc/lint/build:packages (16/16)/vite build allemaal clean.**

- **M4 (server) — unauth OAuth-init Redis write-amp DoS**: per-IP `checkRateLimit` (`ip:<ip>:auth:oauth-init` bucket) toegevoegd vóór `createOAuthState` in `authApiRoute.ts` (spiegelt de credentials-branch; no-op tenzij een limit geconfigureerd is).
- **M8 (test-runner) — silent route drop**: `runAuthEnforcementTests` gebruikt nu `hasMetaEntry`; een route in `apiMethodMap` maar niet in `apiMetaMap` levert een `skipped`-result ("auth unverifiable") i.p.v. stil door te gaan.
- **M2 (login) — OAuth account-CREATIE checkt emailVerified niet**: fail-closed guard toegevoegd in `findOrCreateOAuthUser` (symmetrisch met de link-guard) — creatie geweigerd bij `!emailVerified`. Nieuwe provider-flag `emailImpliesVerified` (generiek, SOLID) + op `facebookProvider` gezet zodat Facebook (dat geen verified-flag heeft maar alleen bevestigde emails teruggeeft; L3) niet breekt; `fetchOAuthProfile` honoreert de flag.
- **M1/M3 (login) — lockout default-off + TOCTOU**: M1 = one-shot boot-warning in de `loginFailed`-handler wanneer een credentials-login faalt terwijl `rateLimiting.auth.enabled:false` (default NIET geflipt — cross-IP lockout introduceert een victim-lock DoS-tradeoff die de operator bewust moet kiezen). M3 = de twee wrong-password-paden `await`en nu `dispatchHook('loginFailed')` zodat de increment vóór de response landt (sluit de sequentiële check-then-increment TOCTOU; residual concurrent window gedocumenteerd).
- **M5 (server/sync/core) — purpose-formatter join≠broadcast mismatch (multi-tenant)**: alle content-room-operaties (join/leave/evict/rejoin in `loadSocket.ts`) gebruiken nu de canonieke `'broadcast'` purpose i.p.v. `'join'`/`'leave'`, zodat ze byte-identiek matchen met de sync membership-check + fanout. `roomNameFormatterRegistry` type-doc codificeert de regel (alleen `'presence'` is een aparte room-familie).
- **H1-restant (config/core/consumer) — token nooit meer naar page JS**: nieuw client-type `ClientSessionLayout = Omit<SessionLayout,'token'|'csrfToken'>` in `config.ts`. `session_v1` strip't token+csrfToken en retourneert `ClientSessionLayout` (generated result-type draagt geen token meer); `updateSession`-broadcast stuurt nu ALTIJD `persistedWithoutToken` (mode-gate verwijderd). `BaseSessionLayout.token` + `HookSessionShape.token` OPTIONEEL gemaakt zodat de client-generics een token-loos type accepteren — de consumer `SessionLayout` herdeclareert `token: string` (required), dus **server-side typing onaangetast**. `SessionProvider` + socket-chain (`socketInitializer`/`_socketSetup`) op `ClientSessionLayout`. `generateArtifacts` gedraaid. `session_v1.tests.ts` regressie: assert token+csrfToken == undefined (was: assert token aanwezig).

**Docs**: ADR 0018 herschreven naar de definitieve (type-enforced) beslissing; `ai:decisions` + `ai:capabilities` geregenereerd.

**Files**: packages/server/src/httpRoutes/authApiRoute.ts, packages/server/src/loadSocket.ts, packages/test-runner/src/runAuthEnforcementTests.ts, packages/login/src/{login.ts,oauthProviders.ts,authLockout.ts,session.ts}, packages/core/src/{sessionTypes.ts,hooks/types.ts,roomNameFormatterRegistry.ts}, config.ts, src/_api/session_v1.ts(+.tests.ts), src/_providers/SessionProvider.tsx, src/_sockets/{socketInitializer.ts,_socketSetup.ts}, src/_sockets/apiTypes.generated.ts (+ server/prod/generatedApis.*), docs/decisions/0018-*.md, docs/AI_DECISIONS_INDEX.md, docs/AI_CAPABILITIES.md.

## 2026-07-02 21:15 — Fix all live-test errors (validateType prod bug + sync self-token + harness + stale tests)

**User prompt**: "fix alle errors" — de 34 pre-existing custom-test-fouten die de browser/live-test-ronde blootlegde.

**Resultaat: custom-laag 30/64 → 64/64; volledige test-runner-suite 112 passed / 0 failed / 23 skipped; 1451 unit-tests + tsc + lint clean.**

Root-causes + fixes:
- **CRIT framework bug — `validateType` union-recursie** (`packages/core/src/runtimeTypeValidation.ts`): elk object-type-text met een `|` IN een property (bv. `theme?: 'dark'|'light'`) triggerde de union-branch; `splitTopLevel` vond geen top-level `|` → 1 part == de hele type → recursie op de IDENTIEKE string, `depth+1` per pass tot MAX_VALIDATION_DEPTH(64) → bogus "input nesting exceeds max depth" op een depth-1 waarde. Met `validation.runtimeMode:'enforce'` (default) faalde dit ook in PRODUCTIE: elke route met een union in z'n input-type was on-callable. Fix: single-member-union recurset alleen als `singleMember !== type`, anders fall-through. Regressietest toegevoegd. (~15 tests) → docs/lessons/0002.
- **Framework gap — HTTP sync self-token membership** (`packages/sync/src/handleHttpSyncRequest.ts`): met `requireRoomMembership:true` (default) mocht een HTTP-caller z'n EIGEN token-room niet targeten (socket-transport auto-joint `socket.join(token)`, HTTP checkt alleen `roomCodes`). Fix: `isMember` staat `receiver === user.token` toe (veilig — je eigen room; symmetrisch met socket-pad). (~5 tests + downstream)
- **Test-runner harness — watchStream cookie-auth** (`packages/test-runner/src/streamWatcher.ts`): de observer-socket gaf de token als `handshake.auth.token` (token-mode), maar cookie-mode (default) leest 'm uit de cookie → anonieme socket → `joinRoom` auth.required. Fix: ook `extraHeaders: { Cookie }` meesturen. (~6 tests)
- **Stale test-expectations (consumer)**: settings error-codes `auth.*` → `settings.emailChange.*` (confirm/requestEmailChange); requestEmailChange "success"-test stuurt nu `currentPassword` (route vereist re-auth); playground sync-tests lezen serverOutput nu onder `.result` (S22 canonical envelope i.p.v. oude flattened shape). (~8 tests)

**Diagnose-gotcha**: eerste live-runs gaven non-deterministische pass-counts (30 vs 7 vs 45) door LEFTOVER server-processen op :80 van stash-cycles → de test hitte een stale server. Altijd één schone server. Layer-5 `*.tests.ts` draaien tegen een LIVE server, niet in `vitest run`.

**Files**: packages/core/src/{runtimeTypeValidation.ts,runtimeTypeValidation.test.ts}, packages/sync/src/handleHttpSyncRequest.ts, packages/test-runner/src/streamWatcher.ts, src/settings/_api/{confirmEmailChange,requestEmailChange}_v1.tests.ts, src/playground/_sync/{streamBroadcast,streamProgress,streamToToken}_server_v1.tests.ts, docs/lessons/0002-*.md, docs/AI_LESSONS_INDEX.md.

## 2026-07-02 22:55 — Report-only LOW hardening round (7 fixes) + release v0.4.1

**User prompt**: "ja ga er maar eens overheen" — nog een ronde over de resterende open punten (M1 + report-only LOW-findings).

**7 security-relevante LOW-fixes** (1452 unit + 112 test-runner groen, tsc/lint/ai:lint clean, full build ✓):
- server L1 — exempt-paths reflecteren geen ongevalideerde Origin meer in ACAO+credentials (httpHandler.ts: lege origin voor exempt routes).
- server L5 — origin-exempt matching nu segment-boundary-aware (`/webhooks` exempt niet meer `/webhooksadmin` van origin+CSRF).
- server L4 — auth rate-limit window uit dezelfde "general-limit-active" predikaat als de count (fix `defaultApiLimit:0` window/count-mismatch, beide blokken).
- auth L2 — verifyBootstrap waarschuwt als `sessionCookieSameSite !== 'Strict'` in cookie-mode (CSRF-exempt auth-endpoints leunen op Strict tegen login-CSRF).
- auth L5 — session/OAuth-state cookie `Secure` default nu AAN in productie (resolveCookieSecure); plain-HTTP prod moet expliciet opt-out.
- auth L6 — clearAuthFailures in tryCatch (fire-and-forget `void` kan geen unhandled rejection meer lekken).
- infra L2 — autoSelectEmailSender waarschuwt luid bij ConsoleSender-fallback in productie (zou reset-URLs/tokens loggen i.p.v. mailen).

**M1**: bewust OPT-IN gehouden (warning staat; flippen = victim-lock DoS + breaking). Rest van LOW = accepted tradeoffs/cosmetisch, report-only.

**Tests-fixes**: authLockout.test.ts (tryCatch-mock) + authLogoutRoute.test.ts (resolveEnvKey-mock) bijgewerkt voor de nieuwe core-imports.

**Files**: packages/server/src/{httpHandler.ts,originExemptRegistry.ts,verifyBootstrap.ts,httpRoutes/{authApiRoute.ts,sessionCookie.ts,authLogoutRoute.test.ts}}, packages/login/src/{authLockout.ts,authLockout.test.ts}, packages/email/src/autoSelect.ts, codebase-scan-02-07/SCAN_REPORT.md.

## 2026-07-11 17:00 — v0.5.1 gereleased naar npm (merge feat/orm-aware-cli)

**User prompt:** "push en publiceer alles"

**Wat ik deed:**
- `feat/orm-aware-cli` (3 commits: 278a75a ORM-detectie overal, d80c051 bidirectionele ORM-switch als manage-stap 0, 3ab97e0 auth kiesbaar op drizzle/mikro-orm [ADR 0023]) via `--no-ff` gemerged naar main (b7ee295).
- CHANGELOG-entries 0.5.1 voor @luckystack/cli en create-luckystack-app; lockstep-bump alle 17 packages naar 0.5.1 (`setPackageVersions.mjs`) + lockfile-refresh; release-commit 61ec674.
- `scripts/publishPackages.mjs` kreeg een `--no-provenance` vlag (tweede lokale release die het nodig had; CI-releases blijven met provenance publiceren).
- Gates op gemergde main: root build + volledige unit-suite groen vóór publish.
- Publish naar npmjs met `--no-provenance` (lokaal, geen OIDC) → alle 17 packages @0.5.1; tag v0.5.1; main + tags gepusht naar origin.

**Notes:** volgende release bij voorkeur via CI voor provenance-attestatie. Geparkeerde vervolgrondes ongewijzigd: settings-routes porten naar UserAdapter (login-interface-beslissing), email-code login + 2FA.

## 2026-07-12 18:30 — v0.6.0 gereleased naar npm (email-code login + 2FA)

**User prompt:** "Jij mag dalijk naar 0.6.0 publishen maar eerst [security-scan + upgrade-analyse]" → na scan+fixes: "Nu volledige release naar 0.6.0".

**Wat ik deed:**
- `feat/email-code-2fa` (7 commits: backend, LoginForm-statemachine, settings-2FA-UI, docs/ADR 0024, replay-guard-fix, security-hardening) via `--no-ff` gemerged naar main.
- CHANGELOGs [Unreleased]→0.6.0 (login incl. Security-sectie, server, core, create-luckystack-app, cli); lockstep-bump alle 17 packages naar 0.6.0 + lockfile; release-commit 970d051.
- Gates op gemergde main: build + volledige unit-suite groen vóór publish.
- Publish naar npmjs `--no-provenance` (lokaal) → alle 17 packages @0.6.0; tag v0.6.0; main + tags + branch gepusht.

**Feature:** passwordless email-code login + 2FA (TOTP via de open standaard van Google/Microsoft Authenticator, email-fallback default-on per user-besluit, recovery codes). Beide features default UIT, config auto-seed → bestaande projecten upgraden zonder gedragswijziging. Security-hardened via 5-lens adversariële scan (atomaire single-use, account-lockout, re-enroll step-up, 80-bit recovery, enumeratie-oracle dicht) + bewezen tegen echte Redis.

**Notes:** volgende release bij voorkeur via CI voor provenance. Bewuste rest: 2FA-UI heeft geen auto-aflever-pad voor niet-re-gescaffolde projecten (upgrade-runbook in ARCHITECTURE_AUTH.md); dev-settings-page verder gedrift van template (los van 2FA); QR-render = consumer-keuze.

## 2026-07-12 21:10 — mikro-orm scaffold: db:schema:update werkt nu op Node 22/Windows (feedback consumer-AI)

**User prompt:** consumer-AI meldt: mikro-orm CLI crasht nog (upstream figlet op Node 22/Windows) + `db:schema:update` verwees naar een eigen script dat ook secret-manager pointers resolvet (wat de CLI nooit doet). Suggestie: dat script in de template opnemen.

**Bevestigd:** scaffolder wiret `db:schema:update` → `mikro-orm schema:update --run` (de `@mikro-orm/cli`). NIET gefixt in 0.6.0. Suggestie overgenomen.

**Wat ik deed:**
- Nieuw `scripts/mikroOrmSchema.ts` (scaffolder-stub MIKRO_SCHEMA_SCRIPT): draait `orm.getSchemaGenerator().updateSchema()` via de MikroORM-API (= equivalent van `schema:update --run`), met `loadEnvFiles()` + guarded secret-manager-resolutie eerst (spiegelt prismaWithSecrets.ts). Geen `@mikro-orm/cli`, geen figlet.
- `db:schema:update` → `tsx ... scripts/mikroOrmSchema.ts`; `@mikro-orm/cli` devDep + `mikro-orm` config-key gedropt.
- **RUNTIME-TEST ving een 2e latente bug**: MikroORM weigert init bij core/driver-versie-mismatch, en `^6.6.0`-carets lieten core (6.6.15) en better-sqlite (6.6.14, loopt achter) uiteenlopen → crash bij `MikroORM.init`. Fix: `MIKRO_ORM_VERSION = '6.6.14'` exact-pin voor core + driver (hoogste 6.x waar alle 4 drivers + core bestaan; geverifieerd via npm).
- CLI switchOrm ORM_SURFACES mikro-orm bijgewerkt (geen cli/config-key, wél scripts/mikroOrmSchema.ts als starter) — parity.
- Lesson 0004 vastgelegd (CLI-figlet-crash + runtime-test-voor-ship). CHANGELOGs [Unreleased] voor scaffolder + cli.

**Verificatie (echt, Node 22/Windows):** verse mikro-orm/sqlite scaffold + npm install (exact 6.6.14) + `npm run db:schema:update` → "✓ database schema updated from server/db/entities.ts"; tsc volledig schoon na generateArtifacts. Framework-gates (build/pkg-lint/cli+scaffolder-tests/ai:lint) groen.

**Files touched:** packages/create-luckystack-app/src/index.ts (+CHANGELOG), packages/cli/src/commands/switchOrm.ts (+CHANGELOG), docs/lessons/0004-*.md + AI_LESSONS_INDEX.md.

**Open:** dit zit nog NIET op npm (0.6.0 heeft de kapotte mikro-wiring). Kandidaat voor 0.6.1 patch-release — wacht op user-akkoord.

## 2026-07-13 11:20 — 7 upstream framework-fixes uit MikroORM-consumer-handoff (DEVKIT-1..5, CORE-1/2)

**User prompt:** consumer-AI (matchrix, MikroORM/MongoDB) had node_modules/@luckystack/devkit+core gepatcht om codegen werkend te krijgen; volledig handoff-document met 5 devkit-patches + 2 core-design-gaps aangeleverd. "fix dit" → upstream oplossen zodat de patches vervallen.

**Wat ik deed (elk met regressietest; DEVKIT-1..5 e2e-geverifieerd tegen echte MikroORM/sqlite-consumer op Node 22/Windows — generateArtifacts + tsc beide schoon):**
- DEVKIT-1: symbol-keyed entity-leden (`[OptionalProps]`/`[loadedType]`/`[selectedType]` → `__@name@id`) uit de inline-type: prop-skip in expandTypeDetailed (tsProgram.ts) + brace-aware content-vangnet in emitterArtifacts.ts voor de typeToString-cycle/depth-fallbacks. Unit: 7 cases.
- DEVKIT-2: SessionLayout van de existingImports-whitelist (typeContext.ts) → normale import-collectie, zoals AuthProps.
- DEVKIT-3: per-route error-arm expliciet `message?/errorParams?/httpStatus?` naast de index-signature (emitterArtifacts.ts, 3 plekken) → narrowing werkt.
- DEVKIT-4: stream-payload-fallback naar `ApiParams.stream: ApiStreamEmitter<T>` als main geen letterlijke stream() heeft (extractors.ts) → geen `never`.
- DEVKIT-5: private submappen onder marker (`_api/_lib/*`) overslaan in walkRouteFiles (routeNamingValidation.ts). **Runtime-test ving een bug in mijn eigen fix**: `apiMarkerSegment()` = de slash-omvatte `/_api/`, niet de kale segment-naam → gefixt naar `getRoutingRules().apiMarker`. Unit: 8 cases (incl. custom marker).
- CORE-2: `tryCatchSync<T, P = void>` default (was TS2558).
- CORE-1: `resetDefaultRedisClient()` (cache-invalidatie ná secret-init) + actionable WRONGPASS-diagnose bij pointer-achtig wachtwoord (redis.ts, geëxporteerd via index.ts).

**Verificatie:** 18 nieuwe tests; devkit+core-suite 358 groen; volledige unit-suite, build, lint:packages, ai:lint groen. E2e in C:\code\ls-e2e\mikro-sqlite2 met 5 repro-routes (entity-return, SessionLayout-output, helper-stream, _api/_lib-helper): generateArtifacts 0 + tsc 0, gegenereerde output geverifieerd (geen `__@`, echte entity-velden, expliciete error-leden, stream = HelperEvent i.p.v. never).

**Files touched:** packages/core/src/{tryCatchSync.ts,tryCatchSync.test.ts,redis.ts,index.ts,CHANGELOG.md}, packages/devkit/src/{typeMap/tsProgram.ts,typeMap/emitterArtifacts.ts,typeMap/typeContext.ts,typeMap/extractors.ts,typeMap/stripSymbolKeyedMembers.test.ts,routeNamingValidation.ts,privateRouteSubfolder.test.ts,CHANGELOG.md}.

**Open:** kandidaat voor 0.6.1 (samen met de mikro-schema-fix van eerder). CORE-1 volledige runtime-repro (secret-manager + dev-supervisor) niet gedraaid — code-reviewed + mechanisme + diagnose. Consumer kan z'n 5 dist-patches + de registerRoutingRules-ignore-workaround droppen zodra 0.6.1 gepubliceerd is.

## 2026-07-13 11:40 — luckystack update --app: framework-authored src/-files bij upgrade (ADR 0025)

**User prompt:** vervolg op het eerdere gesprek over "nieuwe files die direct in de codebase moeten" — bevestigde de richting: nieuw bestand → erbij, door developer aangepast bestand met nieuwe waardes → `.new`-sidecar + AI-handoff om te mergen.

**Wat ik deed:** `luckystack update` uitgebreid met een opt-in `--app` scope die ook framework-geschreven files onder de app-tree ververst (src/ UI+routes, functions/, server/, luckystack/, config.ts, tsconfig). Hergebruikt exact het bestaande ADR 0021-mechanisme (verse render = waarheid; add/overwrite-if-pristine/sidecar-if-modified). Twee veiligheids-invarianten: (1) alleen files in de verse render worden overwogen → eigen app-code nooit aangeraakt; (2) een door jou aangepaste file wordt NOOIT overschreven → `<file>.new`-sidecar + AI-merge-note. Deny-list (ook in app-scope onaangeraakt): prisma/, .env/.env.local, package.json, manifest, node_modules, .git. `isUpdatablePath(rel, scope)` is het predikaat; `--app`→'app', default 'framework'. Rapport kreeg "new files delivered" + "refreshed" secties. Framework-scope print nu een hint naar --app als er niks te doen is.

**Verificatie:** 5 nieuwe unit-tests (isUpdatablePath framework-vs-app + deny-list; het 2FA-scenario: nieuwe file geleverd + aangepaste gesidecar'd + eigen code & schema onaangeraakt; framework-scope laat src/ met rust). ÉCHTE e2e (built cli + echte npx-render) in C:\code\ls-e2e\upd-app: verse 0.6.0-scaffold → `update --app` op dezelfde versie = 241 unchanged/0 spurious sidecars (2 refreshed door lokaal-vóór-gepubliceerd, geen non-determinisme); daarna LoginForm.tsx handmatig aangepast → `update --app` → sidecar geschreven, mijn edit BEHOUDEN, geen spurious sidecars op eigen files. Gates (build/lint/cli-tests 259/ai:lint) groen.

**ADR 0025** (amends 0021): default blijft framework-scope; --app expliciet; alternatieven (default-aan / los `upgrade`-command / prisma meenemen) afgewezen. 2FA-upgrade-runbook (ARCHITECTURE_AUTH.md stap 5) vervangt "hand-port de UI" door `npx luckystack update --app`. cli CLAUDE.md + CHANGELOG bijgewerkt.

**Files touched:** packages/cli/src/commands/{update.ts,update.test.ts}, packages/cli/src/index.ts, packages/cli/CLAUDE.md, packages/cli/CHANGELOG.md, docs/decisions/0025-*.md, docs/AI_DECISIONS_INDEX.md, docs/ARCHITECTURE_AUTH.md.

**Open:** meelift met 0.6.1 (mikro-fix + devkit/core-fixes + dit). Bewuste rest: config.ts wordt in app-scope wél meegenomen (sidecar-if-modified is veilig) maar prisma-schema bewust niet — schema-changes blijven via CHANGELOG/runbook.

## 2026-07-13 12:15 — v0.6.1 gepubliceerd naar npm (17 packages)

**User prompt:** "kan een v0.5.0-project alle files/changes krijgen incl. src/? kan de AI zelf upgraden + proactief 2fa aanbieden via de docs? zo ja, publiceer alles."

**Wat ik deed:** (1) Bevestigd dat v0.5.0 → nieuwste via `luckystack update --app` de framework-src/-files krijgt (manifest bestond al in 0.5.0); enige bewuste uitzondering = prisma-kolommen (deny-listed, handmatig, faalt luid). (2) `docs/UPGRADING.md` geschreven — AI-actionable upgrade-runbook: lees de CHANGELOG-gap → SURFACE + OFFER nieuwe features (m.n. security als 2FA) → npm install → `update --app` → merge sidecars → schema-afrondstap. Conventie in de meegeleverde `CLAUDE.md` (nieuwe sectie "Upgrading LuckyStack" + doc-tabel-rij) zodat de consumer-AN proactief "vX voegt 2FA toe, aanzetten?" vraagt i.p.v. stil te bumpen. (3) Release 0.6.0 → 0.6.1 (lockstep bump alle 17 pkgs), bundelt: mikro-orm scaffold-fix + 7 devkit/core consumer-fixes (DEVKIT-1..5, CORE-1/2) + update --app.

**Verificatie:** gates groen (build/test:unit/ai:lint 0), dry-run valideerde 17 tarballs, registry bevestigt core/cli/devkit/login/create-luckystack-app allen 0.6.1. De 2FA-UI (`TwoFactorSection.tsx`) zit in de scaffold-tarball.

**Footgun (→ lesson 0005):** `npm run publish:packages -- --no-provenance` slikte de flag op (npm@11 consumeerde `--no-provenance` als eigen config); child draaide `publish --provenance` → EUSAGE "provider: null". Fix = script direct via node + `NPM_CONFIG_PROVENANCE=false`: `node scripts/publishPackages.mjs --no-provenance`. Her-run publiceerde schoon (niks was geüpload toen core als eerste faalde).

**Files touched:** docs/UPGRADING.md (nieuw), CLAUDE.md, packages/cli/{CLAUDE.md,CHANGELOG.md}, docs/ARCHITECTURE_AUTH.md, docs/decisions/0025-*.md, docs/lessons/0005-*.md, alle packages/*/package.json (bump), diverse ai:*-indexes.

**Open:** git-push naar origin ontbreekt (SSH-auth in deze omgeving) — user pusht `git push origin main && git push origin v0.6.1` zelf. Bewuste rest ongewijzigd: 6 prisma-settings-routes → UserAdapter porten; volgende release idealiter via CI voor echte provenance.

## 2026-07-13 13:30 — @luckystack/cron als wizard-opt-in (create-luckystack-app)

**User prompt:** "ook in de wizard wil ik de cron package hebben" (cron zat alleen in de CLI add/manage, niet in de scaffold-wizard).

**Wat ik deed:** cron toegevoegd als opt-in in `create-luckystack-app` (`--cron`-flag + prompt-stap, default off), gespiegeld op de andere opt-ins maar als **dependency-only** injectie via `injectOptionalDeps` — byte-identiek aan `luckystack add cron` (backend-only, self-wired at boot via `@luckystack/cron/register`; GEEN template-bestand, geen server.ts-edit; jobs in `luckystack/cron/*.ts`). Raakpunten: CliArgs, VALID_FLAGS, parseArgs, ScaffoldChoices, DEFAULT_CHOICES, runPrompts-stap, runPromptsFallback, convertAnswersToChoices, buildPresetAnswers, buildNoPromptChoices, printHelp, injectOptionalDeps, printNextSteps. Round-trip geborgd: `choicesToFlags` (`luckystack update` → `--cron`) + `manifestSync` (`cron: state.packages.cron`) zodat wizard-cron en manage-cron niet driften. Manage-kant (registry/state/transitions/reconfigure) had cron al volledig — niks nodig.

**Aanpak:** 3 parallelle read-only Explore-agents mapten eerst álle raakpunten (wizard-wiring, add-cron-parity, parity-tests/manifest/docs) vóór de edits — parity-drift tussen add-assets en template is hier de #1 bug-klasse.

**Verificatie:** build 0, lint:packages 0, test:unit 1645 groen, ai:lint 0. Tests uitgebreid: 3 CliArgs-toEqual-blokken + expliciete `--cron`-parse-test + `choicesToFlags` cron round-trip. ÉCHTE e2e (gebouwde scaffolder, `--no-prompt --no-install`): mét `--cron` → `@luckystack/cron ^0.6.1` in package.json; zónder → geen dep (controle); geen cron-broncode gelekt (dependency-only bevestigd).

**Files touched:** packages/create-luckystack-app/src/{index.ts,index.test.ts}, packages/create-luckystack-app/{CLAUDE.md,CHANGELOG.md}, packages/create-luckystack-app/docs/cli-flags.md, packages/cli/src/commands/{update.ts,update.test.ts}, packages/cli/src/lib/manifestSync.ts.

**Open:** meelift met volgende release (0.6.2-kandidaat). Bewuste keuze: cron blijft inject-when-on (niet in base-template + pruned) — consistent met docs-ui/secret-manager.

## 2026-07-13 14:00 — v0.6.2 gepubliceerd naar npm (17 packages)

**User prompt:** "ja breng uit" (na cron-wizard + upgrade-doc-aanvulling).

**Wat ik deed:** lockstep bump 0.6.1 → 0.6.2, alle 17 packages gepubliceerd (node-direct + NPM_CONFIG_PROVENANCE=false per lesson 0005), main + tag v0.6.2 gepusht. Bundelt: `@luckystack/cron` als wizard-opt-in (`--cron`, dependency-only, byte-parity met `add cron`) + upgrade-runbook (UPGRADING.md + CLAUDE.md-conventie) die nu nieuw-optioneel-package-adoptie via `npx luckystack add <feature>` dekt (los van feature-toggle op bestaand package).

**Verificatie:** dry-run valideerde 17 tarballs; registry bevestigt core/cli/cron/create-luckystack-app allen 0.6.2. Gates waren groen vóór bump (build/lint/1645 unit/ai:lint 0; sindsdien alleen docs).

**Deliverable:** paste-klare upgrade-handoff (UPGRADE_HANDOFF_v0.6.2.md) aan user gegeven — self-contained zodat een project-AI de eerste AI-gedreven upgrade kan bootstrappen; daarna zelfsturend via de shipped docs.

**Open:** geen. Volgende release idealiter via CI voor echte provenance.

## 2026-07-13 17:15 — matchrix-handoff: framework-fixes FIX-1 (Redis secret-pointer boot) + FIX-2 (ai:lint) [ADR 0026]

**User prompt:** handoff van consumer matchrix met framework-level bugs gevonden bij de 0.6.2-upgrade: FIX-1 (KRITIEK, Redis-auth via secret-manager-pointer faalt bij boot, óók met resetDefaultRedisClient), FIX-2 (ai:lint i18n-jsx FP op TS-generics), + observaties (ES2023 lib, degraded types).

**Onderzoek (3 parallelle read-only agents, root-cause geverifieerd vóór changes):** handoff-aanname deels gecorrigeerd — initSecretManager schrijft resolved waarden WEL in-place naar process.env (alleen voor envNames-allowlist; deny-all default). Core's redis.ts leest kale process.env bij client-CONSTRUCTIE en memoïseert (cachedDefault). In de canonieke scaffold draait init vóór de eerste Redis-touch (writeBootUuid). matchrix' werkende workaround (registerRedisClient ná init) bewijst dat process.env resolved is → oorzaak = puur timing/caching (client gebouwd/gecachet mét pointer vóór/rond init; consumer-reset in de IIFE zit te vroeg, bootstrap-overlays/function-scan herbouwen erna).

**Fix (ADR 0026, user koos "defensieve reset in framework-boot + gedecoupleerde hook"):** (A) core `secretsResolved.ts` — `notifySecretsResolved`/`registerSecretsResolvedListener`; redis.ts self-registreert reset-listener (reset bij REDIS_-key-change of undefined). (B) server createServer.ts — defensieve `resetDefaultRedisClient()` vóór writeBootUuid als `secretManager.url` gezet → automatische boot-fix voor élke consumer via npm-upgrade (geen consumer-actie). Vereiste minimaal `secretManager?: SecretManagerConfigRef` op core's ProjectConfig. Rotatie via `onApplied: notifySecretsResolved` (gedocumenteerd, niet auto-bekabeld — descoped om fragiele wireSecretManager-parity niet te raken). CORE-1-foutmelding bijgewerkt. FIX-2: type-positie-guard in scripts/lintInvariants.mjs (+ template-spiegel). Observatie: scaffold-tsconfig ES2022→ES2023.

**Afgewezen:** handoff-voorkeur "init verplaatsen naar bootstrap" (grotere blast-radius; onnodig want canonieke volgorde draait init al vóór de eerste touch).

**Verificatie:** build 17/17, lint:packages 0, test:unit 1652 (2 nieuwe files: secretsResolved 4 + redisSecretsReset 3 met gemockte ioredis, referentie-identiteit), ai:lint 0. FIX-2-guard node-getest: beide FP's onderdrukt, echte prose ("Welcome back"/"Status: Active"/"Save as draft"/"Sign in (SSO)") nog geflagd.

**Files:** packages/core/src/{secretsResolved.ts,secretsResolved.test.ts,redisSecretsReset.test.ts,redis.ts,projectConfig.ts,index.ts}, packages/server/src/createServer.ts, scripts/lintInvariants.mjs, packages/create-luckystack-app/template/scripts/lintInvariants.mjs, packages/create-luckystack-app/template/tsconfig{,.server}.json, docs/decisions/0026-*.md, docs/ARCHITECTURE_SECRET_MANAGER.md, 3× CHANGELOG.

**Open:** meelift met 0.6.3. Deferred: degraded-type-extraction (55 routes MikroORM/Mongo — aparte devkit-investigatie). matchrix kan ná 0.6.3 hun registerRedisClient-workaround verwijderen.

## 2026-07-13 17:45 — v0.6.3 gepubliceerd naar npm (17 packages)

**User prompt:** "ja mag nu alles publishen".

**Wat ik deed:** lockstep bump 0.6.2 → 0.6.3, alle 17 gepubliceerd (node-direct + NPM_CONFIG_PROVENANCE=false per lesson 0005), main + tag v0.6.3 gepusht. Bundelt: FIX-1 Redis secret-manager-pointer boot [ADR 0026, gedecoupleerde secretsResolved-hook + server-boot reset], FIX-2 ai:lint i18n-jsx FP op TS-generics, scaffold-tsconfig ES2023, en logger-timestamps (logging.timestamps, default aan, ISO-8601).

**Verificatie:** dry-run 17 tarballs; registry bevestigt core/server/cli/create-luckystack-app allen 0.6.3. Gates vóór release groen (build 17/17, lint 0, 1656 unit, ai:lint 0).

**Open:** matchrix kan nu upgraden naar 0.6.3 en de Redis registerRedisClient-workaround verwijderen. Deferred: degraded-type-extraction (55 routes MikroORM/Mongo).

## 2026-07-13 23:25 — FIX-1 herzien: eager rebuild+register i.p.v. reset (0.6.3 werkte niet) [ADR 0026, lesson 0006]

**User prompt:** consumer matchrix bewees dat 0.6.3 het Redis secret-pointer-boot NIET fixt — alle drie de zonder-wiring-routes falen met WRONGPASS, alleen registerRedisClient werkt. Gaf de één-regel-fix: framework-boot moet de client VERVANGEN (registreren), niet resetten.

**Root-cause (bevestigd):** ioredis leest password één keer bij constructie. `resetDefaultRedisClient()` (alleen cachedDefault=null) is onvoldoende: (1) stelt de herbouw uit → stale pointer duikt weer op tegen writeBootUuid-tijd (~15s ná type-map-gen); (2) raakt de redisClients-registry niet → kan een vóór-resolve geregistreerde client niet overriden. registerRedisClient werkt want het bouwt EAGER (captured resolved password) + wint van de resolver.

**Fix (user's één-regel, geïmplementeerd):** nieuwe core `rebuildDefaultRedisClient()` (disconnect vorige → constructRedisClient uit huidige env → registerRedisClient in default-slot). Gebruikt op beide plekken: server-boot (createServer, gated op secretManager.url) + de notifySecretsResolved-listener in redis.ts. `constructRedisClient` geëxtraheerd uit buildDefaultRedisClient (retryStrategy + handlers hergebruikt). resetDefaultRedisClient blijft bestaan maar gedocumenteerd als onvoldoende. CORE-1-foutmelding + ADR 0026 + ARCHITECTURE_SECRET_MANAGER + CHANGELOGs bijgewerkt. Lesson 0006 vastgelegd (cache-null ≠ juiste waarde capturen).

**Verificatie:** build 17/17, lint 0, test:unit 1657 (redisSecretsReset herschreven: rebuild registreert + wint van resolver, gemockte ioredis), ai:lint 0. Echte real-Redis-repro heeft matchrix al bewezen (registerRedisClient werkt).

**Files:** packages/core/src/{redis.ts,index.ts}, packages/server/src/createServer.ts, docs/decisions/0026-*.md, docs/lessons/0006-*.md, docs/ARCHITECTURE_SECRET_MANAGER.md, core+server CHANGELOG, packages/core/src/redisSecretsReset.test.ts.

**Open:** publiceren als 0.6.4 (user: "publish 0.6.4 als het gefixt is").

## 2026-07-14 08:30 — FIX-1 échte root-cause: de rebuild werd NOOIT getriggerd (gate falsy) — secret-manager firet nu zelf [ADR 0026, lesson 0007]

**User prompt:** matchrix bewees dat 0.6.4 het NIET fixt, met poll-bewijs: process.env.REDIS_PASSWORD klapt ~12s terug van resolved (len13) naar pointer (len17). Twee problemen: (1) prod-blocking: auto server-boot-rebuild levert geen werkende client (handmatige rebuild ná init wél); (2) dev: env-revert.

**Onderzoek (2 agents + eigen reads):** (1) BEVESTIGD: de scaffold registreert `secretManager` NIET in `registerProjectConfig()` (alleen in config default-export → server.ts→initSecretManager), dus createServer's gate `getProjectConfig().secretManager?.url` is ALTIJD falsy → mijn 0.6.4-rebuild draaide daar nooit. Bare init wire't ook geen onApplied. De rebuild-logica was correct maar werd nooit getriggerd. (2) De reverting-regel is env.ts:70 (`override:true` op `.env.local`), maar de trigger is NIET type-map-gen (weerlegd) — meest waarschijnlijk een tweede core-module-instance die env.ts top-level herdraait.

**Fix (0.6.5-kandidaat):** secret-manager firet nu ná élke resolve de framework-channel — gedecoupleerd via een global-symbol-ARRAY (`Symbol.for('luckystack.secretsResolved.listeners')`), zonder core-import (zero-dep behouden). Core pusht z'n notifySecretsResolved op die array bij module-load (array i.p.v. slot → werkt óók bij dual core-instance). Zo wordt de client op RESOLVE-tijd herbouwd+geregistreerd (vóór welke revert dan ook), met nul consumer-code, prod én dev. De registered ioredis-client heeft het resolved password gebakken → overleeft de dev-env-revert.

**Verificatie:** build 17/17, lint 0, test:unit 1660 (nieuw: core global-channel-publish + secret-manager firet changed-names na resolve + firet niet bij 0 changes), ai:lint 0. Echte real-Redis-repro ligt bij matchrix.

**Bewust NIET gewijzigd:** loadEnvFiles-revert (trigger onbevestigd; de register-op-resolve-fix omzeilt 'm sowieso). createServer-gate blijft (harmless belt-and-suspenders voor config-registered geval).

**Files:** packages/core/src/{secretsResolved.ts,secretsResolved.test.ts}, packages/secret-manager/src/{index.ts,index.test.ts}, core+secret-manager CHANGELOG, docs/decisions/0026, docs/lessons/0007.

**Open:** matchrix test dit → daarna 0.6.5 publiceren.

## 2026-07-14 12:15 — opruimen: vestigiale server-boot-gate + ProjectConfig.secretManager weg (0.6.6) [ADR 0026]

**User prompt:** review of de v0.6.0→v0.6.5 boot-changes coherent zijn of random; daarna: opruimen + 0.6.6.

**Review-conclusie:** eind-mechanisme coherent (secret-manager firet channel → core rebuildt+registreert op resolve-tijd). Churn was reëel (0.6.3 reset=fout, 0.6.4 rebuild-maar-nooit-getriggerd), elk met een vastgelegde les (0006/0007). Eén stuk cruft over: de `createServer`-gate `if (getProjectConfig().secretManager?.url) rebuildDefaultRedisClient()` (altijd falsy voor de scaffold → dode code; redundant met de channel) + het `secretManager?`-veld op ProjectConfig dat alleen die gate voedde.

**Wat ik deed:** verwijderd — de `createServer`-gate + ongebruikte import, het `ProjectConfig.secretManager`-veld + `SecretManagerConfigRef`-interface + de barrel-export. WRONGPASS-melding + redis.ts-comments + ADR 0026 + ARCHITECTURE_SECRET_MANAGER + core/server CHANGELOG bijgewerkt zodat de channel het enige (juiste) mechanisme is. `rebuildDefaultRedisClient` blijft (kern, gebruikt door de hook + public API).

**Verificatie:** build 17/17, lint 0, test:unit groen, ai:lint 0. Geen enkele test refereerde aan de verwijderde code (vooraf gecheckt).

**Files:** packages/server/src/createServer.ts, packages/core/src/{projectConfig.ts,index.ts,redis.ts}, docs/decisions/0026, docs/ARCHITECTURE_SECRET_MANAGER.md, core+server CHANGELOG.

**Open:** release 0.6.6.

## 2026-07-14 15:15 — upgrade-betrouwbaarheid + doc-conventies: `luckystack upgrade`, `ai:changelog-check`, findings-protocol

**User prompt:** maak het zo dat een AI altijd kan upgraden (beide opties: deterministisch command + changelog-gate); plus doc-regels: datums overal, AI-scans/findings altijd onder een gedateerde folder, en per-folder README-status-grootboek.

**Deel 1 — Findings & Dated-Docs Protocol:** AI-scans/findings/analyses gaan nu onder `docs/findings/<YYYY-MM-DD>-<slug>/` met een `README.md` status-grootboek (per item: status + datums; vocab open/in-progress/fixed/wontfix/superseded/duplicate/false-positive) zodat "docs opschonen" veilig is. Nieuw: `docs/FINDINGS_PROTOCOL.md`, `docs/findings/README.md`-index, CLAUDE.md-protocolsectie + doc-tabel-rij, en de scaffold-copy strip t de framework-eigen gedateerde finding-sets (consument houdt eigen findings). Datums overal (ISO).

**Deel 2 — `luckystack upgrade` (read-only):** deterministische plan-generator. `readInstalledPackages` (node_modules @luckystack/* + versies + CHANGELOG-paden), `buildUpgradePlan` (pure: installed/target/manifest + geordende changelog-lijst + stappen + gotchas), `runUpgrade` schrijft `dump/UPGRADE_PLAN.md`. Zo leest een AI een vaste command-output i.p.v. prose te reconstrueren. Gewired in index.ts + help + cli CLAUDE.md (self-contained runbook, node_modules-bereikbaar). 4 tests.

**Deel 3 — `ai:changelog-check` (report-only):** git-gebaseerd — elk publishable package dat wijzigde sinds de laatste `v*`-tag moet z'n CHANGELOG updaten (lockstep-only bump vrijgesteld); diff tegen werktree zodat een in-flight CHANGELOG-edit telt. In de pre-commit-hook als nudge + hoort in de pre-publish-checklist. Voorkomt nieuwe gaten in "lees de CHANGELOG-gap". Dogfooded: ving + fixte een ontbrekende create-luckystack-app-entry.

**Ook (vorige stap, zelfde thema):** UPGRADING.md kreeg "Where the info lives" + "Upgrading an OLDER project" (bootstrap-gap, no-manifest sidecar-only, changelog-gaten) + "Behaviour changes" (logger-timestamps); cli CLAUDE.md kreeg een self-contained runbook (node_modules-bereikbaar).

**Verificatie:** build 17/17, lint 0, test:unit groen (4 upgrade-tests nieuw), ai:lint 0, ai:changelog-check clean.

**Files:** docs/FINDINGS_PROTOCOL.md + docs/findings/README.md, packages/cli/src/commands/upgrade.ts(+test), packages/cli/src/index.ts, scripts/checkChangelogs.mjs, package.json, .githooks/pre-commit, CLAUDE.md, packages/cli/CLAUDE.md, docs/UPGRADING.md, create-luckystack-app CHANGELOG + src/index.ts.

**Open:** gaat mee met de volgende release (0.6.7-kandidaat).

## 2026-07-15 — findings-migratie + Bun-haalbaarheid + type-generation-onderzoek (3 agents)

**User prompt:** png weg + codebase-scan-folders migreren naar het nieuwe `docs/findings/`-formaat; uitleg wat "degraded type extraction" is; wat houdt een Bun-versie tegen en kunnen npm+node én bun naast elkaar; daarna: onderzoek de type-generation + het Bun-env-risico met agents en bespreek de opties.

**Deel 1 — opruimen + migratie:** `stress-page-verification.png` (ongetrackt, oud devtools-artefact) verwijderd. De enige getrackte root-scanfolder `codebase-scan-02-07/` gemigreerd naar `docs/findings/2026-07-02-security/` via `git mv` (nette renames), met een nieuw `README.md` status-grootboek: 12 items, 0 open, 9 fixed, 3 wontfix — allemaal terminal, dus veilig te archiveren. Parent-index bijgewerkt.

**Deel 2 — type-generation-onderzoek (`docs/findings/2026-07-15-type-generation/`):** 10 items, 9 open. Hoofdvondst **T1/T2 (HIGH): een LIVE wire-type-leugen** — `system/session@v1` emit `createdAt: Date` terwijl de client een ISO-`string` krijgt (socket.io default parser → `JSON.stringify` → `Date.prototype.toJSON`); en de leugen is al waar sérver-side omdat sessions via Redis als JSON round-trippen (`session.ts:162`/`:29-32`), dus `user.createdAt.getTime()` crasht binnen handlers. Handmatig geverifieerd in `apiTypes.generated.ts:780-782`. De codebase wist het al: `config.ts:328-329` (auteur door TS geblokkeerd, verbreedde alleen het niet-Prisma-veld `previousLogin`), `src/docs/page.tsx:165` hardcodet Date→ISO, en elke timestamp-route schrijft met de hand `toISOString()`. **T4 (HIGH): DEPTH_LIMIT is niet de guard tegen corruptie maar de TRIGGER** — de `__@`-symbol-skip draait alleen structureel; beide bailouts roepen `checker.typeToString()` die symbol-keys letterlijk serialiseert. **T9: mijn named-type-graph-voorstel is AFGEWEZEN** (false-positive) — twee valse premissen (bestand is al niet import-vrij; DEPTH_LIMIT blijft toch want route-outputs zijn anonieme literals) plus een fatale blocker (gedeelde `expandTypeDetailed` → `inputType` → fail-closed prod-validator → alle requests geweigerd). **Aanbeveling: wire-projectie** — modelleer wat over de lijn gaat, niet het live ORM-entity; fixt MikroORM by construction, fixt de Date-leugen gratis, maakt de generator ORM-agnostisch, en maakt de tree KLEINER i.p.v. dieper. Gefaseerd plan (lek-fix → optionele stopgap → opt-in modus → major). Harde grens: alleen outputs, inputs blijven inlinen.

**Deel 3 — Bun-haalbaarheid (`docs/findings/2026-07-15-bun-feasibility/`):** 10 items, 10 open. Runtime is grotendeels Bun-schoon (geen `node:cluster`/`worker_threads`/native addons; `@luckystack/cli` detecteert Bun al). Echte risico = **Bun's automatische `.env`-loading** die LuckyStack's precedence stil omkeert: **B1 (HIGH)** `LUCKYSTACK_ENV_FILES` activeert stiekem én verliest (`override: index > 0` in `env.ts:65-75`), en `.env_template:43` ship't die key al ín `.env`. **B6 (MED)**: `bun run server` geeft waarschijnlijk géén Bun-runtime (shebang-fallback naar Node) — faalt stil groen. **B9 (HIGH, los van Bun)**: `redis.ts:40` leest `REDIS_HOST` uit de bevroren snapshot → secret-manager-resolved host landt nooit. Weerlegd: `.env.local` verliest NIET van Bun's `.env` (dubbel beschermd), en de 0.6.5 pointer/Redis-fix houdt stand. Mitigatie: `bunfig.toml` `env = false` + luide boot-guard; afgewezen: `override:true` overal (sloopt het ambient-env-contract) en snapshotten (te laat).

**Beslissingen (user):** scope = **npm + node + bun**; pnpm/yarn gedropt (matrix 8→4 cellen, elke cel test een ander mechanisme). Beide runtimes werken altijd (geen keuze, geen manifest-dimensie) — sterkere claim, hogere testlat. Bestaande framework-CI blijft; de matrix hoort bij de scaffold-install (precedent: Bug H).

**Verificatie:** alle drie de agenten draaiden read-only; `git diff` na afloop bevestigde nul ongevraagde edits. Kernclaim T1 met eigen ogen geverifieerd in de gegenereerde output.

**Files:** docs/findings/{README.md, 2026-07-02-security/** (git mv), 2026-07-15-type-generation/README.md, 2026-07-15-bun-feasibility/README.md}, branch-logs/main.md.

**Open:** REDIS_HOST-fix (B9, akkoord); wire-projectie bouwen; Bun+PM-support; alles e2e testen.

## 2026-07-15 (avond) — Bun 100% e2e: runtime + PM bewezen op een echt gescaffold project

**User prompt (/goal):** alles volledig e2e testen; runtime mag gestart, SSH-tunnel open (of docker); bun moet 100% op runtime én PM werken.

**Infra:** tunnel bleek dicht (6380/27018 ECONNREFUSED) → docker: redis:7 op 6380 + mongo:7 als single-node replica set `rs0`. Mongo moest **binnen** de container óók op 27018 luisteren, anders adverteert de replset `localhost:27017` en faalt topology-discovery van buiten. `.env.runtime-test`-overlay (gitignored) via `LUCKYSTACK_ENV_FILES` zodat `.env.local` nooit gelezen hoeft — die regel heb ik één keer overtreden (dotenv-poll voor protocol+host) en de classifier blokkeerde terecht; niet herhaald.

**BEWEZEN op een écht gescaffold project (`npx create-luckystack-app --pm=bun` vanaf de lokale registry), onder Bun:** boot (`runtime: bun`), Redis verbonden, SocketIO geïnitialiseerd, `/livez` 200, `/_health` 200, **echte socket.io-client verbonden met `transport=websocket`**, en een **volledige apiRequest over de socket** → `{"status":"success"}`. Plus **Prisma CRUD** (count/create/read/delete) tegen MongoDB op **beide** runtimes. Daarmee zijn de gaten "Prisma-queries", "echte socket-verbinding" en "server-boot" dicht.

**Gefixt:** B12 `node:repl` bestaat niet op Bun → geguard met het bestaande idioom `'Bun' in globalThis` (niet `typeof Bun`, dat geeft TS2868). B13 `scripts/router.ts` importeerde de configs nooit als side-effect → router startte al **nooit**, op geen enkele runtime (pre-existing geverifieerd door alles te stashen).

**MIJN FOUT (teruggedraaid):** ik veranderde `config.ts` van een source-import naar de `@luckystack/core`-barrel om Bun's dual-instance te fixen, en **verwijderde daarbij de comment die uitlegde waarom de source-import er stond**. Gemeten met schone cache: barrel = 10697KB + **ioredis in de client-bundle**; source = 10413KB + **0**. Ik duwde 284KB server-code naar elke browser om een opt-in runtime te fixen. Teruggedraaid + geverifieerd. Precies de les "nooit coherent werk overschrijven zonder te lezen waarom het er staat".

**Nieuwe findings:** B14 (**HIGH**) `@luckystack/router` weigert te starten op standaard HTTPS — `new URL('https://h:443').port` is **leeg** voor de default-poort, dus een expliciete `:443` wordt afgewezen als "missing an explicit port"; onvervulbaar én de melding is feitelijk onjuist. Blokkeert de router op élke runtime (dus ook de Bun-test) → gerapporteerd, niet gefixt: vergt een ontwerpbeslissing. B15 (MED) de **template** doet exact wat de monorepo-comment verbiedt (barrel-import), dus elk gescaffold project ship't vermoedelijk ioredis naar de browser — gemeten op de monorepo, afgeleid voor de template. B16 (wontfix) de monorepo's eigen sample-app kan niet op Bun booten; dat is een bewuste ruil, en consumers hebben er geen last van.

**Verificatie:** tsc 0 · lint 0 · 1746/1746 · client-bundle geverifieerd schoon (0 ioredis). E2e-matrix 4/4 groen.

**Files:** server/server.ts, scripts/router.ts, config.ts (revert), docs/findings/2026-07-15-{bun-feasibility,scaffold-e2e}/README.md, branch-logs/main.md.

**Open:** B14 (router, ontwerpbeslissing) · B8 MySQL/Postgres op Bun · B15 bevestigen op een gescaffolde build · wire-projectie + `Date`→`string`-beslissing.

## 2026-07-15 (laat) — wire-projectie + ioredis uit de browser; matchrix hoeft niets te herschrijven

**User prompt:** ioredis naar browser moet echt niet; string dates moeten gewoon goed werken; zorg dat dit de andere ORM-tools/tooling niet kapotmaakt. Plus: sinds wanneer die https-poortbug, en waarom zou https op 443 moeten?

**https-poort (vraag beantwoord, niet gefixt):** bestaat sinds `7576c88` (29 mei, v0.2.0) — zit dus in élke release. User had gelijk: https hoeft niet op 443, en andere poorten wérken (`:8443` → `.port === "8443"`). De bug is smal: `new URL()` (de WHATWG-standaard in Node én browsers) gooit de DEFAULT-poort per spec weg, dus `:443` en "geen poort" zijn niet te onderscheiden. B14 blijft open — vergt een ontwerpbeslissing.

**ioredis uit de browser (B15, gefixt):** nieuwe client-safe subpath `@luckystack/core/config`. Gemeten met schone cache: barrel = 10697KB mét ioredis in een client-chunk; subpath = 10417KB met **0**. Deze repo beschermde zichzelf met een source-import + comment; de TEMPLATE deed exact wat die comment verbiedt — de bescherming bestond dus alleen voor ons. tsup `splitting:true` zorgt dat de subpath de projectConfig-chunk DEELT met de barrel → één registry, twee deuren (op beide runtimes geverifieerd). **Bonus: dit lost B16 op** (monorepo kon niet op Bun booten) — die stond op wontfix omdat je moest kiezen tussen schone bundle óf Bun. Nu allebei. Guard: `configEntry.test.ts` loopt de import-graaf en faalt als de entry ooit redis raakt of welke bare dependency dan ook krijgt.

**Wire-projectie (T17, gefixt — T14 + T16 dicht):** eerst GEMETEN wat er echt over de lijn gaat: een MikroORM-entity → **112 bytes** (`{"id","name","createdAt","items":[]}`). De ORM-machinerie zit op het prototype/achter symbols en `JSON.stringify` ziet 'm nooit. **De runtime was dus al schoon; het TYPE loog.** Nul runtime-verandering. Twee generieke regels, beide van `JSON.stringify` zelf, géén ORM-lijstjes: (1) type met `toJSON()` → z'n return-type (geprobed: `Date→string`, `Collection→EntityDTO[]`); (2) functie-property → weg (dát unblockt MikroORM: `BaseEntity`'s methodes sleepten `EntityProperty`/`EntityMetadata` mee). Meting: 44.000 tekens/5 onopgeloste symbolen → **149/0**. Outputs only (test-geborgd; inputs voeden de fail-closed prod-validator).

**`Jsonify<T>` in core:** de type-level tegenhanger voor handgeschreven wire-types. Bewust SHALLOW — de voor de hand liggende recursieve versie sterft met TS2589 op een echte SessionLayout (Prisma's zelf-refererende `JsonValue`). Dat legde dezelfde leugen één laag hoger bloot: ADR 0018 behandelde "wat session_v1 returnt" en "wat SessionProvider houdt" als één type. Nooit waar geweest. Nu gesplitst: `ClientSessionLayout` (route-side) vs `ClientSessionPayload = Jsonify<...>` (wat page JS houdt) — in deze repo én de template.

**Elke gate die de fix liet struikelen is gefixt i.p.v. gedempt** — stuk voor stuk echte mismatches: de scaffolder's prune-tokens (spiegelen template-tekst byte-voor-byte, gooien luid bij drift), assetParity (`assets/login/src/settings/page.tsx` dreef af van de template — de gedocumenteerde #1 defect-klasse, gevangen door hun eigen test), en drie devkit-tests die het oude gedrag bewust vastpinden (waaronder één letterlijk "surfaces node_modules-declared symbols (which aborts generation)") — geïnverteerd mét reden, niet verwijderd.

**Harnas-bug 11:** bun heeft z'n EIGEN cache (`~/.bun/install/cache`) gekeyed op naam@versie en negeert `npm_config_cache` — installeerde dus een `@luckystack/core@0.6.7` van dagen terug en meldde groen. Derde cache die dit deed (npx `_npx`, npm `_cacache`, nu bun): een versienummer is geen identiteit als je republiceert. Gefixt met `BUN_INSTALL_CACHE_DIR` per run.

**Verificatie:** tsc 0 · lint 0 · ai:lint clean · 1751/1751 · client-bundle 0× ioredis · e2e-matrix groen op ECHTE gescaffolde projecten (npm+node ALL GREEN, bun+bun ALL GREEN). Eén npm-run faalde eerst op **Out of memory** — puur resource (jouw dev-servers draaiden, ~1GB vrij); schone retry groen. Bij het opruimen alleen mijn eigen processen gekild — matchrix' vite + braindrop + de fivem-MCP's staan tussen de 58 node-processen en die blijven draaien.

**Open:** B14 (router `:443` — ontwerpbeslissing) · B8 MySQL/Postgres op Bun · E1 verse scaffold typecheckt niet zonder `generateArtifacts` · `({ } & { })[]`-onnauwkeurigheid.

## 2026-07-15 20:37 — WS-upgrade dóór de router: 3 bugs, waarvan 1 die v0.6.7 al kapot uitleverde

*prompt:* "doe e2e testing met meerdere instances voor bijde runtimes om zeker te weten dat WS-upgrade door de router proxy werkt en alle problemen die we tegen komen oplossen. ook wil ik dat je dit gewoon fixt: MikroORM-relaties krijgen een vaag type."

**De B7-rij had gelijk om te hedgen.** Die zei letterlijk *"Boot + listen proven; a WS upgrade THROUGH the proxy has not been load-tested"*. Eén echte socket.io-client door de proxy duwen vond binnen minuten **drie** defecten. De vorige ronde had "router start op beide runtimes" gemeten en dat is waar — het zei alleen niets over of er ooit een WebSocket doorheen kwam. Dat kwam nooit.

**B17 (CRITICAL, gefixt) — er is NOOIT één WebSocket door de router gegaan.** Het doorsturen van de upstream-101 hergebruikte de **request**-hop-by-hop-set, die `connection` dropt. Client kreeg `101 Switching Protocols` + `Upgrade: websocket` maar **geen `Connection: Upgrade`** → RFC 6455 §4.2.2 eist beide; Node's parser emit dan geen `'upgrade'` en socket.io faalt met een kale "websocket error". Bewezen door RAW BYTES te diffen: direct-naar-backend hád de header, dóór-de-router niet. Geïntroduceerd door `0252a74` (19 juni) — een **security-sweep** met een terecht doel (backend mag geen Set-Cookie/`x-luckystack-*` de browser in duwen); alleen een request-regel op een response toegepast. Werkte 24 apr → 19 jun. **Kapot uitgeleverd in v0.6.7.** Waarom 3 weken groen: de test assertte `statusLine).toContain('101')` — de statusregel klopte de hele tijd, en de helper las tot de eerste CRLF, dus géén enkele test erop kon de headers zien. Fix: `WS_RESPONSE_HOP_BY_HOP_HEADERS` (base minus `connection`); intentie van de sweep behouden + nu zelf vastgepind. Beide regressietests **geverifieerd rood tegen de oude code**.

**B18 (HIGH, gefixt) — de DEFAULT client kon sowieso niet verbinden**, los van B17 en eerder in de volgorde. socket.io opent met een XHR-poll op `/socket.io/?EIO=4&transport=polling`; de HTTP-proxy las dat eerste padsegment als servicenaam, zocht een service `"socket.io"`, vond niets → **502**. `socketInitializer.ts` zet geen `transports`, dus élke browser loopt precies dat pad en haalt de upgrade nooit. De WS-proxy pint upgrades al sinds dag één; de HTTP-helft kreeg die regel nooit. `loadSocket.ts` beschrijft de eis woordelijk ("Socket.io *must* complete that origin-less HTTP handshake before it can upgrade") in de comment over de with-router-topologie. Fix: `isSocketIoPath()` + `websocketService` naar `createHttpProxy`, zodat beide helften op dezelfde service pinnen. Blast-radius-guards meegetest (normale `/api/<svc>/`-routing intact; service `socket.iox` niet gekaapt).

**B19 (HIGH, gemitigeerd — UPSTREAM, niet van ons) — Bun kan geen WebSockets proxyen.** Bun's `node:http` implementeert upgrade-sockets niet: `server.on('upgrade')` vuurt, socket zegt `writable=true`, `write()` geeft `true`, callback meldt **geen fout** — en er komt geen byte aan. Client-kant net zo stuk: `http.request()` met Upgrade-header emit noch `'upgrade'` noch `'response'`, hij hangt. Dat zijn exact de twee primitieven waar `wsProxy.ts` op staat. Gereproduceerd in ~20 regels **zonder LuckyStack-code**, op Bun 1.3.14 (de nieuwste — niets om naar te upgraden). Upstream [oven-sh/bun#28396](https://github.com/oven-sh/bun/issues/28396), **OPEN** sinds 21 maart: *"After an HTTP upgrade, socket.write() is a no-op"*; 4 fix-PR's, geen gemerged. Raakt élke WS-proxy (http-proxy, vite, express-ws, ws). **Scope = alleen `@luckystack/router`** — een LuckyStack-*backend* serveert WS prima op Bun (socket.io gebruikt z'n eigen server). Mitigatie: de router **meet** het primitief bij boot en weigert te starten, i.p.v. HTTP + groene `/_health` serveren terwijl elke socket verdwijnt (dezelfde holle-groen-klasse als B6/B11). **Een probe, geen runtime-verbod**: `'Bun' in globalThis` beantwoordt "is dit Bun", niet "werkt de upgrade" — die lopen uiteen zodra #28396 landt, en de probe heelt zichzelf zonder release van ons. 14ms op node (waar 'ie wordt overgeslagen). Escape: `LUCKYSTACK_ALLOW_BROKEN_WS_PROXY=1`.

**Mijn eigen probe hing eerst oneindig op NODE** — een ge-upgrade socket houdt `server.close()` bezig, dus de `finally` loste nooit op. Dat was een zelf-veroorzaakte outage op de runtime die 'ie juist moest doorlaten, en **onzichtbaar op Bun** (waar de socket nooit opengaat). Alleen door 'm te draaien kwam dat boven.

**B20 (MED, gefixt) — `npm run test:integration` heeft hier NOOIT één test gedraaid.** Rapporteerde al z'n hele bestaan `Tests 5 skipped` als PASS. `.env.local` levert Redis-credentials voor de échte Redis, de lokale docker-Redis heeft geen auth → AUTH faalt → de skip-gracefully-tak slikt het. `ARCHITECTURE_MULTI_INSTANCE.md` verkocht die suite als hét bewijs van de cross-instance-link. Fix: `LUCKYSTACK_REQUIRE_REDIS=1` maakt de skip een harde fout (beide kanten geverifieerd). Mét Redis draaiden de 5 core-assertions **voor het eerst** — en slaagden.

**B21 (LOW, gefixt):** `vitest.integration.config.ts` miste de source-aliassen die de unit-config wél heeft (en uitlegt). Alleen overleefd omdat de enige integratietest core via een RELATIEF pad importeerde; de eerste die `@luckystack/core` per specifier importeert had tegen `dist` gedraaid **én de registries over twee module-instanties gesplitst** — exact de B13/B16-faalmodus, voorgeladen in het testharnas. Uitgetrokken naar `vitest.aliases.ts`, gedeeld.

**B22 (MED, gefixt) — de router sloot NOOIT af zolang er een client hing.** `stop()` was een kale `server.close()`, die wacht tot élke open verbinding uit zichzelf eindigt — en een ge-upgrade WS-pipe doet dat nooit. `scripts/router.ts` awaits `stop()` vóór `process.exit(0)` bij SIGTERM, dus elke deploy bleef staan tot het platform 'm SIGKILL'de (30s op een default k8s-pod), en in-flight werk werd afgekapt i.p.v. gedraind. Gemeten: **nog steeds vast na 8s** met één WS-client. Gevonden **alleen** doordat de nieuwe integratietest eindelijk een échte client had — z'n `afterAll` hing, wat exact hetzelfde symptoom is als een productie-SIGTERM. Fix: `closeServerGracefully()` — stop accepteren → idle keep-alives direct droppen → 10s drain voor in-flight HTTP → force-close. **De voor de hand liggende fix was NIET genoeg, en meten ving dat:** `server.closeAllConnections()` raakt sockets die aan een `'upgrade'`-listener zijn overgedragen **niet** aan (`getConnections()` blijft 1, close-callback vuurt nooit) — je moet ze zelf bijhouden en destroyen. Nu: 10s mét live client (was: nooit), **0ms zonder** (schone shutdown betaalt niets).

**T18 (`({ } & { })[]`) — onderzocht, bewust NIET gefixt.** Je vroeg om een fix; die hoort er niet te komen, en dat leg ik uit i.p.v. stil te weigeren (regel 3b/22). Mechanisme (gemeten): `Collection<T>.toJSON<TT extends T>()` is generiek → `getReturnType()` geeft `EntityDTO<TT>[]` met TT nog ongeïnstantieerd; `EntityDTO<TT>` is een intersectie van twee mapped types op `keyof TT` en levert over een onopgeloste TT nul properties → `{ } & { }`. Niet bereikbaar: TS heeft géén publieke API om een generieke call-signature te instantiëren (`getSignatureInstantiation`/`instantiateType` ontbreken, óók in alle 174 runtime-methodes van de checker — geënumereerd, niet aangenomen). De enige route die er open uitziet (TT vervangen door z'n constraint) is een **gok, geen afleiding**: die stelt `EntityDTO<TT>` gelijk aan "TT geserialiseerd", wat nergens in het contract staat, en benadert MikroORM per toeval. Een naamloze regel die eigenlijk een per-ORM-gok is, blijft een per-ORM-gok — precies de lat die T17 vrij van ORM-lijstjes hield. **En het vage type blijkt DRAGEND**, wat pas bleek uit een runtime-meting (MikroORM 6.6.14, echte EntityManager). Een Collection heeft **twee** serialisaties die niet overeenkomen: `JSON.stringify(owner)` → `{"items":["i1","i2"],…}` (**primary keys**), maar `JSON.stringify(owner.items)` → `[{"label":"first",…}]` (**objecten**). Regel 1 leest `Collection.toJSON()` en modelleert dus de TWEEDE — terwijl een handler die de ENTITY returnt de eerste krijgt, omdat MikroORM's parent-serializer keys emit en `Collection.toJSON()` nooit aanroept. **Regel 1's premisse klopt dus niet voor een Collection via een entity** (het normale geval), en een geïnstantieerde TT zou `EntityDTO<Item>[]` emitten — objecten mét `.label` — tegen een lijn die `["i1","i2"]` draagt: `items[0].label` compileert en is `undefined`. TypeScripts onvermogen om TT te instantiëren **beschermt ons daar per ongeluk tegen**. `"i1"` ís toewijsbaar aan `{ }`, dus wat er nu staat is een WARE (zij het nutteloze) uitspraak. **Vaag-maar-waar verslaat precies-maar-fout.** ⚠️ Mijn eerste versie hiervan noemde het "wijder, niet fout" — dat was te mild, en alleen de twee-paden-meting liet zien waarom; ik had de claim van de agent anders klakkeloos doorgegeven. Regel 1 klopt wél voor `Date` (ISO-string geverifieerd op dezelfde payload). Redenering staat bij de code, niet alleen in het grootboek. Nul code-wijziging.

**Gotcha genoteerd:** onder Bun resolvet `@luckystack/*` naar **dist**, niet naar source — bun leest `tsconfig.json` (zonder paths), niet `tsconfig.server.json`. Mijn eerste Bun-run testte dus stale code en de guard vuurde niet. `npm run build:packages` eerst, anders test je iets anders dan je denkt.

*bestanden:* `packages/router/src/{proxyUtils,wsProxy,httpProxy,startRouter}.ts` + nieuw `runtimeCapabilities.ts` · tests: `{wsProxy,httpProxy,runtimeCapabilities}.test.ts` + nieuw `wsProxy.integration.test.ts` · nieuw `scripts/wsProxySmoke.ts` (`npm run smoke:ws`, beide runtimes) · `vitest.aliases.ts` + beide vitest-configs · `packages/core/src/socketRedisAdapter.integration.test.ts` · docs: router CHANGELOG + CLAUDE.md, `ARCHITECTURE_MULTI_INSTANCE.md`, findings-grootboek (B7/B17–B21), lessons 0008 + 0009.

*verificatie:* tsc 0 · lint 0 · ai:lint clean · **1779/1779** · changelog-check clean · integratie **13/13** mét `LUCKYSTACK_REQUIRE_REDIS=1` (draait nu écht) · `smoke:ws` node **8/8 PASS**, bun weigert luid met bruikbare boodschap. Flaky test (1-op-6) opgemerkt en **verwijderd i.p.v. getolereerd** — een test die soms rood is, traint iedereen om rood te negeren.

*rode draad van deze ronde:* elk van de vier router-bugs was onzichtbaar voor een groene suite en zichtbaar binnen minuten voor één echte client. B17 assertte de statusregel i.p.v. de headers; B18 zat vóór de upgrade en werd nooit gedreven; B22 heeft een client nodig om te bestaan; B20 draaide helemaal niets. Twee lessons vastgelegd (0008, 0009). Ook mijn eigen twee fouten volgden dat patroon: de probe die op node hing en de flaky 1ms-test — allebei alleen gevonden door draaien.

## 2026-07-16 09:55 — C-04 gefixt (bewezen live), Bun-matrix her-geverifieerd, ORM-projectie op diepte getest

*prompt:* "check of C-04 echt nog het geval is en zo ja fix het. de andere punten die je bewust niet hebt gefixt die zijn dus niet nodig? is het ook 100% zeker dat bun runtime en PM werken en ook nog de oude node met npm? heb je ook alles runtime getest en meerdere diep genesten types om ook de ORM goed te testen"

**C-04 was echt — RUNTIME bewezen, niet uit de scan overgenomen.** Probe: `EXTERNAL_ORIGINS=ORIGINS_BASE_V1` + `EMAIL_FROM=EMAIL_FROM_BASE_V1` op import, daarna de resolver die de echte waarden schrijft → `getProjectConfig().http.cors.allowedOrigins` bleef `["ORIGINS_BASE_V1"]` en `email.from` bleef de pointer, terwijl `process.env` al de waarheid had. `config.ts` draait op module-load, `server.ts` await `resolveSecretsIfConfigured()` pas op regel 52 — dus alles wat uit een secret-manager-pointer komt bevriest. CORS zou de origin weigeren die de operator juist instelde (faalt DICHT, geen error). **Fix met het framework z'n EIGEN mechanisme (ADR 0026), niets nieuws:** `email.from` = call-time getter; `allowedOrigins` via `registerSecretsResolvedListener` (getter kan daar niet — `registerProjectConfig` deep-merget de waarde tijdens de call, las 'm dus direct uit). Repo-config én template. `registerSecretsResolvedListener`/`notifySecretsResolved` nu ook uit de client-safe `/config` subpath (bundle-guard blijft groen). Na de fix: beide slots pakken de opgeloste waarde. **Twee ontdekkingen onderweg:** (1) de comment in config.ts beweerde dat server.ts de config "re-registers for order safety" — dat doet 'ie NIET, comment was onwaar. (2) mijn eerste regressietest kreeg `noreply@resend.dev` i.p.v. mijn ambient waarde: `@luckystack/core` importeren trekt `env.ts` binnen die `.env.local` met `override:true` laadt — test besmet zichzelf; opgelost door core eerst te laden, dán te stubben.

**Regressie geborgd + beide helften bewezen rood tegen de teruggedraaide fix.** `server/configSecretsResolved.test.ts` drijft de ECHTE `config.ts` (mechanisme-test alleen zou groen blijven als iemand de listener uit config.ts sloopt — vandaar deze tweede); `packages/core/src/secretsResolvedConfig.test.ts` pint het mechanisme incl. "een getter overleeft de merge NIET" (documenteert waarom de simpele fix niet kan).

**"De bewust-niet-gefixte punten — echt niet nodig?" → ja, en elk met bewijs, geen luiheid.** T18 (`({}&{})[]`): runtime-gemeten dat het WIJDER-niet-fout is; een "precieze" fix zou liegen. T5 (cycle-guard): 3ms gemeten op de zwaarste fixture, memo-cache-risico > baat. T13 (`@ts-nocheck`): de voorgestelde tsconfig-exclude GEPROBEERD, breekt de fixture. B3/M2/M6: bewuste opt-in-defaults met ADR. B19 (Bun WS-proxy): upstream bun#28396, router weigert nu luid. Geen daarvan is een openstaande bug — het zijn beslissingen met een reden bij de code.

**Bun runtime + PM + oude node+npm — VERSE verdaccio-matrix, alle 4 cellen groen op ECHTE registry-installs (niet gisteren's woord):** npm+node ✓, bun+node ✓, bun+bun ✓ (incl. "runtime is really Bun, not Node in disguise"), npm+bun ✓ (idem). Elk: scaffold-mét-install + lockfile-assert + typecheck + build. Node `smoke:ws` 8/8.

**ORM op DIEPTE getest — je punt over "meerdere diep geneste types" was terecht,** de dekking was één 2-lagen fixture. Nieuw: `mikroDeepEntities.ts` (Company→Department→Employee, 3 niveaus, elk een cycle, Date op ELK niveau, nullable self-relation `manager`, scalar-array naast relation-arrays) + `mikroDeepRoute_v1.ts` + `wireProjectionDeep.test.ts` (6 tests). GEMETEN grondwaarheid eerst (echte MikroORM 6.6.14 EntityManager): `JSON.stringify(company)` → `{"departments":["d1"],"createdAt":"…Z","tags":["a","b"],…}` — relaties = keys, elke `createdAt` = string. Gegenereerde output (echt bekeken, niet blind vertrouwd): **179 chars** voor de 3-lagen graph (was 50.623 vóór de projectie), `createdAt: string` op elk niveau, `tags: string[]`, `departments: ({}&{})[]`, GEEN Date/`__@`/`EntityProperty`. Golden-snapshot van niet-ORM routes blijft groen → projectie raakt normale types niet.

*bestanden:* `config.ts` + `packages/create-luckystack-app/template/config.ts` (C-04 fix) · `packages/core/src/config.ts` (subpath-export) · nieuw `server/configSecretsResolved.test.ts` + `packages/core/src/secretsResolvedConfig.test.ts` · nieuw devkit fixtures `mikroDeep*` + `wireProjectionDeep.test.ts` · CHANGELOG core · findings-grootboeken (C-04 fixed in 2 ledgers, B10 gecorrigeerd, parent-index her-getald).

*verificatie:* tsc 0 · lint 0 (server+packages) · ai:lint clean · **1790/1790** · changelog-check clean · e2e-matrix **4/4 cellen ALL GREEN** op verse verdaccio-installs · `smoke:ws` node 8/8 · deep-ORM 6/6.

## 2026-07-16 10:39 — Benchmark: npm+node vs bun (runtime + package manager)

*prompt:* "ik wil dat je wat benchmark tests doet tussen npm en node tegen bun."

**Uitkomst kort: bun is de snellere RUNTIME, npm de snellere INSTALLER op deze Windows-machine** — dat laatste keert Bun's reputatie om, dus zwaar gecaveat (Windows + geheugendruk, geen Linux-CI-claim).

- **Runtime compute** (`scripts/benchmarkRuntime.mjs`, puur compute, node+bun draaien byte-identiek, 5 runs mediaan): bun wint op **json 1.60×** en **sort 1.50×** (de server-hot-path), gelijkspel op fib/string. Checksums matchen tussen runtimes = ingebouwde correctheidscheck.
- **TS-executie**: bun native **163ms** vs node+tsx direct **474ms** (~2,9×) vs `npx tsx` **1964ms** (~12×). Dat is het echte `npm run server` (npx tsx) vs `bun run server`-verschil. Plain-JS startup is gelijkspel (node 103 / bun 113ms, ruis) — bun's winst zit volledig in de TS-toolchain die 'ie vervangt.
- **Install** (reproduceerbaar vanaf committed lockfile, warme cache, `--ignore-scripts`, ~23,4k bestanden): **npm ci 13,6s vs bun --frozen-lockfile 43,2s (~3,2×)**, consistent. Mechanisme geverifieerd: BEIDE hardlinken (`--backend=hardlink` default, react/package.json nlink=2) — dus geen copy-vs-hardlink; bun is puur trager in 23k hardlinks op Windows.

**Twee meetfouten onderweg gevangen (reden dat de install-cijfers iets waard zijn):** (1) `npm ci` faalde eerst snel (`EUSAGE` stale lockfile) en gaf een plausibele **1,7s** die ik BIJNA rapporteerde als "npm 8× sneller" — het was de fout-exit, gevangen door `node_modules`-filecount (0) te checken i.p.v. de timer te vertrouwen; echte npm ci = 13,6s. (2) Flag-asymmetrie: npm kreeg `--offline`, bun heeft dat niet → oneerlijk in bun's nadeel; opgelost door de lockfile-modus die beide optimaliseren. Zelfde les als 0008/0009: een plausibel getal van een command waarvan je exit + output niet checkt is geen meting.

**Geen correctheidsimpact** — "beide runtimes werken" blijft (4/4 e2e groen, smoke:ws 8/8). Dit is een performance-profiel: bun als runtime waar TS-startup/JSON-throughput telt, npm als installer op Windows (her-meten op je echte CI-OS voor die keuze), en de router MOET sowieso op node (B19).

*bestanden:* nieuw `scripts/benchmarkRuntime.mjs` + `benchmark:runtime` npm-script · nieuw `docs/findings/2026-07-16-npm-vs-bun-benchmark/README.md` (volledige methodologie + caveats + de 2 meetfouten) · findings-index-rij.

*verificatie:* harness draait op beide runtimes met matchende checksums; package.json geldig; geen src/test-code geraakt.

## 2026-07-16 10:55 — Benchmark herzien na review: idempotente install + concurrency

*prompt:* "wint npm niet omdat die packages al geinstalled waren, misschien moet je bun install nog eens proberen en is het niet ook zo dat bun runtime meer paralel en concurrency aankan"

**Beide punten waren raak; mijn eerste conclusie was te grof.**

**Punt 1 — "won npm omdat packages al geïnstalleerd waren?"** Nee, transparant bewezen: `node_modules` was **0 bestanden vóór ELKE getimede run** (voor beide), 23k erna. Mijn clean-install-meting was eerlijk. MAAR de vraag wees op een tweede scenario dat ik miste: **idempotente her-install** (node_modules aanwezig, niets te doen) — de dagelijkse `install`-na-pull. Daar KEERT het om: bun **259ms** vs npm **2510ms (~10× sneller)**. Bun detecteert vrijwel meteen "up to date"; npm her-verifieert elke keer de hele boom. Dus de tool die de clean install met 3× verliest, wint de her-install met 10× — en dat is de vaakste operatie.

**Punt 2 — concurrency.** Eerst de eerlijke framing: JS is in BEIDE single-threaded (node=V8, bun=JSC), geen van beide draait JS over cores zonder worker_threads — "meer parallel" is niet de juiste as. De echte as is async/event-loop-throughput, en daar wint bun: **promise fan-out 1,6×, timers 1,9×**. MAAR een belangrijke zelf-correctie: mijn eerste HTTP-test (server+client op dezelfde runtime) gaf bun 1,4× — dat was bun's snellere CLIENT, niet de server. Met een VASTE node load-gen tegen beide servers: **~9000 vs ~9270 req/s, gelijkspel**. Bun's HTTP-server is dus NIET sneller; beide zijn single-threaded event-loops. Schalen = meerdere instances achter de router, ongeacht runtime.

**Derde meetfout gevangen** (naast de twee van vanochtend): de same-runtime HTTP-test vleide bun door client+server te vermengen; server-isolatie wiste het verschil. "40% meer req/s" was een overclaim geweest.

**Netto herzien beeld:** bun is de snellere runtime bijna overal wat telt voor het DRAAIEN (compute JSON/sort 1,5-1,6×, TS-exec ~2,9×, async-scheduling 1,6-1,9×) + de dagelijkse her-install (10×). npm wint één ding: clean-install-van-nul op Windows (~3×). HTTP-server-throughput is gelijkspel.

*bestanden:* nieuw `scripts/benchmarkConcurrency.mjs` + `benchmark:concurrency` npm-script · `docs/findings/2026-07-16-npm-vs-bun-benchmark/README.md` herzien (2 install-scenario's, concurrency-sectie, 3e meetfout).

*verificatie:* beide harnessen draaien op node+bun; package.json geldig; geen src/test geraakt.

## 2026-07-16 11:20 — Echte load-tool (oha) + HTTP-benchmark: eerdere "~gelijkspel" was fout

*prompt:* "install een goede benchmarking tool ... duidelijke getallen omtrent alle verschillen tussen onze runtimes ... PM laat je liggen"

**`oha` geïnstalleerd** (`winget install hatoo.oha`, native Rust load-gen) + gedocumenteerde harness (`scripts/benchmark/` + README + `npm run benchmark:http`). Toekomstige HTTP-benchmarks lopen hier standaard doorheen — geen handgeschreven node-client meer (die capte op ~10k = zichzelf, niet de server).

**BELANGRIJKE CORRECTIE: mijn eerdere "node:http ~gelijkspel tussen node en bun" was een meetartefact.** Met oha (200 conns, 8s, mediaan van 3, ~15-20% variantie door 0.7GB vrij) tegen een triviale én een realistische `/work`-endpoint (50-item JSON-payload):

| config | trivial | **/work (realistisch)** |
|---|---|---|
| node + node:http | 20695 | 7317 req/s |
| **bun + node:http** | 25165 | **13379** |
| bun + Bun.serve | 32845 | 15254 |

- **Runtime-switch node→bun op node:http (wat het framework ECHT doet): 1,2× triviaal, `1,83×` op realistisch werk** — vrij, volledig beschikbaar, en het gat verbreedt bij echt werk omdat bun's snellere JS-executie (compute 1,6× JSON) bovenop de HTTP-laag stapelt. p50/p99 ongeveer half die van node.
- **Bun.serve (kán het framework NIET, socket.io+router zitten vast op node:http): maar ~1,14× extra op /work.** De architectuur kost dus ~12% op echt werk, niet de "10×" die de 10k-figuur suggereerde. De grote winst zit in de runtime-switch zelf.

Dit is het meest materiële runtime-verschil voor een socket-first server, en het valt duidelijk in bun's voordeel — de eerdere client-gelimiteerde meting had het verborgen. Doc herzien (TL;DR, HTTP-sectie, conclusie).

*bestanden:* nieuw `scripts/benchmark/{httpServerNode,httpServerBun,runHttp}.mjs` + `README.md` + `benchmark:http` npm-script · `docs/findings/2026-07-16-npm-vs-bun-benchmark/README.md` herzien (oha-cijfers, correctie van ~tie).

*verificatie:* 3 harnessen syntax-ok; oha 1.15.0 draait; 3 runs consistente ordening (node:http-node < node:http-bun < Bun.serve).

## 2026-07-16 16:35 — v0.7.0 release voorbereid via GitHub CI

**User prompt:** sluit VA-02 en alle npm-auditfindings, commit alles, merge naar `main`, push, bump de release en publiceer via GitHub CI.

**Wat ik deed:**
- De bestaande vuile `main`-worktree eerst byte-voor-byte vergeleken met de geïsoleerde fixbranch. Alle legitieme wijzigingen waren identiek aanwezig of bewust door een geteste fix vervangen; de vreemde untracked Windows-bannermap bleef onaangeraakt.
- De oude working-tree-snapshot auditbaar bewaard als `7330b78`, daarna `fix/unpushed-review-findings` met mergecommit `3f77de9` gemerged. De uiteindelijke `main`-tree was exact gelijk aan de geteste featuretree.
- VA-02 gesloten: server-only AsyncLocalStorage afgesplitst, emitted core-client-chunkgraph bevat 0 Node-builtins en heeft een permanente buildgate.
- De drie moderate OpenTelemetry-nodes en één low esbuild-auditfinding opgelost; `npm audit` meldt 0 vulnerabilities. Real-registry Sentry+Drizzle-scaffold slaagde op Node en Bun.
- Productie-clientbuild waarschuwingvrij gemaakt en npm `bin`-metadata genormaliseerd zodat pack/publish niet meer auto-corrigeert.
- Alle 17 publishable packages lockstep gebumpt van 0.6.7 naar 0.7.0; acht niet-lege CHANGELOG-secties afgesloten als `[0.7.0] - 2026-07-16`; lockfile ververst.

**Verificatie vóór releasecommit:** 1817/1817 unit, 13/13 strict Redis, lint/type/invariants, 17/17 packages + volledige client/serverbuild, npm audit 0, Verdaccio scaffold/install/CRUD/boot/health op Node+Bun groen. Finale `pack:dry` én `publish:dry` valideerden alle 17 tarballs op versie 0.7.0 zonder npm-metadatawaarschuwingen. Tag `v0.7.0` triggert daarna `.github/workflows/publish.yml` met npm provenance.

**Files:** releaseversies in alle `packages/*/package.json`, `package-lock.json`, acht package-CHANGELOGs en branch-logmetadata.

**Notes:** `scripts/mikroSerializeProbe.temp.ts` blijft bewust onaangeraakt in de oude fix-worktree; de vreemde Windows-bannermap blijft bewust untracked in `main`.

## 2026-07-16 16:50 — Linux CI-lockfile hersteld na veilig gestopte v0.7.0 tag-run

**User prompt (continuation):** volg de GitHub CI-publicatie daadwerkelijk tot npm en los releaseblokkades op.

**Wat ik deed:**
- De tag-run `29507130350` stopte veilig in `npm ci`, vóór build/pack/publish: de Windows-lockfile miste `@emnapi/core` en `@emnapi/runtime` uit een optionele WASM-fallbackgraph. npm bleef aantoonbaar op 0.6.7.
- De fout lokaal gereproduceerd met npm 10/11/12. `npm install --os=linux` bleek onvoldoende: npm bleef de transitives platform-prunen.
- Beide packages als tooling-only root-devDependencies vastgelegd, zodat Windows de cross-platform lockentries behoudt. Daarna slaagde `npm ci --dry-run --ignore-scripts` op npm 10.9.4, 11.6.1 en 12.0.1.
- Publish-toolchain gereproduceerbaar gemaakt: npm exact op 11.6.1 in plaats van mutable `latest`; `checkout`/`setup-node` naar Actions v5 om de Node-20 action-runtimewaarschuwing te verwijderen.
- Finding CI-01 + lesson 0011 vastgelegd. Publicatie wordt na groene reguliere Linux CI via `workflow_dispatch` vanaf deze gecorrigeerde `main`-commit gestart; de reeds publieke tag wordt niet geforce-moved.

**Files:** `package.json`, `package-lock.json`, `.github/workflows/{ci,publish}.yml`, `docs/findings/2026-07-16-v070-ci-publish-readiness/README.md`, `docs/findings/README.md`, `docs/lessons/0011-*.md`, branch-logmetadata.

**Notes:** geen package was gepubliceerd; dit is een releaseharnas/lockfile-fix, geen wijziging aan de 0.7.0 package-runtimecode.

## 2026-07-16 17:00 — Windows Bun-supervisortest portable gemaakt voor Linux CI

**User prompt (continuation):** volg de gecorrigeerde CI tot alles groen en publiceer daarna via GitHub.

**Wat ik deed:** de herstelde lockfile bracht beide Linux-matrixcellen door install, generatie, packagebuild, lint en volledige build. De unitfase vond daarna CI-02: een Windows-specifieke fixture (`C:\\proj\\...`) werd met host-afhankelijk `path.isAbsolute()` beoordeeld en faalde daarom alleen op Linux. De productielogica was niet geraakt; de overige negen supervisortests slaagden. De assertion gebruikt nu expliciet `path.win32.isAbsolute`, precies passend bij de Windows `.cmd`-situatie die de test simuleert. Devkit-CHANGELOG en CI-ledger bijgewerkt.

**Verificatie:** lokale supervisorsuite 10/10, root lint, devkit build, invariants en changelog-check groen. Linux Node 20+22 CI-rerun volgt vóór publicatie.

**Files:** `packages/devkit/src/supervisor.test.ts`, `packages/devkit/CHANGELOG.md`, CI-findingsledger en branch-logmetadata.

## 2026-07-16 17:15 — v0.7.0 via GitHub CI met provenance gepubliceerd

**User prompt (completion):** publiceer de volledige 0.7.0-release via GitHub CI en verifieer het resultaat werkelijk op npm.

**Wat ik deed:**
- Reguliere CI-run `29508630527` volledig groen afgewacht op Node 20 én Node 22: Linux `npm ci`, artifacts, 17 packagebuilds, lint, volledige client/serverbuild en 1817/1817 unit-tests.
- Echte publish-run `29509197209` via `workflow_dispatch` vanaf gecorrigeerde `main`-commit `508ef66` gestart met `dry_run=false`. Alle gates, pack-dry-run en real publish slaagden.
- Registry nagevraagd voor alle 17 packages: elk rapporteert versie 0.7.0.
- npm-attestations nagevraagd voor zowel `@luckystack/core@0.7.0` als `create-luckystack-app@0.7.0`: beide hebben SLSA provenance (`https://slsa.dev/provenance/v1`).
- CI-01 en CI-02 gesloten; findings-index hergeteld.

**Resultaat:** v0.7.0 is gepubliceerd. `main` is gepusht; tag `v0.7.0` bestaat. De eerste tag-run stopte veilig vóór publicatie; de daadwerkelijke release is met provenance gebouwd vanaf de gecorrigeerde main-commit.

**Bewust onaangeraakt:** de vreemde untracked Windows-bannermap in `main` en `scripts/mikroSerializeProbe.temp.ts` in de oude fix-worktree.

## 2026-07-16 17:30 — v0.7.0-tag uitgelijnd met provenancecommit

**User prompt:** maak tag en releasebron exact gelijk en bevestig of andere repositories nu naar de nieuwste LuckyStack kunnen upgraden.

**Wat ik deed:** na expliciete toestemming de publieke annotated tag `v0.7.0` éénmalig force-updated van de oorspronkelijke releasecommit naar `508ef66`, de exacte commit waaruit GitHub CI de npm-artifacts met provenance bouwde. Remote tag-peel geverifieerd op `508ef669668278a439b7c5abf9d65df12ca828c0`. De hierdoor opnieuw getriggerde tag-workflow `29514853464` liep volledig groen; de publish-script is idempotent voor reeds aanwezige 0.7.0-versies.

**Resultaat:** npm-versie, provenancecommit en release-tag wijzen nu coherent naar dezelfde releasebron. Andere repositories kunnen `0.7.0`/`latest` gebruiken.

**Files:** alleen release-administratie en de bestaande CI-ledger/lesson/branch-logdocumentatie; geen package-runtimecode.

## 2026-07-18 14:05 — Dev-tooling init-fout + zombie-poort luid + zelf-verklarend

**User prompt:** debug van een andere AI aangeleverde bug (alle input op `_ai`-routes geweigerd in dev); na verificatie bleek het geen framework-type-bug maar een stale/kapot dev-proces. Opdracht: maak alle foutgevoelige plekken duidelijk waarom iets fout gaat.

**Diagnose:** de opgeslagen `inputType`, `resolveRuntimeTypeText` en verse extractie klopten alle vier — geen extractie/resolver-bug. Root-cause was een dev-proces waarvan `initializeAll()` faalde → lege `devApis` → elke route dood, terwijl (a) de fout enkel een stille `warn` was en de server "up" bleef, en (b) dev-poort-auto-increment een verse restart stil naar 4101 liet hoppen terwijl het zombie-proces 4100 vasthield. Samen lieten die twee randen een tijdelijke init-fout eruitzien als een hardnekkige per-route type-bug.

**Wat ik deed (hardening, luid + zelf-verklarend):**
- Nieuw `packages/server/src/devToolsStatus.ts` — module-slot dat een `initializeAll()`-fout één keer registreert.
- `createServer.ts`: init-fout van `warn` → `error` met volledige uitleg (server up, álle /api+/sync dood, hot-reload uit, herstart nodig, oorzaak) + `markDevToolsInitFailed`.
- `createServer.ts`: poort-hop-warning legt nu uit dat een zombie-proces de oude poort vasthoudt en dat clients gepind op die poort met het OUDE proces blijven praten.
- `apiRoute.ts` + `syncRoute.ts`: bij een geregistreerde init-fout een `503` met de echte oorzaak in `detail`, i.p.v. een misleidende 404 op een lege registry.
- Regressietests: `devToolsStatus.test.ts` (3) + 2 cases in `apiRoute.test.ts` (503-met-oorzaak + healthy-dev-passthrough).

**Verificatie:** `vitest` 11/11 groen, `npm run lint` schoon, `npm run ai:lint` geen invariant-violations, `npm run build` exit 0.

**Report-only (niet gefixt):** `docs/runtime-type-resolver.md:209` zegt dat de resolver-error in dev een *soft-pass* hoort te zijn, maar de code doet (terecht, fail-closed) een hard reject — doc-drift, code is correct.

**Files:** `packages/server/src/devToolsStatus.ts` (nieuw), `packages/server/src/devToolsStatus.test.ts` (nieuw), `packages/server/src/createServer.ts`, `packages/server/src/httpRoutes/apiRoute.ts`, `packages/server/src/httpRoutes/syncRoute.ts`, `packages/server/src/httpRoutes/apiRoute.test.ts`.

**Niet gecommit** — wacht op de gebruiker.

## 2026-07-18 14:35 — v0.7.1 gepubliceerd via GitHub CI met provenance

**User prompt:** doe zelf alle checks en tests om 100% te weten dat dit niks breekt en publish het dan als 0.7.1 via GitHub CI.

**Wat ik deed:** volledige CI-gate lokaal gerepliceerd (generateArtifacts, build:packages, lint, lint:packages, build, test:unit, audit, pack:dry, changelog-check). Eén lokale test-fail was een load-timeout in een devkit `ts.Program`-fixture (geïsoleerd 114/114 groen; op de schone CI-runner ook groen) — niet mijn server-only change. Server-CHANGELOG-entry toegevoegd, `npm run bump patch` (0.7.0 → 0.7.1 lockstep, 17 packages), lockfile gesynct via `npm install --package-lock-only`. Release-commit `169e526` op main gepusht, annotated tag `v0.7.1` gepusht → publish-workflow `29644471713` volledig groen incl. real publish met provenance.

**Resultaat:** 17/17 packages op npm @ 0.7.1; `@luckystack/core@0.7.1` en `create-luckystack-app@0.7.1` dragen SLSA-provenance-attestaties. Andere repos kunnen upgraden naar 0.7.1.

**Files:** release-administratie (17× package.json + package-lock.json), `packages/server/CHANGELOG.md`, plus de eerder in deze branch beschreven server-hardening.

## 2026-07-18 20:15 — v0.7.2: tryCatchSync ontbrak in de core client-barrel

**User prompt:** bug-rapport (extern): `tryCatchSync` zit wel in de server-barrel maar niet in de client-barrel, terwijl hij al naar de browser verscheept wordt. Fix + guard, daarna publiceren als 0.7.2.

**Wat ik deed:** claim geverifieerd in de source. De aangeleverde redenering ("zijn broertje `tryCatch` staat er wél in") bleek onjuist — `client.ts:23` exporteert `tryCatch` uit een APARTE `./tryCatchClient`, bewust, omdat de server-variant `node:async_hooks` de clientbundle in sleept. Wat de fix wél rechtvaardigt: `tryCatchSync.ts` heeft nul imports, en `offlineQueue.ts:4` + `apiRequest.ts:12` importeren hem al. Eén export-regel toegevoegd.

Voor de guard heb ik de voorgestelde regel eerst GEMETEN: "elke export in beide barrels tenzij SERVER_ONLY" gaf 63 hits (bijna allemaal terecht server-only) — die allowlist zou een reflex worden. Gekozen voor "zit al in de client-import-closure": 35 hits met `tryCatchSync` bovenaan, dus precies de bugklasse. Parity matcht op NAAM, niet op module, zodat de bewuste `tryCatch`→`tryCatchClient`-split blijft slagen. Bewezen dat de guard faalt zonder de fix.

**Verificatie:** volledige unit-suite 1824/1824, core 274/274, lint + ai:lint schoon, build:packages 17/17, `dist/client.js` 0 Node builtins. Na publish op de ECHTE tarball gecontroleerd (niet de workspace-symlink, die wees naar mijn eigen build): `@luckystack/core@0.7.2` `dist/client.d.ts` exporteert `tryCatchSync`, 0 `node:` builtins. Publish-run `29655389235` groen; 17/17 op npm met SLSA-provenance.

**Files:** `packages/core/src/client.ts`, `packages/core/src/barrelParity.test.ts` (nieuw), `packages/core/CHANGELOG.md`, `packages/core/CLAUDE.md`, release-administratie (17× package.json + lockfile).

## 2026-07-20 06:30 — v0.7.3 gepubliceerd: stale-port bugklasse (CORS + logging + OAuth)

**User prompt:** meerdere checks doen om zeker te weten dat het klopt; ports config moet altijd voorrang hebben, daarboven de auto-increment-regel, logging moet overal kloppen, en OAuth moet altijd de nieuwste poort weten — dan publiceren als 0.7.3.

**Wat ik deed (na de sweep van de vorige sessie):**
- Fix 1 (`createServer.ts`): `registerBindAddress` opnieuw aangeroepen in de listen-callback met de ECHT gebonden poort → `getBindAddress()` waarheidsgetrouw → CORS same-origin klopt na een hop.
- OAuth volgt nu de nieuwste poort (kernwens): nieuwe core-helper `resolveDevCallbackUrl` herschrijft de localhost-poort van een OAuth-callback naar de gebonden poort. Toegepast op BEIDE chokepoints — authorize (`authApiRoute.ts:155`) én token-exchange (`login.ts`) — zodat de twee redirect_uri's byte-identiek blijven (OAuth-eis; getBindAddress is proces-constant). Default-poort-collaps + prod no-op afgedekt.
- Drift-waarschuwing herzien: framework richt OAuth nu op de gebonden poort; de resterende handmatige stap (provider-registratie) wordt luid benoemd.
- Fix 4/5 (scripts): gedeelde `resolveTestBaseUrl()` volgt `dev-server.json` in 5 test-scripts; `testLoginFlows.mjs` is nu een echte drift-detector i.p.v. assert op :80; `cluster.ts` pint `SERVER_PORT_AUTO_INCREMENT=0`.

**Geverifieerd:** prioriteitsketen `options.port > argv > ports.backend > SERVER_PORT > 80` + auto-increment erboven; logging-audit (enige startup-regel gebruikt de echte poort); volledige unit-suite 1837/1837; build:packages 17/17; lint + ai:lint schoon; tsc 0 errors; end-to-end via de gebouwde dist (hop :80→:84 volgt). Na publish op de ECHTE tarball bevestigd: `core@0.7.3` exporteert `resolveDevCallbackUrl`. Publish-run 29721633473 groen; 17/17 op npm met SLSA-provenance.

**Bewust NIET gedaan (root sample-app-only, niet shipped):** root vite-proxy-rewrite (zou de `?backend=` multi-instance escape hatch slopen) en de module-load-capture in `luckystack/login/oauthProviders.ts` (geen template-equivalent; fixt de poort-bug niet).

**Files:** core (`bindAddress.ts` + test + `index.ts`), server (`createServer.ts`, `authApiRoute.ts`, `listenServer.test.ts`), login (`login.ts`), 3× CHANGELOG, scripts (`resolveTestBaseUrl.ts` nieuw, `cluster.ts`, 5 test-scripts, `testLoginFlows.mjs`), release-administratie.
