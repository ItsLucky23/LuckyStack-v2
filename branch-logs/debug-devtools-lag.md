# Branch log — debug/devtools-lag

> Doel: onderzoeken + oplossen waarom de client extreem lagt zodra Chrome DevTools open staat.
> Op deze branch mag alles: code strippen, packages uitzetten, experimenteren — het is een wegwerp-onderzoeksbranch vanaf `main` (cec118b, v0.4.1).

## 2026-07-03 — Branch aangemaakt + handoff vorige sessie vastgelegd

*User prompt:* framework lagt met DevTools open; commit + push alles, maak sub-branch, leg handoff vast, geef een /loop of /goal commando voor de volgende prompt.

*Wat ik deed:* `main` was clean en gepusht; branch `debug/devtools-lag` aangemaakt; handoff van de vorige sessie (andere machine, 2026-07-02) hieronder integraal vastgelegd. **Belangrijk: de op die machine toegepaste fix (`console.createTask = undefined` in `index.html`) zit NIET in deze repo** — `createTask` komt nergens in de codebase voor. Die fix moet hier dus opnieuw aangebracht worden (root `index.html` én `packages/create-luckystack-app/template/index.html`).

*Files touched:* `branch-logs/debug-devtools-lag.md` (nieuw), `branch-logs/INDEX.md`.

*Notes / openstaand:* zie handoff hieronder, §5 (restlag) is het openstaande werk.

---

## 2026-07-03 — Iteratie 1: createTask-fix aangebracht + logging-experiment (§5.1)

*User prompt:* /loop — onderzoek + los de DevTools-lag op (autonoom).

*Wat ik deed:*
1. **createTask-fix** (uit handoff §2) aangebracht in `index.html` én `packages/create-luckystack-app/template/index.html`: dev-only inline `<script>` dat `console.createTask = undefined` zet vóór de module-graph laadt, zodat React 19.2's jsx-dev-runtime de no-op-tak bindt.
2. **§5.1 logging-experiment**: `config.ts` `logging.devLogs` en `logging.stream` hard op `false` (was `resolvedEnvironment.dev`), met comment-markering als experiment. DevTools houdt elk gelogd object vast (retentie) → kandidaat voor de restlag.
3. `npm run lint && npm run build` → groen.
4. Verdachten §5.4 gecheckt: géén IntersectionObserver/MutationObserver/ResizeObserver in eigen src/packages-clientcode (de 770× uit de trace kwamen dus van extensies); client-side timers = alleen de 250ms taalpoll (TranslationProvider) — te goedkoop; activitySampler is server-side.

*Files touched:* `index.html`, `packages/create-luckystack-app/template/index.html`, `config.ts`, deze log.

*Notes:* volgende stap = servers starten + trace via Chrome DevTools MCP, en de production-build-test (§5.2). Kanttekening: het MCP-Chrome-profiel is schoon (geen extensies) en tijdens een Performance-recording staat de debugger-async-tracking uit (handoff §1), dus de subjectieve "console open = lag"-check blijft uiteindelijk een handmatige test voor de gebruiker.

---

## 2026-07-03 — Iteratie 1 (vervolg): CDP-meetharnas + stresspagina — fix gekwantificeerd

*Wat ik deed:*

1. **Runtime-verificatie**: dev-servers gestart (backend :81 — :80 was bezet door C:\code\Workspace; Vite op :5174 — :5173 was bezet door C:\code\portfolio op [::1]). Testaccount `devtools-lag@test.local` / `DevTools!Lag42x` geregistreerd. LET OP: 127.0.0.1:5173 → localhost:81 is cross-site → sessie-cookie doet niet mee; gebruik localhost:5174 (staat al in dnsEnvironmentMap) met `?backend=81`.
2. **Fix live geverifieerd**: `console.createTask === undefined` op onze app; React bindt de no-op-tak.
3. **Performance-trace via Chrome DevTools MCP** op /playground (835 nodes): 60fps, 0 long tasks, **0 AsyncTask\*-events** (waren er ~136k in de oude traces).
4. **Eigen CDP-harnas gebouwd** (`scripts/devtoolsLagHarness/` — dependency-vrij, Node≥22): spawnt Chrome met remote-debugging-port en zet `Debugger.setAsyncCallStackDepth(32)` aan — exact wat DevTools-open doet — en meet 4 cellen: {fix aan/geneutraliseerd} × {tracking uit/aan}.
   - **/playground (835 nodes)**: alle cellen 60fps. Maar promise-churn-microbench: tracking aan = **25-35× tragere promises** (1.5ms → 36-42ms per 20k links). Mechanisme bevestigd, schaal te klein voor voelbare lag.
   - **Productiebuild (vite preview :4173)**: identiek aan dev → Vite-dev/source-maps op page-niveau NIET de boosdoener (§5.2 beantwoord, met kanttekening: de echte DevTools-frontend parseert wél source maps; dat deel simuleer ik niet).
