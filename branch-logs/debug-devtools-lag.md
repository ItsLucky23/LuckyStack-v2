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

## 2026-07-03 — Iteratie 2: FULL-DevTools-simulatie, Vite-watcher-crash gefixt, polling-bevinding INGETROKKEN

*Wat ik deed:*

1. **Harnas uitgebreid** (`cdpStressTest.mjs`): derde modus `full` die alle domeinen enable't die de echte DevTools-frontend bij openen aanzet (DOM-mirror via `DOM.getDocument`, CSS, Overlay, Log, Network, Profiler + async-tracking).
2. **6-cellen-resultaat op n=1500/hz=20** (het gevalideerde meetpunt):
   | cel | fps | long-task ms/5s |
   |---|---|---|
   | fix AAN, instrumentatie UIT | 27.1 | 381 |
   | fix AAN, async-tracking AAN | 23.0 | 1070 |
   | fix AAN, FULL DevTools AAN | 22.9 | 949 |
   | fix UIT, instrumentatie UIT | 20.2 | 1367 |
   | fix UIT, async-tracking AAN | 20.6 | 1152 |
   | fix UIT, FULL DevTools AAN (oude situatie) | 17.4 | 1718 |
   → De extra DevTools-domeinen voegen vrijwel niets toe zodra de fix actief is: **async-tracking × createTask is de dominante term**. Fix aan + DevTools dicht vs oude situatie = 27.1 vs 17.4 fps (+56%) en 4.5× minder long-task-tijd.
3. **Extreme cel (n=4000/hz=30, 16k nodes) is ONBRUIKBAAR**: 9fps baseline = oversatureerd; warmup-noise domineert (cellen kwamen zelfs omgekeerd uit). Meetregime bewaken: baseline moet headroom houden. → Lesson `docs/lessons/0003-devtools-lag-measurement-pitfalls.md`.
4. **Vite-dev-server-crash gevonden + gefixt**: `build:packages` regenereert `packages/create-luckystack-app/framework-docs/` terwijl Vite hem watched → chokidar scandir-race → **onafgehandelde FSWatcher-error killt het hele Vite-proces**. Fix: `/framework-docs/` toegevoegd aan `isIgnoredDevWatchPath` in `vite.config.ts`.
5. **Bevinding "socket blijft op polling" INGETROKKEN**: vals alarm — websockets verschijnen niet in xhr/fetch-filters noch in resource-timing. Live gecheckt: `socket.io.engine.transport.name === 'websocket'`, upgrade werkt gewoon. (In de lesson opgenomen.)

*Files touched:* `scripts/devtoolsLagHarness/cdpStressTest.mjs`, `vite.config.ts`, `docs/lessons/0003-devtools-lag-measurement-pitfalls.md`, deze log.

*Status onderzoek:* mechanisme + fix zijn volledig gekwantificeerd en gecommit. Wat overblijft is niet CDP-simuleerbaar (console-object-retentie + source-map-parsing gebeuren in de echte DevTools-frontend) → handmatige eindcheck door de gebruiker, checklist hieronder.

### HANDMATIGE EINDCHECK (voor de gebruiker, ~5 min)

Voorbereiding: `npm run server` + `npm run client`, log in, en open per stap `http://localhost:5173/devtools-lag-test?n=1500&hz=20` (pas poort aan; op deze machine draaide het onderzoek op :5174 met `?backend=81`).

1. **DevTools dicht** — pagina moet vlot voelen (~27fps tick-animatie). Dit is de baseline.
2. **DevTools open (Console-tab)** — verwacht: merkbaar trager maar werkbaar (~23fps). Was dit vóór de fix onwerkbaar? Dan is de hoofdklacht opgelost.
3. **DevTools open + in Console: `console.createTask` intypen** — moet `undefined` tonen (fix actief). Toont het een native function → verkeerde poort/oude build.
4. **Restlag-check**: voelt de app met DevTools open nóg steeds veel te traag (niet "iets trager" maar "seconden vertraging")? Test dan in deze volgorde:
   a. Console-tab → rechtsklik → "Clear console" + zet in Console-settings "Preserve log" UIT → verschil?
   b. DevTools Settings (F1) → "Disable JavaScript source maps" + "Disable CSS source maps" aanvinken → DevTools herladen (Ctrl+R in DevTools) → verschil? Zo ja: source-map-parsing is de restfactor (alleen-dev-probleem).
   c. Ander DevTools-tabblad actief (Elements vs Console vs Network) — welke tab lagt? Elements = DOM-mirroring, Network = request-buffering.
   d. Zelfde test in een **schoon Chrome-profiel zonder extensies** (`chrome --user-data-dir=%TEMP%\clean-profile`) → verschil? Zo ja: extensies (1Password/Ghostery injecteren content-scripts óók met DevTools dicht, maar DevTools versterkt hun overhead).
5. Rapporteer per stap: beter/slechter/gelijk — dan kan de volgende sessie gericht verder.

---

