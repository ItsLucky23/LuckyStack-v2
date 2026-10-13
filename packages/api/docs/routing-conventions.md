# API routing conventions

Versioned route names allow client and server maps to agree as handlers evolve. Discovery is generated; keep declarations and generated artifacts aligned rather than maintaining a second route inventory. See `../../devkit/` and `../src/handleApiRequest.ts`.

An HTTP method is an HTTP transport constraint, not permission to invoke the handler: socket events have no method. Enforce caller identity and any route predicates in auth policy on both transports. Input-validation exceptions are deliberate reductions in defense and need a reason; avoid broad skips as a type-generator workaround. See `../src/handleHttpApiRequest.ts`, `./auth-flow.md`, `./generated-types.md`.
