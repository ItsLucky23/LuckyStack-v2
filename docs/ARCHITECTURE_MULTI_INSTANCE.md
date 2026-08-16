# Multi-Instance / Router — Mental Model & Pitfalls

> **Read this before building anything that assumes more than one backend instance.**
> It is the single source of truth for how routing, sockets, and Redis behave across
> instances — and the footguns that silently break a horizontally-scaled deploy. Written
> for AI assistants and humans alike: each pitfall lists symptom → cause → fix so a mistake
> is fast to trace.

Related: `docs/ARCHITECTURE_SOCKET.md` (socket setup), `docs/ARCHITECTURE_SYNC.md` (sync
routes), `docs/HOSTING.md` (deploy), `packages/router/CLAUDE.md` (router internals).

---

## When this applies

Only when you run **more than one backend instance** (behind `@luckystack/router` or any
load balancer). A single-instance deploy sidesteps every pitfall below — the Redis adapter
is attached but has no peers, and all sockets live in one process.

---

## Mental model

```
                         ┌────────────────────────────────────────┐
   browser / client ───► │ @luckystack/router (npm run router) :4000 │
                         └───────────────┬────────────────────────┘
        routed HTTP/SSE /api|sync/<service>/...   WS /socket.io/
                         │                    (pinned to `system`)
                         ▼                                ▼
              backend "fleet-preset"           backend "core-preset"
              executes `vehicles` routes       owns browser sockets
                         │                                │
                         └──────────► shared Redis ◄───────┘
                           (Socket.io delivery/fanout only)
```

Three config surfaces drive it:

- **`config.ts > transport.invocation`** — `'socket'` (backwards-compatible
  monolith default) or `'routed-http'` (API/sync invocations traverse the router;
  the Socket.io connection still owns realtime delivery).
- **`services.config.ts`** — which services exist and how they group into **presets**
  (one backend bundle = one preset). `system` is reserved (`source: 'root'` = `src/_api` +
  `src/_sync`).
- **`deploy.config.ts`** — per environment, a **single URL binding per service**
  (`bindings: { system: 'http://localhost:4100' }`). The router resolves
  `/api/vehicles/getAll` → service `vehicles` → that env's `vehicles` binding (local if owned
  + healthy, else the `fallback` env, else `502 serviceNotAssigned`). See
  `packages/router/src/resolveTarget.ts`.

> **These two files are opt-in.** Both — plus the build-time validator
> `server/config/presetLoader.ts` — are **pruned from a default (single-instance) scaffold** and
> installed by **`npx luckystack add router`**, which copies them in and wires their two
> side-effect imports (`import '../deploy.config'` + `import '../services.config'`) into
> `server/server.ts`; `npx luckystack remove router` deletes them and un-wires the imports. With
> the files absent, `scripts/generateServerRequests.ts` emits a single `default` bundle, so a base
> install runs single-instance without them. See `docs/ARCHITECTURE_PACKAGING.md` §10.

Run a backend per preset: `npm run server -- core-preset 4100`. Run the router:
`npm run router` (port 4000, or `ROUTER_PORT`).

> **Dev proxy → router.** In cluster-dev set `ROUTER_PORT` in `.env`: the Vite dev proxy then
> targets the router (`http://SERVER_IP:ROUTER_PORT`) instead of a single backend, so one frontend
> origin fans out across the per-service backends. With `ROUTER_PORT` unset the proxy targets the
> single backend on `config.ports.ts` `backend` (its actually-bound port via
> `node_modules/.luckystack/dev-server.json`). See `vite.config.ts`.

---

## Invocation versus delivery — the part that surprises people

**All WebSocket upgrades are pinned to the `system` service** by convention.
That determines where room membership, presence, socket lifecycle handlers and
incoming realtime callbacks live. It determines API/sync execution only when
`transport.invocation === 'socket'`.

With `transport.invocation: 'routed-http'`, `apiRequest` and `syncRequest` use
HTTP/SSE paths whose service-first segment is resolved by the router. The owning
preset executes the handler; the one `system` socket remains connected for rooms,
presence and incoming sync events. There is no second browser socket.

Cross-instance **delivery** is provided by **`@socket.io/redis-adapter`**, attached unconditionally
on every backend (`packages/core/src/socketRedisAdapter.ts`, wired at
`packages/server/src/loadSocket.ts:115`). Two delivery mechanisms ride on it. Neither mechanism remotely executes a
missing API/sync handler; execution has already happened on the socket backend
(`socket` mode) or routed service (`routed-http` mode):
- `io.to(room).emit(...)` — used by the streaming emitters — publishes to Redis so a broadcast
  reaches that room's sockets on every instance.
