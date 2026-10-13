# App bootstrap

The registry pattern separates framework packages from each application's infrastructure. Register dependencies during boot and read them when needed, rather than importing consumer configuration or caching stale values at module load. The server entry performs standard wiring; take over registration manually only when owning boot order yourself. See `../src/createRegistry.ts`, `../src/clients.ts`, `../../server/src/bootstrap.ts`.

A consumer-supplied client is intentional ownership: automatic secret refresh must not replace a custom Redis or database connection without its owner's consent. Logging and tracking contexts must redact credentials before fanout; production should not install stack-trace-heavy development logging. The runtime/deploy-environment distinction matters: deployment identity does not authorize development behavior. See `../src/redis.ts`, `../src/env.ts`, `../src/redactedLogKeys.ts`.

For the available registrations and environment variables, consult their types and use sites in `../src/`, not a copied list.
