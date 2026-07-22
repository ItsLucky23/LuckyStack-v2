# Architecture — secret-manager client + external server

> The client (`@luckystack/secret-manager`) is implemented and described here. The external **secret-manager server** it talks to lives in a separate repository (`luckystack-secret-manager`); only its wire contract is captured below so the client can be developed against a stable API.

`@luckystack/secret-manager` is a **wiring client**, not a vault. It resolves committed `.env` pointers to real secrets at boot and writes them into `process.env`. Storage, versioning, auth, and the admin UI all live in the external server.

## TL;DR

- **This package does:** scan `process.env` for pointer-shaped values (`<BASE>_V<n>`), `POST /resolve` them in one request, overwrite each `process.env` entry with the real secret, and (optionally, in dev) re-resolve on `.env` change / on an interval.
- **This package does NOT:** store secrets, version values, render an admin UI, or know what a "secret" is. All of that lives in the external server.
- **The workflow it enables:** developers commit `.env` containing only pointers (`OPENAI_KEY=OPENAI_AUTHORIZATION_KEY_V5`), not real secrets. The server resolves `OPENAI_AUTHORIZATION_KEY_V5` to its actual value at boot.
- **The strict invariant (enforced by the server):** values are **append-only by version**. `..._V5` is immutable; rotating means publishing `..._V6`. Old branches keep working because their committed `.env` still points at `..._V5`.

## Why this design

1. **`.env` is dangerous to commit, painful to share.** Pointers are safe to commit (they are opaque names, not values), so the team shares one source of truth and nobody leaks a secret into git history.
2. **Rotation breaks old branches.** With versioned values, a six-month-old branch still references `..._V5` (resolvable until you retire it), while a fresh PR adopts `..._V6`. No "works on main, broken on old branch" surprises.
3. **One flat keystore, one token.** A single HTTP boundary with one shared bearer token — no per-app vault SDK wiring.

## The pointer model

