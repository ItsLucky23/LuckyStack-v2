# Workspaces — Datamodel (Prisma) & kerncontracten

> Het ontbrekende fundament: een formeel datamodel voor élke entiteit, plus de contracten die in de spec alleen in proza stonden (RBAC, stage/status-vorm, commit-hash-timing, event-granulariteit, Workspace-AI-autonomie, query-per-skill-slice). Gegrond in de **echte** framework-primitives uit `docs/HANDOFF-R1-R5.md` + `docs/ARCHITECTURE_MULTI_TENANCY.md`.
>
> Beslissingen: [`BESLISSINGEN.md`](./BESLISSINGEN.md). Schema-dialect: **Prisma op MongoDB** (`provider = "mongodb"`, ids = `String @id @default(auto()) @map("_id") @db.ObjectId`). Velden hieronder zijn indicatief — namen/types zijn leidend, niet elke Mongo-annotatie is uitgeschreven.

---

## 0. Conventies & framework-koppeling
- **Tenant = Workspace.** Élk tenant-gescoped model draagt `workspaceId`. Isolatie via de geverifieerde D-MT-primitives:
  - **Rij-isolatie:** een app-eigen `tenantDb = getPrismaClient().$extends({...})` die `workspaceId` injecteert op elke read/write van tenant-modellen (de `TENANT_MODELS`-set, §11).
  - **Tenant-context:** `runInTenant(workspaceId, fn)` / `currentWorkspaceId()` (`AsyncLocalStorage`), binnengegaan in een `preApiExecute`-subscriber ná de membership-check. **Let op (open framework-vlag):** sync-handlers en background-workers (indexer, pty-agent, Workspace-AI) draaien buiten de `/api`-lifecycle → die moeten **zelf** `runInTenant(...)` aanroepen.
  - **Gegradeerde DB-clients (B-O8):** `getPrismaClientFor('mongo:ro'|'mongo:rw')` (R2 keyed-registry; onbekende slot throwt).
  - **Redis-keys:** alle via `formatKey(namespace, suffix)` met een tenant-formatter → `<project>:ws:<workspaceId>:<namespace>`.
- **Framework-global (géén `workspaceId`):** `User` + sessies (een user spant meerdere workspaces). Die leven op de default-client/`prisma`.
- **Append-only modellen** (nooit update/delete via app): `TicketEvent`, `RagEntry`, `WorkspaceSignal`. Immutability app-afgedwongen.

---

## 1. Identity & toegang

```prisma
// Framework-global. @luckystack/login bezit de User via UserAdapter; dit is de app-vorm.
model User {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  name         String
  email        String   @unique
  avatar       String?
  // OAuth-identiteit (B-05: OAuth = login). Meerdere providers koppelbaar.
  oauthAccounts OAuthAccount[]
  sshKeys      SshKey[]
  memberships  WorkspaceMember[]
  createdAt    DateTime @default(now())
}

model OAuthAccount {
  id           String @id @default(auto()) @map("_id") @db.ObjectId
  userId       String @db.ObjectId
  provider     String // 'github' | 'gitlab' | ...
  providerUserId String
  user         User   @relation(fields: [userId], references: [id])
  @@unique([provider, providerUserId])
}

// B-05: SSH-publieke sleutel gekoppeld aan het account; vereist om terminals te openen.
model SshKey {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  userId      String   @db.ObjectId
  name        String   // "MacBook Pro"
  publicKey   String   // alleen de PUBLIEKE helft; privé blijft client-side
  keyType     String   // 'ed25519' | 'rsa' | ...
  fingerprint String
  addedAt     DateTime @default(now())
  lastUsedAt  DateTime?
  user        User     @relation(fields: [userId], references: [id])
  @@unique([fingerprint])
}
```

