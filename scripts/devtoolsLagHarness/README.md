# DevTools-lag harness

Dependency-vrij meetharnas (Node >= 22, Chrome) voor het DevTools-open lag-onderzoek
op branch `debug/devtools-lag`. Zie `branch-logs/debug-devtools-lag.md` voor de
volledige context en resultaten.

## Wat het doet

Chrome DevTools zet bij openen `Debugger.setAsyncCallStackDepth` aan; React 19.2's
dev-runtime roept `console.createTask()` aan voor elk JSX-element. De combinatie
verzadigt de main thread. Deze scripts spawnen een schone Chrome met
remote-debugging-port en meten 4 cellen: {createTask-fix actief | geneutraliseerd}
× {async-tracking uit | aan (= DevTools-open-simulatie)}.

## Gebruik

Vereist: draaiende dev-stack (`npm run server` + Vite) en het testaccount
`devtools-lag@test.local` / `DevTools!Lag42x` (eenmalig registreren via /register).

```
# volledige app-meting (logt in, meet /playground: fps + promise/timer-churn):
node scripts/devtoolsLagHarness/cdpLagTest.mjs "http://localhost:5174/login?backend=81"

# stresspagina-meting (grote boom, continue re-renders — dáár zit het createTask-effect):
node scripts/devtoolsLagHarness/cdpStressTest.mjs "http://localhost:5174/devtools-lag-test?backend=81&n=1500&hz=20"

# Chrome-performance-trace (.json/.json.gz) analyseren op AsyncTask*-events:
node scripts/devtoolsLagHarness/analyzeTrace.mjs pad/naar/trace.json.gz
```

Pas poorten aan naar je eigen setup (`?backend=<poort>` werkt alleen in dev).

## Beperking

Het harnas simuleert de *debugger-async-tracking* van DevTools, niet de volledige
DevTools-frontend (console-object-retentie, source-map-parsing, Elements-mirroring).
De subjectieve eindcheck "console open vs dicht" blijft een handmatige test.
