# Workspaces — Diepgaande spec met LuckyStack-koppeling

> Levende spec voor uitvoering door meerdere AI-agents. Verwerkt de volledige projectsamenvatting (`Workspaces — Projectspecificatie`) én koppelt elk onderdeel aan wat in de LuckyStack-codebase is geverifieerd. Elke feature heeft een **bucket-tag** (🟢 native · 🟡 extension · 🟠 build-on-top · 🔴 out-of-bounds). Framework-grenzen verwijzen naar [`FRAMEWORK_GAPS.md`](./FRAMEWORK_GAPS.md) (`G#`). Baseline in [`FRAMEWORK_CAPABILITIES.md`](./FRAMEWORK_CAPABILITIES.md).
>
> Geverifieerd via 2 parallelle sweeps (17 agents) tegen `packages/*` op branch `chore/package-split-prep`. Laatste update: 2026-06-02.
>
> **⚠️ Gemaakte keuzes staan in [`BESLISSINGEN.md`](./BESLISSINGEN.md) (B-01…B-39); het formele datamodel in [`DATAMODEL.md`](./DATAMODEL.md); de Claude-config-mapping in [`CLAUDE_SETTINGS_MAP.md`](./CLAUDE_SETTINGS_MAP.md); de pre-build review in [`REVIEW.md`](./REVIEW.md). Waar deze spec en die docs verschillen, winnen die docs** (sommige secties hieronder zijn vóór die keuzes geschreven). Kernkeuzes: multi-tenant (tenant = Workspace, trusted small-group), OAuth-login + SSH-key voor terminals, RBAC Owner/Admin/Member, GitLab-token per workspace (GitLab = SoT), Caddy, Atlas Local, één base-image, per-container pty-agent, notificaties + web-push, spend/budget + runaway-control, `.claude/settings.json`-first config, lagensysteem = context-docs + skills/MCP.

---

## 0. Het centrale inzicht: Workspaces is twee systemen

De grootste ontwerpconclusie uit de codebase-analyse: **niet de helft van de "wow"-features zijn framework-features.** Workspaces valt uiteen in twee duidelijk gescheiden systemen, en LuckyStack bedient er één van uitstekend en de ander alleen als transport-fundament.

| Systeem | Wat | LuckyStack-rol |
|---|---|---|
| **De web-app** | Workspace-manager-UI, scrum-bord (view op GitLab), live event-log-view, presence, per-stage-config-CRUD, SSH-auth, het tonen/bedienen van terminals | **Kern-fit.** Hier shipt LuckyStack: file-routing, getypeerde `_api`/`_sync`, sessies, sockets, presence, function-injection. Draai als **één** standaard LuckyStack-server. |
| **De orchestrator** | Docker-containers, git-worktrees, ~20 Claude-CLI-processen, node-pty-terminals, RAG-indexer-queue, GitLab-webhook, Atlas-Local, Traefik/Caddy-config | **Alleen fundament.** LuckyStack levert transport/auth/socket-primitieven die de orchestrator hergebruikt, maar de zware infra is **eigen bouw**. Draai als **aparte, single-instance** Node-service (mag `@luckystack/core` importeren voor `tryCatch`/logger/Redis). |

