# Branch log — perf/ts7-parallel

## 2026-10-14 00:30 — TypeScript 7-toolchain en één threadbudget voor lint, typecheck en build

**User prompt (summary):** de CPU benutten: ESLint, typecheck (tsgo) en de Vite/esbuild-bundels tegelijk laten draaien, met de upgrade naar TypeScript 7 (handoff `handoffs/2026-10-13/HANDOFF.md`). Keuzes van de gebruiker: devkit nu porten naar de 7.1-API en meepubliceren, scaffoldtemplate mee inclusief upgradestappen, per-bestand `.d.ts` mits het publieke type-oppervlak gelijk blijft, Tailwind-scan afbakenen (ook in de template), `eslint-plugin-react-x` naar 5.x en de waarschuwingen oplossen, `npm run verify` als gate in AGENTS.md. Pushen wel, publiceren niet (npm-token verlopen).

**What I did:** TypeScript gesplitst naar rol (ADR 0067): `@typescript/native` (7.0) doet typecheck en declaraties, `typescript` is een alias van `@typescript/typescript6` voor typescript-eslint en tsup. Declaraties van 15 pakketten uit één `tsc -b tsconfig.packages.json` in plaats van tsup-`dts` in zes golven; relatieve specifiers in de `.d.ts` krijgen `.js`. `scripts/{threadBudget,withThreads,runParallel}.mjs` verdelen één budget (`LUCKYSTACK_MAX_THREADS`) over lint (geheugen-gecapt), tsc, vite, esbuild en vitest; `npm run verify` draait ze tegelijk en is de CI-stap. Devkit (aparte worktree/lane, daarna gemerged) gebruikt de TypeScript 7.1-API met één compilerproces per generatierun. Tailwind scant alleen `src/` + pakketbronnen (CSS 7,5 MB → 42 KB); de template scant ook `node_modules/@luckystack/*/dist`. `stableTypeOrdering` houdt de generatoroutput gelijk aan TS 7.

**Notes / decisions:**
- Doodlopende paden: een Tailwind-`@source` met alleen een mapwildcard matcht niets (glob met extensies nodig); zonder `.js` in de `.d.ts` worden onder NodeNext + `skipLibCheck` alle LuckyStack-types stil `any`; de eerste regex-specifierfix raakte commentaar, daarom `ts.preProcessFile`. Na `npm install` wees `.bin/tsc` naar een meegetrokken TypeScript 6.0.3 (installatievolgorde), daarom roepen alle scripts TS 7 via pad aan.
- `eslint-plugin-react-x` 1.x weigerde de TS 6-alias (npm ERESOLVE in de scaffold); 5.x werkt op ESLint 9. Twee meet-vóór-paint `useLayoutEffect`s kregen een onderbouwde suppressie; de dropdown-paritytest negeert lintdirectieven omdat de root-app react-x niet laadt.
- Het commit-hookbestand stond sinds aanmaak als niet-uitvoerbaar in git en draaide dus nooit op Linux/macOS; nu `100755`.
- `e2e:verdaccio` liet na elke lokale run verdaccio op poort 4873 achter (alleen de `sh -c`-wrapper werd gestopt). Nu eigen procesgroep per kind en `kill -TERM -- -<pgid>`, plus Ctrl+C-afhandeling; geverifieerd met een volledige run en een onderbroken run (lesson 0023). De `.bin/tsc`-valkuil staat in lesson 0024.
- Generatoroutput: 8/8 bestanden byte-gelijk aan de stable-order-golden; snapshot alleen herordend. Publiek type-oppervlak: 1164 exports vergeleken, 0 verschillen.

**Verification:** `npm run verify` koud groen (lint 0 problemen, typecheck, build 18/18, unit **2189/2189**, 213 bestanden), `pack:dry`, `ai:changelog-check`, `ai:lint`, `ai:check-ids -- --backrefs` groen, 0 achterblijvende TypeScript-processen. Scaffold uit lokale registry: install, typecheck, build en `verify` groen. Meting (één stap tegelijk; machine "na" zwaarder belast, load 15–27 tegen 5–15):

| Stap | Voor | Na |
|---|---|---|
| generateArtifacts | 29,0 s · 755 MB | 14,0 s · 272 MB |
| typecheck (geforceerd) | 58,4 s | 4,9 s |
| lint app + pakketten | 104,9 s · 2,5 GB | 76,9 s · 8,6 GB (5 workers) |
| build:packages | 34,1 s | 5,3 s |
| vite build | 197,3 s | 2,9 s |
| unit tests | 29,4 s | 34,6 s (load 21) |
| hele gate | ~453 s na elkaar | **68,2 s** `verify` koud · piek 7,9 GB |

**Files touched:** `package.json`, `package-lock.json`, `tsconfig*.json`, `packages/*/{tsconfig.json,tsup.config.ts,CHANGELOG.md}`, `packages/devkit/src/**` (o.a. nieuw `typeMap/tsApi.ts`), `scripts/{buildPackages,fixDeclarationSpecifiers,threadBudget,withThreads,runParallel,help}.mjs`, `vitest.config.ts`, `src/index.css`, `packages/create-luckystack-app/template/**`, `.github/workflows/ci.yml`, `.githooks/pre-commit` (modus), `scripts/e2eVerdaccio.mjs`, `AGENTS.md`, `docs/DEVELOPER_GUIDE.md`, ADR 0067, lessons 0023–0024.

**Remaining:** niet gepubliceerd (npm-token verlopen; ook v0.10.2 wacht nog). Devkit hangt aan een 7.1-dev-build met exacte pin; de 7.1-`PropertySignature.type`-declaratie klopt niet (4 guards met suppressie). Rootcommentaar in `eslint.official.config.js` beweert dat react-x 3.x+ ESLint 10 vereist; 5.x draait in de scaffold op ESLint 9 — herintroductie in de root-app is een losse keuze.