- `io.in(room).fetchSockets()` — used by the regular `syncRequest` fan-out — enumerates the
  room's members across **all** instances (`RemoteSocket[]`); per-recipient delivery then routes
  to each via `RemoteSocket.emit()`.

### Which sync primitives cross instances?

| Primitive | Crosses instances? | Mechanism |
|---|---|---|
| `stream(payload)` | n/a — originator only | unicast back to the requesting socket |
| `broadcastStream(payload)` | ✅ **YES** | `io.to(room).emit()` → Redis adapter (`streamEmitters.ts:217`) |
| `streamTo(tokens, payload)` | ✅ **YES** | `io.to(tokens).emit()` → Redis adapter (`streamEmitters.ts:237`) |
| **regular `syncRequest` fan-out** (the `_server` result + optional per-recipient `_client`) | ✅ **YES** | `io.in(room).fetchSockets()` (cross-instance enumeration) + per-recipient `RemoteSocket.emit()` (`handleSyncRequest.ts`) |

### Regular sync vs the streaming emitters — different jobs, not two ways to do one thing

`syncRequest` + `upsertSyncEventCallback` is the **one** function for a normal request→fan-out
sync. It runs `_server` once, optionally runs a per-recipient `_client` (which can return a
*different* `clientOutput` per recipient — filtering, translation, per-user branding), and
delivers the final result to every room member **across all instances**.

The streaming emitters (`stream` / `broadcastStream` / `streamTo`) are a **separate feature** for
**live multi-chunk streaming** (LLM tokens, collab diffs) — many small emits over time. They are
server-side parameters you call *inside* `_server`, not separate client functions. There are
three because a stream can target three audiences: just the originator (`stream`), the whole room
(`broadcastStream`), or specific tokens (`streamTo`). You don't pick between "sync" and "streaming"
for a normal response — you use `syncRequest`; you reach for a streaming emitter only when you
actually need to stream. (Streaming is opt-in on the same request: `syncRequest({ ..., onStream })`
and `apiRequest({ ..., onStream })`.)

> **Cost of the regular fan-out:** each sync fan-out does one `fetchSockets()` (a Redis
> request/response; single-instance setups short-circuit). For very large rooms spread across
> instances it also does one `RemoteSocket.emit()` per remote recipient. Both are fine for typical
> rooms; if it ever becomes a bottleneck, an `io.serverSideEmit()`-based fan-out (O(instances)) is
> the optimization — no API change.

---

## Scaling sockets

Because socket load lives on the `system`-service backend(s):

- To handle more concurrent sockets you run **more `system` instances** — all pointing at the
  **same Redis**.
- The router binds **one URL per service** (`deploy.config.ts`) and does **not** round-robin
  across multiple instances of the same service. To run N `system` instances you put a real LB
  (nginx / cloud LB) at the `system` binding URL, or scale vertically (one bigger instance).
- Regular `syncRequest` fan-out and the streaming emitters both reach room members across all
  `system` instances (via the Redis adapter), so spreading a room's members across instances is
  fine — no sticky routing required for correctness. (Each sync fan-out does one `fetchSockets()`;
  see the cost note above.)

---

## Shared Redis is mandatory (silent-failure footgun)

Every backend attaches the adapter to **its** Redis. If two instances point at **different**
Redis servers, cross-instance fan-out **fails silently** — no error, events just never arrive.
Guards:
- **Boot-UUID handshake** (`packages/router/src/bootHandshake.ts`): writes a UUID to Redis and
  cross-checks the fallback env's `/_health` — detects "two Redis that both respond but aren't
  shared". Set `strictBootHandshake: true` to hard-fail instead of warn.
- **Explicit port required**: every `deploy.config.ts` binding URL must include a port or the
  router crashes at boot (`resolveTarget.ts:153`) — a port-less URL silently defaulting to 80/443
  is almost never intended.
- **`synchronizedEnvKeys`** (e.g. `COOKIE_SECRET`, `PROJECT_NAME`): hashed and compared across
  envs so sessions/cookies stay portable between instances.

---

## `services.config.ts` reality check

