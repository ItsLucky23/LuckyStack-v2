# Architecture — wiring package + external secret manager

> Concept doc — the external env-server is NOT YET IMPLEMENTED. This file describes the design `@luckystack/env-resolver` is wired for, and what the package does (and explicitly does NOT do) in that picture today.

`@luckystack/env-resolver` is a **wiring package**, not a secret manager. It is the thin client that lives inside a LuckyStack app and pulls resolved values from a separate, project-independent env-server at boot. The env-server itself — version-controlled values, auth, audit, admin UI — is planned as its own git repository, reusable beyond LuckyStack. Until that server ships, this package operates against the documented HTTP contract (see `./resolution-modes.md`) and the modes `'local'` / `'hybrid'` keep dev/test boxes working.

## TL;DR

- **This package does:** read four `LUCKYSTACK_ENV_*` bootstrap keys, call a remote HTTP endpoint, write the returned key/value map into `process.env`, cache it, and expose a refresh hook.
- **This package does NOT:** store secrets, version values, authenticate users, render an admin UI, encrypt anything at rest, or know what a "secret" is. All of that lives in the (future) external server.
- **The workflow it enables:** developers commit `.env` / `.env.local` files containing only **V-references** (e.g. `OPENAITOKEN=OPENAITOKEN_V4`), not real secrets. The remote server resolves `OPENAITOKEN_V4` to its actual value at boot.
- **The strict invariant:** values on the remote are **append-only by version**. `OPENAITOKEN_V4` is immutable; rotating means publishing `OPENAITOKEN_V5` and updating the reference. Old branches keep working because their committed `.env` still points at `OPENAITOKEN_V4`.

## Why this design

Three problems with the classic `.env` + secret-manager-SDK stack that this design addresses:

1. **`.env` is dangerous to commit, painful to share.** Secrets in version control leak; secrets out of version control diverge across machines. V-references are safe to commit (they are pointers, not values), so the team shares one source of truth.
2. **Rotation breaks old branches.** If you rotate `OPENAITOKEN` in place, checking out a six-month-old branch that hit a now-revoked key triggers silent failures. With versioned values, the old branch still references `OPENAITOKEN_V4` (still resolvable until you choose to retire that version), and a freshly opened PR can adopt `V5`.
3. **Per-app secret-manager SDKs are heavy.** Wiring AWS Secrets Manager / Vault / Doppler into every app + every framework module is repetitive. A single HTTP boundary with a single bearer token collapses that to one boot-time call.

## System diagram

```
+---------------------------------+        +---------------------------------+
|   developer machine             |        |   external env-server           |
|   (committed to your repo)      |        |   (separate git repo,           |
|                                 |        |    project-independent)         |
|   .env / .env.local             |        |                                 |
|   ----------------------------- |        |   - stores immutable versions   |
|   OPENAITOKEN=OPENAITOKEN_V4    |        |     OPENAITOKEN_V1 = "sk-..."   |
|   STRIPE_KEY=STRIPE_KEY_V2      |        |     OPENAITOKEN_V2 = "sk-..."   |
|   LUCKYSTACK_ENV_URL=...        |        |     OPENAITOKEN_V3 = "sk-..."   |
|   LUCKYSTACK_ENV_TOKEN=...      |        |     OPENAITOKEN_V4 = "sk-..."   |
|   LUCKYSTACK_ENV_PROJECT=...    |        |     STRIPE_KEY_V1   = "rk-..."  |
|   LUCKYSTACK_ENV_ENVIRONMENT=...|        |     STRIPE_KEY_V2   = "rk-..."  |
|                                 |        |                                 |
|   +-------------------------+   |        |   - admin UI / CLI to publish   |
|   | @luckystack/env-resolver|   |        |     a NEW version (never edit)  |
|   |  (this package)         |   |        |                                 |
|   |                         |   |        |   - per-project / per-env       |
|   |  1. read V-refs + auth  |   |        |     scoping                     |
|   |  2. HTTP GET resolve    |---+------->|   - bearer-token auth           |
|   |  3. write process.env   |<--+--------|   - returns                     |
|   |  4. cache (TTL)         |   |        |     { values: {                 |
|   |                         |   |        |       OPENAITOKEN: "sk-...",    |
|   +-------------------------+   |        |       STRIPE_KEY:   "rk-..."   |
|                                 |        |     }}                          |
+---------------------------------+        +---------------------------------+
```

