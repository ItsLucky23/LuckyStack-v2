# Framework-gebruik — welke packages + welke primitives

> Wat je installeert van LuckyStack en de **geverifieerde** primitives die je gebruikt om Workspaces te bouwen. Alles hieronder is op broncode-niveau gecontroleerd (`docs/HANDOFF-R1-R5.md` + `docs/ARCHITECTURE_MULTI_TENANCY.md` shippen mee met de packages). Diepere framework-context: [`FRAMEWORK_CAPABILITIES.md`](./FRAMEWORK_CAPABILITIES.md) + [`FRAMEWORK_GAPS.md`](./FRAMEWORK_GAPS.md).

## 1. Packages om te installeren
| Package | Waarvoor in Workspaces |
|---|---|
| `@luckystack/core` | Fundament: DI-registries, hooks, `tryCatch`, rate-limiter, **R2/R3/R5-primitives** (zie §3) |
| `@luckystack/server` | One-call server-bootstrap (HTTP+Socket.io); **`pre-params` custom-routes + origin-exempt** (R1+R4) |
| `@luckystack/api` | File-based `_api/`-routes |
| `@luckystack/sync` | Real-time `_sync/`-rooms (transport voor de live event-log) |
| `@luckystack/login` | OAuth + sessies + `UserAdapter`/`SessionAdapter` (basis voor SSH-auth) |
| `@luckystack/presence` | AFK/disconnect-grace + status-badge (basis voor de presence-roster) |
| `@luckystack/email` | Transactionele email (invites + notificaties) |
| `@luckystack/error-tracking` | Sentry/Datadog/PostHog |
| `@luckystack/devkit` | Dev hot-reload + type-gen |
| `@luckystack/test-runner` | API-sweep |
| `create-luckystack-app` | Scaffold de web-app |

> **Niet** nodig: `@luckystack/router` (geen subdomein/TLS-proxy → gebruik **Caddy**). `@luckystack/secret-manager` optioneel (per-workspace-token = app-data op de Workspace-row).

## 2. De web-app starten
Scaffold met `create-luckystack-app`. Boot met `bootstrapLuckyStack({...})`; **bewaar `ioServer`** (één regel) — die heb je nodig voor de `/pty`-namespace:
```ts
const server = await bootstrapLuckyStack({ serveFile, serveFavicon });
attachPtyNamespace(server.ioServer);   // jouw code
await server.listen();
```
DEV = 2 poorten (Vite :5173 browser-facing + backend :80). PROD = 1 poort.

## 3. De geverifieerde framework-primitives (R1–R5 + D-MT)

### Multi-tenancy (D-MT)
```ts
import { runInTenant, currentWorkspaceId } from '...tenantContext'; // AsyncLocalStorage-helper (zie ARCHITECTURE_MULTI_TENANCY.md)
// In een preApiExecute-subscriber: resolve workspaceId, check membership/RBAC, dan:
runInTenant(workspaceId, () => handler());
// currentWorkspaceId() throwt luid buiten een tenant-scope — by design.
```
**App-build-eis (open framework-doc-gat):** `runInTenant` wordt in de D-MT-doc alleen op de `/api`-boundary getoond. **Sync-handlers (`_sync/*`) én background-workers** (indexer, pty-agent, Workspace-AI) draaien buiten de request-lifecycle → wrap hun werk **zelf** in `runInTenant(workspaceId, …)`, anders throwt `currentWorkspaceId()`.

### Gegradeerde DB-clients (R2) — B-O8-tiers
```ts
import { registerPrismaClient, getPrismaClientFor } from '@luckystack/core';
registerPrismaClient(new PrismaClient({ datasourceUrl: env.MONGO_RO }), 'mongo:ro');
registerPrismaClient(new PrismaClient({ datasourceUrl: env.MONGO_RW }), 'mongo:rw');
const reader = getPrismaClientFor('mongo:ro');  // onbekende slot → THROWT (geen stille default)
```
Framework-internals (sessies/rate-limit/presence) blijven op de default-client.

### Tenant-Redis-keys (R3)
```ts
import { registerRedisKeyFormatter, formatKey } from '@luckystack/core';
// Bij boot: app-keys per workspace prefixen (framework-namespaces -session/:rate-limit blijven app-global)
registerRedisKeyFormatter((ns, suffix) => /* <project>:ws:<currentWorkspaceId()>:<ns>:<suffix> */ ...);
await redis.set(formatKey('ticketseq', ticketId), '0');  // → <project>:ws:<wsId>:ticketseq:<id>
```
**Discipline-eis:** route álle app-Redis-keys door `formatKey` — de stray-key-net legt op rauwe keys alleen de project-prefix, niet de tenant.

### Leader-election (R5) — voor de single-instance orchestrator/indexer
```ts
import { acquireLease, renewLease, releaseLease } from '@luckystack/core';
const token = await acquireLease('orchestrator', 30_000); // null als al gehouden
// renew/release zijn owner-checked (Lua). De renew-loop is jouw code.
```

### Webhooks + grote uploads (R1+R4)
```ts
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';
registerOriginExemptPath({ pathPrefix: '/webhooks/' });                 // fail-closed default; exempt = géén auth
registerCustomRoute(gitlabWebhookHandler, { phase: 'pre-params' });     // rauwe, ongedrainde req → body-HMAC + grote upload
```
Verifieer **altijd** zelf de signature/secret (origin-exemptie ≠ authenticatie). Houd webhooks op een eigen prefix, nooit overlappend met `/api`·`/auth`·`/sync`.

### Event-log-patroon (sync = transport, jij bouwt de log)
Sync is fire-and-forget zonder ordering/replay → de duurzame event-log is **app-eigen Mongo** (`TicketEvent`, `seq` via Redis `INCR`, unique `[ticketId, seq]`). Eén `_sync/appendEvent`-handler schrijft de rij **en** returnt 'm als `serverOutput` → audit + live-push in één. Catch-up: `postSocketReconnect` → `apiRequest(getEvents, {sinceSeq})` → subscribe-first + merge-op-seq.

## 4. De Claude-CLI-integratie (de orchestrator-backbone)
Veel zwaar werk is **Claude-Code-native** — de orchestrator leunt erop i.p.v. zelf te bouwen (detail: [`CLAUDE_SETTINGS_MAP.md`](./CLAUDE_SETTINGS_MAP.md)):
- **`http`-hooks** (`PostToolUse`/`Stop`/`Notification`) → POST naar orchestrator-endpoints → voeden de **event-log** + **status** (needs-input/done/stuck).
- **`--max-budget-usd` / `--max-turns`** → budget- + runaway-cap per run.
- **`--json-schema`** → dwingt de gestructureerde **carry-over** af (`{summary, changedFiles, openQuestions, commitHash}`).
- **`--mcp-config` + `--strict-mcp-config`** → skills (RAG/graph/…) als MCP-servers, geïsoleerd per stage.
- **`sandbox.network.allowedDomains`** → egress-allowlist (container-hygiëne voor de trusted-group).
- **`worktree.*`** → native worktree-config (`symlinkDirectories` voor `node_modules`).

## 5. Wat je NIET van het framework krijgt (bouw zelf / extern)
Scheduler/queue → **bullmq**; subdomein/TLS-proxy → **Caddy**; vector-search-infra → **Atlas Local**; node-pty/terminal-gateway → eigen `/pty`-namespace + pty-agent; STT → whisper.cpp; web-push → PWA service-worker; RBAC-policy → app; monitoring/metrics → ongebouwd (alleen error-tracking ships). Detail per scenario: [`FRAMEWORK_GAPS.md`](./FRAMEWORK_GAPS.md).
