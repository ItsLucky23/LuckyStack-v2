# Branch Log — fix/routed-http-method-map-bootstrap

## 2026-07-27 23:15 — Routed HTTP methodemap structureel geregistreerd

**User prompt (summary):** Repareer nu frameworkbreed dat routed HTTP zonder geregistreerde gegenereerde methodemap routes zoals `organization` foutief als POST aanroept.

**Wat ik deed:** De scaffold- en referentie-appwrapper registreren nu `apiMethodMap` uit `apiTypes.generated.ts` vóór zij `apiRequest` exporteren. Core-methodeselectie heeft een regressie voor een expliciete GET-route waarvan de naamheuristiek POST zou kiezen; scaffoldtests bewaken zowel de nieuwe-projecttemplate als de frameworkreferentie. API/bootstrapdocumentatie en core/scaffolderchangelogs beschrijven het verplichte runtimecontract. Bestaande projecten ontvangen deze framework-authored wrapper via `luckystack update --app`, met de bestaande sidecarveiligheid voor gewijzigde bestanden.

**Verificatie:** gerichte regressies 4/4; volledige unit-suite 1975/1975; TypeScript, root/package/AI-lint en changelog/doc-stalenesschecks groen; alle 17 packages en de rootapp gebouwd.

**Files:** core methodeselectie/test/docs/changelog; create-luckystack-app wrapper/test/changelog; root `src/_sockets/apiRequest.ts`; API-architectuurdoc; lesson 0015.

**Notes:** Niet gepubliceerd. Een schone artifactvrije worktree legde daarnaast bloot dat Prisma Client vóór route-typegeneratie nodig is; dit is apart vastgelegd als lesson 0015 en niet buiten scope stil gerepareerd.

## 2026-07-27 23:45 — v0.8.3 release voorbereid

**User prompt (summary):** Publiceer de methodemapfix wanneer de volledige verificatie zekerheid geeft.

**Wat ik deed:** Alle 17 packages lockstep naar `0.8.3` verhoogd, interne LuckyStack-ranges en lockfile bijgewerkt, core/scaffolderchangelogs gedateerd en de capability-index vernieuwd. De nieuwe versie bevat uitsluitend de reeds geïsoleerde methodemapbootstrapfix plus releasemetadata.

**Verificatie:** build 17/17 + rootapp; 1975/1975 unittests; root/package/AI-lint schoon; productie-audit, changelog- en doc-stalenesschecks groen; `pack:dry` en `publish:dry` valideerden 17/17 packages.

**Files:** 17 packageversies/interne ranges, `package-lock.json`, core/scaffolderchangelogs, capability-index en branchlog/index.

**Notes:** Klaar voor protected fast-forward, additieve `v0.8.3`-tag en provenance-workflow. Bestaande tags en npm-artifacts worden niet herschreven.
