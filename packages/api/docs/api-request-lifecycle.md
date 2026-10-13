# API request lifecycle

Socket and HTTP entry points should enforce the same route-level authorization, limits, input-validation and response policies; a difference in transport must not open a bypass. The order matters where it protects information: resolve the route to find its policy, then reject unauthorized callers before exposing input-schema or HTTP-method details. Route names themselves are not secret; clients receive them in generated artifacts. See `../src/handleApiRequest.ts`, `../src/handleHttpApiRequest.ts`, `../src/transportParity.test.ts`.

Hooks may observe or change the response only at their designated seam. Do not leak thrown exceptions or raw schema diagnostics into protected responses. A streaming response may have already emitted chunks when a later operation fails; consumers must handle a final error as distinct from prior progress. See `../src/_shared/requestLifecycle.ts`, `../src/_shared/responseEnvelope.ts`, `./error-handling.md`.