5. **Stresspagina gemaakt**: `src/devtools-lag-test/page.tsx` (publiek, plain; `?n=1500&hz=20` tunable) — grote boom die continu re-rendert (re-renders zijn wat per-element `createTask` triggert; pointermoves alléén deden dat niet — dáárom zag de eerste meting niets).
6. **Resultaat 4-cellen op stresspagina (6030 nodes, 20Hz)**:
   | cel | fps | long-task ms/5s |
   |---|---|---|
   | fix AAN, tracking UIT | 29.6 | 423 |
   | fix AAN, tracking AAN | 25.1 | 749 |
   | fix UIT, tracking UIT | 24.7 | 786 |
   | fix UIT, tracking AAN (oude situatie) | 20.0 | 1380 |
   → fix = **-45% long-task-tijd** met tracking aan; native `createTask` aanroepen kost óók zonder DevTools ~17% fps. Op deze pagina: 1500 tiles × ~6 elementen × 20Hz ≈ **180k createTask-calls/s** in de oude situatie.

*Bevindingen buiten scope (NIET gefixt — Report Without Auto-Fixing):*
- **`npm run prod` crasht**: `dist/server.js` importeert runtime een rauw `.ts`-bestand (`C:\code\LuckyStack-v2\luckystack\core\clients.ts`) → `ERR_UNKNOWN_FILE_EXTENSION`. Prod-bundel is kapot op deze branch/main.
- **Socket blijft op polling**: in dev upgradet socket.io nooit naar websocket (alle frames via `transport=polling`). Mogelijk relevant voor perf, zeker het onderzoeken waard.
- **`npm run client -- --port X` faalt**: het script is `vite --host` en `--host` slokt `--port` op als waarde (`getaddrinfo ENOTFOUND 5174`).

*Files touched:* `src/devtools-lag-test/page.tsx` (nieuw), harnas-scripts (scratchpad → gecommit onder `scripts/devtoolsLagHarness/`), deze log.

*Open / volgende iteratie:*
- Restlag met échte DevTools-frontend (console-retentie, source-map-parsing in de DevTools-renderer, Elements-mirroring) is niet CDP-simuleerbaar → handmatige checklist voor de gebruiker staat klaar (zie sessie-samenvatting).
- Kandidaat-experimenten: n=4000/hz=30 extreme cel; echte DevTools open naast het harnas (handmatig); socket-polling-bevinding onderzoeken.

---

## HANDOFF vorige sessie (2026-07-02, andere machine) — integraal

# DevTools-lag onderzoek (client)

> Status: **grotendeels opgelost** — hoofdoorzaak gevonden + gefixt. Restlag met console open vs. dicht is nog in onderzoek (zie §5).
> Laatst bijgewerkt: 2026-07-02.

## 1. Symptoom

- De client draait vloeiend **met DevTools dicht**.
- Zodra **DevTools open** staat lagt alles extreem: cursor verandert seconden te laat bij hover, ~20s om te reageren, zelfs bij idle en zonder netwerk/log-activiteit.
- Opvallend: **tijdens een Performance-recording werkt het juist prima** (bleek een sleutelaanwijzing — profiling schort de debugger-async-tracking op).
- Oudere projecten op een **oudere LuckyStack-versie** (zelfde origin, zelfde Chrome) hebben dit **niet**.

## 2. Hoofdoorzaak (bevestigd)

**React 19.2.7 (meegebracht door de nieuwere LuckyStack) roept in dev-mode `console.createTask()` aan voor élk JSX-element.**

`node_modules/react/cjs/react-jsx-dev-runtime.development.js:305`:

```js
createTask = console.createTask ? console.createTask : function () { return null; };
```

React gebruikt dit voor "owner stacks" / async-stack-tagging (zodat async frames in de debugger componentnamen tonen).

- **DevTools dicht:** `console.createTask` is bijna gratis → geen probleem.
- **DevTools open:** elke call wordt een echte **V8-debugger async-taak**. In de traces: **~30k `AsyncTaskScheduled` + ~84k `AsyncTaskRun` + ~22k `AsyncTaskCanceled`**, getagd met componentnamen (`<div>`, `<Icon>`, `<FontAwesomeIcon>`, `<Context>`). Over een grote boom + event-dispatch = main thread verzadigd.
- **Waarom oudere LuckyStack goed is:** die pinde een oudere React (18 / vroege 19) zónder deze per-element `createTask`. De bump naar React 19.2 introduceerde de regressie. Dit is de framework-**versie**-variabele die de lag verklaart.

### Fix (toegepast op de andere machine — HIER NOG NIET AANWEZIG)

