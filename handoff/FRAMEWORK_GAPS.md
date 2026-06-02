# Workspaces × LuckyStack — Framework-grenzen & oplosscenario's

> **Voor de oppakkende AI:** elk item hieronder is een framework-grens die het Workspaces-project raakt, geschreven als **zelfstandig oplosbaar scenario**. Per item: wat het product wil · waarom LuckyStack het niet native kan (met bronbestand) · impact · voorgestelde aanpak · inschatting · of het een **app-fix** of een **framework-PR** is. Niets hiervan vereist een fork tenzij expliciet vermeld.
>
> Bron: 2 parallelle codebase-sweeps (17 agents totaal) tegen `packages/*`. Geverifieerd op branch `chore/package-split-prep`. Lees naast [`FRAMEWORK_CAPABILITIES.md`](./FRAMEWORK_CAPABILITIES.md) (de baseline) en [`IDEE_SPEC.md`](./IDEE_SPEC.md) (de volledige koppeling).

## Legenda

| Severity | Betekenis |
|---|---|
| 🔴 **blocker** | Kernfeature kan niet zonder dat dit eerst opgelost is; framework levert niets om op te bouwen. |
| 🟠 **major** | Vereist substantieel app-werk of een infra-keuze; framework levert deel-primitieven. |
| 🟡 **minor** | Kleine workaround / discipline-punt. |
| ⚪ **note** | Bewuste framework-grens (juiste altitude); geen defect, wel goed om te weten. |

| Type-fix | Betekenis |
|---|---|
| **APP** | Op te lossen in consumer-code (geen frameworkwijziging). |
| **INFRA** | Externe infra-keuze (Traefik/Atlas/bullmq/…). |
| **FW-PR** | Zou schoner zijn met een upstream framework-PR (optioneel; app-workaround bestaat). |

---

## 🔴 Blockers

### G1 — Geen server-side background-job / queue / cron / leader-election primitive
**Type:** INFRA + APP · **Raakt:** §10 (merge-indexer-queue), §9.4 (onderhoudsbewaking), §6 (RAG-snapshot-jobs)