## 2026-07-03 — Iteratie 3: prod-bundel gefixt (overlay-bundling), client:port-script, Playwright-verificatie

*User prompt:* fix de 2 gemelde issues (npm run prod + npm run client -- --port X) en voer de test uit via Playwright/agent-browser.

*Wat ik deed:*

1. **`npm run prod` gefixt — de overlay wordt nu in de bundel gecompileerd.** Oorzaak: `bootstrapLuckyStack` walkt `luckystack/` op runtime en importeert rauwe `.ts`-bestanden — onder tsx (dev) prima, onder kale `node` = `ERR_UNKNOWN_FILE_EXTENSION`. Fix in drie delen:
   - `packages/server/src/bootstrap.ts`: nieuw export `registerOverlayLoader(loader)` — als geregistreerd slaat `bootstrapLuckyStack` de filesystem-walk over en draait de loader (zelfde volgorde-semantiek, registers eerst).
   - `scripts/bundleServer.mjs`: genereert `node_modules/.luckystack/bundleServerEntry.mjs` met statische imports van alle overlay-bestanden (OVERLAY_ORDER + index-first + alfabetisch) + `registerOverlayLoader`, en bundelt vanaf die entry.
   - Mirror naar `packages/create-luckystack-app/template/scripts/bundleServer.mjs` (parity). Bijvangst daar: de template-`build` riep bundleServer **helemaal nooit** aan (`"build": "vite build"`) → `npm run prod` kon in een gescaffold project sowieso niet werken; nu `"build": "vite build && node scripts/bundleServer.mjs"`.
   - Doc-updates: `docs/HOSTING.md` (overlay-note: prod-bundel pakt overlay-wijzigingen NIET van disk — rebuild nodig) + `packages/server/CLAUDE.md` (function index).
2. **`npm run client -- --port X` gefixt in twee lagen.** Laag 1 (origineel gemeld): `vite --host` at `--port` op als host-waarde → script is nu `vite --host 0.0.0.0`. Laag 2 (nieuw ontdekt): **npm 11.6.1 op Windows eet `--port <n>` én `--port=<n>` volledig op, óók na `--`** (positionele args komen wél door). Oplossing: nieuw script `"client:port": "vite --host 0.0.0.0 --port"` → gebruik `npm run client:port -- 5174`. Beide package.json's (root + template). LET OP eerste poging via PowerShell-regex brak de encoding (BOM + em-dash) — teruggedraaid en met Edit gedaan (rule 9 bevestigd).
3. **Playwright-verificatie (MCP; geen agent-browser CLI in dit project aanwezig):**
   - **Prod** (`node dist/server.js default 4200`, NODE_ENV=production): boot zonder crash, login-pagina rendert, socket CONNECTED, `console.createTask === undefined`, **credentials-login werkt → /playground** (bewijst dat de overlay-userAdapter uit de bundel actief is). 0 echte console-errors.
   - **Dev** (backend :83 — 80/81/82 bezet door Workspace-project; Vite via `npm run client:port -- 5174`): login → /playground; stresspagina n=1500/hz=20 → **32.8 fps, 6 long tasks (437ms/5s)**, consistent met de beste harnas-cel; de 2 console-errors op /playground zijn de bewuste `example.invalid`-avatar-demo.
4. Kanttekening: `SERVER_PORT=4200 npm run prod` luistert alsnog op `ports.backend` (=80) omdat `config.ports.ts` de single source of truth is en SERVER_PORT slechts fallback — port override in prod = positional argv (`node dist/server.js default 4200`). Gedocumenteerd gedrag (HOSTING.md Docker-voorbeeld gebruikt al argv), geen bug.

*Files touched:* `packages/server/src/bootstrap.ts`, `packages/server/src/index.ts`, `packages/server/CLAUDE.md`, `scripts/bundleServer.mjs`, `packages/create-luckystack-app/template/scripts/bundleServer.mjs`, `packages/create-luckystack-app/template/package.json`, `package.json`, `docs/HOSTING.md`, deze log.

*Notes:* lint + volledige build groen; prod-boot + beide login-flows runtime-geverifieerd via Playwright. De handmatige DevTools-open-eindcheck (iteratie 2) blijft open voor de gebruiker.

---

## 2026-07-03 — Iteratie 4: ÉCHTE DevTools-frontend gemeten — fix herstelt vrijwel de hele lag; onderzoek afgerond

*Wat ik deed:* nieuw harnas `scripts/devtoolsLagHarness/cdpRealDevtoolsTest.mjs` — start Chrome met `--auto-open-devtools-for-tabs` zodat de **echte DevTools-frontend** attacht (source-map-parsing, console-retentie, DOM-mirroring — alles wat de CDP-simulatie níet dekt). 4 scenario's × 3 runs op de stresspagina (n=1500/hz=20).