Two boundaries to keep clearly separated:

- **Wiring (this package).** Lives inside the app, has no opinion on storage, versioning, or rotation. Speaks one HTTP endpoint.
- **Secret manager (external server, future).** Lives in its own repo, owns versioning, auth, audit. LuckyStack is just one client; other stacks can use it too.

## Developer workflow

The concrete day-to-day with the full design in place. Today, steps 1–3 work via local `.env`; step 4 onwards lights up once the external server ships.

1. **Reference, do not embed.** In your committed `.env` / `.env.local`, write `OPENAITOKEN=OPENAITOKEN_V4`. Never write the literal `sk-...` value.
2. **Bootstrap keys.** The four `LUCKYSTACK_ENV_*` keys (URL, token, project, environment) tell the resolver how to reach the remote. The token itself is the only true secret on the developer machine, injected via shell or OS keychain, not committed.
3. **Boot.** `initEnvResolver` runs as the first line of `server.ts`. It reads the V-references, asks the remote to resolve them, and writes the resolved values into `process.env` for the rest of the app to consume.
4. **Rotate by appending.** When a credential needs to change, an admin publishes `OPENAITOKEN_V5` on the server. Existing branches still pointing at `V4` keep working until V4 is explicitly retired.
5. **Adopt the new version.** A PR updates `.env` from `OPENAITOKEN_V4` to `OPENAITOKEN_V5` and merges. Old branches do **not** need to be rebased.
6. **Branch checkouts stay deterministic.** Checking out a six-month-old branch reads its committed `OPENAITOKEN_V4`, the server still resolves it, the app boots. No "works on main, broken on old branch" surprises.

## Strict invariants

These are properties the design depends on. The external server enforces them; this package assumes them.

- **Append-only.** A published version is immutable. Never overwrite `OPENAITOKEN_V4`; publish `OPENAITOKEN_V5` instead. This is what makes branch checkouts safe.
- **References, not values, in the repo.** `.env` and `.env.local` contain V-references and bootstrap keys (no real secrets). They are safe to commit. The bootstrap token is the only sensitive item, and it is **not** committed — it is injected per machine / per CI runner.
- **One token per client.** A LuckyStack app holds one `LUCKYSTACK_ENV_TOKEN` scoped to one project + one environment. No per-call auth, no per-key auth.
- **Local overrides always win.** If a developer has `LOG_LEVEL=debug` in their shell, the remote does not overwrite it. See `applyValues` in `./resolution-modes.md`.
- **The remote is the source of truth in `'remote'` mode.** If the server is unreachable and `source: 'remote'` with `fallback: 'throw'`, the process refuses to boot. This is intentional: a degraded env is more dangerous than a hard stop.

## Auth model

A single bearer token (`LUCKYSTACK_ENV_TOKEN`) accompanies every fetch:

```
Authorization: Bearer ${LUCKYSTACK_ENV_TOKEN}
```

Today the token must be configured manually — provisioned through whatever channel the (future) server provides (admin UI, CLI, OS keychain). The package does not negotiate, refresh, or rotate the token itself; it sends it verbatim. Token rotation is the operator's job.

When the external server ships, the recommended posture is:

- One token per `project + environment` pair.
- Tokens scoped to read-only access to the matching project/environment values.
- CI runners inject the token via their secret store; developer machines via OS keychain or a `.env.local` line that is **never committed** (the bootstrap token is the one exception to the "commit everything" rule).

## What this package does NOT do

Listed explicitly because the design depends on these boundaries:

