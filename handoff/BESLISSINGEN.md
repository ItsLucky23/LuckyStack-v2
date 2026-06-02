# Workspaces — Beslissingen-logboek

> Vastgelegde keuzes uit de sparring-sessie van 2026-06-02. Eén bron van waarheid; de andere docs verwijzen hiernaar. `[OPEN]` = nog te beslissen.

## Architectuur & scope
- **B-01 — Twee systemen.** Workspaces = (1) een LuckyStack web-app + (2) een aparte **single-instance orchestrator**. De app schaalt horizontaal; de orchestrator blijft één proces (host-gebonden state).
- **B-02 — Scope: multi-tenant-klaar.** RBAC + org/tenant-isolatie nu inbouwen. **Tenant = Workspace.**
- **B-03 — V1-snit: volledige §15-bouwvolgorde.** Niets overslaan; alle 8 stappen.
- **B-04 — Timing: Workspaces ná de framework-publish.** Gevolg: framework-fixes moeten vóór de publish landen ([`FRAMEWORK_REMEDIATION.md`](./FRAMEWORK_REMEDIATION.md)).

## Auth, tenancy & GitLab
- **B-05 — Auth = OAuth-primary** (login/identiteit) **+ gekoppelde SSH-publieke sleutel vereist om terminals te openen.** De SSH-challenge/response is een **capability-gate op de `/pty`-namespace**, niet de primaire login.
- **B-06 — Tenant = Workspace.** Iedereen kan een workspace aanmaken; leden via **e-mail-invite** (→ `@luckystack/email`, native 🟢).
- **B-07 — GitLab-token per workspace** (niet per user), versleuteld opgeslagen op de Workspace-entiteit.
- **B-08 — Rollen: Owner / Admin / Member.** Owner = token+leden+billing; Admin = pipeline/config; Member = werkt op tickets. App-RBAC (framework levert alleen `auth={login:true}`).

## Framework-first remediation (vóór publish — zie FRAMEWORK_REMEDIATION.md)
- **B-09 — IN scope:** R1 webhook-seam (G6+G7), R2 keyed-client-registry (G9), R3 `registerRedisKeyFormatter` (G24), R4 streaming/multipart-upload-seam (G17), R5 leader-election-helper (G8/G16). + doc-taak D-MT (multi-tenant-patroon).
- **B-10 — OUT of scope (blijft app/infra):** scheduler/queue (G1→bullmq), event-log/CQRS (G2), roster (G13), PTY-gateway (G4/G5), proces-supervisor (G22 — Docker doet het), subdomein/TLS-proxy (G3→Caddy), vector-infra (G10→Atlas), RBAC-model (B2), STT (G27), skill/tool-registry (G28).

## Infra
- **B-11 — Edge-proxy: Caddy** (admin-API-gedreven routes, on-demand/wildcard TLS) voor `dev-<id>.<domein>` + `app.<domein>` + `term.<domein>`.
- **B-12 — Container: één base-image + per-project-config** (Node/git/Claude-CLI/agent-browser in de base; projectspecifiek via process-start-commands). Per-project-image/devcontainer later toevoegen.
- **B-13 — Container-proces-model: 2-terminal DEV** (Vite :5173 = blootgestelde poort, proxyt naar Node-backend :80). PROD-mode (1 poort) voor een aparte preview-stage.

## Informatie-lagen (kern-herontwerp)
- **B-14 — Splitsing context-doc vs skill.** ~5 **context-docs** (altijd/selectief geladen): project-summary, conventies/stijl, domein-glossary, DB-schema (klein), geüploade spec. De rest = **skills/MCP**.
- **B-15 — Skills/MCP** (de "lagen" §5 + "skills" §4.3 + "tool-access" §7.6 verenigd):
  - Over een **bevroren-per-commit store:** RAG (`semantic_search`), code-graph (`impact_of`/graphify-MCP), type/symbol-index (`lookup_symbol`), route/API-index (groot project).
  - **Live:** git-history (`history_of`), test/coverage (`run_tests`), observability (`recent_errors` — needs monitoring), dependency/security (`audit_deps`), cross-ticket-context (`find_related_tickets`, §6.4).