- **Scenario.** Een GitLab-merge moet een job op een queue duwen; **één seriële worker** voegt commit-gestempelde RAG-entries toe. Daarnaast wil §9.4 een periodieke "zijn de dynamische bronnen wel bijgewerkt?"-check.
- **Waarom niet native.** LuckyStack heeft **nul** server-side job-infrastructuur. De enige timers in het framework zijn de rate-limiter-sweep en de dev-only router-health-poller (`packages/router/src/healthPoller.ts`, `.unref()`'d, dev-only). De enige "queue" is de **client-side** offline-send-buffer (`packages/core/src/offlineQueue.ts`). De hook-bus (`packages/core/src/hooks/registry.ts`) is request-lifecycle-only: geen timing, geen persistence, geen retry, geen worker.
- **Impact.** Zowel de seriële RAG-indexer als de cron-achtige bewaking moeten extern.
- **Aanpak.** Breng **bullmq** (Redis-backed; `ioredis` is al een `@luckystack/core` peer-dep, dus geen nieuwe Redis-client) en draai één worker met `concurrency:1` → dit overleeft ook multi-instance want de queue + locking zit in Redis. Voor de lichte single-instance variant volstaat een in-process promise-chain. Breng **node-cron** (of `setInterval` in een boot-module) voor de bron-versheid-watcher. Start beide vanuit het overlay-bestand `luckystack/server/index.ts` (wordt als laatste geladen door `bootstrap.ts`).
- **Inschatting.** Halve dag voor de bullmq-worker + webhook-enqueue; cron-watcher een paar uur.
- **Optionele FW-PR.** Geen — een scheduler hoort bewust niet in dit framework. Documenteer de externe keuze als architectuurbeslissing.

### G2 — Sync heeft geen ordering/event-log/replay → de duurzame event-log is 100% app-eigendom
**Type:** APP · **Raakt:** §11 (event-log/audit), §12 (realtime), §6.4 (live ticket-context)

- **Scenario.** Een **onveranderlijke, geordende, persistente** per-ticket event-stream die zowel de audit-log (ticket "terugspoelen") als de live-view voedt.
- **Waarom niet native.** `packages/sync/src/handleSyncRequest.ts` lost recipients op via `ioInstance.sockets.adapter.rooms.get(receiver)` (alleen nu-verbonden sockets) en doet `tempSocket.emit(...)` — **geen persistence, geen sequence-nummer, geen buffering**. Een socket die niet in de room zit krijgt niets. De enige ordering-primitive (`incrementResponseIndex`, `packages/sync/src/syncRequest.ts`) is een per-originator lokale teller voor request↔response-correlatie, géén per-room monotone sequence.
- **Impact.** Dé definiërende architectuurbeslissing van slice "event-log". Sync is **alleen** de live-push; de waarheid leeft in Mongo.
- **Aanpak.** App-eigen Prisma-model `TicketEvent { id, ticketId, seq Int, type, actor, payload Json, commitHash, createdAt }`, **append-only**, compound-unique-index `[ticketId, seq]`. `seq` komt van **Redis `INCR`** (`luckystack:ticketseq:<ticketId>`) of een atomische Mongo-counter. Eén `_sync/appendEvent_server_v1.ts`-handler **schrijft de rij én returnt 'm als `serverOutput`** → dezelfde handler doet audit-write + live-push (broadcast naar de ticket-room). Catch-up via G11.
- **Inschatting.** 1 dag voor het log-model + append-handler + seq-strategie; client-merge-logica (G11) apart.

### G3 — `@luckystack/router` is geen subdomein-/host-/TLS-/dynamische proxy
**Type:** INFRA · **Raakt:** §7.1–7.2 (subdomein per ticket), §16 (dynamische reverse proxy)

- **Scenario.** Per-ticket dev-server op `dev-1234.<domein>` met wildcard-TLS en **dynamische** ontdekking van containers die op- en afgaan.
- **Waarom niet native.** `@luckystack/router` routeert op het **eerste pad-segment**, niet de host (`packages/router/src/resolveTarget.ts` `parseServiceFromPath`); targets zijn een **statische** `Record<service,url>` die één keer bij boot uit `deploy.config.ts` gelezen wordt (`createServiceTargetResolver` faalt zelfs hard bij boot als een binding geen poort heeft); de listener is **plain `http.createServer`** zonder cert-loading (`packages/router/src/startRouter.ts:139`). `packages/router/CLAUDE.md` zegt expliciet: "The router does NOT terminate TLS" en "When NOT to use: a single backend instance fronted by Caddy/nginx → skip this package."
- **Impact.** De router is hier het verkeerde gereedschap (zijn niche = één app over preset-bundles splitsen).
- **Aanpak.** **Traefik** (Docker-label-provider → gratis dynamische per-container-discovery + ACME wildcard via DNS-01) of **Caddy** (on-demand TLS + admin-API-routes). De orchestrator zet bij container-start een `Host(\`dev-{id}.<domein>\`)`-label (Traefik) of POST't een route naar Caddy. Eén TLS-terminerende edge fronts drie upstreams: de app (`app.<domein>`), de orchestrator (terminals + control-API), en de ticket-subdomeinen.
- **Inschatting.** 1–2 dagen Traefik-opzet incl. wildcard-cert + orchestrator-label-integratie.

---

## 🟠 Majors

### G4 — Geen native interactieve-PTY / raw-duplex-byte-transport
**Type:** APP · **Raakt:** §3.2 (browser-terminals als kernfeature)

- **Scenario.** Live interactieve terminal in een browser-tab gekoppeld aan een draaiend Claude-CLI-proces (xterm.js ↔ node-pty), bidirectionele ruwe bytes, resize, ANSI, lage latency, ~20 sessies parallel.
- **Waarom niet native.** LuckyStack's transport is RPC (`apiRequest`, één req→één res) + room-fanout-sync-streaming (één req→N **JSON** server→client-frames). De streaming-primitives zijn `StreamPayload = Record<string, unknown>` (`packages/core/src/apiTypeStubs.ts:21`) — **JSON-object, één richting, fire-and-forget** (`packages/sync/src/_shared/streamEmitters.ts`). De client stuurt exact één `syncRequest` en ontvangt daarna alleen (`packages/sync/src/handleSyncRequest.ts`) — **geen client→server mid-stream-kanaal**. `docs/ARCHITECTURE_SOCKET.md` Core-Events-tabel: elk event is één-shot client→server of server→client(s). Geen native "interactieve terminal".
- **Impact.** De marquee-kernfeature heeft geen kant-en-klare framework-primitive — maar wél alle bouwstenen.
- **Aanpak (no fork).** Eigen **`/pty` Socket.io-namespace** op de **gedeelde** `io` die je uit `bootstrapLuckyStack({...}).ioServer` pakt (`packages/server/src/types.ts:81-89` exposeert `ioServer`; `server/server.ts` gooit 'm nu weg → één regel bewaren). Hergebruik framework-auth **verbatim**: `registerSocketMiddleware` (of namespace-`.use()`) + `extractTokenFromSocket` + `getSession` (`docs/ARCHITECTURE_SOCKET.md:94` zegt letterlijk dat custom transports deze moeten hergebruiken). Eigen events `pty:data`/`pty:resize`/`pty:exit` met Socket.io's **binaire** payloads (orthogonaal aan de JSON-sync-laag; `maxHttpBufferSize` default 5MB). **Niet** via `syncRequest`/`broadcastStream`.
- **Inschatting.** ~1 dag voor een werkende eerste versie; extra hardening voor 20-sessie-concurrency + detach/reaper.

### G5 — PTY-proceslevenscyclus moet búíten de socket-/sessie-levenscyclus leven
**Type:** APP · **Raakt:** §3.2 (live volgen, ook na tab-sluiten), §10.4 (heractiveren)

- **Scenario.** Een Claude-CLI-pty moet een tab-sluiting / netwerk-blip **overleven** en bij reconnect opnieuw streambaar zijn.
- **Waarom niet native.** Het framework koppelt veel aan socket connect/disconnect (presence-grace, sessie-deletion, `abortAllForSocket` in `loadSocket.ts`, `handleSyncRequest`'s `socket.once('disconnect', abort)`). Het kent **geen** server-owned proces dat de socket overleeft.
- **Impact.** Naïef pty-aan-socket-binden killt draaiende agents bij elke refresh.
- **Aanpak.** `Map<ticketId, { pty, ringBuffer }>` los van socket-id. Bij `/pty`-connect: lookup op ticket, `socket.join(ticketId)`, `pty.onData→socket.emit`, en replay een bounded **scrollback-ring-buffer** zodat xterm hertekent. `pty.kill()` alleen bij expliciete ticket-close/container-teardown, **nooit** op disconnect.
- **Inschatting.** Onderdeel van G4's hardening; reken een halve dag extra voor reaper + ring-buffer.

### G6 — Webhook-POST wordt geblokkeerd door fail-closed origin-enforcement
**Type:** INFRA of FW-PR · **Raakt:** §10.1 (merge-trigger via GitLab-webhook)

- **Scenario.** GitLab POST't een merge-webhook (server-to-server, **geen** Origin/Referer-header) naar de app.
- **Waarom niet native.** `enforceOriginPolicy` (`packages/server/src/httpHandler.ts:99-123`) draait als eerste en **returnt 403 voor elke state-changing POST zonder Origin én zonder Referer** — precies een server-to-server webhook. Dit draait vóór custom routes het request kunnen claimen. De `preHttpRequest`-hook kan alleen *stoppen*, niet *doorlaten*.
- **Impact.** De merge-trigger bereikt de handler nooit zonder workaround.
- **Aanpak.** Praktisch: laat de eigen Traefik/Caddy-edge op het webhook-pad een toegestane `Origin`-header **injecteren** vóór forwarding (houdt browser-CORS streng). Alternatief: zet GitLab's webhook-host in `projectConfig.http.cors` en leun op Referer.
- **FW-PR (schoonst).** Voeg een registreerbare **origin-exempt path-prefix-lijst** toe (skip origin-enforcement wanneer een geregistreerde webhook-path-matcher het pad claimt). Maakt secret-geverifieerde server-to-server-endpoints first-class. → zie [`FRAMEWORK_PR_KANSEN`](#framework-pr-kansen).

### G7 — Custom routes kunnen de ruwe request-body niet lezen (geconsumeerd + content-type-gated)
**Type:** APP (voor GitLab) / FW-PR (algemeen) · **Raakt:** §10.1 (webhook-verificatie)

- **Scenario.** Webhook-secret verifiëren op de inkomende merge-POST.
- **Waarom niet native.** Voor POST dráínt `getParams` de body (en 415't niet-JSON content-types) **vóór** `handleCustomRoutes` draait (`packages/server/src/httpHandler.ts:272` vóór `:277`); de custom-route-handler krijgt alleen `ctx={routePath,method,queryString,token}`, niet de body. **HMAC-over-body is onmogelijk** vanuit een custom route.
- **Impact.** Body-HMAC-verificatie kan niet; header-secret wél.
- **Aanpak.** Voor **GitLab specifiek** overleefbaar: GitLab-webhook-auth is een **plaintext `X-Gitlab-Token`-header** (geen body-HMAC), dus verifieer `req.headers['x-gitlab-token']` en lees de reeds-geparste JSON. (Andere providers met body-HMAC = geblokkeerd.)
- **FW-PR.** Een `PRE_PARAMS` custom-route-seam of per-path `skipBodyParse`-flag zodat een webhook-handler zijn eigen `req.on('data')`-reader kan plaatsen vóór `getParams`.

### G8 — Orchestratie-state is per-proces; multi-instance-ownership is niet door het framework opgelost
**Type:** APP/INFRA · **Raakt:** §4.5 (≤20 instances), §7 (containers/worktrees), §15 (volgorde)

- **Scenario.** Het register van git-worktrees / Docker-containers / Claude-CLI-processen (`Map<ticketId, ChildProcess>`, ~20 concurrent) leeft ergens.
- **Waarom niet native.** Alle framework-singletons (rate-limit-Map, custom-route-array, io-instance-slot, elke module-level Map die je toevoegt) zijn **per-proces**. Het framework is expliciet gebouwd om multi-instance achter `@luckystack/router` te draaien (WS gepind op `system`), maar child-processen zijn lokale OS-handles die niet over instances te delen zijn, en er is **geen leader-election**.
- **Impact.** Niets in het framework beslist wélke instance de ~20 children bezit.
- **Aanpak.** Draai de orchestrator + indexer-worker als **één gepinde single-instance** service (eigen preset/binding). Wil je ooit HA: voeg zelf Redis-`SETNX`-lease-leader-election toe (Redis is er al). Documenteer de Claude-CLI-supervisor als singleton. Zie ook G3/G16.
- **Inschatting.** Architectuurkeuze (geen bouwwerk); de single-instance-pin is gratis.

### G9 — Gegradeerde DB/cache-credentials per stage kunnen niet via de framework-client-registry
**Type:** APP / FW-PR · **Raakt:** §7.6 (per-stage per-tool permissies)

- **Scenario.** Stage 6 mag Mongo alleen lezen; stage 8 mag schrijven (en idem Redis).
- **Waarom niet native.** `registerPrismaClient`/`registerRedisClient` schrijven naar **globale module-level singletons** (`packages/core/src/clients.ts`, last-write-wins); `getPrismaClient`/`getRedisClient` en de `prisma`/`redis`-Proxies resolven naar **die ene** client per proces. De injected `functions.db.prisma`/`functions.redis.redis` zitten op dezelfde globale client. **Geen keyed/scoped accessor.**
- **Impact.** Read-only-stage-6 vs read-write-stage-8 kan niet via de registry.
- **Aanpak.** App-eigen pool: `Map<credentialTier, PrismaClient>` + `Map<credentialTier, Redis>` (één Mongo-user per tier, één Redis-user per tier), één keer bij boot opgebouwd; kies in de handler op basis van de stage-config. Laat `registerPrismaClient`/`registerRedisClient` wijzen naar de geprivilegieerde client die framework-internals (sessies, rate-limit, presence) gebruiken.
- **FW-PR.** Keyed client-registry: `registerPrismaClient(client, key?)` + `getPrismaClientFor(key)` → maakt gegradeerde credentials first-class.

### G10 — `$vectorSearch` vereist MongoDB Atlas (of Atlas Local), niet vanilla replica-set
**Type:** INFRA · **Raakt:** §5.1 (RAG in Mongo), §6 (vector-query per commit-hash)

- **Scenario.** Vector-similarity-search over embeddings, gefilterd op commit-hash.
- **Waarom niet native (infra, niet framework).** `.env` wijst naar zelf-gehoste `mongodb://...replicaSet=rs0` zónder Atlas-Search-node. `$vectorSearch` is een Atlas-Search-stage (mongot); een plain replica-set geeft "Unrecognized pipeline stage name: $vectorSearch". LuckyStack legt hier **geen** friction op — het geeft `DATABASE_URL` enkel door.
- **Impact.** Pure self-host-Mongo serveert geen `$vectorSearch`.
- **Aanpak.** Draai **Atlas Local** (`atlas deployments setup`) in de Docker-stack (het product shipt sowieso Docker), `createSearchIndexes` via `$runCommandRaw` bij boot/migratie. **Fallback** zonder Atlas: embeddings als `Float[]`, kandidaten ophalen op `commitHash`-filter, **cosine in de Node-worker** (acceptabel tot ~10k vectoren per snapshot).
- **Inschatting.** Atlas-Local in compose: een paar uur; index-lifecycle-helper: halve dag.

### G11 — Geen server-side missed-event catch-up; reconnect-replay is handmatig
**Type:** APP · **Raakt:** §3.2 (live volgen op telefoon), §12 (realtime)

- **Scenario.** Een (mobiele) client die even wegviel moet de gemiste events inhalen en naadloos verder.
- **Waarom niet native.** Bij reconnect-binnen-grace vuurt alleen de `postSocketReconnect`-hook met `{token, userId, roomCodes}` (`packages/presence/src/activity/lifecycle.ts`). Hij zegt **niet** welke events je miste, buffert niets, replayt niets. De offline-queue replayt alleen je eigen **uitgaande** sends.
- **Impact.** Catch-up is jouw werk (maar de seam is er).
- **Aanpak.** Client houdt `lastSeenSeq` per ticket. Op mount **én** `postSocketReconnect`: `apiRequest('ticket/getEvents', {ticketId, sinceSeq})` → geordende backlog uit Mongo (G2) → toepassen → live hervatten. **Kritisch:** abonneer **eerst** op live sync (buffer inkomende events), **dan** de snapshot-fetch, dan merge op `seq` — anders verlies je events in het fetch-venster.
- **Inschatting.** Halve dag client-merge-logica + getEvents-route.

### G12 — Geen delivery-ack dat een ontvanger een event kreeg
**Type:** APP · **Raakt:** §11 (audit-betrouwbaarheid), §12

- **Scenario.** Zekerheid dat een collega event `seq N` daadwerkelijk ontving.
- **Waarom niet native.** `postSyncFanout` rapporteert `recipientCount` = aantal sockets waarnaar **geëmit** is, niet ge-acked. Socket.io-emit is best-effort; er is geen per-recipient-ack in het sync-protocol (alleen de originator-request↔response heeft een ack).
- **Impact.** Server weet niet zeker dat een client een event kreeg.
- **Aanpak.** **Seq-gap-detectie op de client** (ziet client `N+2` na `N` → vraagt het gat op via `getEvents`). Mongo-log = waarheid, sync = best-effort-accelerator (correcte CQRS-split voor een audit-grade log). Optioneel periodiek `lastSeenSeq` rapporteren voor presence/health.

### G13 — Geen persistente collaborator-roster; presence = transient transition-pings
**Type:** APP · **Raakt:** §12 (collega's live zichtbaar / presence)

- **Scenario.** "Wie kijkt nu naar ticket N" — een autoritatieve, querybare aanwezigheidslijst.
- **Waarom niet native.** `@luckystack/presence` emit `userAfk`/`userBack` naar nu-verbonden peers (`peerNotifier.informRoomPeers`) en levert een status-badge + `LocationProvider` (emit `updateLocation` op route-change), maar **geen** roster-model, **niets** persistents. Een laat-joinende client krijgt geen lijst. De `/client`-surface is enkel `SocketStatusIndicator` + `LocationProvider`.
- **Impact.** De "wie is hier"-lijst bouw je zelf.
- **Aanpak.** App-eigen Redis-set `presence:ticket:<id>` → tokens/userIds, gemuteerd op joinRoom/leaveRoom/disconnect-grace-expiry, vers gehouden via `prePresenceUpdate`/`postPresenceUpdate`/`postSocketReconnect`-hooks. Snapshot via `apiRequest`, deltas via sync. Hergebruik presence's grace-timers zodat een tab-refresh de roster niet laat flikkeren.
- **Inschatting.** Halve dag.

### G14 — DEV draait op 2 poorten; de browser-facing poort is Vite (5173), niet de backend
**Type:** APP/INFRA · **Raakt:** §7.1–7.2 (subdomein wijst naar dev-server), §7.5 (process-config)

- **Scenario.** De per-ticket reverse-proxy moet naar de juiste poort in de container.
- **Waarom (inherent aan het dev-model).** Een LuckyStack-project draait in DEV **twee** processen: **Vite** (`vite --host`, vaste poort **5173**, browser-facing) die `/api`,`/sync`,`/auth`,`/uploads`,`/socket.io`(ws) + health-endpoints **proxyt** naar de **Node-backend** (`tsx server/server.ts`, `SERVER_PORT` default 80). Bron: `packages/create-luckystack-app/template/{package.json,vite.config.ts}`. In PROD valt het samen tot **één** poort (`node dist/server.js <preset> <port>` serveert static `dist/` + API + sockets, `server/prod/serveFile.ts`).
- **Impact.** Proxy naar de backend-poort = kapotte HMR + socket.io-handshake.
- **Aanpak.** Process-config = **2 geordende terminals**: T1 `npm run server` (eerst), T2 `npm run client` (Vite 5173 = de blootgestelde poort). Standaardiseer Vite op 5173 in élke container; proxy `dev-<ticket>.<domein>` → container-Vite-5173. Health-gate optioneel op backend-`/readyz`. Voor een build-only preview-stage: PROD-mode (1 poort).
- **Inschatting.** Onderdeel van de process-config-modellering; geen los bouwwerk.

### G15 — DNS/CORS/OAuth-callback-env moet bij container-boot op het ticket-subdomein staan
**Type:** APP · **Raakt:** §7.1 (subdomein), §7.5 (env-injectie per stage)

- **Scenario.** De app in de container wordt geserveerd op `dev-<ticket>.<domein>`.
- **Waarom niet native.** `config.ts` leidt `backendUrl`, CORS-`allowedOrigins`, OAuth-callbacks en e-maillinks af uit `DNS`. Blijft `DNS` op localhost, dan is CORS fail-closed (403 op state-changing POST als Origin niet matcht) en wijzen OAuth/e-maillinks naar de verkeerde host. `allowLocalhost` dekt geen echt subdomein.
- **Impact.** Verkeerde env = stukke CORS/OAuth in de ticket-container.
- **Aanpak.** Zet in de per-ticket-container-env `DNS=https://dev-<ticket>.<domein>` (+ evt. extra origins) + `DATABASE_URL` + `REDIS_*` + `NODE_ENV=development`. De "process-start-config + prompt-injectie"-stap (§7.5/§4.7) is de natuurlijke plek voor deze env-injectie.

### G16 — Orchestrator moet single-instance; zijn sockets/terminals mogen niet load-balanced
**Type:** APP/INFRA · **Raakt:** §7 (orchestratie), §12 (terminals)

- **Scenario.** De orchestrator bezit mutable host-resources (containers, worktrees, ~20 live node-pty's) + de seriële indexer.
- **Waarom niet native.** LuckyStack's multi-instance-verhaal is gebouwd op **stateless** backends + Socket.io-Redis-adapter voor **room-fanout**. node-pty-terminal-streams zijn **point-to-point host-gebonden** state die dat model niet dekt; geen leader-election, geen single-writer-garantie, geen sticky-pinning voor een specifieke pty.
- **Impact.** De orchestrator kan niet horizontaal schalen; zijn terminals zijn van nature sticky.
- **Aanpak.** Draai de orchestrator als **exact één** proces (bewuste constraint, geen defect — de router/multi-instance is optioneel). Route terminal-websockets **direct** naar de orchestrator via de edge-proxy (eigen subdomein/pad), níét via de router (die WS op `system` pint). App-sockets (presence/event-log) blijven wél op de schaalbare app-server met Redis-adapter.

### G17 — 1 MiB JSON-body-cap maakt het native upload-pad onbruikbaar voor echte audio
**Type:** APP/FW-config · **Raakt:** §8 (voice-input)

- **Scenario.** Mobiel ingesproken audio uploaden → STT → ticket/prompt.
- **Waarom niet native.** `getParams` (`packages/core/src/getParams.ts`) handhaaft `projectConfig.http.requestBodyMaxBytes` (default **1 MiB**) op elke `/api/*`-POST, en parst **alleen** `application/json` + `x-www-form-urlencoded` (415 op de rest — **geen** multipart-parser, **geen** streaming-to-disk). Native upload = base64-in-JSON (`processUpload`, avatar-patroon in `src/settings/_api/updateUser_v1.ts`), en base64 inflateert ~33% → effectief **~0.75 MiB** audio.
- **Impact.** Native pad = enkele seconden audio.
- **Aanpak.** Voor echte voice: dedicated **streaming `registerCustomRoute`-handler** (ruwe `req`/`res`, parse multipart/octet-stream zelf, **omzeil** `getParams`), authenticate handmatig via `extractTokenFromRequest`+`getSession`, dan STT (Whisper/cloud) in de handler of downstream `_api`. Voor korte clips: verhoog `requestBodyMaxBytes` + base64-`_api`. STT zelf = app-code (geen framework-primitive).
- **Inschatting.** Halve dag streaming-route + STT-call (lage prioriteit per §8).

---

## 🟡 Minors / ⚪ Notes

### G18 ⚪ — `AuthProps.additional[]` kan geen per-stage/per-tool-permissiematrix uitdrukken
**Raakt §7.6.** `validateRequest` (`packages/core/src/validateRequest.ts`) doet alleen platte predicates op top-level `BaseSessionLayout`-keys (strict-equality / typeof / nullish / falsy). Een stage→tool→permissie-matrix is **authz-policy**, geen authenticatie. **Aanpak:** houd de framework-gate op `auth={login:true}` (sessie vereist) en handhaaf de matrix in `main(...)` of via één project-brede `preApiExecute`-hook-subscriber (stop-signal-capable). Geen defect — juiste altitude.

### G19 🟡 — Geen ingebouwde SSH/signature/nonce-primitives
**Raakt §3.3.** Grep over `packages/` vond nul SSH/public-key/challenge-helpers. **Aanpak:** nonce-uitgifte via het bestaande Redis-`NX`-patroon (`createOAuthState`/`consumeOAuthState` in `packages/login/src/login.ts`), signature-verificatie met Node `crypto.verify` in een `registerCustomRoute`-endpoint, dan `saveSession(randomBytes(32).hex, sessionLayout, true)` — identiek aan hoe credentials/OAuth convergeren. SSH-pubkeys op het user-record via custom `UserAdapter`; `sshKeyId`/`gitlabToken` op de sessie via `declare module '@luckystack/core' { interface BaseSessionLayout }`. **Geen blocker** — gewoon build-on-top. Voeg expliciet `checkRateLimit` toe op de verify-endpoint (brute-force).

### G20 🟡 — PTY-ordering/latency: route niet via sync-fanout's fire-and-forget + `flushPressure`
**Raakt §3.2.** Sync-fanout yieldt periodiek (`fanoutYieldEvery/Ms`) en `createStreamThrottle` is ~50ms LLM-georiënteerd — het tegenovergestelde van keystroke-echo. **Aanpak:** emit pty-stdout direct met `socket.emit('pty:data', chunk)` op de `/pty`-namespace (Socket.io bewaart emit-volgorde per socket); flow-control via node-pty `pause()`/`resume()` of een eigen ~5–10ms-coalescing-window.

### G21 🟡 — Router-`wsProxy` pint socket.io-upgrades op de `system`-service
**Raakt §7.2/§12.** `createWsProxy` (`packages/router/src/wsProxy.ts:13,40-49`) stuurt élke WS-upgrade naar `system`. **Aanpak:** front de app/orchestrator **niet** met de router (skip 'm voor dit product); laat de edge-proxy WS op host/pad routeren. Als de router toch ergens staat: een `/pty`-namespace rijdt mee op `/socket.io/` (transparant), maar een aparte WS-poort vereist een eigen proxy-regel.

### G22 🟡 — devkit-supervisor is geen herbruikbare proces-supervisor
**Raakt §7.5.** `packages/devkit/src/supervisor.ts` is een standalone dev-only entry, **hardcoded** op `spawn(tsx, 'server/server.ts')`, module-level singletons (één child), devDependency-only. **Aanpak:** níét hergebruiken; bouw je eigen supervisor (`node:child_process.spawn`) met supervisor.ts enkel als **patroon-referentie** (spawn + SIGTERM-grace + crash-restart + Windows-force-exit). Eigen `Map<ticketId, child>`.

### G23 🟡 — `aggregateRaw`/`$runCommandRaw` returnen untyped `Prisma.JsonObject`
**Raakt §5/§6.** Vector-resultaten komen untyped terug (`node_modules/.prisma/client/index.d.ts:151,1358`); de strict-typing-policy verbiedt `as unknown as T`. **Aanpak:** valideer met **zod** (al een core-dep) → typed waarde zónder cast. Centraliseer in één `functions/rag.ts`-wrapper (injected als `functions.rag.*`).

### G24 🟡 — Redis-key-prefix-multi-tenancy is een per-call-conventie, niet afgedwongen
**Raakt §6.3 (queue-keys).** De redis-proxy prefixet niet automatisch; `getProjectName()`-prefixing gebeurt handmatig per call-site (`packages/login/src/session.ts:337` → `${getProjectName()}-session:${token}`). Twee schema's co-existeren (session-stijl vs rate-limit-stijl). **Aanpak:** exporteer in `functions/redis.ts` een kleine key-builder (`ragKey = s => \`${getProjectName()}-rag:${s}\``) en route alle RAG-queue/cache-keys erdoor. Voorkomt collisions in het 20-worktree-scenario. (Framework-roadmap: `registerRedisKeyFormatter`.)

### G25 🟡 — Cross-instance per-recipient `_client`-logica draait alleen op de lokale instance
**Raakt §12 (alleen bij horizontaal geschaalde app-tier).** Onder de Redis-adapter bereikt `broadcastStream`/`io.to(room).emit` alle instances, maar `handleSyncRequest`'s per-recipient `_client`-loop draait alleen tegen **lokale** sockets. **Aanpak:** voor de event-log live-push níét leunen op per-recipient `_client`-transforms cross-instance — emit één `serverOutput` (broadcast dekt cross-instance) en filter per-viewer client-side of via room-design (per-ticket-rooms). Non-issue bij één app-instance.

### G26 🟡 — Geen supervisor/proces-manager in de consumer-template
**Raakt §7.5.** De scaffold draait `tsx server/server.ts` direct (geen crash-restart). **Aanpak:** (a) container-restart-policy, (b) wire devkit-supervisor expliciet, of (c) accepteer tsx-direct en laat de AI/orchestrator herstarten (voor een interactieve AI-dev-terminal meestal prima — de backend-terminal is één van de geordende terminals die de AI kan herstarten).

### G27 ⚪ — Geen native STT (speech-to-text)
**Raakt §8.** Niets in het framework zet audio om naar tekst. **Aanpak:** Whisper/cloud-STT-call in de voice-handler; STT-credentials als env + een dunne `functions/`-shim (zoals db/redis/sentry).

### G28 ⚪ — Geen LuckyStack skill/tool-registry; stage-AI-config is app-data + container-provisioning
**Raakt §4.3/§7.6/§14 — bevestigt de `[FRAMEWORK-MATCH §14]`-grens exact.** `packages/core/src/hooks/types.ts` `HookPayloads` somt **elke** hook op: nul `skill`/`tool`/`command`. De enige "skills" zijn Claude-Code-developer-`SKILL.md`-docs (incl. `agent-browser`) die de scaffold in `skills/` zet voor de **menselijke** Claude-Code-sessie — geen runtime-API. **Aanpak:** modelleer per-stage-config (sources, skills, whitelisted commands, per-tool-permissies, instructies, visibility, process-start, prompt-injectie) als **Prisma-modellen**; render bij container-creatie naar **bestanden in de container** (`.claude/settings.json`, `CLAUDE.md`, `skills/`) + injecteer de stage-start-prompt over de node-pty-stream. LuckyStack **slaat op + serveert** config en bezit de websocket-terminal-transport; het "biedt geen skill aan een AI".

### G29 ⚪ — node-pty/xterm-terminal en dynamische reverse-proxy zijn buiten framework-scope
**Raakt §3.2/§7.2.** LuckyStack levert Socket.io-transport (waar de terminal-WS op kan rijden) maar geen pty-management of proxy-orchestratie. **Aanpak:** node-pty in het orchestrator-proces, bridge over een Socket.io-namespace (G4); Traefik/Caddy out-of-band beheren. Framework-sockets enkel als transport.

---

## Erfenis-grenzen uit de baseline (raken dit product ook)

| # | Grens | Relevantie voor Workspaces |
|---|---|---|
| B1 | **Niets gepubliceerd**; npm-org `@luckystack` bestaat niet | Bouw nu tegen in-repo/workspace-versie; publish-blocker staat los van dit project. Zie `project_npm_scope_registration`. |
| B2 | **Geen RBAC/roles/org-tenant-model** | Het product heeft per-project-pipelines, per-stage-permissies, mogelijk meerdere gebruikers/teams → **alle** rol/permissie/tenant-modellering is app-werk (Prisma + handler-authz, G18). |
| B3 | **`@luckystack/monitoring` ongebouwd** | §11's audit-log bouw je zelf op Mongo (G2); P95/P99/forensics-dashboards zijn er niet. De event-log dekt audit, niet metrics. |
| B4 | **MongoDB-default pint Prisma 6.19** | Geen blocker voor vector-search (G10 — door Mongo geserveerd), maar Prisma-7-features vereisen SQL + ongebouwde driver-adapter-migratie. Het product kiest sowieso Mongo (RAG). |
| B5 | **Pure SPA, geen SSR/SEO** | Geen probleem: de app zit achter SSH-auth, geen SEO-behoefte. Wel: geen data-loader/cache-laag → board/lijsten met `useEffect`+lokale state of een meegebrachte data-library. |
| B6 | **Alleen Dropdown/MultiSelect als form-primitives** | Drag-and-drop-board + rijke UI vereisen meegebrachte libraries (dnd-kit etc.) — door het product al voorzien (§4.2). |

---

## <a id="framework-pr-kansen"></a>Framework-PR-kansen (optioneel, maken dit product schoner)

> Deze zijn **niet** nodig (elke heeft een app-workaround), maar zouden Workspaces — en elk vergelijkbaar orchestratie-product — first-class maken. Goede kandidaten om vóór of kort na publish in het framework te zetten.

| PR | Wat | Lost op | Effort (ruw) |
|---|---|---|---|
| **PR-1** | Registreerbare **origin-exempt path-prefix-lijst** + optionele **`skipBodyParse`/`PRE_PARAMS` custom-route-seam** voor webhooks | G6 + G7 (server-to-server-webhooks first-class, body-HMAC mogelijk) | 1 dag in `packages/server` |
| **PR-2** | **Keyed client-registry**: `registerPrismaClient(client, key?)` + `getPrismaClientFor(key)` (idem Redis) | G9 (gegradeerde per-stage-credentials zonder app-pool) | Halve dag in `packages/core` |
| **PR-3** | `registerRedisKeyFormatter` (staat al op de roadmap) | G24 (afgedwongen multi-tenant-key-prefix) | Halve dag in `packages/core` |
| **PR-4** | Optionele **detached-process / pty-transport-helper** (twijfelachtig — mogelijk bewust buiten scope) | G4/G5 (minder boilerplate voor terminal-gateways) | 1–2 dagen; **eerst** ontwerpdiscussie of dit überhaupt in het framework hoort |

> **Aanbeveling:** PR-1 en PR-2 zijn de twee die het meeste app-boilerplate + scherpe randen wegnemen en passen netjes binnen de bestaande extension-point-filosofie. PR-4 is discutabel: het kan de "transport-framework, geen agent-runtime"-grens vervagen — eerst sparren.