### Workspace (tenant) + membership + invites
```prisma
model Workspace {
  id                 String   @id @default(auto()) @map("_id") @db.ObjectId
  name               String
  slug               String   @unique
  ownerId            String   @db.ObjectId
  gitlabBaseUrl      String   // self-hosted of gitlab.com
  gitlabTokenEnc     String?  // B-07: per-workspace token, VERSLEUTELD op de row; decrypt per request
  retentionPolicy    Json?    // B-39
  createdAt          DateTime @default(now())
  members            WorkspaceMember[]
  invites            Invite[]
  projects           Project[]
}

enum Role { OWNER ADMIN MEMBER }

model WorkspaceMember {
  id          String    @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String    @db.ObjectId
  userId      String    @db.ObjectId
  role        Role
  invitedById String?   @db.ObjectId
  joinedAt    DateTime  @default(now())
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  user        User      @relation(fields: [userId], references: [id])
  @@unique([workspaceId, userId])
  @@index([userId])
}

// B-06: leden via e-mail-invite (@luckystack/email).
model Invite {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  email       String
  role        Role     @default(MEMBER)
  token       String   @unique
  invitedById String   @db.ObjectId
  expiresAt   DateTime
  acceptedAt  DateTime?
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  @@index([workspaceId])
}
```

### RBAC-matrix (B-28) — afgedwongen in `main(...)` of één `preApiExecute`-subscriber (authz = app-domein)
| Actie | Owner | Admin | Member |
|---|---|---|---|
| Terminals gebruiken + op tickets werken | ✓ | ✓ | ✓ |
| Pipeline/stages editen | ✓ | ✓ | ✗ |
| Workspace-settings / GitLab-token / integraties | ✓ | ✓ | ✗ |
| Members (gewone) inviten/verwijderen | ✓ | ✓ | ✗ |
| Sprints/labels beheren, container-teardown | ✓ | ✓ | ✗ |
| Member → **Admin** promoten | ✓ | ✗ | ✗ |
| Admin downgraden/verwijderen | ✓ | ✗ | ✗ |
| Ownership overdragen / workspace verwijderen | ✓ | ✗ | ✗ |

**Request-lifecycle:** `auth={login:true}` → `preApiExecute`-subscriber resolvet de target-`workspaceId`, laadt `WorkspaceMember`, checkt de rol tegen de actie (anders stop met reden), dan `runInTenant(workspaceId, …)`. Daarbinnen: `tenantDb.*` filtert rijen, `formatKey(...)` prefixt Redis, per-workspace-secret decrypt.

---

## 2. Project, pipeline & stages