- **B-16 — Skill-vorm: MCP-servers**, per stage aan/uit via `.claude/settings.json`. Sluit aan op graphify-MCP + Claude-CLI-native.
- **B-17 — Breedte v1: Tier A + B (9 lagen actief).** Tier C situationeel/later (observability blokt op ongebouwde monitoring).
- **B-18 — Embeddings: self-hosted code-model** (nomic-embed / BGE / jina-code in een container). Geen code-egress.
- **B-19 — Code-graph: graphify-integratie** (`docs/GRAPHIFY_INTEGRATION.md`) als startpunt; open voor extra lagen.
- **B-20 — §5.4 [OPEN] opgelost:** een stage laadt nooit de hele bron; de AI **queryt een slice via een skill** (gefilterd op de commit-hash → bevriezing-per-ticket automatisch).

## Event-log & realtime
- **B-21 — Event-log: gecoalesceerde events** (command/file-change/MR/AI-bericht-klaar); live-tokens realtime tonen, niet persisteren. Ruwe log = waarheid, samenvattingen = afgeleid.
- **B-22 — Catch-up:** `postSocketReconnect` → `apiRequest` snapshot → subscribe-first + merge-op-`seq` (tegen het fetch-venster-gat).

## Workspace-AI
- **B-23 — Autonomie: voorstellen + accept.** De Workspace-AI stelt voor (tickets koppelen, branches, notities); de gebruiker keurt goed. In lijn met de command-accept-flow.

## RAG / data
- **B-24 — Vector-search: MongoDB Atlas Local** in de Docker-stack (`$vectorSearch` via `aggregateRaw`). App-side-cosine als fallback achter een flag.
- **B-25 — RAG-store: append-only, commit-gestempeld**; query met eigen commit-hash; snapshot-hergebruik op commit-hash. Opruim-policy: cron verwijdert versies < oudste actieve ticket-commit.

## Resterende keuzes — nu beslist (B-O1…B-O8)
- **B-O1 — STT-provider: self-hosted whisper.cpp** (in een container, geen audio-egress; voice blijft lage prio).
- **B-O2 — Stage-output-carry-over: subset + on-demand volledig.** Injecteer een gestructureerd subset `{summary, changedFiles[], openQuestions[], commitHash}`; de volgende AI haalt de vólledige vorige-output zelf op via de **event-log/cross-ticket-skill** als-ie meer nodig heeft. Elke stage produceert dit subset als eind-contract.
- **B-O3 — Herindex: per-changed-files delta.** RAG = alleen chunks van gewijzigde files; graph = gewijzigde files herparsen + **dependency-aware propagatie** (importers). Dedupe op `commitHash+filePath+chunkId`.
- **B-O4 — Nieuw project: één 7-stage-default + kloneerbaar.** Start met Unrefined→Refined→Plan→Implementatie→Test→Review→Final (volledig bewerkbaar); eigen pipelines later als template opslaan. (Geen meerdere ingebouwde templates in v1.)
- **B-O5 — Stage-statussen: universele basis + custom.** Vaste kern (`needs-input`/`busy`/`done`) op elke stage + per stage eigen extra statussen toevoegbaar.
- **B-O6 — Signaal-transport: Mongo-collectie (durable).** Append-only `WorkspaceSignal`; de Workspace-AI consumeert serieel; queryable + onderdeel van de audit; overleeft herstart. Optionele socket-nudge voor liveness. (Geen Redis-stream.)
- **B-O7 — db-schema & route/API-index: adaptief.** Klein project → geladen context-doc; groot → automatisch een skill (`get_schema(model)` / `find_route`). (Niet de agressieve 'alles-skill'-snit.)
- **B-O8 — Permissie-tiers: `mongo:ro`/`mongo:rw` + `redis:ro`/`redis:rw`.** Vier tiers, per stage per tool gekozen (via R2 keyed-client-registry), uitbreidbaar als er tools bijkomen.

