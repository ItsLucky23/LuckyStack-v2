# Workspaces — Feature-overzicht (3-min scan)

> Platte bullet-lijst per categorie. Elke feature heeft een bucket-tag. Diepe uitwerking: [`IDEE_SPEC.md`](./IDEE_SPEC.md) · framework-grenzen: [`FRAMEWORK_GAPS.md`](./FRAMEWORK_GAPS.md) (`G#`).
>
> 🟢 native · 🟡 extension (geen fork) · 🟠 build-on-top (framework = transport, kern is van jou) · 🔴 out-of-bounds / externe infra · ⚪ bewuste grens

## In één zin
Eén zelf-gehoste, mobiel-vriendelijke webapp die AI-gedreven development orkestreert: per ticket een eigen Claude-CLI in worktree+container, een configureerbare scrum-pipeline, een schaalbaar informatie-lagensysteem (RAG + git), en live meekijken/bedienen vanaf je telefoon.

## ⚠️ Belangrijkste inzicht
- **Workspaces = twee systemen.** (1) De **web-app** (bord, event-log, presence, auth, config) → LuckyStack-kern-fit. (2) De **orchestrator** (containers, worktrees, ~20 CLI-processen, terminals, RAG-queue, proxy) → grotendeels **eigen infra**, LuckyStack alleen als transport-fundament.
- **App schaalt horizontaal; orchestrator blijft één proces** (host-gebonden state — G8/G16).
- **~60% van de "wow"-features zijn geen framework-features** — ze coëxisteren met LuckyStack, het levert ze niet.

## Workspace-manager
- 🟢 Browser-achtig tab-/sessiesysteem (open/sluit/wissel) — pure SPA-state + RR7-routing.
- 🟢 Session-manager: welke tabs open, gekoppeld aan ticket+stage.
- 🟠 **Browser-terminals (kernfeature):** live interactieve terminal ↔ draaiend Claude-CLI (xterm.js ↔ node-pty). Eigen `/pty` Socket.io-namespace op de gedeelde `io`; auth verbatim hergebruikt; pty-lifecycle los van socket (overleeft tab-sluiting) — G4, G5.
- 🟡 **SSH-sleutel-auth** (publieke sleutel op account, privé blijft client-side): nonce + `crypto.verify` + custom `UserAdapter` → `saveSession`. Geen fork — G19.
- 🟢 Mobiel-first responsive UI; dezelfde sessie op telefoon als desktop.

## Scrum-omgeving
- 🟡 Bord = **view op GitLab-issues** (GitLab = waarheid, duwt terug via API); Prisma als projectie/cache.
- 🟢 Drag-and-drop kaartjes via meegebrachte library (dnd-kit).
- 🟡 Backlog + live bord + sprints — app-data + sync voor live updates.
- 🟡 **Configureerbare pipeline van stages** (per project) — genormaliseerd Prisma-datamodel (`PipelineStage` + `StageSkill`/`StageCommand`/`StageToolPermission`/`StageSource`).
- 🟡 Per stage: AI aan/uit · gekoppelde bronnen · skills · whitelisted commands · per-tool-permissies · custom instructies · zichtbaarheid van andere stages · process-start-config · prompt-injectie.
- 🟡 Twee niveaus strikt gescheiden: **stage** (pipeline-stap) vs **status** (ticket-toestand binnen de stap).
- 🟠 Eén ticket → één stage → één AI-instance/container/worktree; parallellisme op bordniveau (~20 instances) — orchestrator-werk, G8.
- 🟡 Zichtbaarheid: bron-stage bepaalt eigen zichtbaarheid (`visibleStageIds`); app-authz, niet `AuthProps` — G18.
- 🟠 **Automatische prompt-injectie bij stage-start** (CI/CD-stijl carry-over) via Claude-CLI-stdin over de pty-stream; commando's blijven onder whitelist/accept-flow.

## Informatie-lagensysteem
- 🟢 Whole-loaded context (project-summary, specs, skills, code-graph-als-file) → **files in git** (gratis versioning).
- 🟠 Queryable semantische context (**RAG/embeddings**) → **MongoDB** via `functions.db.prisma`.
- 🟡 Meerdere schaalbare lagen, elk met eigen samenvatting (hobby 1-2 → grote codebase 10+): voorstel `project-summary` + `rag-embeddings` + `code-graph` als aparte lagen.
- 🟢/🟡 Statische (geüpload) en dynamische (AI-onderhouden) bestanden; dynamische leven mee in git.
- 🟡 Stage **verwijst** naar bron (geen kopie); meerdere stages delen één bron; voorstel: query/filter-per-bron i.p.v. hele bron.

## RAG-versioning (bevroren per ticket)
- 🟠 Append-only Mongo-store, **gestempeld op main-commit-hash** bij worktree-creatie; ticket queryt met eigen commit-hash → live én bevroren-per-ticket.
- 🟠 Vector-search via `aggregateRaw({ $vectorSearch, filter:{commitHash} })` — bewezen raw-Mongo-pad.
- 🔴→infra **Vereist MongoDB Atlas Local** (vanilla replica-set serveert geen `$vectorSearch`) — G10; fallback = app-side cosine.
- 🟢 Snapshot-hergebruik op commit-hash (twee tickets, dezelfde ochtend-commit → één index).
- 🟡 Ticket-prefix (`DEV-1234`) = label voor branch/worktree; RAG-versie hangt aan commit-hash (bewust gescheiden).
- 🟡 Append-only typing via zod (geen `as`-casts) — G23.

