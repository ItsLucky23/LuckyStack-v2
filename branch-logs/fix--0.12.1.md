# Branch log — fix/0.12.1

## 2026-10-15 13:40 — Bun + SQLite, e-mailbevestiging (release 0.12.1)

**User prompt (summary):** na de 0.12.0-release: "1. akkoord. 2. ja. 3. ja. 4. ja." — (1) Bun mag `better-sqlite3` bouwen, (2) de bevestigingspagina met knop ook in nieuwe projecten, (3) `npm ci` in de hoofdcheckout, (4) eslint-10-werk opruimen. "eerst de rest afronden en zorgen dat 0.12 goed online komt".

**What I did:**
- Bun: `bun install` draait alleen installatiescripts van pakketten in `trustedDependencies`; zonder `better-sqlite3` daarin bouwde de native binding niet en crashte een `--pm=bun` SQLite-project bij de eerste query (Node) en maakte `db:push` geen tabellen. Scaffolder voegt `better-sqlite3` toe aan de bestaande lijst (`@prisma/client`, `prisma`, `sharp` uit `cbd5592`) voor drizzle- én mikro-orm-SQLite (`@mikro-orm/better-sqlite` hangt aan hetzelfde pakket). `switch-orm` voegt/verwijdert alleen die ene naam en laat eigen items staan.
- E-mailbevestiging: template- en CLI-assetkopie van `settings/confirm-email/page.tsx` bevestigden direct bij openen, zodat een linkvoorvertoning het eenmalige token kon opmaken; nu de knopversie van de referentie-app (+ 2 vertaalsleutels in 4 talen). In alle drie de kopieën de kop "Email updated" vóór de klik weggehaald.
- Onderweg gevonden en gefixt: core-standaard `auth.emailChangeConfirmPath` was sinds v0.2.0 `/confirm-email-change`, een route die geen project heeft — elke bevestigingsmail linkte naar een niet-bestaande pagina. Nu `/settings/confirm-email`.

**Notes / decisions:**
- De eerste `dev` in de verse worktree crashte (`@luckystack/server/dist/parseArgv.js` ontbrak): `npm ci` bouwt de pakketten niet. Na `build:packages` + `dev restart` gezond. Volgorde, geen codefout.
- Niet gefixt, gemeld: (a) maillinks in branch-omgevingen wijzen naar `localhost:5173` omdat `dev` wel `EXTERNAL_ORIGINS` maar niet `DNS` zet (machine-instelling); (b) na "server emitted logout" logt React één keer "createRoot() on a container that has already been passed" (niet bij een verse lading).
- Twee identieke paginakopieën gezet met `cp`, niet met de Edit-tool.

**Verification:** regressietests: `switchOrm.test.ts` (toevoegen/behouden/verwijderen `trustedDependencies` + pariteit), `drizzleSqliteRuntime.test.ts` (echte `applyOrmChoice` op een templatekopie, 4 varianten), `assetParity.test.ts` (pagina wacht op klik, sleutels in alle locales, standaardpaden wijzen naar bestaande pagina's) — falen aantoonbaar op de oude pagina. `npm run verify` groen (unit **2249/2249**), `lint:packages`, `audit:production`, `ai:changelog-check`, `ai:lint`. e2e: Bun + drizzle-SQLite `--runtime=both` ALL GREEN (was rood: ontbrekende binding + "no such table"). Browser (agent-browser, wegwerpaccount in de branch-DB): e-mailwijziging aangevraagd → link in de consolemail wijst naar `/settings/confirm-email` → openen toont alleen de knop → klik bevestigt en logt uit → tweede keer openen "link ongeldig" → inloggen met het nieuwe adres werkt.

**Files touched:** `packages/core/{src/projectConfig.ts,CHANGELOG.md}`, `packages/create-luckystack-app/{src/index.ts,src/drizzleSqliteRuntime.test.ts,template/src/settings/confirm-email/page.tsx,template/src/_locales/*.json,CHANGELOG.md}`, `packages/cli/{src/commands/switchOrm*.ts,src/assetParity.test.ts,assets/login/src/settings/confirm-email/page.tsx,CHANGELOG.md}`, `src/settings/confirm-email/page.tsx`, 17 × `package.json` (0.12.1), `package-lock.json`.

**Runtime / remaining:** branch-omgeving `https://fix-0121-luckystack-v2.keetlerop.nl` (frontend 5181, backend 4105, Mongo 27102, Redis 6412). Daarna: commit, tag `v0.12.1`, publicatie volgen, opruimen.