- A pointer is any `.env` value matching `^(.+)_V(\d+)$` (configurable via `pointerPattern`).
- The env **name** is decoupled from the secret **base name**: `OPENAI_KEY` (name) -> `OPENAI_AUTHORIZATION_KEY_V5` (value) -> base `OPENAI_AUTHORIZATION_KEY`, version `5`.
- The client sends the **full pointer string** to the server and overwrites the env name with the resolved value. The base/version split is the server's job.
- A non-pointer value (`NODE_ENV=production`, or a real secret pasted locally) is a literal: never sent, never overwritten. Local overrides win for free.
- Scanning is gated by `envNames` (a name allowlist — `string[]` or `(name) => boolean`). **This is required to resolve anything**, and the secure default is deny-all: see [Name scoping](#name-scoping-envnames) below.

## Name scoping (`envNames`)

Pointer detection runs **only** over the env NAMES allowed by `config.envNames`:

- `string[]` — resolve exactly these names.
- `(name) => boolean` — a predicate (e.g. `(n) => n.endsWith('_KEY')`).
- `() => true` — deliberately scan every name.

**Secure default: when `envNames` is unset, NOTHING is resolved off-host.** The client emits a one-time boot warning and leaves `process.env` untouched (a deny-all no-op), in every mode. This prevents the resolver from POSTing an unrelated, pointer-shaped inherited value (a CI `RELEASE_TAG=build_2024_V2`) to the server — an explicit allowlist (or `() => true`) is mandatory to opt in. The same allowlist gates the dev file-reload channel, so a name excluded by `envNames` is never POSTed as a pointer nor injected as a plain value.

## Boot flow

```
process start
  -> dotenv loads .env / .env.local        (consumer's server.ts)
  -> initSecretManager(...)                 <-- THIS CLIENT, first line of server.ts
       0. require an `envNames` allowlist (unset = deny-all + boot warning)
       1. capture { envName -> pointer } from the allowed names in process.env (once)
       2. POST /resolve { keys: [unique pointers] }
       3. overwrite process.env[envName] = values[pointer]
  -> framework boot (reads the resolved process.env)
  -> server.listen()
```

`initSecretManager` runs **before** anything else that reads `process.env` at module-init time.

## Modes

| `source` | Behavior | Writes to `process.env`? |
| --- | --- | --- |
| `'remote'` (default) | Resolve from the server. A missing pointer or fetch error throws — production hard-stop. | After a successful resolve. |
| `'local'` | No network. Pointers untouched. Tests / offline dev. | Never. |
| `'hybrid'` | Try the server; on failure warn and keep local env. | Only on a successful resolve; missing pointers are warned and left as-is. |

## Dev hot reload (opt-in, dev-only)

Set `config.dev` to live-reload while a long-running dev process is up (no-op when `NODE_ENV === 'production'`):

- `dev.watch` (default `true`) — a debounced `fs.watch` on `dev.envFiles` (default `.env` + `.env.local`). On change the files are **re-parsed and applied**: plain values (`ENVIRONMENT=production`, `PORT=123`) are injected straight into `process.env` (live config reload), and pointer-shaped values are re-resolved against the server. A pointer added or bumped after boot is picked up here — no restart. Ownership is source-aware: a file-owned pointer changed to a plain value (or removed) is dropped from later polls, while an inherited shell/CI pointer not declared by any watched file stays active.
- `dev.pollIntervalMs` (default `0`/off) — re-resolve the current pointers every N ms, catching server-side rotations. The interval lives in `config.ts`, changeable in one place.
- `dev.envFiles` — override which files are watched + re-parsed (default `['.env', '.env.local']`).

The file parse is done by a tiny in-package `.env` parser (standard `KEY=VALUE`, comments, quotes), so the package stays dependency-free. Both channels swallow + warn on a transient error rather than crashing the dev process.

## Auth model

A single shared bearer token accompanies every request:

```
Authorization: Bearer <token>
```

The token is the only real secret on the developer machine. Keep it in a gitignored single-line file referenced via `token: { fromFile: '.secret-manager-token' }` (read at resolve time, so file rotation is picked up by the next poll). CI runners inject the file from their secret store.

## What this package does NOT do

- **No secret storage.** No on-disk persistence beyond reading the token file. The in-memory cache is plain JS, discarded on exit.
- **No versioning logic.** It sends the full pointer string and writes back whatever the server returns. Version naming + resolution is the server's job.
- **No admin / write operations.** Read-only `POST /resolve`. Publishing new versions happens through the server's own UI.
- **No app-key validation.** Whether `DATABASE_URL` is a valid URL is the app's concern (validate after `initSecretManager` returns).

## External server — wire contract (separate repo)

The server lives in its own repo (`luckystack-secret-manager`). The client only depends on this one endpoint:

### `POST /resolve`

Request (the app sends only the pointers it references):

```json
{ "keys": ["OPENAI_AUTHORIZATION_KEY_V5", "STRIPE_SECRET_KEY_V2"] }
```

Response:

```json
{ "values": { "OPENAI_AUTHORIZATION_KEY_V5": "sk-...", "STRIPE_SECRET_KEY_V2": "rk-..." } }
```

- Auth: `Authorization: Bearer <token>` (the shared token). 401 on mismatch.
- Pointers the server can't resolve are omitted from `values`. The client treats a missing pointer as fatal in `'remote'` mode, and a warning in `'hybrid'`.

The server additionally exposes admin endpoints (`GET /keys` listing masked values, `POST /keys` appending a new version) used only by its own admin webpage — the client never calls them. The full server + admin-UI implementation lives in the separate, running `luckystack-secret-manager` repo.

## Implementation status

| Piece | Status | Where |
| --- | --- | --- |
| Resolver client (this package) | Implemented | `packages/secret-manager/src/index.ts` |
| local / remote / hybrid modes | Implemented | this doc |
| Opt-in dev hot reload (watch + poll) | Implemented | this doc |
| External secret-manager server (storage, versioning, admin UI, auth) | **Separate repo** | `luckystack-secret-manager` |

## Related

- Function index: `../CLAUDE.md`.
- Consumer quickstart: `../README.md`.
- Framework-wide packaging map: `/docs/PACKAGE_OVERVIEW.md`.
- Architecture deep-dive: `/docs/ARCHITECTURE_SECRET_MANAGER.md`.
