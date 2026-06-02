# SESSION_STATE — Workspaces sparring/handoff (thuis verdergaan)

> **Doel van dit bestand:** alles wat we deze sessie hebben gedaan, in detail, zodat je thuis op je eigen computer naadloos verder kunt. Datum: 2026-06-02. Repo: `C:\youcomm\LuckyStack-v2`, branch `chore/package-split-prep`. Taal: NL.
>
> **TL;DR:** Het hele **Workspaces**-project is uitontworpen (visie → spec → beslissingen → datamodel → UI-brief → review), het framework-fundament (`@luckystack/*` R1–R5 + D-MT) is geïmplementeerd én op broncode-niveau geverifieerd, en er is een zelf-standige `handoff/`-folder klaar voor de nieuwe repo. Open: framework committen+publishen+e2e, Claude Design afmaken, dan bouwen.

---

## 1. Wat is Workspaces (1 alinea)
Een zelf-gehoste, mobiel-vriendelijke webapp die AI-gedreven development orkestreert: per ticket een eigen Claude Code CLI in een git-worktree + Docker-container (live browser-terminal), een scrumbord als view op GitLab met een per-project configureerbare pipeline van stages, een informatie-/skill-systeem (context-docs + RAG/MCP), en een overkoepelende Workspace-AI. Gebouwd bovenop het **LuckyStack**-framework (deze repo, dat als 14 `@luckystack/*`-packages naar npm gaat). Threat-model: **trusted small-group, self-hosted** (jij + paar collega's), géén publieke SaaS. Toetssteen: *op het water, telefoon, voice, tickets autonoom verwerkt terwijl je weg bent.*

---

## 2. Wat we deze sessie hebben gedaan (chronologisch)
1. **Codebase-sweep** — 2 parallelle workflows (17 agents) lazen het hele LuckyStack-framework (`packages/*`) en verifieerden de haalbaarheid van het Workspaces-idee tegen de échte source, met bestandscitaties.
2. **Sparring-docs geschreven** (`sparring/`): `IDEE_SPEC`, `IDEE_OVERZICHT`, `FRAMEWORK_GAPS` (G1–G29), `FRAMEWORK_CAPABILITIES`, `FRAMEWORK_REMEDIATION` (R1–R5), `VRAGEN`, `README`.
3. **Sparringrondes** (vraag-voor-vraag) → alle keuzes in `BESLISSINGEN.md` (B-01…B-25 + de detail-items B-O1…B-O8).
4. **Framework-first remediation gedefinieerd** (R1–R5 + D-MT doc) → **een andere AI heeft die geïmplementeerd** (zie `docs/HANDOFF-R1-R5.md`).
5. **Design-brief** voor Claude Design (`sparring/DESIGN_BRIEF.md`, 15 schermen, desktop+mobiel).
6. **Pre-build review** — 2 read-only audits (coherentie + cross-cutting) → review verwerkt → **B-26…B-39**, `DATAMODEL.md`, `CLAUDE_SETTINGS_MAP.md`, `REVIEW.md`; `VRAGEN.md` gearchiveerd.
7. **R1–R5 broncode-geverifieerd** (skeptische agent las source + tests): alle 5 + D-MT kloppen, fail-closed, geen stubs/casts, 37 tests, gates groen.
8. **`handoff/`-folder gebouwd** — zelf-standig pakket voor de nieuwe repo (`HANDOFF.md` + `FRAMEWORK_USAGE.md` + alle project-docs).
9. **Claude Design** — kit-staat ontvangen → **feature-completion-spec** geschreven (`handoff/designs/CLAUDE_DESIGN_FEATURE_COMPLETION.md`) om alle ontbrekende schermen/menu's/popovers toe te voegen.

---

## 3. Belangrijkste beslissingen (volledige lijst in `BESLISSINGEN.md`)
- **Tenant = Workspace** (multi-tenant, trusted small-group; per-user meerdere workspaces, deelbaar). Multi-tenant + permissies **in V1**; billing + voice **later**.
- **Auth:** OAuth-login + **gekoppelde SSH-key vereist om terminals te openen** (challenge op de `/pty`-namespace).
- **RBAC:** Owner = alles · Admin = alles **behalve** admin-rolbeheer + ownership/delete · Member = volledig werken (terminals+tickets), geen config/pipeline.
- **GitLab = source of truth** (bord synct, conflict → GitLab wint) + webhook-reconciliatie-cron.
- **Infra:** **Caddy** (edge + wildcard-TLS; níét de LuckyStack-router) · **MongoDB Atlas Local** (voor `$vectorSearch`) · **één base-image** + per-stage process-start · **per-container pty-agent** (overleeft orchestrator-restart).
- **Lagensysteem:** ~5 **context-docs** (geladen) + **skills/MCP** (RAG/graph/symbol/route/git/test/deps/cross-ticket); **self-hosted embeddings** (geen kosten) + leun op Claude-CLI native search in worktree.
- **Event-log:** gecoalesceerde events, append-only **aparte Mongo-collectie** + Redis-`seq`.
- **Workspace-AI:** voorstellen + accept (geen auto-acties).
- **Toegevoegd uit de review:** notificaties (email + web-push), spend/budget + runaway-control, backup/DR, data-retentie/delete, sprints met tijdsduur, mobiel ~99% parity.
- **B-38 — `.claude/settings.json`-first:** de pipeline-editor mapt 1-op-1 op de échte Claude-Code-config; skill/template-marktplaats = later.

---

## 4. Framework-fundament: R1–R5 + D-MT — status & verificatie
Geïmplementeerd door een andere AI, gedocumenteerd in **`docs/HANDOFF-R1-R5.md`**, door mij broncode-geverifieerd (✅ alle items kloppen, fail-closed, geen stubs/`as any`, 37 tests, 14/14 builds, live-sweep groen):
- **R2** keyed client-registry (`getPrismaClientFor('mongo:ro'|…)`, onbekende slot **throwt**).
- **R3** `registerRedisKeyFormatter`/`formatKey` (byte-identieke default → nul migratie).
- **R5** Redis-lease (`acquireLease`/`renew`/`release`, owner-checked Lua) — voor de single-instance orchestrator.
- **R1+R4** samengevoegd tot één **`pre-params`**-fase (`registerCustomRoute(h, {phase:'pre-params'})` + `registerOriginExemptPath`) → webhook-HMAC + grote upload.
- **D-MT** `docs/ARCHITECTURE_MULTI_TENANCY.md` — `runInTenant`/`currentWorkspaceId` (AsyncLocalStorage) + `preApiExecute`-boundary.

**Open vlaggen (af te handelen vóór/bij de bouw):**
1. **D-MT toont alleen de `/api`-boundary** → sync-handlers + background-workers (indexer, pty-agent, Workspace-AI) moeten **zelf `runInTenant(...)`** aanroepen. (Doc aanvullen of als app-eis onthouden.)
2. **Webhook/upload-e2e** staat als "optioneel" → één keer echt draaien (recipe in `docs/ARCHITECTURE_HTTP.md`).
3. **Alles staat UNCOMMITTED** op `chore/package-split-prep` (+ secret-manager-stapel) → committen.
4. Minor: rate-limit is app-global; de R3 stray-key-net legt op rauwe keys alleen de project-prefix → gebruik consequent `formatKey`.

---

## 5. Grote ontdekking: veel is Claude-Code-native (`CLAUDE_SETTINGS_MAP.md`)
De settings.json-research onthulde dat veel "zelf bouwen"-werk al door Claude Code gedekt wordt:
- **`http`-hooks** (`PostToolUse`/`Stop`/`Notification`) → POST naar de orchestrator → voeden de **event-log + status**.
- **`--max-budget-usd` / `--max-turns`** → budget- + runaway-cap per run.
- **`--json-schema`** → dwingt de gestructureerde **carry-over** af.
- **`--mcp-config --strict-mcp-config`** → skills-per-stage geïsoleerd.
- **`sandbox.network.allowedDomains`** → egress-control (container-hygiëne voor de trusted-group).
- **`worktree.*`** → native worktree-config.

---

## 6. Bestandskaart — waar alles staat
**`sparring/`** (werkhistorie, deze repo): `IDEE_SPEC`, `IDEE_OVERZICHT`, `BESLISSINGEN`, `DATAMODEL`, `CLAUDE_SETTINGS_MAP`, `REVIEW`, `DESIGN_BRIEF`, `FRAMEWORK_GAPS`, `FRAMEWORK_CAPABILITIES`, `FRAMEWORK_REMEDIATION`, `README`, `VRAGEN`(gearchiveerd).

**`handoff/`** (zelf-standig pakket voor de NIEUWE repo — dit is wat je meeneemt):
- `HANDOFF.md` — startpunt (twee-systemen-model, bouwvolgorde, prep-stappen, orchestrator-workstream).
- `FRAMEWORK_USAGE.md` — welke packages + de geverifieerde primitives + Claude-CLI-integratie.
- `BESLISSINGEN.md`, `DATAMODEL.md`, `CLAUDE_SETTINGS_MAP.md`, `IDEE_SPEC.md`, `IDEE_OVERZICHT.md`, `DESIGN_BRIEF.md`, `REVIEW.md`, `FRAMEWORK_GAPS.md`, `FRAMEWORK_CAPABILITIES.md`.
- `designs/` — `README.md` (placeholder) + `CLAUDE_DESIGN_FEATURE_COMPLETION.md` (de spec voor Claude Design).
- `SESSION_STATE.md` — dit bestand.

**Framework-eigen docs** (shippen mee bij `npm install @luckystack/*`, niet in `handoff/`): `docs/HANDOFF-R1-R5.md`, `docs/ARCHITECTURE_MULTI_TENANCY.md`, `docs/ARCHITECTURE_HTTP.md`, alle `docs/ARCHITECTURE_*` + package-`CLAUDE.md`'s.

---

## 7. Om thuis verder te gaan — checklist
**Spoor 1 — Framework publiceren (blokkeert de installatie):**
1. [ ] R1–R5 + secret-manager-werk reviewen en **committen** op `chore/package-split-prep`.
2. [ ] Webhook/upload-**e2e** draaien (`docs/ARCHITECTURE_HTTP.md`-recipe): `/webhooks/*`→200 (geen 403), `/api/*` zonder Origin→403, >1 MiB upload→geen 413.
3. [ ] `npm install` (ververst symlinks) → `npm org create luckystack` → de 14 packages **publishen**.
4. [ ] (Klein) D-MT-doc aanvullen met de sync-/worker-`runInTenant`-sectie.

**Spoor 2 — Claude Design afmaken (parallel):**
5. [ ] De spec uit `handoff/designs/CLAUDE_DESIGN_FEATURE_COMPLETION.md` in Claude Design plakken — **per PART** (Part 1 → Part 2 → de pipeline-tabs → de 40-item overlay-catalogus → states), met telkens de foundations-alinea erbij.
6. [ ] De resulterende designs in `handoff/designs/` zetten (per scherm).

**Spoor 3 — Workspaces bouwen (nieuwe repo, ná spoor 1):**
7. [ ] Nieuwe repo opzetten met `npx create-luckystack-app` → `npm install @luckystack/*`.
8. [ ] `handoff/`-folder erin kopiëren als project-docs.
9. [ ] Bouwen volgens `HANDOFF.md §6` bouwvolgorde: fundament+datamodel → orchestrator-kern → terminals → bord+event-log → pipeline-editor+skills → Workspace-AI+notificaties+budget → mobiel+voice.

---

## 8. De twee bouw-workstreams (uit `HANDOFF.md`)
- **A) Web-app (LuckyStack):** bord/backlog/ticket-detail/terminals-view/pipeline-editor/bronnen/Workspace-AI/account/org/event-log. Standaard LuckyStack-server, schaalt. Hier shipt het framework.
- **B) Orchestrator (apart, single-instance, grote zelf-bouw):** Docker-containers, git-worktrees, ~20 Claude-CLI-processen, pty-agents, RAG-indexer (bullmq+lease), GitLab-webhook, Workspace-AI, budget/runaway. Buiten het framework (mag `@luckystack/core` importeren). **Onderschat deze niet** — maar veel is Claude-CLI-native (zie §5).

---

## 9. Openstaande risico's / dingen om in de gaten te houden
- Framework nog niet gepubliceerd (spoor 1).
- Orchestrator = bewuste single-instance-SPOF; pty-agent + reattach + graceful drain mitigeren terminal-verlies.
- Self-hosted embeddings: benchmark op je eigen codebases (kwaliteit vs. cloud); leun op Claude-CLI search in worktree.
- Atlas Local vereist voor `$vectorSearch` (anders cosine-fallback).
- Secrets: per-workspace GitLab-token versleuteld op de Workspace-row; lever als scoped/kortlevende token aan containers, niet als ruwe env.
- Mobiel ~99% parity is een harde eis (de toetssteen).

---

## 10. Eén-regel-samenvatting om mee te beginnen thuis
*Ontwerp compleet + framework-fundament geverifieerd; doe spoor 1 (commit→e2e→publish), maak Claude Design af (spoor 2), en bouw dan Workspaces in een nieuwe repo volgens `handoff/HANDOFF.md` — begin met het datamodel + de orchestrator-kern.*
