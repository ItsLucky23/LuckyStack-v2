# Branch Log — test/release-consumer-acceptance

## 2026-07-28 20:19 — Echte consumeracceptatie blokkeert publicatie

**User prompt (summary)**: Bouw een releasegate die slechte verse installs en upgrades voorkomt voordat immutable npm-packages worden gepubliceerd.

**What I did**:
- Breidde de Verdaccio-harness uit met verse en N-1-upgradelanes via echte registry/semver-installaties.
- Voegde een routed browserfixture toe met twee backendpresets, router, Redis, adversarial GET/POST/PUT/DELETE-routes, cross-instance syncfanout, `ignoreSelf`-onderdrukking en exact één Socket.io-WebSocket.
- Bewees dat `update --app` een gewijzigd frameworkbestand bewaart en de kandidaat als `.new` sidecar levert.
- Maakte vier representatieve consumerprofielen verplicht vóór de npm-publishjob.
- Vond en repareerde via de nieuwe gate een productie-bundlebug: gegenereerde presetimports misten de `.ts`-suffix.
- Liet routed HTTP fail-closed eindigen met `api.methodMapUnavailable` als de gegenereerde methodemap ontbreekt.
- Legde de release- en methodemapkeuzes vast in ADR 0043 en 0044 en werkte architectuurdocs/changelogs bij.

**Files touched**: `.github/workflows/publish.yml`, `scripts/e2eVerdaccio.mjs`, `package.json`, `package-lock.json`, `packages/core/src/apiRequest.ts`, `packages/core/src/apiRequest.routedMethodMap.test.ts`, `packages/create-luckystack-app/template/server/server.ts`, `packages/create-luckystack-app/src/generatedPresetBundle.test.ts`, `server/server.ts`, packagechangelogs, `docs/ARCHITECTURE_{API,TESTING}.md`, `docs/decisions/0043-*.md`, `docs/decisions/0044-*.md`, gegenereerde AI-indexen.

**Notes / decisions**: Niets gepubliceerd. Unit-suite 1977/1977, lint zonder cache, 17/17 packages + rootbuild, productie-audit en doc/changelogchecks zijn groen. Echte brede fresh-, routed fresh- en aangepaste N-1-upgradeacceptatie zijn groen. De algemene `npm test`-runner vereiste een niet-beschikbare projectdatabase/server (`DATABASE_URL`) en is daarom geen geldige standalone verificatie in deze worktree.
