# Branch log — feat/orm-aware-cli

## 2026-07-11 15:40 — Bidirectionele ORM-switch als manage-wizard-stap (elke ORM → elke ORM)

**User prompt:** "we willen dat iedere stap op elkaar kan inspelen dus maakt niet uit welke ORM we altijd alles omtrent die ORM updaten … en ook bij andere items zoals de sentry tooling … dat we kunnen switchen naar posthog of whatever."

**Wat ik deed:**
- **`commands/switchOrm.ts` (nieuw)**: de daadwerkelijke switch, fresh-render-based (zelfde seam als `luckystack update` — `renderScaffoldToTemp` is de single source of truth voor file-inhoud én dep-VERSIES; de CLI heeft alleen naam-tabellen `ORM_SURFACES`). Per switch: package.json deps/scripts/pkgKeys van de oude surface eruit, nieuwe erin met versies uit de render; actieve shims (`functions/db.ts`, `luckystack/core/clients.ts`) vervangen mét `.orm-<from>.bak` backup; starters copy-if-absent; config.ts `User`-type BEIDE kanten op (prisma-import ↔ het placeholder-blok uit de render — nooit een niet-compilerende halfstaat; tussen twee non-prisma ORMs: no-op); per-ORM UserAdapter-starter als login geïnstalleerd is; manifest `choices.orm`/`dbProvider` bijgewerkt; oude-ORM-leftovers NOOIT verwijderd, wel gerapporteerd.
- **`transitions.ts`**: `DesiredConfig.orm` nu editbaar + `dbProvider` erbij; nieuw `planOrm` draait als EERSTE in `planChanges` zodat latere stappen (auth) op de nieuwe laag landen; `planAuth` leest de DESIRED orm — switchen + auth aanzetten in één pass spelen correct op elkaar in (zelfde model als de monitoring sentry↔posthog-swap).
- **`commands/reconfigure.ts`**: ORM/data-layer als wizard-rij 0 (FIXED_STEPS=4), drizzle+mongodb → SQL-dialect-vervolgvraag; Auth-rij annoteert tegen desired.orm.
- **`lib/state.ts`**: `deriveDbProvider`/`readPrismaSchemaProvider` (manifest wint, anders schema.prisma provider-regex, anders postgresql); `ProjectState.dbProvider`.
- **Scaffolder**: `PRISMA_USER_TYPE_IMPORT` + `ORM_NONE_CONFIG_USER_TYPE` nu geëxporteerd (naast `DRIZZLE_DRIVER_DEPS`/`MIKRO_DRIVER_PACKAGES`) voor parity-guards. NB: de parity-test ving direct een échte bug — het werkboom-scaffolderbestand refereerde een niet-gedeclareerd `PRISMA_USER_TYPE_IMPORT` (non-prisma scaffolds zouden runtime crashen); declaratie toegevoegd.
- **Tests**: `switchOrm.test.ts` (fixture-render heen én terug, copy-if-absent, fail-clean zonder render, config-blok↔import) + parity-guards (tokens byte-identiek, dep-naamtabellen dekken alle scaffolder-drivers); `planOrm`-suite in transitions.test.ts; fixtures dbProvider.
- **Gates**: cli-suite 159 groen, volledige suite groen, root build, lint:packages, ai:lint groen.
- **Echte smoke** (`C:\code\ls-e2e\smoke-orm-switch.ts`, tsx): lokale dist-scaffold (prisma/mongodb) → `switchOrm` prisma→drizzle(postgresql) → drizzle→prisma met de ÉCHTE `npx create-luckystack-app@0.5.0` renderer — alle asserts groen, config.ts round-tript, detectie klopt na elke stap. De eerste smoke-run onthulde dat de heenweg het placeholder-blok niet plaatste (alleen import-verwijdering) — gefixt door het blok uit de fresh render te extraheren.

**Files touched:** packages/cli/src/commands/{switchOrm.ts,switchOrm.test.ts,reconfigure.ts,update.ts,addLogin.ts}, packages/cli/src/{transitions.ts,transitions.test.ts,transitions.apply.test.ts}, packages/cli/src/lib/{state.ts,state.test.ts}, packages/create-luckystack-app/src/index.ts, packages/cli/CLAUDE.md, packages/create-luckystack-app/CLAUDE.md.

