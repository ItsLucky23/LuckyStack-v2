# Branch log — fix/dropdown-positioning

## 2026-07-22 20:13 — Eerste dropdownopening betrouwbaar gepositioneerd

**User prompt (summary):** Fix dat Dropdown en MultiSelectDropdown bij de eerste opening geregeld verkeerd staan en pas na sluiten en opnieuw openen correct worden gepositioneerd.

**What I did:** de gedeelde dropdownhook seedt nu vóór portalmount de actuele triggerbreedte en -positie, zodat de eerste hoogtemeting niet langer tegen de initiële `width: 0` gebeurt. Positie-updates worden per animation frame gebundeld; trigger-, menu- en lijst-resizes, native/window- en visual-viewportscroll/resize en anchorverplaatsingen door layout shifts of CSS-transforms starten een nieuwe meting. Ongewijzigde positie-state wordt behouden om onnodige renders te vermijden. De root-dogfoodcomponent en verse scaffold zijn gelijk bijgewerkt; een regressiecontract bewaakt beide implementaties en gedeeld gebruik door Dropdown en MultiSelectDropdown.

**Files touched:** `src/_components/dropdownInternals.tsx`; `packages/create-luckystack-app/template/src/_components/dropdown/dropdownInternals.tsx`; nieuw `packages/create-luckystack-app/src/dropdownPositioning.test.ts`; `packages/create-luckystack-app/CHANGELOG.md`; deze branch-log en `branch-logs/INDEX.md`.

**Notes:** `.claude/settings.local.json` en het ongetrackte lege `nul`-bestand zijn niet aangepast. Geen browser gestart en geen server gestart; de gebruiker moet de visuele flow nog in de draaiende playground controleren.

**Verificatie:** dropdownregressies 7/7; volledige create-app testselectie 127/127; gerichte TypeScriptchecks voor root- en scaffold-internals groen; root- en package-lint plus `ai:lint` groen; volledige build groen (17/17 packages, TypeScript, Vite en serverbundle); `git diff --check` groen.

## 2026-07-22 20:50 — v0.7.5 release voorbereid

**User prompt (summary):** Merge de dropdownbranch en de vorige branch naar main en publiceer daarna een release; voer de benodigde commands uit.

**What I did:** bevestigd dat de vorige v0.7.4-branch al via mergecommit `134a279` volledig op `main` staat. Alle 17 publiceerbare packages en interne ranges zijn lockstep van 0.7.4 naar 0.7.5 gezet, de lockfile is met npm ververst en het create-app-changelog is als v0.7.5 gedateerd. De releasebron wordt via een PR naar `main` gebracht; pas de exacte groene main-commit krijgt de immutable annotated `v0.7.5`-tag voor de provenance-workflow.

**Files touched:** alle 17 package-manifests; `package-lock.json`; `packages/create-luckystack-app/CHANGELOG.md`; deze branch-log en `branch-logs/INDEX.md`.

**Notes:** de twee bekende moderate `@modelcontextprotocol/sdk -> @hono/node-server`-advisories blijven geaccepteerd: LuckyStack MCP is stdio-only en mount de kwetsbare HTTP static-file-handler niet. De high-auditgate is groen. `.claude/settings.local.json` en `nul` blijven uitgesloten.

**Verificatie:** 1914/1914 unit-tests; root- en package-lint groen; volledige build 17/17 plus TypeScript/Vite/server groen; 17/17 dry-packs op versie 0.7.5; `ai:lint`, changelog-, doc-staleness- en high-auditgate groen; lockfile bevat alle 17 workspaces op 0.7.5.

## 2026-07-22 21:17 — v0.7.5 gepubliceerd met provenance

**User prompt (summary):** Voer de merge en release volledig uit.

**What I did:** PR #5 is na groene Node 20/22-CI naar `main` gemerged. De afzonderlijke main-CI op mergecommit `9955696f2e6251f2cc0748738624090089e79e07` is eveneens volledig groen. De annotated tag `v0.7.5` is exact op die commit gezet en heeft publishrun `29949496394` gestart; de echte publishstap met npm provenance is geslaagd.

**Files touched:** post-release alleen deze branch-log en `branch-logs/INDEX.md`; de releasecode staat onder de immutable `v0.7.5`-tag.

**Notes:** tagobject `60bb2153d00a880fdf231ff2e0e8b11c7a832b47` peelt naar main/releasecommit `9955696f2e6251f2cc0748738624090089e79e07`. De tag is niet verplaatst en branches zijn niet verwijderd. `.claude/settings.local.json` en `nul` bleven onaangeraakt.

**Verificatie:** alle 17 npm-packages rapporteren 0.7.5; SLSA-provenanceattestaties bevestigd voor `@luckystack/core@0.7.5` en `create-luckystack-app@0.7.5`; PR-CI, main-CI `29948991023` en publishrun `29949496394` zijn groen.
