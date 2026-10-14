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