**Notes:** email/monitoring switchten al volledig bidirectioneel via planChanges; de ORM sluit daar nu bij aan. Bewuste rest ongewijzigd: de zes Prisma-gebonden settings-routes porten naar de UserAdapter blijft een eigen vervolgronde (login-interface-beslissing). Branch is de 0.5.1-kandidaat.

## 2026-07-11 15:00 — CLI overal ORM-bewust: detectie + per-ORM starter-UserAdapter bij `add login`

**User prompt:** (na eigen test op een niet-Prisma-project, n.a.v. de add-login-warning) "ik merk dat we op veel plekken nog automatisch van prisma uit gaan … ook bij npx luckystack manage … ik wil dat de code altijd kijkt naar de orm tool die er is en daarop inspeelt."

**Inventaris vooraf:** devkit-routetemplates zijn schoon; de echte aannames: geen ORM-detectie in state/manage/list, en de zes settings-`_api`-routes in de login-assets die `functions.db.prisma` direct aanroepen.

**Wat ik deed:**
- **Centrale detectie** (`cli/lib/state.ts`): `DetectedOrm = 'prisma'|'drizzle'|'mikro-orm'|'none'`; `deriveOrm` — manifest `choices.orm` wint, anders dep-inferentie (@prisma/client → drizzle-orm → @mikro-orm/core → none); `readScaffoldOrm` (best-effort manifest-read); `orm` toegevoegd aan `ProjectState` en (niet-editbaar) aan `DesiredConfig` via `configFromState`.
- **`manage`-wizard**: header toont "Data layer: <orm>" + non-Prisma-annotatie; de Auth-rij draagt de waarschuwing; `planAuth` prepend't bij enable-auth op non-Prisma een ⚠-effect in de consequence-preview (vóór confirm, i.p.v. pas na apply).
- **`list`**: print de gedetecteerde data layer als eerste regel.
- **`add login` speelt nu écht in op de ORM**: `adaptAuthToDataLayer` schrijft (skip-if-exists) een per-ORM starter `luckystack/login/userAdapter.ts` — drizzle en mikro-orm krijgen een becommentarieerd-maar-COMPLEET adapter tegen de echte `UserAdapter`-interface (incl. `findByEmailAnyProvider`-tiebreak, `toRecord`-mapping id→string, users-table/EntitySchema-snippet, mysql-`.returning()`-caveat, Mongo-ObjectId-variant); `none` krijgt een TODO-skelet. De warning benoemt daarnaast expliciet de zes Prisma-gebonden settings-routes (`PRISMA_BOUND_SETTINGS_ROUTES`) die geport of verwijderd moeten worden.
- Tests: `deriveOrm`-suite (manifest-wint/dep-fallback/invalid-waarden) + fixtures bijgewerkt (`orm` in cfg-helpers + configFromState-verwachting). CLI-suite 149 groen; volledige suite, root-build, lint, ai:lint groen.
- Smoke met gebouwde dists: drizzle-scaffold + `add login --no-install` → starter geschreven met drizzle-inhoud, warning + routelijst bovenaan, herhaalde add idempotent; `list` toont "Data layer: drizzle (non-Prisma …)".

**Files touched:** packages/cli/src/lib/state.ts, packages/cli/src/{transitions.ts,transitions.test.ts,transitions.apply.test.ts}, packages/cli/src/commands/{reconfigure.ts,list.ts,addLogin.ts}, packages/cli/src/lib/state.test.ts, packages/cli/CLAUDE.md.

**Notes / bewuste rest:** de zes settings-routes zelf PORTEN naar de UserAdapter (i.p.v. `functions.db.prisma`) is de structurele eindfix — vergt een interface-beslissing in @luckystack/login (UserRecord kent geen `theme`; `update`-patch-typing) en raakt auth-kritieke code: als eigen vervolgronde geflagd, niet stiekem meegenomen. Dit werk is post-0.5.0 — meenemen in de volgende release (0.5.1).