Dev-only inline `<script>` in `index.html` `<head>`, vóór de module-graph, zodat React de no-op-tak bindt:

```html
<script>
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    console.createTask = undefined;
  }
</script>
```

Kost enkel component-labels in *async* stack traces. React DevTools / Profiler / gewone stacks / productie: onaangetast.

**Resultaat:** groot deel van de lag weg.

## 3. Wat we hebben geprobeerd (chronologisch)

| # | Hypothese | Bevinding | Verdict |
|---|---|---|---|
| 1 | Sync-log-firehose: `@luckystack/sync` `attachSyncReceiver` logt elk sync-bericht + elke stream-chunk als object (`getLogger().debug(...)`, gated door `logging.devLogs`/`logging.stream` = `dev`). Console-object-retentie met DevTools open. | Reëel mechanisme, maar verklaart de **idle + geen-logs** lag niet. Nog niet uitgezet — kandidaat voor de restlag (§5). | Bijdrage, niet hoofdoorzaak |
| 2 | Doorlopende client-loop/animatie (rAF/interval/framer-motion) | Hele client doorzocht: elke interval/animatie is gated of stopt bij idle. Enige continue timer = 250ms taalpoll (te goedkoop). Geen `repeat: Infinity`. | Uitgesloten |
| 3 | Activity-broadcaster: `pointermove`-window-listener (`socketInitializer.ts:128`, `handleActivity`) via `socketActivityBroadcaster`. | Trace toonde `handleActivity` 709×, maar **`socketActivityBroadcaster: false` maakte geen verschil**. | Uitgesloten |
| 4 | Browser-extensies. CPU-profiel: main thread **85% idle**, app-code ≈0; enige echte JS = **1Password** (`dppgmdbiimibapkepcbdbmkaabgiofem`, `inline/injected.js` 338×) + **Ghostery** (`mlomiejdfkolichcflejclcbmpeaniij`, adblocker/whotracksme) + IntersectionObserver 770×. | Zichtbaar in de trace, maar verklaart niet waarom een oudere framework-versie wél goed is. Later: **alle extensies uit → lag deels blijft**. | Bijrol, niet hoofdoorzaak |
| 5 | **React 19 `console.createTask` per element** | Bevestigd in code + traces (84k debugger-async-taken met componentnamen). Fix werkt. | **Hoofdoorzaak** |

## 4. Waarom "async stack traces" geen zelf-veroorzaakte setting was

Async-stacktrace-capture staat **standaard aan** in Chrome zodra DevTools open is — niets aangezet, en staat óók aan bij de oudere projecten. Het verschil zit dus niet in DevTools maar in wat de code (React 19) er per frame doorheen jaagt.

## 5. Restlag — nog te doen

Zelfs met `console.createTask = undefined` én alle extensies uit, blijft er merkbaar verschil tussen console open/dicht. Volgende verdachten en tests:

1. **Sync-/dev-logging naar console** (hypothese #1, nog aan): zet in `config.ts` `logging.stream: false` en `logging.devLogs: false`. Elk gelogd object wordt door DevTools vastgehouden (retentie) → residuele last, ook zonder nieuwe zichtbare logs.
2. **Vite dev + source maps over een grote module-graph** (15 `@luckystack/*` packages + deps, onbundeld): DevTools parset/houdt source maps bij. Test: een **production build** met DevTools open — is het daar wél snel, dan is dit het.
3. **React DevTools-extensie** (is óók een extensie): bevestig dat die echt uit staat — die loopt de component-boom bij elke commit.
4. **Overige async-instrumentatie**: ook zonder `createTask` blijft DevTools élke promise/timer/observer instrumenteren. Minder DOM-elementen (board virtualiseren, minder always-mounted `motion`) verlaagt de basislast.

**Aanbevolen volgende stap:** maak een **nieuwe Performance-trace** (met de fix + extensies uit) van ~5s met muisbeweging, dan analyseren welke `AsyncTask*`/functie nu bovenaan staat.

## 6. Hoe de traces geanalyseerd zijn (reproduceerbaar)

Chrome-traces zijn gzip-JSON. Decomprimeer met Node (`zlib.gunzipSync`), `JSON.parse`, dan:

- Aggregeer `traceEvents` op `name` (count + som `dur`) → toont `v8::Debugger::AsyncTask*` dominantie.
- Extraheer het CPU-profiel uit `ProfileChunk`-events (`args.data.cpuProfile.nodes` + `samples`/`timeDeltas`) → self-time per functie/URL → toonde 85% idle + extensies.
- Grep de ruwe tekst op `chrome-extension://<id>` → extensies identificeren.

Analyse-scripts stonden in `/tmp/analyze*.mjs` tijdens het onderzoek (niet gecommit).
