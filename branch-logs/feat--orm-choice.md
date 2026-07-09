# Branch log — feat/orm-choice

## 2026-07-09 09:40 — Fase 1b: ORM-dimensie in de wizard (prisma/none) + runtime-seams (ADR 0020)

**User prompt:** vervolg fasering: de ORM-keuze in de scaffold-wizard, met 'none' als hook-gebaseerde bring-your-own-data-layer (user-besluit: duidelijke error die naar het registratiebestand wijst i.p.v. een kapot project). Branch gestapeld op feat/scaffold-manifest.

**Wat ik deed — runtime-seams (core/server):**
- `packages/core/src/db.ts`: het statische waarde-import van `@prisma/client` vervangen door een **lazy `createRequire`-load** in de default-resolver (type-import blijft, wordt geërased). Ontbreekt het package én is er geen `registerPrismaClient` → duidelijke actionable error die naar `luckystack/core/clients.ts` wijst (i.p.v. een kale ERR_MODULE_NOT_FOUND bij boot). Nieuw: `isPrismaClientResolvable()`.
- Nieuw `packages/core/src/dbHealthCheck.ts`: `registerDbHealthCheck` registry (+ get/is/reset) — pluggable `/readyz`-database-probe.
- `packages/server/src/httpRoutes/healthRoutes.ts`: `/readyz` gebruikt nu (1) de geregistreerde probe, anders (2) de ingebouwde Prisma-ping mits Prisma aanwezig (registered of resolvable), anders (3) `'skipped'` — een bewust DB-loos project kan nu wél ready worden (was: permanent 503). Response: `checks.database` = tri-state; `checks.prisma` behouden voor compat.
- Tests: `dbHealthCheck.test.ts` (registry + resolvable-probe). core+server builds groen, 351 tests groen.

**Wat ik deed — wizard (create-luckystack-app):**
- Nieuwe dimensie `orm: ['prisma','none']` als EERSTE wizard-stap (mechanische kloon van het dbProvider-patroon): PROVIDER_OPTIONS + ScaffoldChoices + DEFAULT_CHOICES (`prisma`) + `--orm=`-flag + WizardStep + non-TTY-fallback + help-tekst. 'drizzle' is de geplande volgende entry (template-variant, geen architectuur).
- Constraint (ADR 0020): `orm:'none'` ⇒ `authMode:'none'` afgedwongen op alle drie de resolutiepaden (wizard-skip van db/auth/oauth-stappen, `convertAnswersToChoices`, `normalizeChoices` voor `--no-prompt`); default-UserAdapter is Prisma-backed.
- `pruneOrmNone`: verwijdert `prisma/` + `scripts/prismaWithSecrets.ts`; dropt `@prisma/client` (deps), `prisma` (devDeps) en de drie `prisma:*`-scripts; vervangt `functions/db.ts` door een export-je-eigen-client-shim (wordt `functions.db.*` — géén casts nodig) en `luckystack/core/clients.ts` door een stub met `registerDbHealthCheck`-/Redis-voorbeelden; vervangt config.ts's `import type { User } from '@prisma/client'` door een lokale placeholder-type (SessionLayout blijft compileren).
- `PRISMA_INIT_CMD` template-var + `printNextSteps` orm-bewust (incl. 5-punts bring-your-own checklist: functions/db.ts, registerDbHealthCheck, .env.local, Redis blijft verplicht, auth-later-vergt-Prisma-of-custom-adapter); `runPrismaGenerate` geskipt bij none.
- `packages/cli/commands/update.ts` `choicesToFlags`: `orm` → `--orm=` (anders zou `luckystack update` een orm-none-project mét Prisma re-renderen) + testfix.
- Tests: `--orm` parse/exit-2 + CFG01_NULLS bijgewerkt; scaffolder+cli suites 230/230 groen.
- Runtime-smoke: echte `--orm=none --no-prompt` scaffold → géén prisma-sporen (dir/dep/devdep/scripts 0), config-User-type lokaal, beide hook-stubs aanwezig, checklist geprint, manifest registreert `orm:none`+`auth:none` (216 files).
- Docs: create-luckystack-app CLAUDE.md (flag + ScaffoldChoices), core CLAUDE.md (nieuwe exports; eerste poging via PowerShell-replace verminkte de encoding — hersteld via git en met de Edit-tool gedaan: Rule 9 bevestigd), server CLAUDE.md + docs/http-routes.md (readyz tri-state).

**Files touched:** packages/core/src/{db.ts,dbHealthCheck.ts,dbHealthCheck.test.ts,index.ts}, packages/core/CLAUDE.md, packages/server/src/httpRoutes/healthRoutes.ts, packages/server/{CLAUDE.md,docs/http-routes.md}, packages/create-luckystack-app/src/{index.ts,index.test.ts}, packages/create-luckystack-app/CLAUDE.md, packages/cli/src/commands/{update.ts,update.test.ts}.

**Notes:** BEWUSTE scope (in taak #3): drizzle-optie + manage-CLI ORM-wissel uitgesteld — drizzle = template-variant + per-ORM schema/scripts (eigen pass); ORM-wissel via manage vergt de transitie-planner en is nu ontgrendeld door het scaffold-manifest. Boot-hard-error bij "feature vereist DB" (bijv. login aan zonder client) zit impliciet: login+orm-none is op wizard-niveau onmogelijk; `luckystack add login` op een orm-none project waarschuwt nog NIET — genoteerd als aandachtspunt voor de verdaccio-e2e. Consumer-tsc zonder @prisma/client leunt op `skipLibCheck` voor core's d.ts — expliciet te verifiëren in de e2e (taak #5).