## Infrastructuur per ticket
- 🟠 Git-worktree op branch met ticket-prefix.
- 🔴→infra Container per ticket (isolatie + triviale teardown).
- 🔴→infra **Subdomein per ticket** (`dev-1234.<domein>`), niet path (path breekt Vite-HMR + socket.io) — G14.
- 🔴→infra **Dynamische reverse proxy = Traefik/Caddy** (níét `@luckystack/router` — die is pad-segment/static/geen-TLS) — G3.
- 🟢 LuckyStack-dev-env = **2 poorten** (Vite 5173 browser-facing + Node-backend 80); proxy → Vite. PROD = 1 poort.
- 🟡 DNS/CORS/OAuth-env per container op het ticket-subdomein zetten — G15.
- ⚪ Command-whitelisting via `.claude/settings.json` (Claude-CLI-niveau, niet LuckyStack); containerisatie = de echte isolatie.
- 🟠 Process-start per stage = geordende terminals × commando's (`processStartConfig`); eigen supervisor (devkit-supervisor niet herbruikbaar) — G22, G26.
- 🟠 **Tool-toegang met gegradeerde permissies per stage** (Mongo/Redis read-only vs read-write): **app-eigen client-pool per credential-tier** (framework-registry is global single-client) — G9; matrix = app-authz — G18.

## Voice-input (lage prioriteit)
- 🟠 Mobiel audio → STT → ticket/prompt; **streaming `registerCustomRoute`** (omzeilt 1 MiB body-cap) — G17.
- ⚪ STT zelf = app-code (Whisper/cloud), geen framework-primitive — G27.

## Workspace-AI
- 🟠 Overkoepelende AI, toegang tot alles, **dynamisch inladen** (queryt selectief Mongo/git/RAG).
- 🟠 Stage-AI's praten niet onderling → sturen **signalen** naar de centrale Workspace-AI (Redis-stream/Mongo).
- 🟠 Verzamelt **persistente** suggesties/notities (bij terugkomst: "2 suggesties, 3 notities").
- 🟠 Beoordeelt pipeline-config zelf (waarom de config genormaliseerd moet zijn).
- 🟠 Bewaakt dat dynamische bronnen na merge daadwerkelijk geüpdatet worden (cron-watcher) — G1.

## Merge-trigger & bron-update
- 🟠 GitLab-merge → **webhook** (`registerCustomRoute`); origin-403 + body-cap-randen (verifieer `X-Gitlab-Token`-header) — G6, G7.
- 🔴→infra **Serial indexer-queue = bullmq `concurrency:1`** (geen framework-scheduler) — G1.
- 🟠 Append-only + commit-stamp lost de race structureel op (geen stilleggen, geen wachten).
- 🟠 Delta-herindex per changed-files (RAG) / dependency-aware reparse (graph).
- 🟠 Branch in GitLab blijft; container wegwerp; event-log persistent (overleeft teardown).

## Event-log & audit
- 🟠 **Onveranderlijke, geordende, persistente per-ticket event-stream = 100% app-eigen Mongo** (sync heeft geen log/ordering/replay) — G2.
- 🟠 App-toegekende `seq` via Redis `INCR`; unique `[ticketId, seq]`.
- 🟢/🟠 Eén `_sync`-handler schrijft de rij **én** pusht 'm live (audit + live-view in één).
- 🟠 Ruwe log = waarheid; samenvattingen = afgeleide laag (aparte dienst, geen 4e agent).
- 🟠 Ticket "terugspoelen" = replay uit Mongo op `seq`.

## Realtime & samenwerking
- 🟢 Live event-view over sockets (zelfde stream als audit-log).
- 🟠 **Catch-up na reconnect** (mobiel valt weg): `postSocketReconnect` → snapshot → merge-op-seq (subscribe-first tegen fetch-venster-gat) — G11.
- 🟠 **Presence** (collega's live zichtbaar): transient pings + badge native; **persistente roster = app Redis-set** — G13.
- ⚪ Geen delivery-ack → client doet seq-gap-detectie + self-heal uit de log — G12.

## Read-only gedeelde context per ticket
- 🟠 Eén keer genereren, read-only delen met meerdere processen = commit-gestempeld RAG-snapshot + read-only worktree-files; geen proces muteert de gedeelde waarheid.

## Latere fasen
- ⚪ Externe agent-tools (agent-browser) = CLI-binary in de container, toegestaan via stage-whitelist; **geen** LuckyStack-skill/tool-concept — G28.
- 🟡 Andere repos inhaken = meerdere `Project`/`Source`-entiteiten; datamodel open houden.

## Topologie in één blik
- **Edge** (Traefik/Caddy, TLS) → **app** (`app.<domein>`, LuckyStack-server, schaalbaar) + **orchestrator** (`term.<domein>`, single-instance) + **ticket-containers** (`dev-<id>.<domein>`).
- **Gedeeld:** Redis (sessies/fanout/seq/queue/presence) + MongoDB+Atlas-Local (RAG/event-log/tickets/config).

## Erfenis-grenzen die ook spelen
- 🔴 Niets gepubliceerd op npm; `@luckystack`-scope bestaat nog niet (bouw tegen in-repo-versie).
- 🔴 Geen RBAC/roles/org-tenant → multi-user/team/permissie-modellering = app-werk.
- 🔴 `@luckystack/monitoring` ongebouwd → metrics/forensics-dashboards niet aanwezig (event-log dekt audit).
- ⚪ MongoDB pint Prisma 6.19 (geen blocker voor vector-search).
- ⚪ Pure SPA (geen SEO-behoefte achter auth); geen data-loader-laag.
