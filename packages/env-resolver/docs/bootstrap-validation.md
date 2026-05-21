# Bootstrap validation — boot-time guards and fail-fast behaviour

> What `@luckystack/env-resolver` does (and explicitly does NOT do) at boot when the remote env source is misconfigured or unreachable. Covers hard-fail conditions, soft-fallback conditions, and how this package fits the framework-wide peer-dep guard policy.

For the bigger picture (wiring package + external env-server, V-reference workflow, append-only versioning), read `./architecture.md` first. This file zooms into the concrete boot-time guards `initEnvResolver` enforces.

`@luckystack/env-resolver` currently has **no required peer dependencies** of its own, so the peer-dep-guard contract from `feedback_peer_dep_guard_policy.md` does not apply directly to this package. What this file documents is the **boot-time guard role** the resolver itself plays — it is the *first* boot-guard in a LuckyStack app, gating whether `process.env` is trustworthy before anything else runs.

## TL;DR

- This package has zero required peer dependencies. Plain HTTP via the global `fetch` API is the only network primitive.
- The resolver IS the boot guard for env keys: in `'remote'` mode, missing options or a failed fetch hard-fails the process before any framework code starts.
- The escape hatches are explicit: `source: 'local'`, `source: 'hybrid'`, or `fallback: 'local'`. Anything else and the process exits with a thrown error.
- A missing `fetch` global (Node < 20 with no `fetchImpl`) is treated as a config error, not a peer-dep guard miss, but the failure mode is identical: a thrown `Error` before any app code starts.

## Why this package does NOT use `validatePeerDependencies`

Sibling packages (`@luckystack/email`, `@luckystack/error-tracking`) use the shared `validatePeerDependencies` helper because they support pluggable adapters whose runtime SDKs (Resend, Postmark, Sentry, etc.) live in optional peer deps. If an operator sets `EMAIL_PROVIDER=resend` but never `npm install resend`, those packages must hard-crash at boot rather than silently fall through to a no-op.

`@luckystack/env-resolver` has no such adapter ecosystem today:

- The only "adapter" is the built-in HTTP client in `fetchRemoteEnv`, which has no SDK.
- The only swap-point is `RemoteEnvOptions.fetchImpl`, which the caller provides directly — there is nothing to detect.
- Therefore there is no peer-dep state to validate.

If a future version introduces backend-specific adapters (AWS SSM, HashiCorp Vault, Doppler), each adapter that requires its own SDK should opt into `validatePeerDependencies` at that time. Until then, this file documents the boot-guard behaviour we **do** have.

## Hard-fail conditions (throw and exit)

These cause `initEnvResolver` to reject with an `Error`. Because `initEnvResolver` is supposed to be `await`-ed at the very top of `server.ts`, an unhandled rejection there ends the process before sockets, the database, or any framework module loads. This is the intended boot-guard behaviour.

### 1. Remote selected but options missing

```
[env-resolver] Remote source selected but no remote options + no LUCKYSTACK_ENV_URL/TOKEN/PROJECT/ENVIRONMENT in env.
```

Triggered when:
- `source: 'remote'`,
- `options.remote` not provided,
- one or more of the four `LUCKYSTACK_ENV_*` env vars is missing,
- `fallback !== 'local'`.

Operator action: set the four env vars, or pass `options.remote` explicitly, or change `source` to `'hybrid'`, or pass `fallback: 'local'`.

### 2. Remote fetch returns non-2xx

```
[env-resolver] Remote env fetch failed: 403 Forbidden
```

Triggered when:
- The endpoint responds with any non-2xx status (auth failure, project not found, server error, etc.),
- `source: 'remote'` AND `fallback !== 'local'`.

Operator action: check the token + project/environment slug against the remote server's admin UI. The status code in the message is the same one the remote returned.

### 3. Remote response missing `values`

```
[env-resolver] Remote env response missing `values` object.
```

Triggered when:
- The response is 2xx but the JSON body does not contain a `values` field shaped like `Record<string, string>`,
- `source: 'remote'` AND `fallback !== 'local'`.

This guards against a misconfigured remote returning a 200 with an empty / error body. Operator action: inspect the response body directly (curl with the bearer token); the remote server is the source of truth.

### 4. No fetch implementation available

```
[env-resolver] No fetch implementation available. Pass `fetchImpl` or run on Node 20+.
```

Triggered when:
- `globalThis.fetch` is `undefined` (Node < 20),
- `RemoteEnvOptions.fetchImpl` is not provided,
- The resolver reaches the fetch step (so `source !== 'local'` and options resolved).

Operator action: upgrade to Node 20 or pass a polyfill (`undici`, `node-fetch`) via `fetchImpl`. This is the closest thing the package has to a "peer-dep miss" — a required runtime capability that the host environment must provide.

## Soft-fail conditions (warn and continue)

These do NOT crash the process. The resolver logs to `console.warn` and returns; downstream code keeps running with whatever `process.env` already held (typically from `dotenv` or the shell).

