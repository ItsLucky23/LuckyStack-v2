# Branch log — fix/prod-function-map-divergence

> Function-injection dev/prod-divergentie: de productiegenerator las `paths.serverFunctionDirs` niet en sloeg geneste sleutels plat. Zie ADR 0046 + `docs/findings/2026-08-14-prod-function-map-divergence/`.


## 2026-08-14 15:30 — Function-injection: dev/prod-divergentie structureel gedicht

**User prompt (summary):** Gebruiker meldde dat `functions.rbac.*` undefined blijft omdat de productiegenerator geen geneste sleutels kan maken, en koppelde dat aan een deployed crash op `functions.sleep.sleep(...)`. Daarna: "fix alle opgelegde en gevonden problemen in 1 keer op jouw manier zodat we zeker weten dat het straks allemaal zou moeten werken."

**Wat ik deed:** Bevestigd dat beide meldingen één generator betreffen — `scripts/generateServerRequests.ts` (+ de template-tweeling) las `paths.serverFunctionDirs` niet (dus `shared/` ontbrak volledig in élke productie-map, inclusief `tryCatch` en `sleep`) én sleutelde op `path.basename()` (dus submappen werden platgeslagen). Beide zijn lokaal onzichtbaar omdat `runtimeMapsLoader` in dev naar de devkit-loader delegeert. In plaats van de generator te patchen is discovery verplaatst naar één gedeelde bron, `packages/devkit/src/functionRegistry.ts` (`collectFunctionModules` + `renderFunctionsMap`), die nu door de dev-loader, `functionsMeta.ts` en beide productiegenerators wordt aangeroepen; de aparte walks in `loader.ts` en `functionsMeta.ts` (incl. `walkDirToIR`/`mergeIR`) zijn verwijderd. Collisions gooien nu build-time (exit 1) en waarschuwen alleen in dev via `onConflict`. Twee meegevonden defecten meegefixt: `areEquivalentFunctionEntries` vergeleek namespaces shallow (zou ADR 0042 één niveau dieper opnieuw breken zodra de map nest) en de type-generator negeerde het `RoutingRules.ignore`-predicaat. ADR 0046, lesson 0016 en een gedateerde findingsledger toegevoegd.

**Verificatie:** 16 nieuwe registry-tests + 2 nieuwe loader-tests groen; volledige unit-suite 1993/1993; root- + package-lint schoon; 17/17 packages + rootapp gebouwd. End-to-end bewezen: productie-map ging van 4 naar 10 modules; een tijdelijke `shared/rbac/engine.ts` emitte identiek genest in `apiTypes.generated.ts` én `generatedApis.*.ts`; een bewuste duplicate faalde de build met exit 1; en de template-generator is in een écht gescaffold project gedraaid en emit daar nu `shared/sleep` + `shared/tryCatch`.

**Files:** `packages/devkit/src/functionRegistry.ts` (nieuw), `packages/devkit/src/functionRegistry.test.ts` (nieuw), `packages/devkit/src/index.ts`, `packages/devkit/src/loader.ts`, `packages/devkit/src/typeMap/functionsMeta.ts`, `packages/devkit/CLAUDE.md`, `packages/server/src/runtimeMapsLoader.ts` + `.test.ts`, `scripts/generateServerRequests.ts`, `packages/create-luckystack-app/template/scripts/generateServerRequests.ts`, ADR 0046, lesson 0016, `docs/findings/2026-08-14-prod-function-map-divergence/`, findings-index en gegenereerde AI-indexen.

**Notes:** Nog niet gepubliceerd — een consumer krijgt de fix pas na een versiebump + `npm run generateArtifacts`. Twee open, niet-meegefixte punten staan als finding 6 en 7 in de ledger: een pre-existing ongebruikte `resolveFromRoot`-import in `scripts/generateServerRequests.ts` (`scripts/` valt buiten elke lint-glob), en een intermitterende full-suite-flake in `packages/test-runner/src/runAllTests.test.ts` die in isolatie en bij herhaling groen is. De hardcoded `server/functions`-scan is bewust vervallen (stond in geen enkele config, bestond in geen enkele template) — zie ADR 0046 Consequences.