```prisma
model Project {
  id               String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId      String   @db.ObjectId
  name             String
  gitlabProjectId  String   // GitLab = source of truth (B-29)
  gitlabPath       String   // "youcomm/app"
  defaultPipelineId String? @db.ObjectId
  createdAt        DateTime @default(now())
  @@index([workspaceId])
}

// B-O4: één default-pipeline per project, kloneerbaar; eigen templates later.
model Pipeline {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  projectId   String   @db.ObjectId
  name        String
  isDefault   Boolean  @default(false)
  stages      PipelineStage[]
  @@index([workspaceId, projectId])
}

model PipelineStage {
  id                     String  @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId            String  @db.ObjectId
  pipelineId             String  @db.ObjectId
  order                  Int
  name                   String  // "Plan"
  aiEnabled              Boolean @default(true)
  customInstructions     String? // → CLAUDE.md in de container
  promptInjectionTemplate String? // B-O2 carry-over: {{summary}} {{changedFiles}} {{openQuestions}} {{commitHash}}
  visibleStageIds        String[] @db.ObjectId // §4.6: bron-stage bepaalt eigen zichtbaarheid
  claudeSettings         Json?   // B-38: het .claude/settings.json-blok dat we 1-op-1 renderen (zie CLAUDE_SETTINGS_MAP.md)
  // kind-collecties:
  skills      StageSkill[]
  commands    StageCommand[]
  toolPerms   StageToolPermission[]
  sources     StageSource[]
  statuses    StageStatus[]
  processes   StageProcess[]
  @@index([pipelineId, order])
}

// B-15/B-16: skills/MCP per stage. skillKey is canoniek (DH2: gebruik "RAG").
model StageSkill {
  id       String  @id @default(auto()) @map("_id") @db.ObjectId
  stageId  String  @db.ObjectId
  skillKey String  // 'RAG' | 'code-graph' | 'symbol-index' | 'route-index' | 'git-history' | 'test-runner' | 'deps-audit' | 'cross-ticket'
  enabled  Boolean @default(true)
  config   Json?   // bv. MCP-server-args
}

// Whitelisted shell-commands → mappen op .claude permissions (B-38).
model StageCommand {
  id      String @id @default(auto()) @map("_id") @db.ObjectId
  stageId String @db.ObjectId
  pattern String // bv. "Bash(npm run test:*)"
  mode    String // 'allow' | 'ask' | 'deny'
}

// B-O8: per stage per tool een credential-tier → getPrismaClientFor(key).
model StageToolPermission {
  id      String @id @default(auto()) @map("_id") @db.ObjectId
  stageId String @db.ObjectId
  tool    String // 'mongo' | 'redis' | (uitbreidbaar)
  tier    String // 'ro' | 'rw'  → clientKey "mongo:ro" etc.
}

// §5.4/DH3: een stage linkt een bron + een FILTER (nooit de hele bron).
model StageSource {
  id       String @id @default(auto()) @map("_id") @db.ObjectId
  stageId  String @db.ObjectId
  sourceId String @db.ObjectId // → InfoSource
  filter   Json?  // { moduleGlobs: string[], topK: number } — de query-slice
}

// B-O5: universele basis + custom per stage.
model StageStatus {
  id      String @id @default(auto()) @map("_id") @db.ObjectId
  stageId String @db.ObjectId
  key     String // 'needs-input' | 'busy' | 'done' | <custom>
  label   String
  kind    String // 'base' | 'custom'
  order   Int
}

// §7.5: geordende terminals × commando's voor process-start.
model StageProcess {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  stageId      String   @db.ObjectId
  terminalOrder Int
  commands     String[] // ["npm run server"] / ["npm run client"]
}
```

> **DH3 — query-per-skill-slice (opgelost):** een stage laadt nooit een hele bron. Voor een **context-doc** (klein) wordt het bestand geladen; voor een **skill** (RAG/graph/…) roept de Claude-CLI de MCP-skill aan met de `StageSource.filter` (`moduleGlobs`+`topK`) **én** de ticket-`commitHash` als filter. De skill voert dus een *slice-query* uit (bv. `$vectorSearch` met `filter:{commitHash, path∈moduleGlobs}`), niet een volledige inlading. Bevriezing-per-ticket = automatisch via de commit-hash-filter.

---

## 3. Informatielaag (context-docs + skills) — B-14/B-15

```prisma
model InfoSource {
  id            String  @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId   String  @db.ObjectId
  projectId     String  @db.ObjectId
  kind          String  // 'project-summary'|'conventions'|'glossary'|'db-schema'|'spec'|'RAG'|'code-graph'|'symbol-index'|'route-index'|'git-history'|'test-runner'|'deps-audit'|'cross-ticket'
  mode          String  // 'context-doc' (geladen) | 'skill' (opgevraagd, MCP). 'db-schema'/'route-index' = adaptief (B-O7: klein→doc, groot→skill)
  storage       String  // 'git-file' | 'mongo' | 'live'
  name          String
  summary       String? // elke laag heeft een eigen samenvatting
  lastIndexedCommit String?
  status        String  // 'healthy' | 'indexing' | 'stale' | 'error'
  @@index([workspaceId, projectId])
}

// B-25/B-32: append-only, commit-gestempeld; self-hosted embeddings (geen per-call-kosten).
model RagEntry {
  id          String  @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String  @db.ObjectId
  projectId   String  @db.ObjectId
  commitHash  String
  filePath    String
  chunkId     String
  content     String
  embedding   Float[] // vector-index = Atlas-side (Prisma kan 'm niet declareren)
  metadata    Json?
  createdAt   DateTime @default(now())
  @@index([commitHash, filePath])
  @@unique([commitHash, filePath, chunkId]) // delta-dedupe (B-O3)
}
```
**Canonieke skill-set (DH2 — gebruik "RAG"):** `RAG` (semantische slice-search over de bevroren store), `code-graph` (impact/relaties, graphify-MCP), `symbol-index`, `route-index`, `git-history`, `test-runner`, `deps-audit`, `cross-ticket`. Context-docs: `project-summary`, `conventions`, `glossary`, `db-schema` (klein), `spec`. (Breedte v1 = Tier A+B, B-17.)