The framework's **own root app** is the multi-service / with-router reference: its
`services.config.ts` declares `vehicles` and `billing` services and those folders **really exist** —
`src/vehicles/_api/listVehicles_v1.ts` and `src/billing/_api/listInvoices_v1.ts` are real example
routes, alongside `src/playground`, `src/settings`, `src/reset-password`, and `src/_api`/`src/_sync`
(`system`). So in this repo the config matches the folders that exist. Note that a freshly
**scaffolded** consumer project does NOT ship these files at all until `npx luckystack add router`
(see the opt-in note above) — and when you do add the router, make `services.config.ts` match YOUR
project's actual `src/` service folders (add real service folders, or trim the example services). In
**dev** every route loads regardless of preset, so a mismatch is harmless locally; it only bites a
real split deploy. `npm run luckystack-validate-deploy` flags service/preset mismatches.

---

## Generated Docker topology

Fresh scaffolds include `Dockerfile`, `compose.yaml`, `docker/` and `docs/DOCKER.md`; existing apps run `npx luckystack add docker`. The renderer follows the selected database provider and whether `@luckystack/router` is installed. It never copies consumer seeds, credentials or app-specific service groups.

`LUCKYSTACK_PRESET` selects the backend bundle at container startup instead of hardcoding `default`. Router-enabled builds emit `dist/router/deploy.config.js` and `dist/router/services.config.js`; the default Docker environment binds `system` to `http://app:4100`. Split deployments add one app service/binding per chosen preset while retaining one immutable image.

`NODE_ENV` and `LUCKYSTACK_ENV` are deliberately separate axes. `NODE_ENV=production` controls route maps, cookies, validation, rate limits, port policy and dev tooling. `LUCKYSTACK_ENV=dockerSplit` (or `staging`, `localAdmin`, ...) selects deploy bindings, boot UUIDs, health attestation and observability labels. Never infer production safety from the topology name.

The default `services.config.ts > customRoutes` maps framework-owned non-typed paths (`/auth`, health endpoints, uploads/hooks/docs) to `system`. Consumer routes add their own prefixes and mirror them in `docker/nginx.conf`. App/router are non-root and read-only-root compatible; nginx is unprivileged; Mongo initialization elects a replica set but creates no application data.

For local-preset→remote-staging development, use the gitignored `.env.docker` explicitly. Database and Redis can be selected independently via `LUCKYSTACK_DATABASE_URL` and `LUCKYSTACK_REDIS_*`; this grants normal remote read/write access and never implies migrations or seeding.

---

## Pitfalls — symptom → cause → fix

