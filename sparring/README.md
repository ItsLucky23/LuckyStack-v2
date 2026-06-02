# Sparring — Workspaces × LuckyStack

> Sparring-/documentatiemap voor het **Workspaces**-project: een zelf-gehoste, mobiel-vriendelijke webapp die AI-gedreven development orkestreert, gebouwd bovenop het **LuckyStack**-framework (deze repo). Géén code hier — alleen analyse, feasibility en ontwerp, klaar om door meerdere AI-agents opgepakt te worden.
>
> Opgesteld op 2026-06-02 op basis van de projectsamenvatting van de bedenker + 2 parallelle codebase-sweeps (17 agents) tegen `packages/*` op branch `chore/package-split-prep`.

## Leesvolgorde

| # | Document | Voor wie / wanneer | Leesduur |
|---|---|---|---|
| 0 | [`BESLISSINGEN.md`](./BESLISSINGEN.md) | **Alle gemaakte keuzes (B-01…B-39)** — leidend bij verschil met de spec | ~7 min |
| 1 | [`IDEE_OVERZICHT.md`](./IDEE_OVERZICHT.md) | Snel overzicht van álle features met bucket-tags | ~3 min |
| 2 | [`IDEE_SPEC.md`](./IDEE_SPEC.md) | De volledige spec gekoppeld aan LuckyStack; elke `[FRAMEWORK-MATCH]` ingevuld | naslag |
| 3 | [`DATAMODEL.md`](./DATAMODEL.md) | **Het Prisma-datamodel** + kerncontracten (RBAC, stage/status, commit-hash, event-granulariteit, container/git-logica) | naslag |
| 4 | [`CLAUDE_SETTINGS_MAP.md`](./CLAUDE_SETTINGS_MAP.md) | **Stage-config ↔ echte `.claude/settings.json`** (B-38): hooks, budget-caps, MCP, sandbox, carry-over | naslag |
| 5 | [`REVIEW.md`](./REVIEW.md) | Pre-build review (lege plekken/afraden/toevoegingen) + resoluties + R1–R5-handoff-review | naslag |
| 6 | [`FRAMEWORK_REMEDIATION.md`](./FRAMEWORK_REMEDIATION.md) | Framework-first backlog R1–R5 (geland — zie `docs/HANDOFF-R1-R5.md`) | naslag |
| 7 | [`FRAMEWORK_GAPS.md`](./FRAMEWORK_GAPS.md) | Élke framework-grens als zelfstandig oplosbaar scenario (`G#`) | naslag |
| 8 | [`FRAMEWORK_CAPABILITIES.md`](./FRAMEWORK_CAPABILITIES.md) | LuckyStack-baseline: native kunnen, extensie-model, realtime-plafond | naslag |
| 9 | [`DESIGN_BRIEF.md`](./DESIGN_BRIEF.md) | **Design-brief voor Claude Design**: complete live-omgeving (15 schermen, desktop+mobiel, popovers, seed-data) | naslag |
| — | [`VRAGEN.md`](./VRAGEN.md) | ~~Waslijst vragen~~ — **gearchiveerd** (beantwoord in BESLISSINGEN.md) | — |

## De kern in 5 punten

1. **Workspaces = twee systemen.** Een **LuckyStack web-app** (bord, event-log, presence, auth, config — kern-fit) en een **orchestrator** (containers, worktrees, ~20 Claude-CLI-processen, terminals, RAG-queue, proxy — grotendeels eigen infra, LuckyStack alleen als transport-fundament).
2. **~60% van de "wow"-features zijn geen framework-features** — ze coëxisteren met LuckyStack. De bouwvolgorde van de bedenker zet dat deel terecht vooraan.
3. **Wat LuckyStack écht versnelt:** getypeerde `_api`/`_sync`-routes, sockets, sessies (SSH-auth past zonder fork), presence, function-injection (db/redis), de 2-poorts-dev-env. De terminals rijden op de gedeelde Socket.io-`io` (eigen `/pty`-namespace).
4. **Wat je zelf bovenop bouwt:** de duurzame geordende event-log (Mongo + Redis-`seq`), de RAG-vectorstore (`aggregateRaw($vectorSearch)`, vereist Atlas Local), de serial indexer-queue (bullmq — geen framework-scheduler), de presence-roster, de PTY-gateway, de gegradeerde DB-credential-pool.
5. **Wat buiten het framework valt:** Traefik/Caddy (de router is geen subdomein/TLS-proxy), node-pty-management, STT, en alle Claude-CLI-skills/tools/whitelisting (`.claude/`-niveau, niet LuckyStack).

## Status & vervolg

- ✅ Codebase doorgelicht (2 sweeps, 17 agents); alle `[FRAMEWORK-MATCH]` geverifieerd tegen de source.
- ✅ Alle framework-grenzen gedocumenteerd als oplosbare scenario's (`FRAMEWORK_GAPS.md`, G1–G29).
- ✅ **Alle keuzes gemaakt** (`BESLISSINGEN.md`, B-01…B-39): multi-tenant (tenant = Workspace, trusted small-group), OAuth-login + SSH-voor-terminals, RBAC Owner/Admin/Member, GitLab-token per workspace (GitLab = SoT), Caddy, Atlas Local, één base-image, context-docs + skills/MCP, per-container pty-agent, notificaties + web-push, spend/budget + runaway-control, `.claude/settings.json`-first config.
- ✅ **Framework-fundament geland & gereviewd:** R1–R5 + D-MT (`docs/HANDOFF-R1-R5.md`) — geverifieerd sterk; tenant-context via `runInTenant` + `preApiExecute`. Open vlaggen: sync/worker-`runInTenant`-note, e2e draaien, committen.
- ✅ **Pre-build review afgerond** (`REVIEW.md`) + **formeel datamodel** (`DATAMODEL.md`) + **Claude-config-mapping** (`CLAUDE_SETTINGS_MAP.md`).
- 💡 **Ontdekking:** veel zwaar werk (event-log-voeding, budget/runaway, gestructureerde carry-over, skills-isolatie, egress-control) wordt **native door Claude Code** gedekt via hooks/flags/sandbox — zie `CLAUDE_SETTINGS_MAP.md`.
- ⏭️ **Volgende stap:** definitieve handoff naar de nieuwe repo; Workspaces bouwen (orchestrator + web-app) tegen de gepubliceerde packages.

## Conventies

- **Bucket-tags:** 🟢 native · 🟡 extension (geen fork) · 🟠 build-on-top · 🔴 out-of-bounds / externe infra · ⚪ bewuste grens.
- **`G#`** verwijst naar een genummerde framework-grens in `FRAMEWORK_GAPS.md`.
- Bestandscitaties (`packages/...:regel`) komen uit de geverifieerde sweeps en zijn klikbaar in de editor.
