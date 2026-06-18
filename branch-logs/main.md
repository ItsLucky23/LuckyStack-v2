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
