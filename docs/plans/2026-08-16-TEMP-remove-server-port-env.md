# Temporary implementation plan — remove `process.env.SERVER_PORT`

> **Status:** implemented and verified on 2026-08-16. Kept as the execution
> record for ADR 0045; the final E2E used dynamically reserved consecutive ports
> rather than fixed `4787/4788` because port `4787` was already occupied locally.

## Goal

Remove `process.env.SERVER_PORT` completely from LuckyStack runtime code and
make the port contract explicit:

```text
consumer config.ports.ts
  ├─ server.ts -> defaultPort: ports.backend
  ├─ config.ts -> OAuth callback default
  └─ vite.config.ts -> frontend/proxy fallback

server positional CLI port
  -> typed core port-override registry

server bootstrap
  -> effective intended port
  -> core intended/bound registry
  -> dev-server.json for Vite proxy after auto-increment
```

`SERVER_PORT_AUTO_INCREMENT` remains. It is an auto-increment policy flag, not
the backend-port value.

## Explicit decisions for this run

1. **`config.ports.ts` remains consumer-owned and pure data.** No framework
   package imports it directly.
2. **The positional server port remains supported:**
   `npm run server -- <preset> <port>`.
3. **The positional port is stored in a browser-safe core/config registry, not
   in `process.env`.**
4. **`server.ts` continues to pass `defaultPort: ports.backend`.**
5. **Effective precedence becomes:**

   ```text
   options.port > positional argv port > options.defaultPort > generic numeric fallback 80
   ```

   There is no environment-port fallback.
6. **Auto-increment remains runtime state:** intended port is registered before
   listen; the successful `node:http` port is registered after listen and
   advertised to the Vite proxy.
7. **Generic consumers remain supported** through `options.port`,
   `defaultPort`, explicit `oauthCallbackBase`, or `app.publicUrl`; they no
   longer get a port from `.env`.
8. **No router dependency is added.** Single-instance scaffolds and router
   scaffolds use the same port contract.
9. Historical handoffs/changelogs may mention the removed legacy key, but live
   runtime code, templates, tests, and active docs must not use
   `process.env.SERVER_PORT`.

## Architecture to implement

### A. Add a core port-override registry

Add a browser-safe module under the existing `@luckystack/core/config`
subpath, for example `packages/core/src/portConfig.ts`:

```ts
registerPortOverride(port: number | null): void
getPortOverride(): number | undefined
resetPortOverrideForTests(): void
```

Requirements:

- no Node-only imports;
- no consumer imports;
- strict `0..65535` validation, preferably reusing a shared contract without
  creating a core→server dependency;
- `@luckystack/core/config` exports the registration/accessor;
- tests cover empty, valid, zero, invalid, and reset states;
- the normal browser bundle sees no server CLI override and falls back to
  `config.ports.ts`.

### B. Remove argv writeback to `process.env`

Change:

- `packages/server/src/argv.ts`
- `packages/server/src/parseArgv.ts`
- argv tests and docs

`applyServerArgv()` should:

1. parse and validate bundles/port;
2. store the parsed port in its existing server-side accessor;
3. call `registerPortOverride(parsedPort)`;
4. never assign `process.env.SERVER_PORT`.

Keep `getParsedPort()` temporarily as the server package API and make it read
from the same parsed state. No environment bridge remains.

### C. Make consumer config use the typed override

Change both consumer surfaces:

- root `config.ts`;
- `packages/create-luckystack-app/template/config.ts`.

Replace the runtime `SERVER_PORT` read with:

```ts
getPortOverride() ?? ports.backend
```

Keep the config module browser-safe by importing only from
`@luckystack/core/config` and the consumer's pure `config.ports.ts`.

Verify that the server entry imports `@luckystack/server/parseArgv` before the
consumer config, so the override registry is populated before OAuth config is
registered.

### D. Remove environment fallback from server/core runtime

Change:

- `packages/core/src/env.ts` — remove `SERVER_PORT` from the schema/runtime
  environment surface;
