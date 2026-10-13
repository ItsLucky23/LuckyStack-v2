# Secret manager architecture

`@luckystack/secret-manager` resolves versioned secret **pointers** at process boot against a separate server. Committed pointer names are not credential values; an old branch can keep using an old immutable version while a new branch adopts a rotation. The application still must keep the resolver's bearer credential outside git. See [the client design guide](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/packages/secret-manager/docs/architecture.md) for the current client contract.

## Fail-closed boundary

- Explicitly select which environment names may be resolved remotely. With no opt-in the resolver sends no pointers off-host. When remote resolution is enabled, an unreachable server or missing pointer must stop production boot rather than allowing a raw pointer to reach a database, SDK or login path. Local or hybrid behavior is an intentional different trust choice, not a production fallback to assume.
- Resolve secrets **before** constructing env-backed clients. A pool or Redis client built with a pointer does not repair itself when `process.env` changes; rebuild long-lived clients after rotation. The framework's default Redis client uses the secrets-resolved channel; custom clients need their own rebuild path (ADR 0026).
- Server and standalone tools are separate processes. Prisma commands, test runners and one-off jobs that need resolved credentials must run their own resolution prefix; resolving in the server cannot populate another process's environment. Do not accidentally reload unresolved pointer literals over resolved values partway through a test run.
- Keep the shared resolver token in a gitignored secret store or file, not alongside committed pointers. Rotation must retain old decryption/resolution capability while deployed older versions still refer to it; retire old versions only after confirming no consumers remain.
- Live reload is not instantaneous revocation: credentials already handed to a long-lived SDK can outlive a changed environment value. For stronger guarantees use a dedicated call-site integration.

This client does not store or validate application secrets and is not a per-workspace vault. See [multi-tenancy](./ARCHITECTURE_MULTI_TENANCY.md) for tenant-owned credentials and `server/bootstrap/initSecrets.ts` for the current boot seam. The separate `luckystack-secret-manager` server owns the wire endpoint and storage policy.
