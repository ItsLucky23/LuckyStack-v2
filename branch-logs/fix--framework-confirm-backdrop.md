# Branch log — fix/framework-confirm-backdrop

## 2026-07-28 21:53 — Confirm-submit beschermd tegen backdrop-dismissal

**User prompt (summary)**: Controleer of dezelfde bubbled mousedown/mouseup-fout uit Flexbuddy ook in de framework-confirmdialog zit en breng de fix zo nodig terug.

**What I did**:
- Bevestigde dat de root-dogfoodapp en fresh-scaffoldtemplate dezelfde volledige-overlay mousehandlers bevatten.
- Verving die handlers door een afzonderlijke backdropknop die als sibling achter de dialog staat.
- Voegde een regressietest toe die de verboden handlers afwijst en bytepariteit tussen root en scaffold bewaakt.
- Documenteerde de componentinvariant en de consumer-facing fix in de changelog.

**Files touched**: `src/_components/MenuHandler.tsx`, `packages/create-luckystack-app/template/src/_components/MenuHandler.tsx`, `packages/create-luckystack-app/src/menuHandlerBackdrop.test.ts`, `packages/create-luckystack-app/CHANGELOG.md`, `CLAUDE.md`, branchlog/index.

**Notes / decisions**: De diagnose is ook voor het framework geldig. Interacties in de dialog kunnen niet meer naar een dismiss-handler bubbelen; alleen een echte klik op de afzonderlijke backdrop sluit alle menu's. Create-app-tests 137/137, lint en alle 17 packagebuilds plus rootbuild zijn groen.