---

## 4. Tickets, bord & sprints

```prisma
model Ticket {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId   String   @db.ObjectId
  projectId     String   @db.ObjectId
  gitlabIssueId String   // GitLab = SoT (B-29)
  gitlabIssueIid Int
  prefix        String   // "DEV-1240" (label voor branch/worktree)
  title         String
  description    String?
  stageId       String   @db.ObjectId // huidige stage
  statusKey     String   // huidige status binnen de stage (StageStatus.key)
  sprintId      String?  @db.ObjectId
  labels        String[] // GitLab-native, gecachet (B-29)
  branch        String?  // "DEV-1240"
  worktreePath  String?
  commitHash    String?  // bevroren RAG-snapshot (zie DH5)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([workspaceId, projectId, stageId])
  @@index([workspaceId, sprintId])
}

model TicketLink {
  id              String @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId     String @db.ObjectId
  ticketId        String @db.ObjectId
  relatedTicketId String @db.ObjectId
  type            String // 'relates' | 'blocks' | 'duplicates'
  createdBy       String // userId | 'ai'
}

model TicketReference {
  id          String @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String @db.ObjectId
  ticketId    String @db.ObjectId
  kind        String // 'file' | 'mr' | 'source'
  value       String // path / url / sourceId
  createdAt   DateTime @default(now())
}

// B-30: sprint met tijdsduur.
model Sprint {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  projectId   String   @db.ObjectId
  name        String
  startsAt    DateTime
  endsAt      DateTime
  isActive    Boolean  @default(false)
  @@index([workspaceId, projectId])
}
```

> **DH5 — stage/status-vorm:** een ticket = `{ stageId, statusKey }`. **Stage** = pipeline-stap (kolom); **status** = toestand binnen die stap (pill). Strikt twee niveaus.
>
> **DH5 — commit-hash-binding-timing:** de `commitHash` wordt toegekend **bij worktree-creatie** (`git pull origin main` → die hash). Hij is **bevroren**: als `main` verderschuift terwijl het ticket open is, blijft het ticket op zijn oude `commitHash` (code- + RAG-context bevroren). Pas bij her-activatie/nieuwe worktree pakt het de nieuwste hash. Ticket-/status-context is wél live (§6.4).

---

## 5. Runtime & orchestratie (LP11 — door mij bepaald)

```prisma
// Eén draaiend Claude-CLI-proces per actief ticket.
model AgentSession {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId   String   @db.ObjectId
  ticketId      String   @db.ObjectId
  stageId       String   @db.ObjectId
  containerId   String?  // Docker-container
  ptyAgentUrl   String?  // B-31: per-container pty-agent endpoint (orchestrator proxyt)
  status        String   // 'starting'|'running'|'needs-input'|'done'|'stuck'|'killed'|'error'
  model         String?  // welk Claude-model (B-38)
  startedAt     DateTime @default(now())
  lastHeartbeatAt DateTime? // B-35: stuck-detectie
  @@index([workspaceId, ticketId])
}
```

