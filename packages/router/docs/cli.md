# Router CLI

The CLI loads deployment and service registration modules before starting the router; use compiled config paths in production, and an appropriate TypeScript loader when pointing at source during development. Run `luckystack-router --help` for current flags and defaults rather than relying on a duplicate table here.

Validate the intended environment and preset before binding a public port. Use Node while Bun's upgrade socket behavior cannot reliably proxy WebSockets. For split/fallback topologies, shared Redis health and a boot handshake are safety requirements, not optional performance tuning. If programmatic lifecycle control is needed, use the installed `startRouter` API and preserve its shutdown behavior. See `health-polling.md` and `boot-uuid-failover.md`.
