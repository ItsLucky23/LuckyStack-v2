# @luckystack/api — design context

API is the route-adapter layer between generated runtime maps and socket/HTTP transports; server bootstraps it. Keep auth, validation, rate limiting, hooks and response normalization consistent across transports. Their implementations, not a hand-maintained step list, are authoritative: `src/handleApiRequest.ts`, `src/handleHttpApiRequest.ts`, `src/_shared/`, `src/transportParity.test.ts`.

Do not use an HTTP method declaration as an authorization gate: sockets have no HTTP method. Authenticate and authorize with route auth policy on both transports. Validate input before application execution; do not expose schema-error details from a protected route to unauthorized callers. Derive per-user limiter identity from validated session identity, not an attacker-supplied token; treat forwarded IP headers as trusted only behind the configured proxy (`../core/src/resolveClientIp.ts`). Keep observational hooks observational and do not bypass error normalization.

Type maps are generated contracts, not a reason for unsafe casts: regenerate artifacts and correct the generator/source when typing fails. See `docs/generated-types.md` and repository `AGENTS.md`.
