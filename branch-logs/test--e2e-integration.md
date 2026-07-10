# Branch log — test/e2e-integration

> Integratie-branch: feat/scaffold-manifest → feat/orm-choice + feat/cron-package + debug/devtools-lag samengevoegd. Dit is de merge-kandidaat voor main.

## 2026-07-10 12:00 — Gap-scan-fixes (2 FUNDAMENTAL + medium-veegronde) + ORM-uitbreiding drizzle/mikro-orm

**User prompt:** "doe alles wat op code gebied mogelijk is, ik doe straks het laatste testen" + TS-first ORMs die mysql/sqlite/postgres/mongodb dekken erin; advies gevolgd: Prisma default, MikroORM als 4/4-TS-first, Drizzle als SQL-only optie, TypeORM bewust overgeslagen (Mongo tweederangs).

**FUNDAMENTAL-fixes (uit de adversariële gap-scan):**
1. **Prod-overlay-drift structureel gedood**: `OVERLAY_ORDER` is nu een EXPORT van `@luckystack/server` (bootstrap.ts); beide `bundleServer.mjs`-kopieën (root + template) importeren hem at-build-time met een fallback-lijst (mét `cron`) alleen voor niet-gebouwde checkouts; nieuwe `overlayOrderParity.test.ts` pint beide fallback-lijsten op de canonieke export. (De klasse: een hardcoded bundler-kopie liet cron in prod geruisloos dood.)
2. **Overlay-import-crash actionable**: `importIfExists` (bootstrap.ts) vangt de import-fout en gooit een nette error mét bestandsnaam + hint ("verwijderde je een package via `luckystack remove`? ruim de `luckystack/<feature>/`-files op") — was een kale ERR_MODULE_NOT_FOUND die de boot brickte na `remove cron`.

**Medium-veegronde:**
- **Manifest-choices-sync** (`cli/lib/manifestSync.ts`): na élke succesvolle `add`/`remove`/`manage`-apply worden de manifest-choices her-afgeleid uit de echte projectstaat (deps + env-keys; package.json vers van disk) — lost de stale-manifest-klasse op incl. het prismaWithSecrets-sidecar-scenario. Gehookt in `index.ts` runSingle + `reconfigure.ts` na de apply-loop.
- **test-runner**: `ctx.prisma` is nu een LAZY getter (customTests.ts) — orm-none projecten kunnen DB-vrije per-route tests draaien; de eager resolve brak de hele custom-fase.
- **`luckystack update`**: (a) versie-coherentie-waarschuwing (cli-versie vs geïnstalleerde @luckystack/core), (b) rapport-sectie "No longer shipped" voor safe-surface files die de nieuwe versie niet meer levert (nooit auto-delete), (c) `isTextFile` geëxporteerd t.b.v. parity.
- **`add login`-guard**: waarschuwt luid (niet-blokkerend) wanneer het project geen Prisma-data-layer heeft (manifest orm≠prisma of @prisma/client ontbreekt) — met de custom-UserAdapter-route erbij.
- **Parity-gates** (`cli/commands/updateParity.test.ts`): hash-implementatie cli ↔ scaffolder (tekst/binair + CRLF) én `choicesToFlags` ↔ scaffolder `VALID_FLAGS` — beide waren e2e-only bewaakt.
- **Dev-shutdown**: SIGINT/SIGTERM in dev dispatcht nu `preServerStop` met een 2s-cap vóór `process.exit(0)` (createServer.ts) — cron-lease komt vrij i.p.v. 30s TTL-wachten na elke herstart.
- core CHANGELOG: optional-peer-demotie (breaking voor hand-rolled projecten) + nieuwe exports gedocumenteerd.

**ORM-uitbreiding (`orm: prisma | drizzle | mikro-orm | none`):**
- Wizard: orm-stap met volledige uitleg; **twin-db-stappen** met complementaire skips (drizzle krijgt een SQL-only lijst, default postgresql); auth-stappen geskipt voor élke non-prisma (default UserAdapter is Prisma-backed) — afgedwongen op alle drie resolutiepaden. `--db=mongodb --orm=drizzle` expliciet → exit(2) met mikro-orm-hint; impliciete mongodb-default onder drizzle → stille postgresql-coerce mét melding.
- `stripPrismaSurface` (gemeenschappelijk) + `applyOrmChoice` (per ORM, aangeroepen vanuit main met de gerenderde DATABASE_URL):
  - **drizzle**: `server/db/schema.ts` (per-dialect starter-tabel), root `drizzle.config.ts` (drizzle-kit; sqlite strips file:-prefix), `functions/db.ts` met live client (node-postgres/mysql2/better-sqlite3), deps drizzle-orm ^0.44 + driver, devDeps drizzle-kit ^0.31 (+ types), scripts db:generate/migrate/push/studio, clients-stub met registerDbHealthCheck-voorbeeld.
  - **mikro-orm**: `server/db/entities.ts` via **EntitySchema** (géén decorators/reflect-metadata; mongo-variant met ObjectId/serializedPrimaryKey), `server/db/mikro-orm.config.ts` (defineConfig per driver; sqlite→dbName), `functions/db.ts` met `getOrm()`/`getEm()` (fork-per-request gedocumenteerd), deps @mikro-orm/core+driver ^6.6, devDep @mikro-orm/cli + package.json `"mikro-orm".configPaths`, script db:schema:update.
  - Files onder `server/db/` = binnen de bestaande tsconfig-include (geen tsconfig-wijzigingen).
- `PRISMA_INIT_CMD` + next-steps per ORM (checklists incl. auth-uit-uitleg + user-adapter-route); manifest registreert de orm-keuze (verifieerd).
- Smokes met gebouwde dist: app-drizzle (pg default+coerce-melding), app-drizzle-sqlite, app-mikro (mongodb, first-class) — alle structureel correct (deps/scripts/starters/manifest, 0 prisma-sporen); badcombo exit 2.

**Files touched:** packages/server/src/{bootstrap.ts,index.ts,createServer.ts}, packages/server/CLAUDE.md, scripts/bundleServer.mjs, packages/create-luckystack-app/{template/scripts/bundleServer.mjs,src/index.ts,src/index.test.ts,src/overlayOrderParity.test.ts,CLAUDE.md}, packages/test-runner/src/customTests.ts, packages/cli/{src/lib/manifestSync.ts,src/index.ts,src/commands/{reconfigure.ts,addLogin.ts,update.ts,updateParity.test.ts},CLAUDE.md}, packages/core/CHANGELOG.md, deze log + INDEX.

**Notes:** MikroORM-advies vastleggen in ADR? De keuze prisma-default + mikro/drizzle-selectie is een verlengstuk van ADR 0020 — geen aparte ADR nodig (consequences-sectie dekt de uitbreidbaarheid). User doet de finale install/runtime-tests (drizzle/mikro varianten met echte `npm install` + boot). Manage-CLI ORM-WISSEL blijft bewust volgende pass (transitie-planner; manifest-basis ligt er).
