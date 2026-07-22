# v0.7.3 port/OAuth review — 2026-07-20

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: `v0.7.2..v0.7.3`, post-tag root commit `b646705`, server bind/listen flow,
> OAuth authorize + exchange, CORS, Vite proxy, test targeting, root/scaffold parity,
> router/dev edge cases · Tool/agents: source/diff audit, targeted Vitest, esbuild parse
> checks, Vite 6.4.2 + Vite 8 proxy-source verification · Supersedes: —

Last updated: 2026-07-21

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| P-01 | The advertised per-request Vite target update does not reach the proxy's live options, so a running client stays pinned to its startup backend port | HIGH | fixed | 2026-07-20 | 2026-07-21 | `viteBackendProxy.ts` + executable original/clone regression |
| P-02 | Four v0.7.3 root test entrypoints are syntactically invalid | HIGH | fixed | 2026-07-20 | 2026-07-21 | Imports repaired; release typecheck includes all changed TS entrypoints |
| P-03 | The consumer scaffold's `npm test` still hardcodes `http://localhost:80` and does not follow `dev-server.json` | MED | fixed | 2026-07-20 | 2026-07-21 | Shared `@luckystack/test-runner` resolver + `ports.backend` fallback |
| P-04 | Any exiting dev backend unconditionally deletes the shared port file, including a newer process's advertisement | MED | fixed | 2026-07-20 | 2026-07-21 | Cleanup now verifies `pid === process.pid`; three lifecycle tests |
| P-05 | Auto-increment/proxy-file gating uses `isProduction` (`NODE_ENV`) while OAuth/dev tooling uses canonical `resolveEnvKey()` (`LUCKYSTACK_ENV` first) | MED | fixed | 2026-07-20 | 2026-07-21 | One `resolveEnvKey()` result drives all listen branches |
| P-06 | The “actually-bound port” contract is false for port `0`, and the upper auto-increment boundary can retry with invalid port `65536` | MED | fixed | 2026-07-20 | 2026-07-21 | Strict resolver, `address().port`, and bounded retry tests |
| P-07 | `resolveDevCallbackUrl` overwrites every localhost callback port, including an explicitly configured local router/reverse-proxy ingress | MED | fixed | 2026-07-20 | 2026-07-21 | Recommended policy adopted: rewrite intended direct port only |
| P-08 | Post-tag root proxy parity is incomplete: `.env` `ROUTER_PORT`/`SERVER_IP` are not loaded and `ports.frontend` is not wired to Vite | MED | fixed | 2026-07-20 | 2026-07-21 | Root now uses `loadEnv` + `server.port: ports.frontend` |
| P-09 | Port/OAuth docs and diagnostics contradict current behavior, and the release gate excludes the scripts it changed | LOW | fixed | 2026-07-20 | 2026-07-21 | Help/docs/diagnostic corrected; root + scaffold typecheck expanded |
| P-10 | OAuth loopback rewriting excludes IPv6 `::1`, although the CORS localhost policy includes it | LOW | fixed | 2026-07-20 | 2026-07-21 | `[::1]` supported and tested |
| P-11 | Current `main` no longer builds: the post-tag root Vite `bypass` callback rejects Vite 8's `ServerResponse | undefined` WebSocket signature | HIGH | fixed | 2026-07-20 | 2026-07-21 | Typed proxy helper accepts HTTP response or undefined; full build green |

## Release verdict

The review initially concluded that published v0.7.3 was incomplete. This fix
branch closes all eleven findings. The proxy now updates the original options held
by http-proxy as well as Vite's request clone; consumer tests share the same live
port resolver; port-file cleanup is owner-safe; and the bind/OAuth contracts retain
both intended and actually-bound ports.

The selected P-07 policy is deliberate: auto-derived direct loopback callbacks
follow an intended → bound hop, while an explicit local router/reverse-proxy ingress
remains authoritative. These changes are not published until a later release is
cut.

## What is correct