> **Waarom dit ertoe doet:** de bouwvolgorde (§15 van de samenvatting) zet de orchestrator-/container-/proxy-infra terecht vooraan — want dat is het deel dat LuckyStack *niet* voor je doet. De web-app erbovenop is relatief snel zodra het fundament staat. Verwar de twee niet: de app schaalt horizontaal (stateless + Redis-adapter), de orchestrator blijft één proces (host-gebonden state — [G8](./FRAMEWORK_GAPS.md#g8), [G16](./FRAMEWORK_GAPS.md#g16)).

### 0.1 Systeemtopologie (voorgesteld)

```
                         Internet / telefoon
                                │  (wildcard-TLS, *.<domein>)
                    ┌───────────▼────────────┐
                    │   Edge-proxy            │   Traefik (Docker-label-provider)
                    │   Traefik / Caddy       │   of Caddy (admin-API). TLS hier. (G3)
                    └──┬─────────┬─────────┬──┘
            app.<domein>│  term.<domein>│  dev-<id>.<domein>│ (per ticket)
            ┌───────────▼──┐  ┌─────────▼──────────┐  ┌─────▼─────────────────┐
            │ Workspaces   │  │ Orchestrator        │  │ Ticket-container N    │
            │ web-app      │  │ (single-instance)   │  │ ┌───────────────────┐ │
            │ = LuckyStack │  │ • Docker/worktree   │  │ │ Vite :5173 (expose)│ │ (G14)
            │   server     │  │ • node-pty Map      │  │ │  └─proxy→ backend  │ │
            │ • board UI   │  │ • /pty namespace(G4)│  │ │ Node backend :80   │ │
            │ • event-log  │  │ • bullmq worker(G1) │  │ │ Claude CLI proces  │ │
            │ • presence   │  │ • GitLab webhook    │  │ │ .claude/settings   │ │
            │ • SSH-auth   │  │ • Workspace-AI      │  │ │ skills/ CLAUDE.md  │ │
            └──────┬───────┘  └──────────┬──────────┘  └────────────────────┘ │
                   │                     │             └───────────────────────┘
                   └────────┬────────────┘
                   ┌────────▼─────────┐   ┌──────────────────┐
                   │ Redis (gedeeld)  │   │ MongoDB + Atlas   │
                   │ sessies, fanout, │   │ Local (vector)    │
                   │ seq, queue, pres.│   │ RAG, event-log,   │
                   └──────────────────┘   │ tickets, config   │ (G10)
                                          └──────────────────┘
```

---

## 1. Probleem & visie (samenvatting §1)

Geen framework-impact — context. Kernspanning: het terminal-wildgroei-probleem wordt opgelost door **browser-terminals** (de orchestrator's `/pty`-namespace, [G4](./FRAMEWORK_GAPS.md#g4)) en **één workspace** (de LuckyStack-app). De toetssteen ("op het water, telefoon, voice, tickets managen, app sluiten, op de achtergrond draait alles door") vertaalt naar twee harde eisen die de architectuur sturen:
1. **Autonoom doorlopen terwijl de gebruiker weg is** → prompt-injectie + queue-gedreven pipeline (§4.7, §10), niet request-gebonden.
2. **Mobiel live kunnen meekijken** → realtime event-log met **catch-up na reconnect** ([G11](./FRAMEWORK_GAPS.md#g11)), want mobiel valt weg.

---

## 2. Workspace-manager (samenvatting §3)

### 2.1 Tabs/sessies — 🟢 NATIVE (app-UI)
Het browser-achtige tab-/sessiesysteem is **gewone SPA-state + routing**. LuckyStack levert React 19 + React Router 7 glob-routing (`src/<page>/page.tsx`), per-page `template`-const, en de provider-stack. De session-manager (welke tabs open, gekoppeld aan ticket+stage) is app-state, eventueel gepersisteerd per gebruiker in Mongo.
- **`[FRAMEWORK-MATCH §3.4]` — modelleert LuckyStack views/tabs/sessies?** Nee, niet als concept — en dat hoeft niet. "Tabs" zijn pure client-UI; er is geen framework-tab-model nodig. Wél herbruikbaar: de **page/template/middleware**-structuur voor de verschillende views, `menuHandler` voor modals/sheets, en `useSession`/`useSocketStatus` voor live status. Eigen app-onderdelen mogen **paths** zijn (§7.1) — dat is je eigen UI, geen dev-server-root-probleem.

### 2.2 Browser-terminals (kernfeature) — 🟠 BUILD-ON-TOP — [G4](./FRAMEWORK_GAPS.md#g4), [G5](./FRAMEWORK_GAPS.md#g5)
- **`[FRAMEWORK-MATCH §3.4]` — hoe exposet LuckyStack een draaiend CLI-proces als interactieve terminal?** **Niet native** — er is nul "interactieve terminal"-support in de source (geverifieerd: de streaming-primitives zijn JSON-only, één richting, fire-and-forget — `packages/core/src/apiTypeStubs.ts:21`, `packages/sync/src/handleSyncRequest.ts`; `docs/ARCHITECTURE_SOCKET.md` Core-Events kent geen bidirectioneel event). **Maar** de bouwstenen zijn er volledig:
  - De gedeelde Socket.io-`io` is bereikbaar via `bootstrapLuckyStack({...}).ioServer` (`packages/server/src/types.ts:81`) en `getIoInstance()` (`packages/core/src/socketTypes.ts`). `server/server.ts` gooit `ioServer` nu weg → **één regel** bewaren, geen fork.
  - **Aanpak:** eigen `ioServer.of('/pty')`-namespace op de orchestrator. Auth verbatim hergebruiken: `registerSocketMiddleware`/namespace-`.use()` + `extractTokenFromSocket` + `getSession`. Eigen `pty:data`(binair, beide richtingen)/`pty:resize`/`pty:exit`. node-pty-processen in een `Map<ticketId, {pty, ringBuffer}>` **los van de socket-levenscyclus** (overleeft tab-sluiting; ring-buffer voor reconnect-repaint). **Niet** via `syncRequest`/`broadcastStream` (verkeerde contract).
  - Front-end: **xterm.js** (`term.onData→emit`, `socket.on('pty:data')→term.write`, `term.onResize→emit`). Op telefoon precies dezelfde sessie als desktop.
- **Effort:** ~1 dag eerste werkende versie + hardening voor 20-sessie-concurrency + detach/reaper.

### 2.3 Auth-model: OAuth-login + SSH-key voor terminals (B-05) — 🟡 EXTENSION — [G19](./FRAMEWORK_GAPS.md#g19)
> **Besluit (B-05):** OAuth = primaire **login/identiteit**; een gekoppelde **SSH-publieke sleutel** is vereist om **terminals** te openen. De SSH-challenge/response is dus een **capability-gate op de `/pty`-namespace**, niet de primaire login.

- **Login (OAuth) — 🟢/🟡:** GitHub/GitLab-OAuth via `registerOAuthProviders` (built-in factories of raw `FullOAuthProvider`); convergeert op `saveSession` (`packages/login/src/session.ts:36`). GitLab-OAuth heeft als bonus dat de board-integratie (§3.1) eventueel een per-user token kan meenemen — maar de **token leeft per workspace** (B-07), niet per user, dus de OAuth-token wordt voor identiteit gebruikt, niet als bron-van-waarheid voor GitLab-API-calls.
- **SSH-key als terminal-capability — 🟡/🟠:** bij het openen van een `/pty`-terminal eist de orchestrator een **SSH-challenge/response**: server stuurt een nonce (Redis-`NX`-patroon `createOAuthState`/`consumeOAuthState`, `packages/login/src/login.ts:44-73`), client tekent met de **privé** sleutel (die client-side blijft), server verifieert met `crypto.verify(...)` tegen de **publieke** sleutel die aan het OAuth-account gekoppeld is. Pas bij succes wordt de node-pty aan de socket gekoppeld. Reden: een terminal = shell-toegang tot een container, dus je wilt sterke key-gebaseerde proof (zoals SSH naar een server), bovenop de gewone app-sessie.
- **User/sessie-vorm:** SSH-pubkeys gekoppeld aan het user-record via custom `UserAdapter` (`registerUserAdapter`); getypeerde velden via `declare module '@luckystack/core' { interface BaseSessionLayout { userId: string; workspaceRoles?: Record<string,'owner'|'admin'|'member'>; sshKeyVerified?: boolean } }`.
- **Privé sleutel blijft client-side** — server verifieert alleen tegen de publieke helft (exact zoals GitLab). Geen server-side private keys.

### 2.4 Mobiel — 🟢 NATIVE (app-UI) + 🟠 voice (§8)
Tab-benadering = responsive SPA. Voice = aparte slice (§8, [G17](./FRAMEWORK_GAPS.md#g17)).

---

## 3. Scrum-omgeving (samenvatting §4)

### 3.0 Tenant-model: Workspace = tenant (B-02, B-06, B-07, B-08) — 🟠 BUILD-ON-TOP — [B2](./FRAMEWORK_GAPS.md)
> **Besluit:** multi-tenant-klaar; **tenant = Workspace**. Iedereen kan een workspace aanmaken, leden via **e-mail-invite** toevoegen, en **per workspace** een GitLab-token koppelen.

- **`Workspace`-entiteit** (top-level tenant): `id`, `naam`, `gitlabToken` (versleuteld), `gitlabBaseUrl`, leden. Alle ticket-/board-/pipeline-/RAG-/event-data hangt aan een `workspaceId`.
- **Membership + RBAC (B-08):** `WorkspaceMember { workspaceId, userId, role: 'owner'|'admin'|'member' }`. Owner = token+leden+billing; Admin = pipeline/config; Member = werkt op tickets. **Framework levert alleen de auth-gate** (`auth={login:true}`); de rol-matrix is app-authz in `main(...)` of één `preApiExecute`-hook ([G18](./FRAMEWORK_GAPS.md), [B2](./FRAMEWORK_GAPS.md)) — geen framework-RBAC.
- **E-mail-invites — 🟢 NATIVE fit:** `@luckystack/email` (Console/Resend/SMTP + template-registry) dekt de invite-flow direct. `Invite { workspaceId, email, role, token, expiresAt }` → mail met accept-link → bij accept een `WorkspaceMember`.
- **Tenant-isolatie (multi-tenant):** data-scoping op `workspaceId` via composeable **`Prisma $extends`** (where-injection — de sanctioned interceptie, [G9](./FRAMEWORK_GAPS.md)/datamodel-story); Redis-keys per workspace via **R3 `registerRedisKeyFormatter`** ([FRAMEWORK_REMEDIATION R3](./FRAMEWORK_REMEDIATION.md)). Patroon-doc = **D-MT** (`docs/ARCHITECTURE_MULTI_TENANCY.md`, framework-first).

### 3.1 Bord als view op GitLab — 🟡 EXTENSION
GitLab = bron van waarheid; het bord rendert issues en duwt terug via de GitLab-API. Dit is **app-domein**: `_api`-routes die de GitLab-API aanroepen (server-side, met de **per-workspace** GitLab-token (B-07) — versleuteld op de `Workspace`, of via `@luckystack/secret-manager`), Prisma als cache/projectie gescoped op `workspaceId`. LuckyStack levert getypeerde `_api`-routes, `functions`-injection (db/redis), en sockets om bordwijzigingen live te pushen. Drag-and-drop = meegebrachte library (dnd-kit) — 🟢 consumer brengt library, geen framework-rol. **Let op** [B5](./FRAMEWORK_GAPS.md): geen data-loader/cache-laag → board-data met `useEffect`+lokale state of een meegebrachte fetch-library; sync-events houden 'm live.

### 3.2 De pipeline & stages — 🟡 EXTENSION (datamodel) — [G28](./FRAMEWORK_GAPS.md#g28)
Per-stage-config is **app-data**, geen framework-concept. Er is **geen** LuckyStack skill/tool-registry (geverifieerd: `packages/core/src/hooks/types.ts` `HookPayloads` kent nul skill/tool/command — de enige "skills" zijn Claude-Code-developer-`SKILL.md`-docs voor de menselijke sessie).
- **Datamodel (voorstel, [OPEN]→ingevuld):** `Project` 1‑N `PipelineStage`. `PipelineStage`: `aiEnabled:Boolean`, `order:Int`, `customInstructions:String`, `promptInjectionTemplate:String`, `visibleStageIds:String[]`, `processStartConfig:Json`. Kind-collecties: `StageSkill`, `StageCommand` (whitelisted shell-pattern), `StageToolPermission` (`tool` enum mongo/redis/… + `accessLevel` read-only|read-write), `StageSource` (ref naar info-bron + type). **Genormaliseerd** (niet één Json-blob) zodat de Workspace-AI (§9.3) de config met echte queries kan beoordelen.
- **Levering aan de container:** bij worktree-/container-creatie rendert de orchestrator deze rijen naar **bestanden**: permissions/commands → `.claude/settings.json` (allow/deny + per-tool MCP); instructies/visibility → `CLAUDE.md`; skills → kopieer matchende `skills/`-folders; `promptInjectionTemplate` → naar de Claude-CLI-stdin over de node-pty-stream (§4.7).
- **Twee niveaus strikt scheiden** (samenvatting §4.3 sluit): **stage** = pipeline-stap; **status** = ticket-toestand binnen die stap. Beide app-enums.

### 3.3 Eén ticket, één stage, één AI-instance — 🟠 BUILD-ON-TOP (orchestratie) — [G8](./FRAMEWORK_GAPS.md#g8)
Parallelliteit op bordniveau (~20 instances) is **orchestrator-werk**: `Map<ticketId, ChildProcess>`, per-proces, single-instance-pinned. LuckyStack bezit hier niets; het levert alleen de sockets om de status live te tonen.

### 3.4 Zichtbaarheid van stages — 🟡 EXTENSION (app-authz)
"Bron-stage bepaalt eigen zichtbaarheid" = `visibleStageIds` op de stage, afgedwongen in app-code wanneer een stage-AI andere stages inleest. **Niet** via `AuthProps.additional[]` ([G18](./FRAMEWORK_GAPS.md#g18) — dat doet alleen platte sessie-veld-predicates).

### 3.5 Automatische prompt-injectie bij stage-start — 🟠 BUILD-ON-TOP
- **Mechaniek:** bij stage-overgang schrijft de orchestrator de prompt naar de **Claude-CLI-stdin via de node-pty-stream** (G4). CI/CD-stijl carry-over: output van de vorige stage gaat mee. De command-veiligheidsgrens blijft op `.claude/settings.json`-niveau (whitelist/accept-flow) — de prompt komt automatisch, de *commando's* niet.
- **Stage-output-carry-over (B-O2 beslist): subset + on-demand volledig.** Injecteer een **gestructureerd subset** `{ vorigeStage, summary, changedFiles[], openQuestions[], commitHash }` als startprompt; de volgende AI haalt de **vólledige** vorige-output zelf op via de **event-log/cross-ticket-skill** (§4.2) als-ie meer context nodig heeft. Elke stage **produceert dit subset als verplicht eind-contract**. Zo: scherpe, goedkope injectie + niets verloren (volledige output blijft in de event-log, §10, en is opvraagbaar).

---

## 4. Informatiesysteem: context-docs + skills/MCP (samenvatting §5; herontwerp B-14…B-20)

> **Kern-herontwerp (B-14):** het "lagensysteem" splitst in **twee subsystemen** i.p.v. één set inlaadbare lagen. Dit verenigt §5 (lagen) + §4.3 (skills) + §7.6 (tool-access) + de graphify-MCP-keuze, en lost §5.4 `[OPEN]` op (je laadt nooit een hele bron — de AI **queryt een slice via een skill**, gefilterd op de commit-hash → bevriezing-per-ticket automatisch).

### 4.1 📄 Context-docs (±5) — 🟢/🟡 (files in git, per stage geladen)
Klein, stabiel, breed relevant → **als geheel in de prompt/`CLAUDE.md`** van de stage-container geladen. Bevroren per commit-hash. Leven als **file in git** (gratis versioning, §5.1).
- `project-summary` (altijd — oriëntatie), `conventies/stijl` (altijd — house-style ≈ `CLAUDE.md`), `domein-glossary` (selectief), `db-schema` (klein → laden; groot → skill), `geüploade spec/docs` (selectief).

### 4.2 🔧 Skills/MCP (de rest) — 🟠 BUILD-ON-TOP (B-15, B-16)
On-demand aangeroepen door de Claude-CLI als **MCP-servers**, per stage aan/uit via `.claude/settings.json` (Claude-CLI-niveau, [G28](./FRAMEWORK_GAPS.md)). Twee soorten:
- **Over een bevroren-per-commit store:** RAG → `semantic_search(query)` · code-graph → `impact_of(symbol)`/`graph_query` (**graphify-MCP**, B-19) · type/symbol-index → `lookup_symbol`/`get_signature` · route/API-index (groot project) → `find_route`. De skill filtert intern op de **commit-hash** van het ticket → frozen-per-ticket (§5/§6).
- **Live (geen frozen store):** git-history → `history_of(file)`/`blame` · test/coverage → `run_tests`/`coverage_for` · observability → `recent_errors` (needs monitoring — eigen gap) · dependency/security → `audit_deps` · cross-ticket → `find_related_tickets` (live, §6.4).

### 4.3 Datamodel & breedte — 🟡 EXTENSION (B-17)
- **`InfoSource`/`StageContext` + `StageSkill`:** een stage **linkt context-docs** (geladen) én **zet skills/MCP aan** (aanroepbaar). "Stage verwijst naar bron" (§5.4) = **"stage zet een skill aan + pint een store-versie (commit-hash)"**.
- **Breedte v1 = Tier A+B (9 actief):** kern (summary, RAG, graph, route/API-index, db-schema) + verdiepend (test/coverage, git-history, type-index, conventies). Tier C (docs/spec, observability, glossary, deps, cross-ticket) situationeel; observability wacht op `@luckystack/monitoring`. Per project/stage aan/uit (hobby = A-licht, grote codebase = A+B+C).
- **Embeddings (B-18): self-hosted code-model** (nomic-embed/BGE/jina-code in een container) — geen code-egress.

### 4.4 Statisch vs dynamisch & generatie — 🟢/🟠
- **Statisch** (geüpload) en **dynamisch** (door Claude-CLI gegenereerd/geüpdatet) — context-docs leven als file in git; skill-stores (RAG/graph) worden door de **indexer-queue** (§10) bijgewerkt per merge. LuckyStack-rol: `_api`-CRUD + `processUpload` (let op [G17](./FRAMEWORK_GAPS.md#g17) body-cap → streaming custom-route / R4).
- **`[OPEN §5.4]` opgelost (B-20):** filter/query-per-skill (`moduleGlobs[]` + `topK`), nooit hele bron. **`[OPEN §5.2]` opgelost (B-17):** doc/skill-split + Tier A+B.

---

## 5. RAG-versioning: bevroren per ticket, append-only (samenvatting §6) — 🟠 BUILD-ON-TOP — [G10](./FRAMEWORK_GAPS.md#g10), [G23](./FRAMEWORK_GAPS.md#g23), [G24](./FRAMEWORK_GAPS.md#g24)

- **`[FRAMEWORK-MATCH §7.6]` deels — hoe bereik je Mongo + vector-search?** Via de injected `functions.db.prisma`. Raw Mongo-toegang is bewezen: het framework's eigen `readyz`-probe doet `prisma.$runCommandRaw({ ping: 1 })` (`packages/server/src/httpRoutes/healthRoutes.ts`). De Mongo-client exposeert `$runCommandRaw` (top-level) én per-model `aggregateRaw({ pipeline: [...] })` (`node_modules/.prisma/client/index.d.ts:151,1358`) — **dé** typed weg voor een `$vectorSearch`-pipeline. **Geen aparte Mongo-driver of externe vector-store nodig** voor het datapad.
- **Datamodel:** `RagEntry { id, commitHash, embedding Float[], content, metadata Json, createdAt }`, `@@index([commitHash])`, **append-only** (app-afgedwongen immutability — expose nooit update/delete). De vector-index zelf leeft **Atlas-side** (Prisma kan 'm niet declareren).
- **Vector-query (frozen-per-ticket):** `functions.db.prisma.ragEntry.aggregateRaw({ pipeline: [{ $vectorSearch: { index, path:'embedding', queryVector, numCandidates, limit, filter: { commitHash: { $eq: ticketCommit } } } }, { $project: {...} }] })`. De commit-hash-filter **in** `$vectorSearch.filter` → bevriezing afgedwongen op de index, niet post-filter.
- **Hergebruik op commit-hash (§6.3):** record-aanmaak = `git pull` → commit-hash → bestaat snapshot? → koppel : indexeer + stempel. Ticket-prefix (`DEV-1234`) = label voor branch/worktree; RAG-versie hangt aan **codebase-staat (commit-hash)**. Twee tickets op dezelfde ochtend-commit delen één snapshot.
- **Infra-eis ([G10](./FRAMEWORK_GAPS.md#g10)):** `$vectorSearch` vereist **Atlas Local** in de Docker-stack (vanilla `replicaSet=rs0` serveert het niet). Fallback: `Float[]` + cosine in de Node-worker tot ~10k vectoren/snapshot.
- **Typing ([G23](./FRAMEWORK_GAPS.md#g23)):** raw-resultaten zijn untyped `JsonObject` → **zod-parse** (geen `as`-cast; strict-typing-policy). Centraliseer in één `functions/rag.ts`-wrapper (injected als `functions.rag.*`).
- **`[OPEN §6.5]` — opruim-policy → voorstel:** append-only houden; een achtergrond-job (de cron-watcher, [G1](./FRAMEWORK_GAPS.md#g1)) verwijdert RAG-versies **ouder dan de oudste nog-actieve ticket-commit**. Opslag is goedkoop → geen fundament-beslissing, prima om later toe te voegen. **Afweging:** nooit opruimen = simpel maar onbeperkte groei; commit-watermark-opruiming = iets meer code maar bounded.

---

## 6. Infrastructuur per ticket (samenvatting §7)

### 6.1 Worktree, container, subdomein — 🔴/🟠 (orchestrator + infra) — [G3](./FRAMEWORK_GAPS.md#g3), [G14](./FRAMEWORK_GAPS.md#g14), [G15](./FRAMEWORK_GAPS.md#g15)
- **`[FRAMEWORK-MATCH §7.2/§7.5]` — hoe start LuckyStack zijn processen, hoeveel poorten?** **DEV = 2 processen/poorten** (geverifieerd, `packages/create-luckystack-app/template/{package.json,vite.config.ts}`): **Vite** (`vite --host`, vaste poort **5173**, browser-facing) proxyt `/api`,`/sync`,`/auth`,`/uploads`,`/socket.io`(ws) + health naar de **Node-backend** (`tsx server/server.ts`, `SERVER_PORT` default 80). **PROD = 1 proces/poort** (`node dist/server.js <preset> <port>` serveert static `dist/` + API + sockets, `server/prod/serveFile.ts`).
- **Voorbeeld-process-config voor een ticket-container (2 geordende terminals):**
  - **T1 (eerst):** `npm run server` — env: `NODE_ENV=development`, `SERVER_IP=127.0.0.1`, `SERVER_PORT=80`, `DNS=https://dev-<ticket>.<domein>`, `REDIS_HOST/PORT`, `DATABASE_URL`.
  - **T2:** `npm run client` — Vite op 5173; **dit is de enige poort die de proxy blootstelt**.
- **Proxy-discovery:** edge-proxy → container-Vite-5173; health-gate optioneel op backend-`/readyz` (503→200 bij Redis+Prisma+boot ready).
- **Subdomein, niet path ([G14](./FRAMEWORK_GAPS.md#g14)):** geverifieerd correct — Vite-HMR (`/@vite/client`) en socket.io gebruiken root-relatieve paden; een subdomein-origin is exact wat ze nodig hebben, een path-prefix breekt HMR + socket.io. Eigen app-onderdelen mogen wél paths (§7.1 ✔).
- **DNS/CORS/OAuth-env ([G15](./FRAMEWORK_GAPS.md#g15)):** moet bij container-boot op het ticket-subdomein staan, anders fail-closed CORS.

### 6.2 Reverse proxy — 🔴 OUT-OF-BOUNDS (framework) → INFRA — [G3](./FRAMEWORK_GAPS.md#g3)
- **`@luckystack/router` is hier het verkeerde gereedschap** (decisief geverifieerd): pad-segment-routing niet host; statische bindings uit `deploy.config.ts` (geen runtime-registratie); **plain HTTP, geen TLS** (`packages/router/src/startRouter.ts:139`; `packages/router/CLAUDE.md`: "does NOT terminate TLS").
- **Besluit (B-11): Caddy.** Admin-API-gedreven: de orchestrator **POST't een route** naar Caddy bij container-start en **DELETE't** 'm bij teardown — expliciet, makkelijk te auditen in de event-log, met on-demand/wildcard-TLS voor `dev-<id>.<domein>` + `app.<domein>` + `term.<domein>`. (Traefik-Docker-labels was het alternatief; Caddy gekozen om de expliciete, auditeerbare route-lifecycle.)

### 6.3 Permissions & commands — 🟡/⚪ — [G28](./FRAMEWORK_GAPS.md#g28)
`.claude/settings.json` doet permissions + accept-flow native (Claude-Code-CLI-niveau, **niet** LuckyStack). Containerisatie = de echte isolatie (fundament-beslissing). LuckyStack-rol: alleen de per-stage-config opslaan/leveren (§3.2). Bewust geaccepteerd risico (postinstall-scripts) → blast-radius = één wegwerpcontainer.

### 6.4 Account/API — ⚪ (buiten framework)
Claude-Pro/Max-CLI nu, API als achtervang. `[OPEN §7.4]` parallelle-CLI-policy → **geen framework-vraag**; bevestig bij Anthropic, API-achtervang maakt het non-blocking. Token-kosten geen bezwaar.

### 6.5 Process-start per stage — 🟠 BUILD-ON-TOP — [G22](./FRAMEWORK_GAPS.md#g22), [G26](./FRAMEWORK_GAPS.md#g26)
Geordende terminal-/commandostructuur per stage = `processStartConfig:Json` (bijv. `[{terminal:1, commands:['X','Y','Z']}, {terminal:2, commands:['A','B']}]`). De orchestrator voert dit uit in de container. Runtime-overzicht (welke processen draaien, welke commando's waar) = voedt de event-log (§11). Poortbeheer: container-per-ticket lost intern-poort-conflict op; proxy regelt buiten via subdomein. **devkit-supervisor niet hergebruiken** ([G22](./FRAMEWORK_GAPS.md#g22)) — eigen supervisor, supervisor.ts als patroon-referentie.

### 6.6 Tool-toegang met per-stage permissies — 🟡/🟠 — [G9](./FRAMEWORK_GAPS.md#g9), [G18](./FRAMEWORK_GAPS.md#g18)
- **`[FRAMEWORK-MATCH §7.6]` — hoe legt LuckyStack tool-/serviceconnecties vast, per stage scheidbaar?** DB/cache-connecties = `registerPrismaClient`/`registerRedisClient`, maar dat zijn **globale single-client-singletons** (`packages/core/src/clients.ts`) — **niet** per-stage scheidbaar.
  - **`[OPEN §7.6]` — hoe permissies technisch afdwingen → besluit:** **aparte DB-credentials per niveau** (robuustst). Eén Mongo-user read-only, één read-write; idem Redis. **Met R2 (keyed-client-registry, framework-first):** registreer ze via `registerPrismaClient(client, 'mongo:ro')` etc. en kies in de handler met `getPrismaClientFor(tier)` — gegradeerde credentials worden zo **first-class** i.p.v. een app-eigen pool ([FRAMEWORK_REMEDIATION R2](./FRAMEWORK_REMEDIATION.md), [G9](./FRAMEWORK_GAPS.md#g9)). De stage-config noemt de tier. Framework-internals (sessies/rate-limit/presence) blijven op de default (geprivilegieerde) client. **Afweging:** aparte credentials = echte DB-niveau-isolatie (een read-only-stage *kan* fysiek niet schrijven) > whitelist/proxy-laag (zwakker).
  - De stage→tool→permissie-**matrix** zelf is app-authz in `main(...)` of één `preApiExecute`-hook ([G18](./FRAMEWORK_GAPS.md#g18)) — niet `AuthProps.additional[]`.
  - Uitbreidbaar tool-lijstje (later andere tools): `StageToolPermission.tool` als open enum + de pool-keys.

---

## 7. Voice-input (samenvatting §8) — 🟠 BUILD-ON-TOP — [G17](./FRAMEWORK_GAPS.md#g17), [G27](./FRAMEWORK_GAPS.md#g27)

Lage prioriteit. Native upload = base64-in-JSON via `_api` + `processUpload`, maar **1 MiB body-cap** ([G17](./FRAMEWORK_GAPS.md#g17)) → ~0.75 MiB audio. **Voorstel ([OPEN]):** dedicated streaming `registerCustomRoute`-handler (ruwe `req`/`res`, stream naar disk/S3, omzeil `getParams`), handmatige auth (`extractTokenFromRequest`+`getSession`), dan STT (Whisper/cloud — app-code, [G27](./FRAMEWORK_GAPS.md#g27)) → transcript voedt ticket/prompt. De "losse AI-instance die voice parset" = een LLM-call in de handler. Voor korte clips: verhoog `requestBodyMaxBytes` + base64-`_api`-pad. **Afweging:** `_api`-pad = gratis auth/typing/hooks maar caps grootte; custom-route = arbitraire grootte maar je herbouwt auth.

---

## 8. Workspace-AI (samenvatting §9) — 🟠 BUILD-ON-TOP

Aparte service-logica (draait in/naast de orchestrator). **Toegang tot alles, dynamisch inladen** = app-code die selectief Mongo/git/RAG queryt. **Stage-AI's praten niet onderling, sturen signalen** = append-only **`WorkspaceSignal`-Mongo-collectie** (B-O6 beslist — durable, queryable, onderdeel van de audit, overleeft herstart; optionele socket-nudge voor liveness), de Workspace-AI consumeert **serieel**. **Persistente suggesties/notities** = Mongo (`WorkspaceSuggestion`/`WorkspaceNote`), bij terugkomst getoond ("2 suggesties, 3 notities") via `_api` + live via sync. **Pipeline-config beoordelen (§9.3)** = waarom de genormaliseerde stage-config (§3.2) belangrijk is — de Workspace-AI queryt echte rijen (bijv. "stage refine laadt volle RAG maar stage plan alleen summary → omgedraaid"). **Bron-onderhoud bewaken (§9.4)** = de cron-watcher ([G1](./FRAMEWORK_GAPS.md#g1)) checkt of dynamische bronnen na merge daadwerkelijk geüpdatet zijn. LuckyStack-rol: opslag (`functions.db`), live-push (sync), `_api`-CRUD. Geen framework-AI-concept — alles app/LLM-code.

---

## 9. Merge-trigger & bron-update (samenvatting §10) — 🟠/🔴 — [G1](./FRAMEWORK_GAPS.md#g1), [G6](./FRAMEWORK_GAPS.md#g6), [G7](./FRAMEWORK_GAPS.md#g7)

- **Trigger:** GitLab-merge → webhook → job op queue. Webhook-ingest via `registerCustomRoute` (CSRF-exempt), maar twee scherpe randen: **fail-closed origin-403** ([G6](./FRAMEWORK_GAPS.md#g6) → Traefik injecteert Origin) en **body al geconsumeerd** ([G7](./FRAMEWORK_GAPS.md#g7) → verifieer `X-Gitlab-Token`-header, niet body-HMAC).
- **De race & de oplossing (§10.2-10.3):** **append-only + commit-gestempeld** (§5/§6) elimineert de race structureel. **Eén seriële worker** drain't de queue → bullmq `concurrency:1` ([G1](./FRAMEWORK_GAPS.md#g1)). Geen stilleggen, geen wachten-tot-alles-klaar.
- **Delta-granulariteit (B-O3 beslist): per-changed-files delta.** RAG = alleen chunks van gewijzigde files herindexeren (volledige herindex per merge is te duur); **code-graph** = gewijzigde files herparsen + **dependency-aware propagatie** (een changed file raakt z'n importers). Chunk-niveau dedupe op `commitHash+filePath+chunkId`.
- **Wat blijft/wegwerp (§10.4):** branch in GitLab (waarheid), container wegwerp, **event-log persistent** (§11, overleeft teardown). Heractiveren = pull + worktree + container op bestaande branch.

---

## 10. Event-log & audit (samenvatting §11) — 🟠 BUILD-ON-TOP — [G2](./FRAMEWORK_GAPS.md#g2), [G11](./FRAMEWORK_GAPS.md#g11), [G12](./FRAMEWORK_GAPS.md#g12)

**Dé definiërende slice.** Sync is fire-and-forget transport zonder ordering/log/replay → de **onveranderlijke, geordende, persistente** event-stream is **100% app-eigendom in Mongo**.
- **Model:** `TicketEvent { id, ticketId, seq Int, type, actor, payload Json, commitHash, createdAt }`, append-only, unique `[ticketId, seq]`. `seq` van **Redis `INCR`** ([G2](./FRAMEWORK_GAPS.md#g2)).
- **Eén handler, twee doelen:** `_sync/appendEvent_server_v1.ts` schrijft de rij **en** returnt 'm als `serverOutput` → dezelfde handler doet audit-write + live-push naar de ticket-room (geverifieerd: `serverOutput` wordt verbatim gebroadcast, `packages/sync/src/handleSyncRequest.ts`).
- **Ruwe log = waarheid, samenvattingen = afgeleid** (§11 ✔): een aparte samenvattende dienst (geen 4e agent-per-ticket) leest goedkoop de samenvatting, duikt alleen bij interesse de volle log in. "Terugspoelen" = replay uit Mongo op `seq`.
- **AI-token-streams:** persisteer **gecoalesceerde** events (command issued, file changed, MR-actie, AI-message-finalized), níét elke token; gebruik `broadcastStream`+`createStreamThrottle` voor de live-ticker zónder elke chunk te persisteren. (Wil je token-level-rewind: persisteer throttled chunks van 32 chars/50ms, niet ruwe tokens.)

---

## 11. Realtime & samenwerking (samenvatting §12) — 🟢/🟠 — [G11](./FRAMEWORK_GAPS.md#g11), [G13](./FRAMEWORK_GAPS.md#g13)

- **Live event-view** = dezelfde event-stream als de audit-log (§10) — 🟢 sync-transport native, 🟠 catch-up zelf ([G11](./FRAMEWORK_GAPS.md#g11): subscribe-first → snapshot → merge-op-seq, anders fetch-venster-gat).
- **Presence (collega's live zichtbaar)** = 🟠. `@luckystack/presence` geeft transient AFK/back-pings + status-badge + `LocationProvider`, maar **geen persistente roster** ([G13](./FRAMEWORK_GAPS.md#g13)) → app-eigen Redis-set `presence:ticket:<id>`, gevoed door joinRoom/leaveRoom + presence-hooks, snapshot via `_api`, deltas via sync.

---

## 12. Read-only gedeelde context per ticket (samenvatting §13) — 🟠 BUILD-ON-TOP

Binnen één ticket: één keer genereren, read-only delen met meerdere processen. Dit is exact het **commit-gestempelde RAG-snapshot** (§5) + de **git-files** (read-only in de worktree). De orchestrator genereert per commit-hash één keer; alle stage-processen van dat ticket lezen dezelfde Mongo-snapshot (gefilterd op hun commit-hash) + dezelfde worktree-files. Geen proces muteert de gedeelde waarheid (append-only + read-only files). LuckyStack-rol: `functions.db.prisma` voor de gedeelde Mongo-read.

---

## 13. Latere fasen (samenvatting §14) — ⚪/🔴

- **Externe agent-tools (agent-browser, §14):** **`[FRAMEWORK-MATCH §14]` — kan LuckyStack externe CLI-tools als skill/tool aan een stage-AI aanbieden?** **Nee, en dat is correct.** Er is geen LuckyStack-runtime-skill/tool-concept ([G28](./FRAMEWORK_GAPS.md#g28)). agent-browser is gewoon een CLI-binary in de container-image, toegestaan via de stage-whitelist (`.claude/settings.json`). De stage-/skill-/tool-architectuur (§3.2, §6.6) is breed genoeg om zulke tools later als `StageTool`/`StageCommand` toe te voegen — puur app-data + container-provisioning. LuckyStack weet er nooit van.
- **Andere repos inhaken:** houd het datamodel open (`Project` is al de top-level entiteit; meerdere repos = meerdere projecten/sources). Eindfase.

---

## 14. Bouwvolgorde met feasibility-tags (samenvatting §15)

| # | Stap | Bucket | Kritieke grenzen |
|---|---|---|---|
| 1 | **Ticket-lifecycle-kern** (activeren→pull→worktree→RAG-snapshot→container→stage-AI→MR→merge→delta-queue→teardown) | 🟠 orchestrator | [G1](./FRAMEWORK_GAPS.md#g1), [G8](./FRAMEWORK_GAPS.md#g8), [G2](./FRAMEWORK_GAPS.md#g2) |
| 2a | **Context-/lagengeneratie** (RAG + commit-stamp + vector-search) | 🟠 build-on-top | [G10](./FRAMEWORK_GAPS.md#g10), [G23](./FRAMEWORK_GAPS.md#g23) |
| 2b | **Container-/proxy-infra** (Traefik + subdomein + health) | 🔴→infra | [G3](./FRAMEWORK_GAPS.md#g3), [G14](./FRAMEWORK_GAPS.md#g14), [G15](./FRAMEWORK_GAPS.md#g15) |
| 3 | **Browser-terminals + SSH-auth + process-start** | 🟠 + 🟡 | [G4](./FRAMEWORK_GAPS.md#g4), [G5](./FRAMEWORK_GAPS.md#g5), [G19](./FRAMEWORK_GAPS.md#g19) |
| 4 | **Het bord** (view op GitLab + configureerbare pipeline-stages) | 🟡 extension | [G6](./FRAMEWORK_GAPS.md#g6), [G7](./FRAMEWORK_GAPS.md#g7), [G28](./FRAMEWORK_GAPS.md#g28) |
| 5 | **Workspace-AI** (signalen, suggesties, config-review, onderhoud) | 🟠 build-on-top | [G1](./FRAMEWORK_GAPS.md#g1) |
| 6 | **Realtime/presence + session-manager-UI + mobiel** | 🟢/🟠 | [G11](./FRAMEWORK_GAPS.md#g11), [G13](./FRAMEWORK_GAPS.md#g13) |
| 7 | **Voice-input** | 🟠 build-on-top | [G17](./FRAMEWORK_GAPS.md#g17), [G27](./FRAMEWORK_GAPS.md#g27) |
| 8 | **Externe agent-tools** (agent-browser) | ⚪ app-data | [G28](./FRAMEWORK_GAPS.md#g28) |

> De bouwvolgorde van de samenvatting is goed gekalibreerd: stappen 1-3 zijn precies het deel dat LuckyStack **niet** voor je doet (orchestrator + infra + terminals). Maak die waterdicht; de app erbovenop (4-6) is grotendeels framework-native.

---

## 15. Samenvatting feasibility per slice

| Slice | Bucket | Eénregel-verdict |
|---|---|---|
| Browser-terminals (PTY) | 🟠 | Eigen `/pty` Socket.io-namespace op de gedeelde `io`; auth verbatim hergebruikt; node-pty-lifecycle los van socket. ~1 dag. |
| SSH-auth | 🟡 | `saveSession` is identiteits-agnostisch → nonce + `crypto.verify` + custom UserAdapter. Geen fork. |
| Per-stage/per-tool permissies | 🟠 | Authz in app; **gegradeerde DB-credentials = app-pool** (registry is global single-client). |
| RAG/embeddings | 🟠 | `aggregateRaw($vectorSearch)` via `functions.db.prisma`; **vereist Atlas Local**; zod-typing. |
| Event-log/audit | 🟠 | Sync = transport; **duurzame geordende log = app-eigen Mongo** + Redis-`seq`. Eén handler write+push. |
| Presence | 🟠 | Transient pings native; **persistente roster = app Redis-set**. |
| Webhook/queue/cron | 🟠/🔴 | `registerCustomRoute` + **bullmq + node-cron** (geen framework-scheduler); origin-403 + body-cap workarounds. |
| Dev-env/process/ports | 🟢 | 2-poorts DEV (Vite 5173 exposen), 1-poorts PROD; subdomein-per-ticket correct. |
| Router/proxy/topology | 🟠/🔴 | Router ≠ subdomein-proxy → **Traefik/Caddy**; app single LuckyStack-server; orchestrator single-instance. |
| Voice/uploads | 🟠 | Streaming custom-route (body-cap omzeilen) + externe STT. |
| Skills/tools | ⚪ | Geen framework-concept; alles app-data + container-provisioning. Bevestigt §14. |

---

## 16. Open beslissingen die nog jouw input vragen
Zie [`VRAGEN.md`](./VRAGEN.md) — de gebundelde waslijst (de `[OPEN]`-items hierboven zijn al van een voorstel voorzien; daar staan de keuzes waar ik jouw richting voor nodig heb, plus de scherpe architectuurvragen die de analyse opwierp).
