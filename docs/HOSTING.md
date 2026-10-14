# Hosting LuckyStack

<!-- @covers packages/router/src, packages/server/src, packages/devkit/src/supervisor.ts, packages/create-luckystack-app/template -->

## Deployment ownership

Deploy the application repository, not the framework reference app. Use its recorded package manager and supported runtime from the package manifests. Provision only the data services your selected features require; do not treat a copied environment table as deployment truth.

The build is the production boundary. Application overlays and generated routing must be included in the built artifact, so changing source files beside an old bundle is not a deployment.

## Minimal production procedure

1. Configure public origins, bind addresses and topology from the application configuration and generated templates. Keep real secrets in the deployment's secret store or restricted local files, never in Git or image build arguments.
2. Install from the lockfile with build dependencies **and optional dependencies** available: the TypeScript 7 compiler that generates the route artifacts, and the bundlers, ship their native binaries as platform-specific optional packages, so `--omit=optional` breaks the build. Then run the project's verification gate, which includes the production build, and confirm the artifact contains both the client and the server entry; a zero exit code alone does not prove that. Retain generated data-layer runtime artifacts when preparing the production image.
3. Apply an explicitly reviewed migration plan against the intended database, with a backup/rollback strategy. Startup must not silently migrate or seed shared data.
4. Start the production command from the application's `package.json` under a process/container supervisor. Use an unprivileged private backend binding behind HTTPS ingress.
5. Verify real browser flows, not just a health endpoint: login, a protected write, realtime reconnect and any streaming routes the app uses. Send the real public `Origin` header in HTTP smoke tests so origin-policy mistakes are visible.

For generated Docker assets:

```sh
npx luckystack add docker
npm run docker:check
```

Review the generated `docs/DOCKER.md`, templates and Compose topology before starting it. A local process talking to remote infrastructure is **not** a disposable local environment: do not run resets, seeds or migrations without authorization.

## Security pre-flight

- HTTPS termination, secure cookies and the public app origin must describe the same deployment. A successful local HTTP request cannot prove the browser session policy is correct.
- Trust forwarded protocol/client metadata only at an explicit trusted-proxy boundary. Otherwise callers can forge it. See [ARCHITECTURE_HTTP.md](ARCHITECTURE_HTTP.md).
- Forward polling and WebSocket upgrades coherently; do not configure only the WebSocket path. Preserve stream delivery rather than buffering it into a final response.
- CORS is not authorization or CSRF protection. Preserve origin checks and cookie-mode CSRF separately. For non-browser writes, use the authentication/origin/CSRF contract in the actual handler, not a blanket bypass.
- Keep destructive test endpoints private and disabled in production. Do not supply test reset credentials to a production process.
- Keep databases and Redis private and authenticated. For MongoDB transaction use, provision a replica set rather than assuming a standalone instance can satisfy that contract.
- Confirm bootstrap dependencies and generated maps before admitting traffic. Do not suppress readiness errors to make a deployment look green.

## Failure boundaries

A failure before accepting traffic is a failed boot. Optional post-listen work must not turn a serving process into a repeated boot failure; truly indispensable work needs an explicit fatal/readiness policy. Otherwise an unreachable background dependency can cause a supervisor-driven crash loop. See the server's post-listen source and [ARCHITECTURE_PACKAGING.md](ARCHITECTURE_PACKAGING.md) for ownership context.

Health proves reachability; it does not prove correct service ownership, shared infrastructure or application readiness. Split deployments also need agreement about which service executes a handler and where realtime recipients live. See [ARCHITECTURE_MULTI_INSTANCE.md](ARCHITECTURE_MULTI_INSTANCE.md); Redis event delivery cannot make an absent handler executable.

## Runtime parity

Keep `bunfig.toml` when choosing Bun: early automatic environment loading would otherwise change secret/configuration ordering relative to Node. Verify the actual child runtime, not merely the package manager command you invoked. Use the runtime probe and supported manifest constraints rather than a historical benchmark as compatibility evidence.

The standalone router has a separate WebSocket-proxy capability requirement. Run it on a runtime whose probe succeeds; an HTTP-only green health response is not proof that upgrades are forwarded. Backend runtime support does not imply router runtime support.

Consult current command help, generated assets and source for exact options and limits. This guide intentionally does not copy proxy configuration, environment defaults or platform package-install recipes.
