# Branch log — test/ts7-verification

## 2026-10-14 10:00 — Grondige verificatie van de TypeScript 7-ombouw

**User prompt (summary):** de nieuwe TypeScript-ombouw (ADR 0067, al op `main`) grondig testen voordat er gepubliceerd wordt.

**What I did:** gericht getest wat de eerdere gate niet dekte, vanuit een schone `npm ci` op `main` (`d71a79c`):
- alle 326 meegeleverde `.d.ts` gescand op specifiers die bij een consument niet resolven;
- consumentmatrix met de echte tarballs (TypeScript 5.7/5.9/6.0/7.0 × bundler/node16/nodenext × `skipLibCheck` aan/uit), naast de gepubliceerde 0.10.1 als nulmeting;
- platformbinaries van de vastgepinde 7.1-dev en welke binary devkit werkelijk start;
- `verify:orm-wire`;
- een eigen branch-omgeving: live-suite en 30 hot-reloads met geheugenmeting;
- een 0.10.1-project uit npm volgens de changelog-stappen geüpgraded via een lokale registry, gebouwd en de productieserver gestart;
- `e2e:verdaccio` met `--runtime=node` en `--pm=bun`.

**Notes / decisions:**
- **Gevonden, ernstig:** `build`/`verify` draaiden `vite build` en de serverbundel als losse parallelle taken. Vite leegt `dist/` bij het schrijven, dus `dist/server.js` verdween (4/4 builds, root en template) terwijl alles exit 0 gaf; ook CI en e2e zagen het niet. Nu één taak op volgorde, plus een artefactcheck in de e2e en een unittest op de scripts (lesson 0025).
- **Gevonden:** `@luckystack/core` verwees in `db.d.ts` naar Prisma's gegenereerde `.prisma/client` in plaats van `@prisma/client` (afgeleid type). Expliciete annotatie, en de build faalt voortaan op zo'n pad.
- De upgradestap in de changelog klopte niet: `update --app` vervangt onbewerkte app-bestanden (`index.css`, dropdown) wél zelf. Tekst aangepast.
- Niet veroorzaakt door TS 7, alleen gemeld: de 7 bekende sync-demotests (`sync.noReceiversFound`, zie de 0.10.2-log); `server` heeft twee interne `.d.ts` met een type-import uit `ioredis` dat geen eigen dependency is (niet bereikbaar via een publieke entry); een `allow-scripts`-regel in de gebruikers-`~/.npmrc` laat npm 11.19 de scaffold-installatie weigeren, omdat de template geen eigen `allowScripts` heeft.
- Mijn eigen `any`-detectie in de matrix bleek onbetrouwbaar voor niet-resolvende imports (error-type is geen gewone `any`); het bewijs komt daarom uit de runs zonder `skipLibCheck`.

**Verification:** declaratiescan 0 problemen op publiek bereikbare bestanden; matrix: 0 niet-resolvende LuckyStack-imports in alle 24 combinaties, foutklassen gelijk aan 0.10.1 (alleen ontbrekende optionele peers + bestaande `ioredis`-quirk). 7.1-binaries voor linux/darwin/win32 (x64 + arm64); devkit start de geneste 7.1-binary, na `close()` geen proces. `verify:orm-wire` groen. Live: 113 geslaagd, 7 bekende fouten, 26 overgeslagen. Hot reload 30/30 in ~3 s, backend 379→385 MB, TS-proces ~505–517 MB, steeds 1 proces. Upgrade: typecheck/build/lint/verify groen, productieserver `livez`/`_health`/`readyz` 200. Unit **2205/2205** (incl. 16 nieuwe tests voor de thread- en declaratiescripts).

**Files touched:** `package.json`, `packages/create-luckystack-app/template/{package.json,scripts/help.mjs}`, `scripts/{help,e2eVerdaccio,buildPackages,fixDeclarationSpecifiers}.mjs`, `scripts/fixDeclarationSpecifiers.test.ts`, `packages/create-luckystack-app/src/parallelScripts.test.ts`, `vitest.config.ts`, `packages/core/src/db.ts`, changelogs van core en create-luckystack-app, lesson 0025.

**Runtime / remaining:** branch-omgeving via `dev` (24 uur TTL): `https://test-ts7-verification-luckystack-v2.keetlerop.nl`, frontend 5195, backend 4121, Mongo 27108, Redis 6418. Lokale registry op 4874 gestopt. Publicatie wacht op een nieuwe npm-token.