## 2026-08-14 16:10 — Opruimwerk: ongebruikte import + runAllTests-flake gediagnosticeerd en gefixt

**User prompt (summary):** "fix de ongebruikte import in de generateServerRequest.ts script, ik snap het probleem niet met de runAllTests.ts" → daarna "pas de fix toe".

**Wat ik deed:** `resolveFromRoot` uit `scripts/generateServerRequests.ts` verwijderd (finding 6). Daarna de runAllTests-instabiliteit echt uitgezocht in plaats van als flake weg te schrijven: `buildAuthHeaders` doet een echte `await import('@luckystack/login')` zodra er een `authToken` is, en de test mockte die package niet — gemeten 612ms tegenover ~2ms voor elke andere case in dat bestand. Onder volle-suite-parallelisme haalde dat de 5s-timeout niet, en de blijven-hangende promise van die test schreef daarna zijn calls in de zojuist door `vi.clearAllMocks()` geleegde mocks van de vólgende test — vandaar dat test 2 een `my_cookie` las die hij nooit zette. `@luckystack/login` + `getCsrfConfig` toegevoegd aan de mocks; 612ms → 2ms. Meteen twee assertions toegevoegd voor het CSRF-header-pad, dat tot nu toe élke run stilletjes in degraded mode draaide en nergens gedekt was.

**Verificatie:** bestand 21/21 groen (was 19). Volledige unit-suite meermaals gedraaid. Lint, package-lint, ai:lint schoon; build groen; changelog-check groen na een test-runner-entry.

**Files:** `scripts/generateServerRequests.ts`, `packages/test-runner/src/runAllTests.test.ts`, `packages/test-runner/CHANGELOG.md`, findingsledger + index.

**Notes:** Tijdens de herverificatie kwam een APART, pre-existing probleem boven: `packages/devkit/src/typeMap/{wireProjectionEdges,transportInput,tsProgram}.test.ts` lopen ongeveer 1 op de 3 volle runs tegen dezelfde 5s-timeout. Bewezen pre-existing — gereproduceerd op een schone tree op HEAD met alles gestasht, en 4/4 groen in isolatie. Zelfde vorm als finding 7, maar hier is het zware werk terecht (ze bouwen het echte `ts.Program` over `tsconfig.server.json`), dus de fix is een verhoogde `testTimeout` voor de typeMap-suite en geen mock. Staat als finding 8 open geregistreerd, bewust niet meegefixt.

## 2026-08-21 — Gerebased op v0.8.4 + e2e-poort eindelijk groen

**User prompt (summary):** Recap na een week, alles pullen, docs van de remote behouden, en daarna de e2e build-stap draaien.

**Wat ik deed:** Werk van `main` naar deze branch verplaatst en gerebased op `d75fc3c` (v0.8.4). Tien conflicten, allemaal append-only docs: upstream-inhoud overal behouden, mijn entries ernaast gezet; geverifieerd met een diff op verwijderde regels t.o.v. `origin/main` (8 verwijderingen, allemaal eigen herschrijvingen of een alfabetische hersortering). ADR hernummerd 0043 -> 0046 omdat upstream 0043-0045 voor het ports-werk nam. Daarna de e2e-blokkade van vorige week opgelost: de harness scaffoldde in `os.tmpdir()`, waardoor vite `vite.config.ts` niet kon laden en stil terugviel op een pluginloze default-config — de `src/index.css`-fout was daar het symptoom van, niet de oorzaak. Werkroot verplaatst naar een ondiepe map naast de repo (binnen de repo kan niet: npm-workspaces slokt de scaffold op). Meegevonden en meegefixt: de harness meldde `ALL GREEN` met exit 0 voor een run die hij na de scaffold had afgebroken.

**Correctie op mezelf:** de `loose: true`-wijziging in `template/vite.config.ts` was niet nodig. Ik had bewezen dat de build slaagt MET die optie, maar nooit dat hij faalt ZONDER. Een A/B in een identieke scaffold bouwde beide keren groen (121 modules). Wijziging plus CHANGELOG-entry teruggedraaid; het bestand is weer byte-identiek aan upstream. Staat als finding 11 (false-positive) in de ledger.

