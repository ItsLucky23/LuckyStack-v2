# LuckyStack — Capability-baseline (referentie voor uitvoerende AIs)

> Doel: een uitvoerende AI genoeg framework-context geven om feasibility-calls te maken **zonder de hele repo te lezen**. Bron: parallelle codebase-sweep (9 explorers + synthese) over `packages/*` + `docs/*`, branch `chore/package-split-prep` (HEAD `7c3e1f4`, ~2026-06-02).
>
> Gebruik dit samen met [`FRAMEWORK_GAPS.md`](./FRAMEWORK_GAPS.md) (de harde grenzen, als oplosbare scenario's) en [`IDEE_SPEC.md`](./IDEE_SPEC.md) (de koppeling aan het Workspaces-project).

---

## 0. Wat LuckyStack is

Socket-first fullstack framework: **React 19 SPA** op een **raw Node.js + Socket.io** backend (géén Express), **file-based routing** voor pages/API's/sync-events, **Prisma 6.x** (MongoDB default, ook MySQL/Postgres/SQLite), **Redis**, **TypeScript 5.7**, Vite, TailwindCSS 4. Gepubliceerd (straks) als **14 `@luckystack/*` packages**.

Kernfilosofie: **extension-point driven, geen monkey-patch-bypass.** Elke boot-stap is observeerbaar of vervangbaar via een registry, adapter of hook. Config wordt **call-time** gelezen (deep-merge over defaults), nooit op import vastgelegd.

---

## 1. De vier feasibility-buckets

Élk onderdeel van een idee valt in één van deze buckets. Dit is het taginstrument door alle docs heen.

| Bucket | Betekenis |
|---|---|
| 🟢 **NATIVE** | Gebouwd, getypeerd, unit-getest — gewoon gebruiken. |
| 🟡 **EXTENSION** | Via registry/hook/adapter/file-drop — jij schrijft de handler, **geen fork**. |
| 🟠 **BUILD-ON-TOP** | Framework geeft alleen **transport/primitief**; de moeilijke kern bouw jij erbovenop. |
| 🔴 **OUT-OF-BOUNDS** | Ander tool of nog niet gebouwd in het framework. |

---

## 2. Capability-map (wat NATIEF bestaat)

| Categorie | Kern | Sleutelprimitives |
|---|---|---|
| **Transport & boot** (core+server) | Raw Node http + Socket.io in ~20 regels; vaste HTTP-dispatch (csrf→health→`_test/reset`→favicon→uploads→auth→api→sync→custom→static); Redis-adapter voor cross-instance room-fanout; CSRF double-submit (cookie-mode); CORS; security-headers; K8s-probes; boot-UUID + env-hash handshake | `createLuckyStackServer`/`bootstrapLuckyStack`, `registerProjectConfig`, `attachSocketRedisAdapter`, `/livez /readyz /_health`, `verifyBootstrap` |
| **API / file-routing** (api) | `src/{page}/_api/{name}_v{N}.ts` met `main`+`auth`+`ApiParams` → instant callable over **socket én HTTP/SSE** via één 13-staps pipeline (parse→session→route→auth→ratelimit→Zod→execute under tryCatch→i18n error-envelope); end-to-end getypeerd vanuit `name`+`version`-literals; per-route `stream()`, abort, offline-queue | `apiRequest({name,version,data})`, `main({data,user,functions,stream,abortSignal})`, `AuthProps{login,additional[]}`, `rateLimit`/`httpMethod`/`validation` exports |
| **Realtime sync** (sync) | Room-fanout als file-routes: `_server_v{N}` draait **1×** (validate/persist→`serverOutput`), optioneel `_client_v{N}` draait **per ontvanger** (filter/transform→`clientOutput`); 4 streaming-primitives; LLM-token-coalescing; cross-instance via Redis-adapter; HTTP/SSE-fallback; per-user token-rooms (multi-device) | `syncRequest({name,version,data,receiver,ignoreSelf})`, `upsertSyncEventCallback`, `broadcastStream`/`streamTo`/`createStreamThrottle`, `postSocketReconnect` |
| **Auth/sessies/presence** (login+presence) | Credentials (bcrypt) + OAuth (Google/GitHub/Discord/Facebook; Microsoft wired-maar-onbewezen; raw custom OIDC via `FullOAuthProvider`); Redis-sessies, sliding TTL, CSRF-mint, single/multi-session + force-logout; password-reset + email-change token-flows; pluggable `UserAdapter`/`SessionAdapter`; AFK/disconnect-grace, room-peer `userAfk`/`userBack` | `loginWithCredentials`, `registerOAuthProviders`, `saveSession`/`getSession`, `registerUserAdapter`/`registerSessionAdapter`, `revokeUserSessions` |
| **Function-injection + data** | Elke handler krijgt getypeerd `functions`-object (walk `functions/` + `shared/`: `<sub>/<file>.ts` export `foo` → `functions.<sub>.<file>.foo`); `functions.db.prisma` (getypeerde Proxy) + `functions.redis.redis`; DB-vendor = `schema.prisma` datasource-swap; `Prisma $extends` = sanctioned query-interceptie | `functions.db.prisma`/`functions.redis.redis`, `registerPrismaClient`/`registerRedisClient`, `Prisma $extends({query,result})`, `npm run generateArtifacts` |
| **Frontend** | Client-rendered React 19 SPA, RR7 glob-routing (`src/<page>/page.tsx`, `_`-folders privé, `[param]`), per-page `template`-const (`plain`/`dashboard`) + optionele `middleware`-guard; singleton socket → getypeerde callback-registry; Tailwind 4 `@theme`-role-tokens + `.dark`; dot-key i18n; ships Dropdown/MultiSelect/Avatar/Navbar/ConfirmMenu/ErrorPage + imperatieve `menuHandler` + sonner-toasts | `page.tsx`+`template`, `useSyncEvents`/`apiRequest`/`syncRequest`, `useSession`/`useTranslator`, `menuHandler.open/confirm` |
| **Tooling/type-gen/test** | devkit inline-expandeert route-types → `apiTypes.generated.ts` (+ `apiMethodMap`/`apiMetaMap`) + `apiInputSchemas.generated.ts` (TS-AST→Zod) + `apiDocs.generated.json`; test-runner 5-layer sweep (contract/auth/ratelimit/fuzz/custom) tegen **live server**; `/_docs` Swagger-UI; AI-snapshots | `generateArtifacts`, `npm run test`, `scaffold:test`, `mountDocsUi`, `registerTestLayer`/`registerTestFixture` |
| **Infra/packaging** | 14 packages + `create-luckystack-app`; `@luckystack/router` = HTTP+WS load-balancer (routeert op **eerste URL-segment** service/action, boot-UUID handshake, Redis-health, dev→staging fallback, WS gepind op `system`); email (Console/Resend/SMTP), error-tracking (Sentry/Datadog/PostHog fan-out), secret-manager (`.env`-pointers) | `@luckystack/router`+`deploy.config.ts`, `registerEmailSenders`/`sendEmail`, `registerErrorTrackers`, `initSecretManager` |

---

## 3. Het extensie-model (uitbreiden zonder forken)

Vier gelaagde seams, géén monkey-patch-bypass:

1. **DI-registries** (lazy gelezen, volgorde-vrij): `registerProjectConfig` (centrale knob-bag), `registerPrismaClient`/`registerRedisClient`, `registerLogger`/`registerErrorTracker(s)`/`registerNotifier`/`registerEmailSenders`, `registerRateLimitStrategy`, `registerCsrfConfig`/`registerAvatarConfig`/`registerSecurityHeaders`/`registerErrorFormatter`, `registerUserAdapter`/`registerSessionAdapter`, `registerOAuthProviders` (built-in factories OF raw `FullOAuthProvider`).
2. **Hook-bus** — ~40 async lifecycle-hooks via `registerHook` (`preApiValidate`/`preApiExecute`[stoppable]/`postApiExecute`/`transformApiResponse`/`preApiRespond`, `preSyncAuthorize`/`preSyncFanout`/`postSyncFanout`, volledige auth/session/password/email-lifecycle, socket connect/disconnect/room join-leave, cors/csrf/ratelimit-signalen, router `preProxyRequest`/`postProxyResponse`). `pre*` kan vetoën met `HookStopSignal{errorCode,httpStatus}`. Plus synchrone `registerSyncHook` voor hot-path error-shape.
3. **File-drop conventies** — nieuwe routes = files; nieuwe injected helpers = files in `functions/`/`shared/` (dan `generateArtifacts`); sessievorm uitbreiden via `declare module '@luckystack/core' { interface BaseSessionLayout }`; scaffold-templates via `registerTemplate`.
4. **Overlay-folder** — `bootstrapLuckyStack` auto-importeert `luckystack/<pkg>/` topologisch; canonieke boot-plek voor registry-calls + `Prisma $extends`-chaining.

**Harde grenzen van het extensie-model:** custom HTTP-routes draaien **altijd ná** framework-routes (geen `/api/*`-`/sync/*`-interceptie); CORS-resolver-functie moet **synchroon**; Express/Fastify-vervanging unsupported (raw-Node dispatch is closed, geen Express-middleware-ecosysteem); geen `as any`/`as unknown`/unsafe-wrappers (fix bij typing-falen = **regenereren**, niet casten); geen adapter-abstractie voor non-HTTP/non-socket transports (queue-worker/gRPC/Lambda-bridge kan `handleApiRequest` + token-extractors hergebruiken, maar je bedraadt het zelf).

---

## 4. Realtime-plafond (cruciaal voor ambitieuze realtime-ideeën)

**HOOG** voor authoritative-server realtime + AI-streaming; **MATIG, jij-bouwt-het-moeilijke-deel** voor offline-tolerante/convergente collaboratie.

**Werkt out-of-the-box & schaalt:** room-broadcast waar de **server authoritative-per-change** is (multiplayer-moves, live dashboards, chat, presence/cursors). Redis-adapter maakt `io.to(room).emit()` cross-instance transparant. Per-user token-rooms = multi-device gratis. **Marquee-use-case: LLM-token-streaming naar een hele room** (`broadcastStream` + `createStreamThrottle` coalesce 3-10-char tokens → ~32-char chunks, 10-100× minder messages + `flushPressure`-backpressure + abortable via `apiCancel`/`syncCancel`→AbortController). Socket-streaming **én** HTTP/SSE-fallback.

**Breekt af (de app bouwt het):**
1. **Geen delivery-guarantee / geen per-recipient ack** — fanout is fire-and-forget `socket.emit`; de originator-ack bevestigt alleen dat `_server` liep, `recipientCount` telt **pogingen** niet afleveringen.
2. **Geen ordering / sequence-nummers** — concurrent `syncRequest`s, throttle-flushes en de async per-recipient `_client`-loop kunnen interleaven; na reconnect wordt volgorde niet hersteld. CRDT/OT-convergentie = volledig op jou.
3. **Geen event-log / history / replay** — een client die offline of mid-reconnect is **mist elk event** in het gat; geen backlog/`lastEventId`/snapshot+delta. Bedoelde patroon: op `postSocketReconnect` → `apiRequest` snapshot van server-state → resume live (**jij** bedraadt dit; de template auto-rejoint/replayt niet).
4. **`_client` per-recipient draait alleen op lokale sockets** onder de Redis-adapter — cross-instance ontvangers krijgen de ruwe broadcast-frame maar hun `_client` filter/transform draait niet op de afvurende instance → per-recipient-logica op schaal vereist sticky sessions of een custom cross-instance runner.
5. **Offline-queue is in-memory per-tab** (verloren bij reload, capped, kan stil droppen).
6. **Grote rooms = O(n)-loop** (per-recipient token-extractie + optioneel `_client`), gemitigeerd door event-loop-yielding niet sharding; `flushPressure` sampelt alleen de eerste 32 sockets → 10k+-in-één-room low-latency-fanout is geen fit.
7. **Stream-chunks dragen geen ingebouwde order/index** → reassembly+dedup is consumer-werk.

> Net: behandel sync als **snelle, schaalbare realtime-transport**; leg er zelf sequencing, snapshotting en catch-up overheen voor alles dat convergentie of gegarandeerde levering vraagt.

---

## 5. Datamodel-story

Prisma 6.x = de enige ORM, bereikt via injected, volledig getypeerde `functions.db.prisma`-Proxy (**geen casts**). Redis = de andere first-class store via `functions.redis.redis` — **dezelfde instance** backt sessies, rate-limit, `activeUsers`, offline-queue-replay én de Socket.io cross-instance-adapter.

- **DB-vendor = datasource-swap** (`schema.prisma`): Mongo/MySQL/Postgres/SQLite, handler-code identiek — MAAR in de praktijk is maar **één provider in dev geoefend**, cross-vendor is ongeaudit, en de repo **default = MongoDB**. Die default pint het hele project op **Prisma 6.19** (Prisma 7 vereist driver-adapters; `@prisma/adapter-mongodb` bestaat nog niet). Prisma-model-types her-exporteren via `src/_types/<Model>.ts` (eslint-regel verbiedt `@prisma/client`-import in components).
- **Makkelijk:** typed CRUD, Redis-caching/counters/sets/queues, session-blobs (whole-record JSON-rewrite per save — geen partial updates), per-OAuth-provider-tokens op de sessie via `extraSessionFields` zonder schema-wijziging.
- **Zelf bouwen:** cross-cutting data-invarianten (multi-tenant where-injection, soft-delete, audit, computed) **alleen** via `Prisma $extends` op de ene geregistreerde client (er is **bewust geen** `prePrismaQuery`/`postPrismaQuery`-hook, geen connection-level-interceptie); multi-tenant Redis-key-isolatie (prefixes `session:`/`rateLimit:`/`oauth-state:`/… zijn **hardcoded** over ~8 files; `registerRedisKeyFormatter` is roadmap-only); audit-trail/metrics-store (`@luckystack/monitoring` **ongebouwd**); module-level state in injected files = **per-proces** (multi-instance → externaliseren naar Redis/DB).

> **Gedeelde Redis is de harde horizontale-schaal-dependency** — sessies, rate-limit, boot-UUID, offline-queue én socket-fanout keyen erop; de router split/fallback-mode start niet zonder.

---

## 6. Bekende harde grenzen (samengevat — detail per scenario in `FRAMEWORK_GAPS.md`)

| Gebied | Grens |
|---|---|
| **Publish** | Niets gepubliceerd; npm-org `@luckystack` bestaat niet (`npm org create luckystack` vereist). Alle gates groen (14/14 builds, lint 0, tsc clean, ~703 tests) maar dat is gate-pass, niet shipped. Live-smoke (boot post-sweep, Microsoft OAuth, SMTP, scaffold-install, integratie-sweep) is **AI-onbewezen**. Uncommitted secret-manager boot-wiring op de branch. |
| **Realtime-garanties** | Geen ack/ordering/event-log/replay/catch-up; `_client` cross-instance gat (zie §4). |
| **Identity** | Geen RBAC/roles/permissions, geen org/tenant/workspace, account-linking config-only+onuitgevoerd, JWT roadmap-only (alleen Redis-sessies). |
| **Frontend** | Pure SPA: geen SSR/SSG/streaming-HTML/per-route-meta; geen data-loader/cache-laag (geen RR-loaders, geen React-Query-equivalent); alleen Dropdown/MultiSelect als form-primitives; flat dot-key i18n (geen plurals/ICU/locale-dates); light/dark zonder persistentie (FOUC); index-chunk >500kB ongesplitst. |
| **Observability** | `@luckystack/monitoring` (audit-trail, P95/P99, request-forensics/replay, dead-letter) + web-vitals (RUM) **ongebouwd**; alleen error-tracking ships. |
| **Background work** | Geen cron/scheduled-jobs/queue/leader-election-primitive by design. Extern bedraden (node-cron/bullmq) achter `registerCustomRoute` + shared secret. |
| **Testing** | Auto-sweep walkt alleen de **API-map**, niet de sync-map (sync = handmatige `.tests.ts`); fuzz = 9 vaste payloads; TS→Zod valt terug op `z.any()` bij intersections/generics/cross-file; tests raken echte Prisma+Redis zonder rollback. |
| **Routing/transport-rigiditeit** | Custom routes ná framework-routes (geen `/api`-`/sync`-interceptie); CORS-resolver synchroon; Express/Fastify-vervanging unsupported; geen non-HTTP/non-socket-adapter; geen graceful socket-drain bij rolling deploy; router-WS gepind op `system`-service, termineert **geen TLS**. |
| **DB** | MongoDB-default pint Prisma 6.19; cross-vendor ongeaudit; ESLint 10 + enkele React-plugins held-back door upstream. |

---

> Volgende lezing: [`FRAMEWORK_GAPS.md`](./FRAMEWORK_GAPS.md) voor hoe elk van deze grenzen het Workspaces-project raakt + voorgestelde oplossing per scenario.