**Container/git-lifecycle (orchestrator, single-instance-pinned via R5-lease):**
1. Ticket activeren → `git pull origin main` → **commit-hash**.
2. RAG-snapshot: bestaat er voor die hash? → koppelen; zo niet → indexeren + stempelen (`RagEntry`).
3. `git worktree add` op branch `DEV-####`.
4. Container start uit **één base-image** + per-stage `StageProcess`-commando's (DEV: Vite :5173 + backend :80).
5. **Pty-agent** (in/naast de container) attacht het Claude-CLI-proces; de orchestrator proxyt de `/pty`-namespace. Scrollback-ring-buffer → reattach overleeft orchestrator-restart (B-31).
6. Stage-AI werkt → MR → merge-webhook (`pre-params`-route, R1) → **delta-indexer-job** op de bullmq-queue (serieel, R5-lease houdt één worker) → `RagEntry`-delta (B-O3).
7. Teardown: container weg; **branch + `TicketEvent` blijven**. Heractiveren = stap 1–5 opnieuw op de bestaande branch.

> **Tenant-context in workers:** de orchestrator/indexer/pty-agent draaien buiten de `/api`-lifecycle → ze wrappen hun werk expliciet in `runInTenant(workspaceId, …)` (anders throwt `currentWorkspaceId()` luid — by design).

---

## 6. Event-log & realtime (B-21, B-33)

```prisma
// Append-only, geordend, persistent. seq = app-toegekend via Redis INCR.
model TicketEvent {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  ticketId    String   @db.ObjectId
  seq         Int      // monotone per-ticket sequence (Redis INCR)
  type        String   // 'command' | 'file-change' | 'mr' | 'ai-message' | 'status-change' | 'stage-move' | 'system'
  actor       String   // userId | 'ai'
  payload     Json
  commitHash  String?
  createdAt   DateTime @default(now())
  @@unique([ticketId, seq])
  @@index([workspaceId, ticketId, seq])
}
```
**Schrijf-én-push in één handler:** een `_sync/appendEvent_server_v1.ts` schrijft de rij + returnt 'm als `serverOutput` → broadcast naar de ticket-room (live-view) + Mongo (audit). Catch-up na reconnect: `postSocketReconnect` → `apiRequest('ticket/getEvents', {sinceSeq})` → subscribe-first + merge-op-seq.

> **DH5 — event-granulariteitsregel (gecoalesceerd, B-21):** één event per **betekenisvolle mijlpaal**: `command` = één per uitgevoerd commando; `file-change` = één per gewijzigd bestand (met +/−-telling, niet per chunk); `ai-message` = één per **afgerond** AI-bericht (niet per token — live-tokens stream je zonder te persisteren); `mr`/`status-change`/`stage-move` = één per actie. Geen sub-token-regels.

---

## 7. Workspace-AI (B-O6, B-23)

```prisma
// Append-only signalen van stage-AI's → centraal, serieel geconsumeerd.
model WorkspaceSignal {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  ticketId    String?  @db.ObjectId
  type        String   // 'observation' | 'suggestion-input' | 'dependency-hint' | ...
  actor       String   // AgentSession.id
  payload     Json
  processed   Boolean  @default(false)
  createdAt   DateTime @default(now())
  @@index([workspaceId, processed, createdAt])
}

model WorkspaceSuggestion {
  id               String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId      String   @db.ObjectId
  type             String   // 'link-tickets' | 'create-epic' | 'config-review' | 'maintenance'
  title            String
  body             String
  relatedTicketIds String[] @db.ObjectId
  status           String   // 'open' | 'accepted' | 'dismissed' | 'snoozed'
  snoozedUntil     DateTime?
  createdAt        DateTime @default(now())
  resolvedAt       DateTime?
  @@index([workspaceId, status])
}

model WorkspaceNote {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  body        String
  archived    Boolean  @default(false)
  createdAt   DateTime @default(now())
}
```
> **DH5 — Workspace-AI-autonomie-scope (B-23: voorstellen + accept):** de Workspace-AI mag **alleen voorstellen produceren** (`WorkspaceSuggestion`) en notities schrijven; nooit zelf scrum-/git-acties uitvoeren. Toegestane voorstel-types: tickets linken, een epic voorstellen, een pipeline-config-bevinding, een bron-onderhouds-waarschuwing. **Uitvoeren gebeurt pas na `accept` door een gebruiker** (en respecteert de RBAC: een Member kan een config-wijzigend voorstel niet accepteren). Config-review-heuristieken (bv. "zwaardere bron in een vroegere stage dan een latere") leven als app-regels, niet hardcoded in het schema.