## Beslissingen uit de pre-build review (B-26…B-39)
> Bron: senior-review van het hele project (2 audits) + de antwoorden van de gebruiker. Detail + onderbouwing in [`REVIEW.md`](./REVIEW.md). Datamodel in [`DATAMODEL.md`](./DATAMODEL.md).
- **B-26 — Threat-model: trusted small-group, self-hosted** (gebruiker + enkele collega's op eigen machine), géén publieke SaaS. Multi-tenant = voor samenwerking/organisatie, niet voor isolatie tegen vijandige tenants. → "geaccepteerd postinstall-risico" blijft geldig; **redelijke container-hygiëne volstaat** (resource-limits CPU/mem/disk/PID + restart-policy), géén gVisor/Firecracker-klasse isolatie nodig. Het multi-tenant *model* (per-user meerdere workspaces, delen met users, permissies) bouwen we wél volledig.
- **B-27 — V1-scope (groots): multi-tenant + syncing + permissies IN V1; billing + voice LATER.** (Lost het B-03/J3-conflict op.)
- **B-28 — RBAC-matrix.** Owner = alles. Admin = alles **behalve** admin-rolbeheer (member→admin promoten, admin downgraden/verwijderen) + ownership-overdracht/workspace-delete. Member = volledig werken (terminals + tickets), **geen** pipeline-edits/config/admin. Iedereen mag terminals + werk. (Volledige matrix in DATAMODEL.md.)
- **B-29 — GitLab = source of truth.** Bord synct bidirectioneel; bij conflict wint GitLab. + webhook-reconciliatie-cron (gemiste webhooks helen).
- **B-30 — Sprint-entiteit met tijdsduur** (start/eind). Onboarding bescheiden (backlog + bord); sprint-deel iets uitgebreider.
- **B-31 — Per-container pty-agent.** De node-pty leeft bij/naast de container; de orchestrator proxyt 'm → orchestrator-restart killt **geen** terminal-sessies (+ graceful drain + scrollback-ring-buffer voor reattach).
- **B-32 — Embeddings: self-hosted model** (geen per-call-kosten) voor de RAG-skill; in worktree-stages leunen op **Claude-CLI native agentic search** om de RAG-afhankelijkheid te verkleinen. Geen cloud-embedding-kosten.
- **B-33 — Event-log: aparte Mongo-collectie volstaat** (kleine schaal; geen aparte store nodig).
- **B-34 — Notificaties: in-app + email (`@luckystack/email`) + web-push (PWA service-worker).** Triggers: needs-input, merge, AI-suggestie, container-failure. (Web-push = app/extern.)
- **B-35 — Spend/budget + runaway-control.** Token-accounting per ticket/stage/workspace; per-workspace-budget + alert + auto-pause bij cap; **stuck/idle/loop-detectie → auto-escalatie naar needs-input** (heartbeat/timeout/iteratie-cap).
- **B-36 — Backup/DR.** mongodump/restore + Redis-snapshot; **event-log = prioriteit** (audit-waarheid). Runbook + RPO/RTO.
- **B-37 — Mobiel ~99% parity;** complexe acties desnoods via de assistant-AI aansturen.
- **B-38 — `.claude/settings.json`-first config.** De stage/pipeline-editor mapt zo direct mogelijk op de **échte** `.claude/settings.json`-mogelijkheden (permissions allow/deny/ask, hooks, MCP-servers, model, env, working-dir), zodat wat in de UI wordt opgezet ook echt werkt in de CLI. Mapping in [`CLAUDE_SETTINGS_MAP.md`](./CLAUDE_SETTINGS_MAP.md). Skill/template-marktplaats = later.
- **B-39 — Data-retentie/delete.** delete-workspace = purge code/embeddings/event-logs; member data-export/-delete.

## Framework-fundament geverifieerd (R1–R5 + D-MT)
`docs/HANDOFF-R1-R5.md` gereviewd: alle 5 + D-MT geland, additief/opt-in, byte-identiek (R3), tenant-context opgelost via `runInTenant`/`currentWorkspaceId` (AsyncLocalStorage) + `preApiExecute`-boundary (`docs/ARCHITECTURE_MULTI_TENANCY.md`). De tenant-tiers (B-O8) draaien op R2 `getPrismaClientFor(...)`. **Open vlag voor de framework-AI:** D-MT toont alleen de `/api`-boundary — **sync + background/orchestrator-workers moeten óók `runInTenant` aanroepen** (D-MT-doc aanvullen). Plus: webhook/upload-e2e draaien + alles committen.
