# @luckystack/router

Optional standalone HTTP and WebSocket router for multi-instance LuckyStack deployments and deliberate development-to-staging fallback. If your deployment is a single backend behind a platform load balancer, you do not need this package.

Install `@luckystack/router` and its `ioredis` peer, then run `luckystack-router --help` for the current compiled-config CLI options. See [CLI guidance](./docs/cli.md) and [hosting guidance](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/docs/HOSTING.md) before routing live traffic. Run the router on **Node** while Bun upgrade sockets cannot reliably write; backends may use a different runtime.

## Boundaries to review before deployment

Pin service backends with explicit ports; implicit HTTP ports can collapse distinct presets onto one backend. Reject client-supplied upstream origins, and trust forwarding headers only from a controlled TLS terminator. A Redis boot handshake catches stale fallback topology before traffic is served, but not topology changes introduced after startup. Split/fallback routing requires shared health; do not disable it in a replicated deployment. See [handshake](./docs/boot-uuid-failover.md), [health](./docs/health-polling.md), and [proxy security](./docs/http-proxy.md).
