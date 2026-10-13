# API error handling

Normalize failures at the transport boundary: clients need stable, localizable errors, not raw exceptions, stack traces or protected validation detail. Error tracking is for operators and must not make a failed tracker crash a request. See `../src/_shared/responseEnvelope.ts`, `../src/handleApiRequest.ts`, `../src/handleHttpApiRequest.ts`, `../../core/src/responseNormalizer.ts`.

Observe the distinction between a pre-execution veto and a post-execution hook: a late hook cannot undo a committed mutation. Per-request tracking identity prevents cross-request attribution; log/capture contexts need credential redaction. See `../../core/src/errorTrackerIdentity.ts`, `../../core/src/redactedLogKeys.ts`, `./api-request-lifecycle.md`.
