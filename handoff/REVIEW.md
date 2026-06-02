# Workspaces — Pre-build review (lege plekken · afraden · slimme toevoegingen)

> Senior-review van het hele project vóór de bouw, met per bevinding de **resolutie** (gebruikersantwoord of mijn beslissing). Onderbouwd met 2 read-only audits (coherentie over alle `sparring/`-docs + cross-cutting-probe tegen `packages/*`/`docs/*`) + de review van de R1–R5-handoff. Beslissingen → [`BESLISSINGEN.md`](./BESLISSINGEN.md) (B-26…B-39); datamodel → [`DATAMODEL.md`](./DATAMODEL.md); Claude-config-mapping → [`CLAUDE_SETTINGS_MAP.md`](./CLAUDE_SETTINGS_MAP.md).

## Kernherijking
- **Threat-model (B-26):** trusted small-group, self-hosted (jij + enkele collega's) — **géén publieke SaaS**. Multi-tenant = samenwerking/organisatie, niet isolatie tegen vijandige tenants. → "geaccepteerd postinstall-risico" blijft geldig; redelijke container-hygiëne + de Claude-CLI-sandbox-egress-allowlist volstaan; geen gVisor/Firecracker.
- **V1-scope (B-27):** groots — multi-tenant + syncing + permissies **in V1**; billing + voice later.
- **Framework-fundament (R1–R5 + D-MT):** gereviewd, geverifieerd, sterk. Veel cross-cutting zorg wordt bovendien **native door Claude Code** gedekt (zie CLAUDE_SETTINGS_MAP.md).

---

## A. Lege plekken — resolutie
| # | Lege plek | Resolutie |
|---|---|---|
| LP1 | Geen datamodel/schema | ✅ **`DATAMODEL.md`** geschreven — alle entiteiten, RBAC-matrix, stage/status-vorm, commit-hash-timing, event-granulariteit, autonomie-scope, query-per-skill-slice. |
| LP2 | Notificaties afwezige gebruiker | ✅ B-34: in-app + email + **web-push** (PWA). Triggers needs-input/merge/AI-suggestie/failure. Grotendeels gevoed door Claude-`Notification`-hook (`idle_prompt`/`permission_prompt`). |
| LP3 | AI-kosten/budget/runaway | ✅ B-35: token-accounting + per-workspace-budget + auto-pause + stuck-detectie. **Grotendeels CLI-native** (`--max-budget-usd`, `--max-turns`, `Stop`/`Notification`-hooks) + dunne app-laag. |
| LP4 | Backup/DR | ✅ B-36: mongodump/restore + Redis-snapshot; event-log = prio. (Framework dekt dit niet — app/ops.) |
| LP5 | Secrets naar containers | ✅ Per-workspace GitLab-token **versleuteld op de Workspace-row**, decrypt per request (D-MT §4); niet als ruwe env → scoped/kortlevende token of een MCP-tool die 'm server-side gebruikt (TV4). Claude-sandbox-egress-allowlist beperkt waar code naartoe kan bellen. |
| LP6 | RBAC-matrix | ✅ B-28: Owner/Admin/Member-matrix vastgelegd (DATAMODEL §1). Member = werken, geen config; Admin = alles behalve admin-rolbeheer + ownership/delete; Owner = alles. |
| LP7 | Graceful shutdown + failure-UX | ✅ B-31: per-container pty-agent + scrollback overleeft orchestrator-restart; orchestrator-failure → retry/backoff/dead-letter + surface in UI (container/worktree/Caddy/indexer/CLI). |
| LP8 | GitLab-sync-conflicten | ✅ B-29: **GitLab = source of truth**, bord synct, bij conflict wint GitLab + webhook-reconciliatie-cron. |
| LP9 | Onboarding + first-index | ✅ Bescheiden onboarding (backlog + bord); sprint-deel iets uitgebreider (B-30 sprint-duur). First-index met progress/ETA in de bronnen-manager (DESIGN_BRIEF §I). |
| LP10 | Data-retentie/delete/GDPR | ✅ B-39: delete-workspace = purge code/embeddings/logs (DATAMODEL §10); member export/delete. |
| LP11 | Container/git-logica | ✅ Door mij bepaald (DATAMODEL §5): pull→commit-hash→snapshot→worktree→container→pty-agent→MR→merge→delta-indexer→teardown. |
| LP12 | Cross-device/mobiel | ✅ B-37: mobiel ~99% parity; complexe acties via de assistant-AI. |

## B. Dingen die ik afraadde — resolutie
| # | Afgeraden/heroverweeg | Resolutie |
|---|---|---|
| AF1 | "Accepted postinstall-risico" in multi-tenant | **Opgehelderd → trusted small-group** (B-26): risico blijft acceptabel; redelijke hygiëne + Claude-sandbox-egress; geen zware sandboxing. Multi-tenant *model* wel volledig. |
| AF2 | Overschaalde V1 | **Gebruiker kiest groots** (B-27): multi-tenant + permissies in V1; alleen billing + voice later. |
| AF3 | Strikt "ná publish" zonder validatie | Gebruiker: **"we controleren dalijk dat R1–R5 werkt"** → de e2e-vlag (zie onder) afhandelen vóór bouw. |
| AF4 | Orchestrator-SPOF voor terminals | ✅ Aangenomen — **per-container pty-agent** (B-31). |
| AF5 | Self-hosted embeddings zonder benchmark | ✅ B-32: self-hosted (geen kosten) + **leun op Claude-CLI native search** in worktree-stages om RAG-afhankelijkheid te verkleinen. |
| AF6 | Mongo-koppeling event-log/RAG/app | ✅ B-33: aparte **collectie** volstaat (kleine schaal); geen aparte store. |

## C. Slimme toevoegingen — status
| # | Toevoeging | Status |
|---|---|---|
| TV1 | Notificatie-service (email + web-push) | ✅ in scope (B-34) |
| TV2 | Spend/budget-dashboard + per-ticket "kostte €X/Yh" | ✅ in scope (B-35); CLI-native budget-caps |
| TV3 | Agent-heartbeat + stuck→needs-input | ✅ in scope (B-35); `Stop`/`Notification`-hooks |
| TV4 | Kortlevende scoped GitLab-tokens per container | ✅ in scope (LP5) |
| TV5 | Per-ticket preview/staging-deploy | ✅ formaliseren als preview-stage (PROD-mode-container) |
| TV6 | "Pause/kill workspace"-noodknop | ✅ in scope |
| TV7 | Webhook-reconciliatie-cron | ✅ in scope (B-29) |
| TV8 | Replay/rewind als debug-feature | ✅ in scope (event-log bestaat) |
| TV9 | Skill/template-marktplaats | ⏭️ **later** (gebruikerskeuze) |
| TV10 | MCP-integratie-flow-doc | ✅ → `CLAUDE_SETTINGS_MAP.md` |
| TV11 | D-MT multi-tenant-doc | ✅ bestaat (`docs/ARCHITECTURE_MULTI_TENANCY.md`); harde pre-flight-blocker afgevinkt |
| — | **`.claude/settings.json`-first config (B-38)** | ✅ gebruikersdirectief — UI mapt op echte Claude-config (`CLAUDE_SETTINGS_MAP.md`) |

## D. Doc-hygiëne — afgehandeld
- **DH1:** `VRAGEN.md` was stale → **gearchiveerd/geretireerd** (alle keuzes staan in `BESLISSINGEN.md`).
- **DH2:** canonieke skill-term = **"RAG"** (DATAMODEL §3).
- **DH3:** query-per-skill-slice-mechanisme uitgelegd (DATAMODEL §2, StageSource.filter + commit-hash).
- **DH4:** B-03/J3 V1-snit-conflict opgelost door B-27 (groots, minus billing/voice).
- **DH5:** stage/status-vorm, autonomie-scope, event-granulariteit, commit-hash-timing geformaliseerd (DATAMODEL §4/§6/§7).

---

## R1–R5 + D-MT handoff — review-uitkomst
**Sterk, matcht/verbetert `FRAMEWORK_REMEDIATION.md`.** Geverifieerd: nieuwe files + exports bestaan, 37 unit-tests, gates + live-sweep groen, tenant-context opgelost (`runInTenant`/`currentWorkspaceId` + `preApiExecute`-boundary). R1+R4 samengevoegd tot één `pre-params`-fase (rauwe req → webhook-HMAC + grote upload); R2 keyed-lookup throwt op onbekende slot; R3 byte-identiek (nul migratie); R5 Redis-lease.

**Open vlaggen (voor de framework-AI / vóór de bouw):**
1. **Sync- + worker-tenant-boundary:** D-MT toont alleen de `/api`-boundary. Sync-handlers + background-workers (indexer, pty-agent, Workspace-AI) moeten **zelf `runInTenant(...)`** aanroepen → D-MT-doc aanvullen met een sync-/worker-sectie.
2. **E2e:** de "optional" webhook/upload-e2e één keer echt draaien (Workspaces hangt hierop).
3. **Commit:** alles staat uncommitted op `chore/package-split-prep` (+ secret-manager-stapel) → committen.
4. **Minor:** rate-limit app-global; stray-key-net legt alleen project-prefix → `formatKey`-discipline vereist voor tenant-isolatie.

---

## Netto-effect op de bouwbaarheid
De review heeft het project van "rijk beschreven maar met gaten" naar **uitvoerbaar** gebracht: een formeel datamodel, een geverifieerd framework-fundament, en de ontdekking dat veel zwaar werk (event-log-voeding, budget/runaway, gestructureerde carry-over, skills-isolatie, egress-control) **native door Claude Code** gedekt wordt via hooks/flags/sandbox. Resterend echt-zelf-bouwen: de orchestrator (containers/worktrees/pty-agent/indexer), de web-app (bord/event-log/presence/config-UI), notificaties + web-push, en de RAG-store. De volgende stap is de definitieve handoff naar de nieuwe repo.
