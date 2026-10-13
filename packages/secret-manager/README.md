# @luckystack/secret-manager

Boot-time client for an **external** versioned secret store. Commit opaque environment pointers instead of real values; keep the bearer token in a gitignored file or a secret store. Install `@luckystack/secret-manager`, then initialize it **before** importing application modules that read environment variables. See the installed `initSecretManager` types and [architecture](./docs/architecture.md) for the boundary with the external server.

Specify an explicit `envNames` allowlist: without one nothing is resolved off-host, intentionally protecting unrelated inherited variables. For production, use fail-closed resolution when an unresolved secret would compromise service behavior. Do not use development fallback mode to silently tolerate missing production secrets.

Secret rotations publish a new immutable pointer version rather than changing an existing one, so old branches can still start. The token file must never be committed; the raw resolution cache must never be logged or exposed by a health endpoint. Use metadata-only diagnostics.