- `packages/core/src/bindAddress.ts` — remove the `process.env.SERVER_PORT`
  fallback; use registered intended/bound address, then numeric generic fallback
  only where the API contract requires one;
- `packages/server/src/portResolution.ts` — remove `envPort` from input and
  precedence;
- `packages/server/src/createServer.ts` — stop passing/reading
  `process.env.SERVER_PORT`;
- `packages/server/src/types.ts` — update port contract docs;
- `packages/cli/src/commands/checkEnv.ts` — remove `SERVER_PORT` from active
  env-key diagnostics; retain `SERVER_PORT_AUTO_INCREMENT`;
- `packages/server/src/devServerInfo.ts` — update stale fallback comments;
- `packages/core/src/checkOrigin.ts` and other active runtime comments/docs.

Do not remove `SERVER_IP` as part of this task.

### E. Preserve OAuth intended/bound behavior

Keep and adapt:

- `registerBindAddress` for intended port;
- `registerBoundAddress` for actual port;
- `resolveDevCallbackUrl` for direct loopback auto-increment;
- authorize rewrite in `packages/server/src/httpRoutes/authApiRoute.ts`;
- token-exchange rewrite in `packages/login/src/login.ts`.

Add the effective intended-port registry to the OAuth callback construction
path where needed so these cases are explicit:

1. scaffold default `ports.backend`;
2. positional CLI port;
3. auto-increment from intended to bound;
4. production `PUBLIC_URL` without dev rewrite;
5. generic consumer with explicit `oauthCallbackBase`.

Preserve the ADR 0031 rule: an explicit local router/reverse-proxy ingress is
not silently bypassed.

### F. Clean scaffold/CLI/docs surfaces

Update:

- `packages/create-luckystack-app/template/config.ts`;
- `packages/create-luckystack-app/template/config.ports.ts` comments;
- template `.env` files;
- root `.env`/`.env_template` comments where active;
- `packages/create-luckystack-app/template/server/server.ts` comments;
- `packages/server/README.md`;
- `packages/server/docs/argv-parsing.md`;
- `packages/server/docs/create-server.md`;
- `packages/core` and `packages/login` docs/CLAUDE surfaces;
- `docs/DEVELOPER_GUIDE.md`, `docs/HOSTING.md`, relevant architecture docs;
- active changelogs;
- a migration note stating: edit `config.ports.ts` or use positional argv,
  never add `SERVER_PORT` to `.env`.

Keep historical handoff material unchanged unless it is presented as current
runtime instructions; mark such historical references if necessary.

## Tests to add/update

### Unit/contract tests

1. Core port registry: register/read/reset/validation.
2. `parseServerArgv`: parsed port registers without changing
   `process.env.SERVER_PORT`.
3. Default scaffold contract:
   - mocked `config.ports.ts` backend `4787`;
   - no `SERVER_PORT` in environment;
   - server resolution = `4787`;
   - OAuth callback base = `http://localhost:4787`.
4. Explicit CLI override:
   - argv port `4911`;
   - server resolution = `4911`;
   - OAuth callback base = `http://localhost:4911`.
5. Auto-increment:
   - intended `4787`, bound `4788`;
   - authorize and token exchange produce byte-identical
     `http://localhost:4788/auth/callback/google`.
6. Production:
   - callback base uses `PUBLIC_URL`;
   - no dev-port rewrite.
7. Generic consumer:
   - no `config.ports.ts`;
   - explicit `oauthCallbackBase` works;
   - fallback to `app.publicUrl` works.
8. Programmatic server options:
   - `createLuckyStackServer({ port })` binds the explicit port;
   - the intended-port registry is truthful before OAuth is constructed.
9. Single-instance scaffold without router:
   - `config.ports.ts` exists;
   - `server.ts` passes `defaultPort: ports.backend`;
   - router topology is absent.
10. Router scaffold:
    - `config.ports.ts` still exists;
    - router topology remains opt-in and independent.
