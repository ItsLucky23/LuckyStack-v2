# Workspaces — Handoff (startpunt voor de bouw)

> **Lees dit eerst.** Deze folder is zelf-standig: met alleen `handoff/` + de geïnstalleerde `@luckystack/*`-packages kun je het Workspaces-project bouwen. De framework-eigen documentatie (`docs/ARCHITECTURE_*`, package-`CLAUDE.md`, `docs/HANDOFF-R1-R5.md`) komt mee bij `npm install` en staat hier bewust **niet** in.
>
> Opgesteld 2026-06-02 na een uitgebreide sparring-/review-ronde. Taal: Nederlands. Status: ontwerp compleet, framework-fundament geverifieerd, klaar voor de bouw na de framework-prep-stappen (§5).

---

## 1. Wat is Workspaces?
Een **zelf-gehoste, mobiel-vriendelijke webapp die AI-gedreven development orkestreert.** Per ticket draait een eigen Claude Code CLI in een git-worktree + Docker-container, bereikbaar als een live browser-terminal. Een scrumbord (view op GitLab) met een per-project configureerbare pipeline van stages duwt tickets van *ruw* naar *productieklaar*; een overkoepelende Workspace-AI verzamelt suggesties.

**De toetssteen (laat elke feature hieraan voldoen):** *op het water liggen, telefoon pakken, een paar voice-berichten inspreken, tickets managen, kijken wat de Workspace-AI zei, de app sluiten — en op de achtergrond worden meerdere tickets professioneel verwerkt.* → **mobiel is eersteklas**, en **autonoom doorlopen terwijl je weg bent** is de kern.

**Schaal/threat-model:** trusted small-group, self-hosted (jij + enkele collega's op eigen machine), **géén publieke SaaS**. Multi-tenant = voor samenwerking, niet voor isolatie tegen vijandige tenants.

---

## 2. Het twee-systemen-model (belangrijkste mentale model)
Workspaces valt uiteen in **twee** systemen. Verwar ze niet — ze hebben verschillende schaal- en faaleigenschappen.

```
                         Internet / telefoon  (wildcard-TLS *.<domein>, Caddy)
            ┌──────────────────────────┬──────────────────────────────┐
            │ A) WEB-APP (LuckyStack)   │ B) ORCHESTRATOR (apart,        │
            │    app.<domein>           │    single-instance) term.<dom> │
            │  • scrumbord + backlog    │  • Docker-containers per ticket │
            │  • live event-log + presence│ • git-worktrees                │
            │  • auth (OAuth+SSH) + RBAC │  • ~20 Claude-CLI-processen     │
            │  • config-/pipeline-UI    │  • node-pty-agents (terminals)  │
            │  • notificaties           │  • RAG-indexer (bullmq, serieel)│
            │  = standaard LuckyStack-  │  • GitLab-webhook-ontvanger     │
            │    server, schaalt        │  • Workspace-AI                 │
            └──────────────┬────────────┴───────────────┬──────────────┘
                           │   Redis (gedeeld)  ·  MongoDB + Atlas Local │
                           └──────────────────────────────────────────────┘
```
- **A) De web-app** = waar LuckyStack shipt (file-routing, getypeerde `_api`/`_sync`, sessies, sockets, presence, function-injection). **Schaalt** horizontaal. Bouw als één standaard LuckyStack-server.
- **B) De orchestrator** = grotendeels **eigen infra**, buiten het framework. **Single-instance** (bezit host-resources). Mag `@luckystack/core` importeren voor helpers, maar is geen LuckyStack-app.

> **~60% van de "wow"-features zijn geen framework-features.** De orchestrator is de grote, zelf-te-bouwen brok. Onderschat 'm niet.

---