Soft-fail triggers when **either**:
- `source: 'hybrid'`, OR
- `options.fallback === 'local'`.

The matching warn:

```
[env-resolver] Remote fetch failed, falling back to local env: <error>
```

The `<error>` is the original thrown `Error` from any of the hard-fail conditions above (missing options, non-2xx, missing values, no fetch). Soft-fail does not differentiate between root causes — the warn line carries the underlying error message verbatim.

When to choose soft-fail:

- **Local dev** (`source: 'local'`): no warning, no network. Use for offline work and tests.
- **Hybrid staging/canary** (`source: 'hybrid'`): try the remote; if it is down, keep serving with cached `.env` values. Operator sees a warn, can decide whether to fail over.
- **Hard-fail prod** (`source: 'remote'`, default `fallback`): any misconfiguration crashes the process. Restart policies (systemd, k8s) should retry with backoff so a flaky env server cannot silently degrade a deployment.

## What is NOT guarded

The resolver is intentionally minimal. It does not:

- Validate that `LUCKYSTACK_ENV_URL` is `https://` or a well-formed URL. `fetch` does that and the error propagates.
- Verify that the remote-returned `values` map contains the keys *your app* needs. That validation belongs in your config layer (`@luckystack/core` `projectConfig` or equivalent) after `initEnvResolver` resolves.
- Refuse to overwrite a locally-shadowed key. `applyValues` skips keys already defined in `process.env`; local always wins. This is **not** a guard against operator error — it is a debugging convenience.
- Detect concurrent `initEnvResolver` calls. Two near-simultaneous boots will both fetch; the second overwrites the cache. Acceptable because the function is meant to run once per process.
- Encrypt the bearer token in memory. The token is held in `RemoteEnvOptions` for the lifetime of the process. Use OS-level secret management (Vault, AWS Secrets Manager, etc.) to inject it via the environment.

## Relationship to the framework peer-dep policy

The user memory `feedback_peer_dep_guard_policy.md` states:

> env-key set without peer-dep installed = hard boot crash, never silent fallthrough

Applied to `@luckystack/env-resolver`:

- **`LUCKYSTACK_ENV_*` keys set, package not installed**: not detectable by this package (it is not running). The boot file simply will not import `initEnvResolver`. The wider framework relies on its scaffold / config-template files to keep the import in sync with the env keys. See root rule 14.
- **`LUCKYSTACK_ENV_*` keys set, package installed, env source `'local'`**: no crash — the resolver short-circuits and does not consume the keys. This is intentional: an operator may have the keys staged for a future promotion but want local-only behaviour for now. If you want a stricter posture, switch to `'remote'` so unused keys become a misconfiguration signal.
- **Future adapter peer-deps** (AWS SDK, Vault SDK, etc.): when adapters land, they should each adopt the same guard pattern as `@luckystack/email` and crash if their env key is set without the matching SDK on disk.

## Test recipe

To verify that the boot guard fires in your CI:

```ts
import { initEnvResolver, resetEnvResolverForTests } from '@luckystack/env-resolver';

beforeEach(() => {
  resetEnvResolverForTests();
  delete process.env.LUCKYSTACK_ENV_URL;
  delete process.env.LUCKYSTACK_ENV_TOKEN;
  delete process.env.LUCKYSTACK_ENV_PROJECT;
  delete process.env.LUCKYSTACK_ENV_ENVIRONMENT;
});

it('hard-fails when remote is selected and env is missing', async () => {
  await expect(initEnvResolver({ source: 'remote' })).rejects.toThrow(
    /Remote source selected but no remote options/,
  );
});

it('soft-fails in hybrid mode', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await initEnvResolver({ source: 'hybrid' });
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('Remote fetch failed'),
    expect.any(Error),
  );
});

it('hard-fails when fetch returns 403', async () => {
  const fetchImpl: typeof fetch = async () => new Response('forbidden', { status: 403, statusText: 'Forbidden' });
  await expect(
    initEnvResolver({
      source: 'remote',
      remote: { url: 'https://env.example.com', authToken: 'x', project: 'a', environment: 'b', fetchImpl },
    }),
  ).rejects.toThrow(/403 Forbidden/);
});
```

If your project ever introduces a true peer-dep adapter to this package, mirror `@luckystack/email`'s guard test: install + uninstall the optional dep across cases and assert that the corresponding env key triggers a thrown `Error` containing the missing package name.

## Related

- Concept overview (wiring + external env-server): `./architecture.md`.
- Source: `packages/env-resolver/src/index.ts` — `initEnvResolver`, `fetchRemoteEnv`, `buildOptionsFromEnv`.
- Mode + cache flow: `./resolution-modes.md`.
- Env-key contract: `./env-key-validation.md`.
- Framework peer-dep policy: user memory `feedback_peer_dep_guard_policy.md`.
- Sibling guard implementations: `packages/email/docs/peer-dep-guards.md`, `packages/error-tracking/docs/peer-dep-guards.md`.
