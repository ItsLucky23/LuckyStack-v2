# @luckystack/secret-manager — agent guidance

This is a boot-time client for an external versioned secret store, not a vault or secret-writing service. Commit opaque pointers only; keep bearer tokens in ignored files or a secret store and initialize resolution before importing modules that read environment values. See `README.md` for a minimal start and `docs/architecture.md` for the security rationale.

Explicitly scope environment variable names before resolving; the default deny-all boundary avoids sending unrelated inherited values off-host. For production dependencies prefer fail-closed remote resolution rather than quietly running with unresolved pointers. A cached resolution contains raw secrets: never include it in logs or health responses; use metadata-only diagnostics. Immutable versioned pointers are essential to keeping older branches bootable through rotations.
