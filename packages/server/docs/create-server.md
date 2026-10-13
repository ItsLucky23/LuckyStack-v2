# Server creation

The high-level bootstrap supplies a single place to verify registrations and connect HTTP, sockets and optional feature packages. A lower-level server factory exists for integrations that knowingly take over this responsibility. Starting to listen before critical config and security registrations are ready creates request-time failures; check boot prerequisites first. Source: `../src/bootstrap.ts`, `../src/createServer.ts`, `../src/verifyBootstrap.ts`.

Shutdown hooks are best-effort opportunities to flush or drain dependencies, not a veto of termination. Production route maps must not depend on development-only tooling. For types, options and lifecycle implementation see `../src/types.ts`, `../src/afterListen.ts`, `../src/stopServer.ts` and `./runtime-maps.md`.
