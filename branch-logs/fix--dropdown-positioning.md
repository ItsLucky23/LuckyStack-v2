# Branch log — fix/dropdown-positioning

## 2026-07-22 20:13 — Eerste dropdownopening betrouwbaar gepositioneerd

**User prompt (summary):** Fix dat Dropdown en MultiSelectDropdown bij de eerste opening geregeld verkeerd staan en pas na sluiten en opnieuw openen correct worden gepositioneerd.

**What I did:** de gedeelde dropdownhook seedt nu vóór portalmount de actuele triggerbreedte en -positie, zodat de eerste hoogtemeting niet langer tegen de initiële `width: 0` gebeurt. Positie-updates worden per animation frame gebundeld; trigger-, menu- en lijst-resizes, native/window- en visual-viewportscroll/resize en anchorverplaatsingen door layout shifts of CSS-transforms starten een nieuwe meting. Ongewijzigde positie-state wordt behouden om onnodige renders te vermijden. De root-dogfoodcomponent en verse scaffold zijn gelijk bijgewerkt; een regressiecontract bewaakt beide implementaties en gedeeld gebruik door Dropdown en MultiSelectDropdown.

**Files touched:** `src/_components/dropdownInternals.tsx`; `packages/create-luckystack-app/template/src/_components/dropdown/dropdownInternals.tsx`; nieuw `packages/create-luckystack-app/src/dropdownPositioning.test.ts`; `packages/create-luckystack-app/CHANGELOG.md`; deze branch-log en `branch-logs/INDEX.md`.

**Notes:** `.claude/settings.local.json` en het ongetrackte lege `nul`-bestand zijn niet aangepast. Geen browser gestart en geen server gestart; de gebruiker moet de visuele flow nog in de draaiende playground controleren.

**Verificatie:** dropdownregressies 7/7; volledige create-app testselectie 127/127; gerichte TypeScriptchecks voor root- en scaffold-internals groen; root- en package-lint plus `ai:lint` groen; volledige build groen (17/17 packages, TypeScript, Vite en serverbundle); `git diff --check` groen.