---

## 8. Spend, budget & runaway-control (B-35)

```prisma
model SpendRecord {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId  String   @db.ObjectId
  ticketId     String?  @db.ObjectId
  stageId      String?  @db.ObjectId
  sessionId    String?  @db.ObjectId
  inputTokens  Int
  outputTokens Int
  costEstimate Float
  at           DateTime @default(now())
  @@index([workspaceId, at])
}

model WorkspaceBudget {
  id            String  @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId   String  @unique @db.ObjectId
  periodCapCost Float?  // per maand; null = ongelimiteerd
  spentCost     Float   @default(0)
  autoPause     Boolean @default(true) // pauzeer agents bij cap
  alertAtPct    Int     @default(80)
}
```
Runaway-control: `AgentSession.lastHeartbeatAt` + een watcher → bij idle/timeout/iteratie-cap zet de sessie op `stuck` en escaleert naar `needs-input` (+ notificatie). Bij budget-cap → `autoPause`.

---

## 9. Notificaties (B-34)

```prisma
model Notification {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  userId      String   @db.ObjectId
  workspaceId String?  @db.ObjectId
  type        String   // 'needs-input' | 'merge' | 'ai-suggestion' | 'container-failure'
  title       String
  body        String
  link        String?
  channels    String[] // 'inapp' | 'email' | 'push'
  read        Boolean  @default(false)
  createdAt   DateTime @default(now())
  @@index([userId, read, createdAt])
}

model PushSubscription { // web-push (PWA)
  id       String @id @default(auto()) @map("_id") @db.ObjectId
  userId   String @db.ObjectId
  endpoint String @unique
  keys     Json   // { p256dh, auth }
}
```

---

## 10. Retentie & delete (B-39)
`delete workspace` → cascade-purge van alle tenant-modellen (`Ticket`, `TicketEvent`, `RagEntry`, `WorkspaceSignal/Suggestion/Note`, `AgentSession`, `SpendRecord`, …) + worktrees/containers teardown + Redis-keys (`SCAN <project>:ws:<id>:*`). Member-export/-delete: dump van de user-gerelateerde rijen.

---

## 11. Tenant-scoping — overzicht
**`TENANT_MODELS` (dragen `workspaceId`, lopen door `tenantDb` + tenant-formatter):** `WorkspaceMember`, `Invite`, `Project`, `Pipeline`, `PipelineStage` (+ kind-tabellen), `InfoSource`, `RagEntry`, `Ticket`, `TicketLink`, `TicketReference`, `Sprint`, `AgentSession`, `TicketEvent`, `WorkspaceSignal`, `WorkspaceSuggestion`, `WorkspaceNote`, `SpendRecord`, `WorkspaceBudget`, `Notification`(optioneel — ook per user).
**Framework-global (default-client, géén tenant-scope):** `User`, `OAuthAccount`, `SshKey`, sessies. `Workspace` zelf is de tenant-root (gefilterd op membership, niet op `workspaceId`).

**Redis-namespaces** (via `formatKey`): app-namespaces (`presence`, `ticketseq`, `rag`, `lease`, `indexer-queue`) → `<project>:ws:<workspaceId>:<ns>`; framework-namespaces (`-session`, `:rate-limit`) → app-global (een user spant workspaces).
