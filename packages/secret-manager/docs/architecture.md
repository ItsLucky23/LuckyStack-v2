# Secret-manager client architecture

The package is a **resolver client**, not a vault. An external secret-manager server stores and versions values; the client replaces allowed environment pointers with resolved values before application modules read them. This keeps committed project configuration shareable without putting actual secrets in Git. The external server's wire contract belongs to that repository and the client's source; avoid a duplicate request/response specification here.

## Rotation and scope

A published pointer version remains immutable; rotation publishes a new version. Old branches can continue using their previous pointer until that version is intentionally retired. Decoupling a project's environment variable name from the external key also lets applications change local names without changing the store's identity.

Resolution requires an explicit name allowlist. Without it, pointer-looking values inherited from a shell or CI could be transmitted off-host despite having nothing to do with application secrets. Unset scoping means **deny all**. Keep the bearer token in an ignored file or managed secret source, never in committed templates. Initialize resolution before env-consuming imports. In production, a missing remote value should stop boot rather than leave a pointer masquerading as a usable secret; local/hybrid behavior is for deliberate development use.

Development watching can refresh values in a running process, but does not eliminate the need for policy on who may change env files or server-side versions. The raw in-process resolution cache contains secrets: never expose it through logs, health checks or HTTP. Use metadata-only diagnostics. Storage, authorization, versioning and admin writes remain the external server's responsibility.