| Symptom | Cause | Fix |
|---|---|---|
| Router **refuses to start**: "This runtime cannot proxy WebSockets" | You are running the router on **Bun**. Its `node:http` upgrade sockets are a silent no-op ([oven-sh/bun#28396](https://github.com/oven-sh/bun/issues/28396)) — the router would serve HTTP, look healthy, and drop every socket | Run the router on **Node**; backends can stay on Bun. `LUCKYSTACK_ALLOW_BROKEN_WS_PROXY=1` downgrades it to a warning if you genuinely never upgrade |
| Client hits the router and socket.io fails with **"websocket error"**, HTTP routes fine | `@luckystack/router` 0.4.0–0.6.7: the forwarded 101 lost `Connection: Upgrade`, so no handshake could complete | Upgrade the router past 0.6.7 |
| Client hits the router and socket.io fails with **"xhr poll error"** / `502 serviceNotAssigned` naming service `socket.io` | `@luckystack/router` ≤0.6.7: the polling handshake was routed by first path segment, so it looked for a service named `socket.io` | Upgrade the router past 0.6.7 |
| A `syncRequest` broadcast / `broadcastStream` reaches **no one** on other servers | Instances pointing at **different** Redis (so neither `fetchSockets()` nor the adapter spans them) | Point every backend at one shared Redis (`REDIS_HOST`/`REDIS_PORT`); enable `strictBootHandshake` to catch it at boot |
| Every sync feels slightly slower / more Redis traffic in a cluster | Each sync fan-out does one cross-instance `fetchSockets()` (Redis round-trip) + one `RemoteSocket.emit()` per remote recipient | Expected; single-instance short-circuits. For very high sync throughput or huge rooms, the `io.serverSideEmit()` fan-out (O(instances)) is the optimization — no API change |
| Router **crashes at boot** with an explicit-port error | A `deploy.config.ts` binding URL has no port | Add the port (`http://host:8081/`) |
| Sessions/cookies not portable between instances (users logged out after LB switch) | `COOKIE_SECRET` / `PROJECT_NAME` differ between instances | Align the `synchronizedEnvKeys` across all backends |
| `502` `serviceNotAssigned` from the router | The route's service isn't in any running preset / has no binding | Add the service to a preset (`services.config.ts`) + a binding (`deploy.config.ts`) |
| A sync/API route "doesn't exist" on the socket instance | `transport.invocation` is still `'socket'`, so the `system` socket backend is asked to execute a route bundled elsewhere | Set `transport.invocation: 'routed-http'` for a split topology, or run a monolith preset containing the route |
| A custom HTTP route returns `serviceNotAssigned` | Its path has no owner in `services.config.ts > customRoutes` (or the owner lacks a binding/fallback) | Add the path prefix and owning service; `luckystack-validate-deploy` then catches unknown owners before deploy |
| `getParsedPort()`/listen on wrong port for a second local instance | Port was not passed in argv slot two | Pass the port via argv (`npm run server -- <preset> <port>`) — `getParsedPort()` reads the typed override registry; there is no `SERVER_PORT` fallback |

---

## Verify it locally

### Automated — proves the Redis cross-instance link

```bash
LUCKYSTACK_REQUIRE_REDIS=1 npm run test:integration
```

Runs two suites against your actual Redis:

- `packages/core/src/socketRedisAdapter.integration.test.ts` — two real Socket.io servers +
  `@socket.io/redis-adapter`. Asserts (a) `ioB.to(room).emit()` reaches a client on **server A**,
  (b) `io.in(room).fetchSockets()` returns members from **both** servers (the regular sync
  fan-out's cross-instance enumeration), and (c) a `RemoteSocket.emit()` from server A reaches a
  client on server B.
- `packages/router/src/wsProxy.integration.test.ts` — the same, **through a real
  `startRouter()`**: a real socket.io client upgrades across the proxy (both websocket-only and
  the browser-realistic polling→upgrade path) and still receives cross-instance fan-out from the
  instance it never talked to.

> **Set `LUCKYSTACK_REQUIRE_REDIS=1` whenever you are trying to PROVE something.** Both suites
> skip gracefully when Redis is unreachable so a Redis-less CI stays green — but a skip is
> indistinguishable from a pass in the summary line, and that is not hypothetical: on a dev
> machine whose `.env.local` points at a Redis with credentials the local one rejects, these
> suites reported "skipped" as a PASS *for as long as they existed*. The flag turns the skip into
> a loud failure. Against a local no-auth docker Redis, bypass `.env.local` with
> `LUCKYSTACK_ENV_FILES=.env LUCKYSTACK_REQUIRE_REDIS=1 npm run test:integration`.

### Automated — proves the router proxies WebSockets, on both runtimes

```bash
npm run smoke:ws     # node
```

`scripts/wsProxySmoke.ts` boots two backend instances + a real router and drives a real
socket.io client through it, printing the runtime it is actually on and PASS/FAIL per check. It
**requires** Redis and never skips — a smoke test whose point is proving something must not pass
by proving nothing.

> **The router does not run on Bun.** It refuses to start there, on purpose: Bun's `node:http`
> upgrade sockets are a silent no-op ([oven-sh/bun#28396](https://github.com/oven-sh/bun/issues/28396),
> open), so a Bun router would serve HTTP, report healthy, and drop every WebSocket. Run the
> router on Node; your backends can still run on Bun. The check is a boot-time capability probe,
> so it starts working by itself once Bun fixes it.

### Manual — see it end-to-end with two real backends (browser)

In dev there's no load balancer, so the browser picks its backend statically. A **dev-only**
`?backend=<port>` query param (`config.ts`; `localhost`-only, ignored in prod) lets a **single**
frontend target a specific backend instance — so two tabs can deterministically land on two
different instances on one machine. Three terminals:

```bash
npm run cluster -- 4100    # backend A on :4100
npm run cluster -- 4101    # backend B on :4101  (same .env → same Redis)
npm run client             # ONE vite frontend (:5173)
```

Open **http://localhost:5173/?backend=4100** (tab A → instance A) and
**http://localhost:5173/?backend=4101** (tab B → instance B). Each tab has its own `sessionStorage`,
so log in independently in each; go to `/playground`, join the **same room** in both, then:
- Fire **`playground/echo`** (regular sync) from tab A → tab B receives it → regular sync now
  crosses instances ✅.
- Fire **`playground/streamBroadcast`** from tab A → tab B receives the chunks → streaming crosses
  instances ✅.

> This is a DEV testing convenience, **not** production. In production the frontend is built once
> (`npm run build`) and served from one origin behind a reverse proxy / load balancer that spreads
> connections across backend instances — browsers never pick a backend themselves. `npm run cluster
> -- <port>` boots `server/server.ts` directly (no supervisor / hot-reload), sharing the `.env`
> Redis. See `scripts/cluster.ts`.