- The server precedence in code is `options.port > parsed argv port >
  options.defaultPort (the scaffold passes ports.backend) > legacy SERVER_PORT >
  80`; auto-increment runs only after that start port is chosen.
- For ordinary nonzero ports, the listen callback re-registers the successful
  attempt, so `getBindAddress()` and CORS same-origin see the hopped port.
- OAuth authorize (`@luckystack/server`) and token exchange (`@luckystack/login`)
  both call `resolveDevCallbackUrl(provider.callbackURL)`, preserving byte identity
  within one process.
- Production and non-localhost callback URLs are no-ops in the callback helper.
- The published scaffold already had same-origin proxy routes; post-tag `b646705`
  only added a root playground equivalent. That commit did not alter npm 0.7.3.
- Final verification after the fixes: 1867/1867 unit tests, zero lint/invariant
  findings, 17/17 package builds + dry-run tarballs, and a warning-free root
  client/server build.

## Detail

### P-01 — Vite mutates a clone, not the proxy's live target (HIGH)

Both proxy configs do this in `bypass`:

```ts
options.target = backendTarget();
```

Vite creates the proxy with the original options object, then stores a shallow
clone for request matching and `bypass`:

```ts
const proxy = httpProxy.createProxyServer(opts);
proxies[context] = [proxy, { ...opts }];
```

The `bypass` callback receives that clone. Vite subsequently calls
`proxy.web(req, res, {})` / `proxy.ws(...)`; http-proxy resolves the request from
the original constructor options, not the clone. This was verified in both the
consumer-pinned Vite 6.4.2 source and the root Vite 8 source. Therefore changing
`options.target` only changes Vite's cloned metadata/debug target, not the actual
upstream. The same is true for direct WebSocket upgrades (Vite does invoke
`bypass` for them, but still proxies with the constructor options).

Observable regression:

1. Vite starts while backend A is on `:80`; proxy constructor captures `:80`.
2. Backend B restarts/hops to `:81` and rewrites `dev-server.json`.
3. Every new HTTP, Socket.io, and OAuth request still proxies to `:80`.

Resolved by the shared root/template `viteBackendProxy.ts`: it captures the
original options through `configure`, updates original + clone in `bypass`, and an
executable regression proves both targets move after initialization.

### P-02 — four test commands do not parse (HIGH)

The v0.7.3 edit inserted the new helper import inside another import declaration:

```ts
import {
import { resolveTestBaseUrl } from './resolveTestBaseUrl';
  logContractResult,
```

esbuild independently rejected all four files with `Expected "as" but found "{"`.
The full unit/build gates stayed green because `tsconfig.server.json` includes
only two named scripts and ESLint's server/package globs exclude `scripts/`.
These are root/contributor commands rather than npm package artifacts, but four
of the five advertised standalone sweep entrypoints are unusable on `v0.7.3` and
current `main`.

### P-03 — scaffold test target did not receive the fix (MED)

Root `scripts/testAll.ts` now reads the port file, but the shipped template's
`scripts/testAll.ts` remains:

```ts
const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:80';
```

So a fresh 0.7.3 consumer whose backend hops to `:81` gets connection failures
against `:80`. Resolved in `@luckystack/test-runner`; root + scaffold now use the
shared resolver with `ports.backend` as the final fallback.

### P-04 — shared file cleanup has no ownership check (MED)

`dev-server.json` records `{ pid }`, but `clearDevServerInfo()` ignores it and
always removes the path. If A advertises `:80`, B advertises `:81`, and A then
exits, A deletes B's current advertisement. This is particularly relevant to the
warning's prescribed recovery: start a hopped replacement, then stop the process
holding the old port. Cleanup now unlinks only when the file still belongs to
`process.pid`; malformed/foreign files are left for their owner or the next write.

### P-05 — environment classifier split (MED)

`listenLuckyStackServer` defaults and side effects use `isProduction`, which core
derives from `NODE_ENV`. The rest of the new OAuth path and server dev-tool default
use `resolveEnvKey()`, where `LUCKYSTACK_ENV` wins. With
`LUCKYSTACK_ENV=production` and a non-production `NODE_ENV`, the server may hop
and write a dev proxy file while the OAuth helper deliberately performs a
production no-op. The listen flow now resolves the canonical environment key once
and uses it for auto-increment, advertisement, and drift-warning decisions.