## 3. Hoe je deze folder leest
| Document | Wat |
|---|---|
| **`HANDOFF.md`** (dit) | Startpunt: oriëntatie, bouwvolgorde, prep-stappen, workstreams. |
| [`FRAMEWORK_USAGE.md`](./FRAMEWORK_USAGE.md) | **Welke packages je installeert + de geverifieerde primitives die je gebruikt** (incl. de Claude-CLI-hooks-integratie). |
| [`BESLISSINGEN.md`](./BESLISSINGEN.md) | **Alle keuzes** (B-01…B-39) — leidend bij twijfel. |
| [`DATAMODEL.md`](./DATAMODEL.md) | Het **Prisma-datamodel** + kerncontracten (RBAC, stage/status, commit-hash, event-granulariteit, container/git-lifecycle). |
| [`CLAUDE_SETTINGS_MAP.md`](./CLAUDE_SETTINGS_MAP.md) | Stage-config ↔ echte **`.claude/settings.json`** (hooks, budget-caps, MCP, sandbox, carry-over). |
| [`IDEE_SPEC.md`](./IDEE_SPEC.md) | De volledige spec, feature-voor-feature, gekoppeld aan LuckyStack. |
| [`IDEE_OVERZICHT.md`](./IDEE_OVERZICHT.md) | Platte feature-bulletlijst (3-min scan). |
| [`DESIGN_BRIEF.md`](./DESIGN_BRIEF.md) | UI-design-brief (15 schermen, desktop+mobiel, componenten, seed-data). |
| [`REVIEW.md`](./REVIEW.md) | De pre-build review + resoluties + de R1–R5-verificatie. |
| [`FRAMEWORK_GAPS.md`](./FRAMEWORK_GAPS.md) · [`FRAMEWORK_CAPABILITIES.md`](./FRAMEWORK_CAPABILITIES.md) | Onze analyse van wat LuckyStack wel/niet kan **voor dit project** (bouw-context; shipt niet met de packages). |
| `designs/` | (Volgt) de Claude-Design-output. |

---

## 4. Wat LuckyStack je geeft vs. wat je zelf bouwt
| Laag | LuckyStack (geïnstalleerd) | Zelf bouwen |
|---|---|---|
| Transport/API | getypeerde `_api`/`_sync`-routes, sockets, HTTP/SSE | de business-handlers |
| Auth/sessie | OAuth + credentials, Redis-sessies, `UserAdapter` | de **SSH-key-voor-terminals**-flow + **RBAC** (Owner/Admin/Member) |
| Multi-tenant | `runInTenant`/`getPrismaClientFor`/`formatKey` (R1–R5 + D-MT) | de tenant-resolutie in `preApiExecute` + **sync/worker-`runInTenant`** |
| Realtime | sync (fire-and-forget transport) + presence (transient) | de **duurzame event-log** (Mongo + Redis-`seq`) + **presence-roster** |
| Data | Prisma (Mongo) + Redis | het **datamodel** (DATAMODEL.md) + de **RAG-vectorstore** (Atlas) |
| Webhooks/upload | `pre-params`-routes + origin-exempt (R1+R4) | de GitLab-webhook-handler + reconciliatie |
| Email | `@luckystack/email` | de **web-push** (PWA) + de notificatie-service |
| Orchestratie | — (niets) | **alles**: containers, worktrees, pty-agent, RAG-indexer, Caddy, bullmq, budget/runaway |

---

## 5. Framework-prep — 4 stappen vóór je kunt installeren
De `@luckystack/*`-packages zijn **nog niet gepubliceerd**. Vóór `npm install @luckystack/*` in de nieuwe repo werkt:
1. **Committen** — R1–R5 + D-MT (en de secret-manager-stapel) staan uncommitted op `chore/package-split-prep`.
2. **Publishen** — `npm org create luckystack` + de 14 packages publishen.
3. **`npm install`** — ververst de workspace-symlinks.
4. **Webhook/upload-e2e** — de "optionele" e2e één keer echt draaien (Workspaces hangt op de `pre-params`-seam + origin-exempt + grote upload). Recipe staat in de framework-`docs/ARCHITECTURE_HTTP.md`.

**Plus één framework-doc-aanvulling** (klein, app-werk anders): `docs/ARCHITECTURE_MULTI_TENANCY.md` toont alleen de `/api`-tenant-boundary — vul aan dat **sync-handlers + background-workers zelf `runInTenant(...)`** moeten aanroepen.

---

## 6. Aanbevolen bouwvolgorde
1. **Fundament + datamodel** — Prisma-schema (DATAMODEL.md) op Mongo + Atlas Local; tenant-context (`runInTenant` + `preApiExecute`-membership-boundary); RBAC.
2. **Orchestrator-kern** — ticket-lifecycle: pull→commit-hash→RAG-snapshot→worktree→container→pty-agent→MR→merge-webhook→delta-indexer→teardown (DATAMODEL §5). Caddy-edge + per-ticket-subdomein. **Maak dit eerst waterdicht — het is het hart.**
3. **Browser-terminals** — `/pty`-namespace op de gedeelde `io` + de per-container pty-agent (reattach overleeft orchestrator-restart) + SSH-unlock.
4. **Web-app: bord + event-log** — scrumbord (GitLab = SoT), de duurzame event-log (Mongo + `seq`), live-view + catch-up, presence-roster.
5. **Pipeline-editor + skills/MCP** — stage-config die 1-op-1 op `.claude/settings.json` mapt (CLAUDE_SETTINGS_MAP.md); RAG/graph/… als MCP-servers per stage.
6. **Workspace-AI + notificaties + budget** — signalen→suggesties (voorstellen+accept), notificaties (email+web-push), spend/budget + runaway-control.
7. **Mobiel afronden + voice** (voice = lage prio).