11. Final source guard:
    - active runtime source contains no `process.env.SERVER_PORT`;
    - active templates contain no `SERVER_PORT` backend-port setting;
    - `SERVER_PORT_AUTO_INCREMENT` is explicitly allowlisted.

## E2E matrix

### 1. Real registry scaffold/install/build

Use the existing Verdaccio harness, not `file:` dependencies:

```bash
npm run e2e:verdaccio -- --pm=npm --runtime=both \
  --scaffold-args="--orm=sqlite --auth=none --no-ai-docs"

npm run e2e:verdaccio -- --pm=bun --runtime=both \
  --scaffold-args="--orm=sqlite --auth=none --no-ai-docs"
```

Extend the harness or add a dedicated `scripts/e2ePortContract.mjs` so the
fresh scaffold is tested with:

- `config.ports.ts` changed to frontend `5391`, backend `4787`;
- no `SERVER_PORT` in the child environment;
- Node runtime and Bun runtime;
- npm install and Bun install;
- single-instance scaffold and router-enabled scaffold asset checks.

### 2. Real default-port server boot

For each runtime/package-manager cell:

1. build the scaffold;
2. launch the built server without a positional port;
3. assert it listens on `4787`;
4. assert `/_health` and `/livez` succeed;
5. assert no `SERVER_PORT` is required or created.

### 3. Real CLI override boot

Launch the same built scaffold with:

```bash
node dist/server.js default 4911
# or
bun --bun dist/server.js default 4911
```

Assert it listens on `4911`, while `config.ports.ts` remains unchanged.

### 4. Real auto-increment + OAuth authorize probe

1. Occupy `4787`.
2. Start the scaffold without a positional port and with auto-increment enabled.
3. Assert the server binds `4788` and writes the matching dev-server
   advertisement.
4. Configure dummy Google development credentials in the child process.
5. Request `/auth/api/google` without following redirects.
6. Decode the provider `Location` header and assert its `redirect_uri` uses
   `4788`.
7. Stop the child and verify cleanup.

Token-exchange byte parity remains covered by unit tests using the same resolver;
no real Google request is made.

### 5. Production callback probe

Run the config/provider contract with:

```text
NODE_ENV=production
PUBLIC_URL=https://app.example.com
```

Assert callback URL is `https://app.example.com/auth/callback/google` and no
localhost/dev-port rewrite occurs.

## Verification commands after implementation

Run in this order:

```bash
npm run ai:decisions
npm run ai:index
npm run lint
npm run lint:packages
npm run ai:lint
npm run test:unit
npm run build:packages
npm run generateArtifacts
npm run build
npm run test:integration
npm run e2e:verdaccio -- --pm=npm --runtime=both
npm run e2e:verdaccio -- --pm=bun --runtime=both
npm run pack:dry
npm run ai:doc-staleness
```

Also run a final active-source scan:

```bash
rg -n --hidden \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!docs/_archive/**' \
  'process\\.env\\.SERVER_PORT|\\bSERVER_PORT\\b' .
```

Expected result: only migration/history/changelog references plus the separate
`SERVER_PORT_AUTO_INCREMENT` flag remain; no runtime code reads or writes
`process.env.SERVER_PORT`.

## Documentation/memory actions

- Add an ADR superseding or extending ADR 0044 for the final no-env contract.
- Update the findings ledger created for the removal assessment.
- Regenerate `docs/AI_DECISIONS_INDEX.md` and `docs/AI_QUICK_INDEX.md`.
- Append a branch-log entry with changed files, test matrix, and any runtime
  limitations.
- Do not bump/publish package versions unless explicitly requested after the
  implementation is verified.

## Stop conditions

Stop before implementation if any of these are discovered:

- `config.ports.ts` cannot be imported from the consumer config without pulling
  server-only modules into the browser;
- the core/config subpath is not actually shared between server and browser
  module instances;
- programmatic `options.port` cannot be made visible to OAuth without
  request-derived or unsafe host inference;
- the existing Verdaccio harness cannot run a clean scaffold on one of the
  explicitly requested runtime/package-manager cells.

In those cases, record the evidence and adjust the design before changing
runtime code.
