# Branch log — feat/orm-aware-cli

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