- **No secret storage.** The package has no on-disk persistence. The in-memory cache is plain JS objects, discarded on process exit.
- **No value resolution beyond fetch.** It does not look up `OPENAITOKEN_V4` itself; it hands the project/environment to the remote and accepts the returned `{ values }` map. Versioned-name resolution is the remote's job.
- **No versioning logic.** It does not know `V4` from `V5`. The remote may return a map that includes `OPENAITOKEN: <resolved>` and it writes that key. The version naming convention lives in the team's `.env` files and the remote's storage.
- **No secret manager SDK.** No Vault client, no AWS SDK, no Doppler client. One HTTP boundary.
- **No admin / write operations.** Read-only fetch. Publishing new versions is done out-of-band through the (future) server's own UI / CLI.
- **No audit logging.** The remote logs requests; this package logs only the boot-time warn/throw lines documented in `./bootstrap-validation.md`.
- **No app-key validation.** Whether `DATABASE_URL` is a valid postgres URL is the app's concern. See `./env-key-validation.md` for the two-key-set split.

## Where this fits in LuckyStack boot

```
process start
  -> initEnvResolver(...)        <-- THIS PACKAGE, first line of server.ts
  -> @luckystack/core projectConfig (reads process.env, validates app keys)
  -> @luckystack/server createServer (db, sockets, routes)
  -> server.listen()
```

`initEnvResolver` runs **before** anything else that reads `process.env` at module-init time. The exact ordering rules are in `./bootstrap-validation.md` (hard-fail vs soft-fail) and `./resolution-modes.md` (mode + cache flow).

## Roadmap — external env-server (not in this repo)

The server side is planned as a separate, project-independent git repository so it can serve non-LuckyStack apps too. High-level shape:

- **Storage**: append-only key/version table, scoped by `project + environment`.
- **API**: at minimum, `GET /projects/{project}/environments/{environment}` returning `{ values }` — this is the contract the current package already speaks.
- **Auth**: bearer tokens, per project + environment.
- **Admin surface**: UI / CLI for publishing new versions, retiring old ones, listing references.
- **Audit**: who fetched / published what, when.
- **Reusability**: nothing LuckyStack-specific in the wire format or storage model. Other frameworks can implement their own resolver client against the same endpoint.

Concrete decisions (storage backend, auth provider, admin UI tech) are deferred to the external repo. This doc only commits to the HTTP contract `@luckystack/env-resolver` already implements.

Until the server ships, `source: 'local'` (no remote, classic `dotenv`) and `source: 'hybrid'` (try remote, fall back to local on failure) keep development unblocked.

## Concept doc — implementation status

| Piece | Status | Where |
| --- | --- | --- |
| Resolver client (this package) | Implemented | `packages/env-resolver/src/index.ts` |
| Local / remote / hybrid modes | Implemented | `./resolution-modes.md` |
| Bootstrap-key validation + fail-fast | Implemented | `./bootstrap-validation.md` |
| Two-key-set contract (bootstrap vs app) | Implemented | `./env-key-validation.md` |
| External env-server (versioned storage, admin UI, auth backend) | **Not yet implemented** | future separate git repo |
| Versioned `OPENAITOKEN_V4`-style naming convention enforcement | **Not yet implemented** (convention only) | future external server |
| Per-project / per-environment token issuance | **Not yet implemented** | future external server |

When the server lands, the only change required in this package is potentially tightening the response schema to include version metadata (currently it only returns `{ values: Record<string, string> }`). The HTTP contract is forward-compatible.

## Related

- Boot-time guards + fail-fast behaviour: `./bootstrap-validation.md`.
- Mode + cache flow (`local` / `remote` / `hybrid`): `./resolution-modes.md`.
- Two key sets (bootstrap vs app-level) + validation expectations: `./env-key-validation.md`.
- Function index: `../CLAUDE.md`.
- Consumer quickstart: `../README.md`.
- Framework-wide packaging map: `/docs/PACKAGE_OVERVIEW.md`.
- Hosting + secret-strategy context: `/docs/HOSTING.md`.
