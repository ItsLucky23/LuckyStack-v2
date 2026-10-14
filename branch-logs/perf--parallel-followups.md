# Branch log — perf/parallel-followups

## 2026-10-14 15:45 — Wat nog op één core draaide: type-generatie, verify-verdeling, publiceren, e2e-start

**User prompt (summary):** onderzoeken welke grote processen (>1 s) nog niet parallel draaien, en de vier voorgestelde verbeteringen doorvoeren.

**What I did:**
- Elk script >1 s los gemeten (wandtijd en CPU-tijd → gemiddeld aantal gebruikte cores).
- `generateArtifacts` draait zijn twee onafhankelijke generatoren tegelijk; Prettier formatteert in hetzelfde proces in plaats van via `npx` en is een devDependency (root en template).
- `verify` verdeelt de threads 2/1/1/8 (lint/typecheck/build/unittests) in plaats van 4/2/1/4.
- `splitThreads` deelde op kleine machines meer threads uit dan het budget; hersteld met test.
- `publishPackages.mjs` publiceert de pakketten binnen een golf tegelijk; vanuit een terminal blijft een echte publicatie standaard sequentieel vanwege mogelijke OTP-vragen.
- De e2e-poortcheck heeft een time-out van 2 s.

**Notes / decisions:**
- Lint schaalt in deze repo niet voorbij ~2–3 workers: koud ~44 s met 2, 3 of 5 threads (met 5 zelfs ~50 s). De threads gaan daarom naar Vitest. Koud blijft lint het kritieke pad.
- De onverklaarde 143 s in de e2e was de poortcheck: op WSL met mirrored networking blijft een connect naar een vrije 127.0.0.1-poort onbeantwoord tot de SYN-retries op zijn (lesson 0026).
- Prettier in-process geeft byte-identieke uitvoer aan de `npx prettier`-run.
- Bewust niet veranderd: de live testsuite (serieel vanwege rate limits en volgordefouten), de integratietests (wachten op Redis, al parallel per bestand), het lege npm-cache van de e2e-installatie (correctheid boven snelheid).

**Verification:**
- `generateArtifacts` ~6,0 → 3,3 s (3 runs).
- Fase van `verify`: koud 50,2 → 44,0 s, warm 28,4 → 20,8 s, gemeten naast de huidige verdeling onder dezelfde belasting.
- Publiceren dry-run 19,4 → 10,1 s.
- e2e 270 s (127 s als poort 4873 toevallig snel weigerde) → 120 s met poort 4873 in de hangende toestand; oude vs nieuwe probe op een hangende poort: >20 s vs 2,0 s.
- `verify` groen (unit 2208/2208), `pack:dry`, AI-checks, e2e ALL GREEN.

**Files touched:** `package.json`, `package-lock.json`, `scripts/{generateTypeMaps.ts,threadBudget.mjs,publishPackages.mjs,e2eVerdaccio.mjs}`, `packages/create-luckystack-app/template/{package.json,scripts/generateTypeMaps.ts,scripts/threadBudget.mjs}`, `packages/create-luckystack-app/src/parallelScripts.test.ts`, `packages/create-luckystack-app/CHANGELOG.md`, lesson 0026.

## 2026-10-14 17:10 — Lint op 3 workers; react-x terug in de root-app

**User prompt (summary):** react-x volgens advies terugzetten (apart, na de parallel-verbeteringen).

**What I did:**
- **Lint-cap:** ESLint gaf zelf `ESLintPoorConcurrencyWarning`. Koude lint per aantal workers gemeten; `withThreads.mjs` kreeg `--max-threads`, en lint in repo en template gebruikt er 3.
- **react-x:** stond sinds juni uit de root-config, omdat de ESLint-9-lijn TypeScript op 5.x begrensde. 5.26.5 accepteert elke ESLint en TypeScript (de template draaide er al op), dus weer aan. 6 waarschuwingen, geen fouten, opgelost:
  - Navbar en playground zetten state niet meer in een effect, maar tijdens render bij een gewijzigde waarde;
  - dropdown en floating layer kregen dezelfde onderbouwde suppressie als de template;
  - `SessionProvider` kreeg de bestaande suppressie ook voor react-x;
  - `useTheme` kreeg een interne hernoeming.

**Notes / decisions:** de state-wijzigingen in Navbar/playground zijn gedragsgelijk (reset bij route- resp. sessiewijziging), alleen zonder extra render met de oude waarde. Niet in een browser gecontroleerd.

**Verification:** lint koud 1/2/3/4/6 workers: 41,3/31,7/29,3/31,6/34,9 s, CPU 63/92/124/177/239 s, piekgeheugen 2,8–9,4 GB. Volledige `verify` koud 55,5 → 52,0 s, warm 35,4 → 28,6 s (drukkere machine dan de eerste meting). `verify` groen (unit 2211/2211), lint 0 meldingen, `pack:dry`, AI-checks.

**Files touched:** `scripts/withThreads.mjs` (+ templatekopie), lint-scripts in beide `package.json`, `eslint.official.config.js`, `package.json`/`package-lock.json` (react-x), `src/_components/{Navbar,dropdownInternals}.tsx`, `src/_components/inputs/floatingLayer.tsx`, `src/_providers/SessionProvider.tsx`, `src/playground/page.tsx`, `packages/core/src/react/useTheme.ts`, changelog en test van create-luckystack-app.