**Verificatie:** unit 2018/2018; 17/17 packages + rootapp gebouwd; lint/package-lint/ai:lint schoon; changelog-check groen; **e2e 9/9 ALL GREEN, exitcode 0**.

**Files:** `scripts/e2eVerdaccio.mjs`, `.gitignore`, `packages/create-luckystack-app/CHANGELOG.md`, `packages/create-luckystack-app/template/vite.config.ts` (teruggedraaid), findingsledger + index, deze log.

**Notes:** Nog niet gepusht en nog niet gebumpt. De e2e zit niet in CI (`.github/workflows/` draait 'm nergens) — dat is de reden dat deze twee harnessfouten onopgemerkt konden blijven; het is niet meegefixt.

## 2026-08-21 — E2e in CI + testbestanden uitgesloten van elke import-alles-plek

**User prompt (summary):** "voeg maar aan de pipeline toe, ook wil ik het nog even hebben over het feit dat als we luckystack installen we dan niet in de luckystack folder ... hierin test files toevoegen ... het is namelijk zo dat op runtime alle files worden geimport." Daarna: "ja inderdaad testbestanden uitsluiten in bijde plekken en kijk ook op andere plekken waar dit handig is en ook waarschuwen."

**Wat ik deed:** De e2e als blokkerende job `e2e-scaffold` aan `ci.yml` toegevoegd (ubuntu, Node 22, 30 min, geen continue-on-error) — hij draaide nergens, en juist dáárom konden de twee harnessfouten van vandaag maanden onopgemerkt blijven. Daarna het overlay-vermoeden van de gebruiker geverifieerd: klopt, `bootstrap.ts` importeert elk `.ts`/`.js` in `luckystack/<pkg>/` en de bundler bakt datzelfde stel in de prod-bundle. Een sweep over alle `readdirSync`-plekken leverde drie lekke oppervlakken op — routes bleken al veilig omdat `isApiFileName` `_v1.tests.ts` niet matcht. De derde was function-injection in mijn eigen `functionRegistry.ts`: `functions/db.tests.ts` werd geïnjecteerd als `functions['db.tests']`, in dev, in de types én in de prod-map. Eén conventie in core (`isTestFile` / `isTestDirectory`), en het overlay-contract ondergebracht in één geëxporteerde `collectOverlayEntries` die zowel de runtime-loader als beide bundlers gebruiken. Genegeerde submappen worden nu gemeld in plaats van stil overgeslagen (behalve `__tests__`/`__mocks__`) — overlay-code één niveau lager draaide nooit en niets wees erop.

**Verificatie:** unit 2033/2033 (193 files, 15 nieuwe tests); 17/17 packages + rootapp gebouwd; lint/package-lint schoon. Paritytest pint de inline fallback-regex in beide bundlers aan core's `TEST_FILE_PATTERN`, zoals `OVERLAY_ORDER` dat al deed.

**Files:** `.github/workflows/ci.yml`, `packages/core/src/testFileConvention.ts` (+ test), `packages/core/src/index.ts`, `packages/server/src/bootstrap.ts` (+ `collectOverlayEntries.test.ts`), `packages/server/src/index.ts`, `packages/devkit/src/functionRegistry.ts` (+ test), `scripts/bundleServer.mjs`, `packages/create-luckystack-app/template/scripts/bundleServer.mjs`, ADR 0047, vier CHANGELOGs, `packages/{server,devkit}/CLAUDE.md`.

**Notes:** Gedragswijziging, bewust: een project dat leunde op een overlay-testbestand dat bij boot draaide, verliest dat side effect. Dat is de bedoelde correctie. De overlay-walk is NIET recursief gemaakt — dat zou een load-order introduceren die er nu niet is en voor elk bestaand project veranderen welke bestanden draaien; waarschuwen behoudt het huidige gedrag en maakt het zichtbaar. Zie ADR 0047 Rejected alternatives.