### P-06 — bound-port and range edges (MED)

Node supports `listen(0)` as “choose an ephemeral free port”. The callback currently
registers/logs/writes `attemptPort` (`0`) instead of reading
`httpServer.address().port`, so CORS, OAuth, tests, and the proxy all receive port
`0`, not the bound port. At the opposite edge, an occupied `65535` with
increment enabled calls `listen(65536)` from the async error handler; Node throws a
range error there and the outer promise is not cleanly rejected. Port inputs are
also parsed with permissive `parseInt`. Resolve/validate an integer in `0..65535`,
read the successful address from the server, and fail explicitly when no next
port exists. `portResolution.ts` and the listen regressions now enforce all three.

### P-07 — explicit localhost ingress versus auto-hop (MED)

The project-config contract says `oauthCallbackBase` is the backend origin the
provider redirects to. In local router/reverse-proxy development that can
legitimately be `http://localhost:4000` while a service binds `:4100`. The new
helper rewrites it to `:4100` solely because the hostname is localhost, bypassing
the configured ingress. This conflicts with the requested “OAuth follows the
bound port” convenience.

The recommended policy was adopted: core retains intended + bound addresses and
rewrites only when the callback still names the intended pre-hop port. Explicit
local ingress ports remain unchanged; IPv6 loopback follows the same rule.

### P-08 — root dogfood parity after `b646705` (MED)

The scaffold calls `loadEnv(mode, process.cwd(), '')` and sets
`server.port: ports.frontend`. Root `vite.config.ts` reads `process.env` directly
(Vite has not loaded `.env` at config-evaluation time) and omits `server.port`.
Consequences at discovery: `.env` `ROUTER_PORT` was ignored by the root client,
and changing `config.ports.ts.frontend` did not change the root Vite port. Root now
uses `loadEnv` and `server.port: ports.frontend`, parity-tested with the scaffold.

### P-09 — docs/gates drift (LOW)

At discovery:

- Root + template `scripts/help.mjs` said auto-increment was “off by default”;
  it is on by default in dev and off in production.
- `packages/server/docs/create-server.md` and `packages/server/CLAUDE.md` omitted
  `options.defaultPort` from the documented precedence.
- `scripts/testLoginFlows.mjs`'s failure detail said frozen
  `oauthCallbackBase` breaks OAuth, although the new helper is intended to fix it.
- The new public core helper was absent from the core package function index/deep docs.
- Root typecheck/lint excluded the test scripts changed in the release, allowing
  P-02 through every stated release gate.

All text is corrected, the public helpers are indexed, and root/scaffold typecheck
now includes the affected TS scripts and Vite configuration.

### P-10 — loopback inconsistency (LOW)

`checkOrigin` treats `localhost`, `127.0.0.1`, and `[::1]` as local origins.
`resolveDevCallbackUrl` originally recognized only the first two. It now includes
`[::1]`, with a regression covering the rewritten callback URL.

### P-11 — current main build failure (HIGH)

The post-tag root proxy declares its bypass callback's response as a mandatory
`ServerResponse`. Vite 8 correctly types it as `ServerResponse | undefined`
because direct WebSocket upgrades invoke bypass without an HTTP response object.
The callback ignores the value, but strict function-parameter variance rejects the
narrower annotation:

```text
vite.config.ts(82,5): error TS2322: Type '(... _res: ServerResponse, ...)'
is not assignable to type '(... res: ServerResponse | undefined, ...)'.
```

`npm run build` completed all 17 package builds and artifact generation, then
failed at root `tsc -b`. This regression is only in `b646705` (after the v0.7.3
tag), so it did not affect the published tarballs, but current `main` is not a
valid release base. Moving the logic into the typed proxy helper accepts Vite's
HTTP/WS callback shape; the final root build is green.