---

## 7. Workstream: de Orchestrator (de grote, zelf-te-bouwen brok)
Een **apart, single-instance** Node-proces (mag `@luckystack/core` importeren). Bezit:
- **Container-lifecycle** — één base-image + per-stage process-start-commando's; Docker-resource-limits (CPU/mem/PID) + restart-policy; de **Claude-CLI-sandbox** (egress-allowlist) voor de trusted-group-hygiëne.
- **Git-worktrees** — `git worktree add` op branch `DEV-####`; `worktree.symlinkDirectories` voor `node_modules`.
- **Pty-agents** — node-pty per container; de orchestrator proxyt de `/pty`-namespace; scrollback-ring-buffer → reattach overleeft orchestrator-restart.
- **RAG-indexer** — bullmq-worker (concurrency 1, vastgehouden via R5-`acquireLease`); delta-per-changed-files; self-hosted embeddings + Atlas `$vectorSearch`.
- **GitLab-webhook-ontvanger** — via een `pre-params` custom-route (R1) op de web-app, die jobs op de queue duwt.
- **Workspace-AI** — consumeert `WorkspaceSignal` serieel → `WorkspaceSuggestion` (voorstellen+accept).
- **Budget/runaway** — telt `SpendRecord` op (`--max-budget-usd`/`--max-turns` + `Stop`/`Notification`-hooks); auto-pause bij cap; stuck-detectie → needs-input.

> **Veel hiervan is Claude-CLI-native** — hooks (`http` → orchestrator) voeden de event-log + status; budget/runaway via CLI-flags; carry-over via `--json-schema`; skills-isolatie via `--strict-mcp-config`; egress via de sandbox. Zie CLAUDE_SETTINGS_MAP.md. Dat scheelt fors zelf-bouwwerk.

## 8. Workstream: de Web-app (LuckyStack)
Standaard LuckyStack-server: bord/backlog/ticket-detail/terminals-view/pipeline-editor/bronnen-manager/Workspace-AI-paneel/account/org-beheer/event-log/activity (alle schermen in DESIGN_BRIEF.md). Realtime via sync; presence via `@luckystack/presence` + eigen roster; auth = OAuth-login + SSH-voor-terminals; alle data tenant-gescoped.

---

## 9. Openstaande punten / risico's om te kennen
- **Framework-prep (§5)** moet eerst af.
- **Orchestrator = SPOF** (single-instance, bewust). De pty-agent + reattach mitigeert terminal-verlies; voeg graceful drain + failure-surfacing toe.
- **Embeddings-kwaliteit** — self-hosted (geen kosten); benchmark op je eigen codebases, en leun in worktree-stages op Claude-CLI native search.
- **Atlas Local** vereist in de Docker-stack voor `$vectorSearch` (anders cosine-fallback).
- **Secrets** — per-workspace GitLab-token versleuteld op de Workspace-row; lever 'm als scoped/kortlevende token aan containers, niet als ruwe env.

---

## 10. Designs
`handoff/designs/` wordt gevuld in de **volgende ronde**: de gebruiker levert een Claude-Design-samenvatting → een gedetailleerde feature-completion-spec → de finale designs. Zie `designs/README.md`.

---

## 11. Kernbeslissingen (quick-ref — detail in BESLISSINGEN.md)
Tenant = Workspace (trusted small-group) · OAuth-login + SSH-key-voor-terminals · RBAC Owner/Admin/Member · GitLab = source of truth · Caddy-edge · Atlas Local · één base-image · per-container pty-agent · self-hosted embeddings + CLI-search · event-log = gecoalesceerde events in aparte Mongo-collectie · Workspace-AI = voorstellen+accept · notificaties + web-push · spend/budget + runaway-control · `.claude/settings.json`-first config · billing + voice = later.