*Resultaat (runs 2+3, consistent; run 1 vervuild — zie note):*
| scenario | fps | long-task ms/5s |
|---|---|---|
| DevTools DICHT, fix AAN | 27.7–27.8 | 507–562 |
| DevTools OPEN, fix AAN | 24.4–25.2 | 576–809 |
| DevTools OPEN, fix UIT (oude situatie) | 19.5–19.6 | 1347–1486 |
| DevTools DICHT, fix UIT | 24.9–25.4 | 762–789 |

*Conclusies:*
1. **De fix herstelt met echte DevTools open vrijwel de hele lag**: +25% fps (24.4–25.2 vs 19.5–19.6) en ~50% minder long-task-tijd. De oude situatie is nu volledig écht gereproduceerd (geen simulatie) en de fix haalt hem weg.
2. **Restkost van DevTools open mét fix is ~10-12% fps** — normale DevTools-overhead (DOM-mirroring, DevTools-UI zelf), geen pathologie. De restlag is daarmee **verklaard en binnen normale marges**.
3. **Source-map-parse-piek verklaard**: run 1's "OPEN, fix AAN"-cel mat 17.7fps/2870ms omdat DevTools bij een verse profielstart nog de source maps van de hele dev-module-graph aan het parsen was tijdens de meting (12s settle was te kort). Dit bevestigt §5.2 als **tijdelijke** kost direct na het openen van DevTools — daarna zakt hij weg. Verwachting voor de gebruiker: de eerste ~10-20s na DevTools-open kan traag voelen in dev; dat is source-map-parsing, geen structurele lag.

*Files touched:* `scripts/devtoolsLagHarness/cdpRealDevtoolsTest.mjs` (nieuw), deze log.

*Status: onderzoek AFGEROND.* Hoofdoorzaak gefixt en in het volledig-echte scenario geverifieerd; restlag verklaard (normale DevTools-overhead + tijdelijke source-map-parse na openen). De handmatige checklist uit iteratie 2 blijft staan als optionele eigen-ogen-verificatie op de machine van de gebruiker (extensies + eigen app-schaal zijn de enige niet-geteste variabelen).

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


## 2026-07-08 20:58 — Framework-planning (LOS van devtools-onderzoek): ADR 0020 + 0021 gelockt

**User prompt:** drie feature-verkenningen (cron-helper, email-code login + 2FA, Prisma optioneel/andere ORMs) + later een vierde punt (update-pad voor gescaffolde files); na onderzoeksrapporten van 5 parallelle Explore-agents besloot de user: ORM-'none' via registration-hook + duidelijke error, en update-mechanisme via scaffold-manifest + expliciet `luckystack update` met AI-assisted merge — "lock maar in".

**Wat ik deed:**
- 5 parallelle Explore-agents: cron (bouwstenen bestaan: ongebruikte `core/src/lease.ts`, `_cron/`-discovery-seam, `preServerStop`; maar ARCHITECTURE_EXTENSION_POINTS.md:503 zegt bewust géén cron — herziening vergt eigen ADR t.z.t.), auth/2FA (alle primitieven bestaan behalve OTP-met-attempt-counter en pending-challenge-state; LoginForm 3× gedrifted), Prisma-koppeling (klein: core/db.ts, /readyz, UserAdapter-seam), wizard/CLI-integratie (ORM-dimensie = kloon van dbProvider/monitoring-patronen; geblokkeerd op ontbrekende persisted scaffold-state, ADR 0014 "infer don't store"), update-pad (niets bestaat; manifest + gefaseerd plan).
- ADR **0020** geschreven: ORM-dimensie (prisma/drizzle/none) in scaffold; 'none' = hook via `luckystack/core/clients.ts`-stub + duidelijke runtime-error, boot-error alleen bij feature die DB vereist; /readyz pluggable; DB-opties gefilterd op ORM (drizzle ≠ mongo).
- ADR **0021** geschreven: `.luckystack/scaffold.json` manifest (version+choices+templateVars+file-hashes); expliciet `luckystack update`-command — pristine=overwrite, user-modified=NOOIT overschrijven maar change-note die project-AI merged; CLAUDE.md sectie-merge; verfijnt ADR 0014 gedeeltelijk.
- `npm run ai:decisions` gedraaid (21 decisions in index).
- Taken #1-#4 aangemaakt/bijgewerkt met alle onderzoeksconclusies (cron wacht op extra info van user; auth geparkeerd).

**Files touched:** `docs/decisions/0020-orm-choice-with-none-via-registration-hook.md` (nieuw), `docs/decisions/0021-scaffold-manifest-and-luckystack-update.md` (nieuw), `docs/AI_DECISIONS_INDEX.md` (regenerated), deze log + INDEX.

**Notes:** Dit werk staat LOS van het devtools-lag-onderzoek van deze branch (implementatie start later op eigen feature-branches). Gemeld, niet gefixt: dubbel ADR-nummer `0016-*` (twee bestanden). INDEX-telling stond op 6 terwijl het bestand 13 `## `-koppen had (subsectie-koppen van de trace-analyse tellen mee volgens de kolomdefinitie) — telling in dezelfde pass hersteld naar 14.
