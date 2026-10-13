# Multi-tenancy architecture

A tenant can be modeled as an application Workspace. LuckyStack authenticates a user; it does **not** decide which workspace that user belongs to or what the user may do there. Keep membership and role policy in application code rather than confusing authentication with authorization.

## Isolation boundaries

- Resolve and authorize the target workspace **before** tenant-scoped data access. A request-local context can carry that identity, but its lifetime must actually enclose the handler and asynchronous work. Merely setting a context in a pre-execution callback does not by itself prove the later handler remains in that scope. Missing context should fail loudly, not fall back to unscoped queries.
- Scope both reads and writes of tenant-owned models. Retain a separate path for framework-global users/sessions: applying workspace filters to global identity data can break authentication, while using an unscoped default client for app data can leak another tenant's rows. Prisma extensions and the registered-client seam are described in `@luckystack/core`.
- When using separate read-only and read-write clients, an unknown slot must not silently fall back to a privileged default. Protect connection credentials as well as query filters; application checks cannot substitute for a read-only database role.
- Partition application Redis keys by workspace without accidentally changing global session/rate-limit key semantics. Preserve the key-prefix/join behavior needed for framework enumeration. See the core key-formatter implementation for its live contract.
- Workspace-supplied credentials are tenant data and need encryption and per-request access checks. Boot-resolved shared infrastructure secrets are a different category; do not treat one as a substitute for the other. See [secret manager](./ARCHITECTURE_SECRET_MANAGER.md).

The exact role matrix belongs to the product, not this framework design. Test cross-workspace reads and writes, including background tasks and bypass paths, against the app's actual authorization rules.
