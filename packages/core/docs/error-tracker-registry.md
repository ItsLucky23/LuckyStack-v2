# Error tracker registry

A registry keeps framework request paths independent of any single observability backend. Capture fans out to adapters, but an adapter failure must not break an application request. Spans remain a single execution scope rather than nesting spans across all adapters. See `../src/errorTrackerRegistry.ts` and `../../error-tracking/src/adapter.ts`.

Request identity is scoped so concurrent requests cannot attribute errors to the wrong user; do not store it in a global mutable user slot. Sanitize context before it reaches adapters, including nested sensitive fields. The server-side scope must not enter browser bundles. See `../src/errorTrackerIdentity.ts`, `../src/redactedLogKeys.ts`, `../src/sentrySetup.ts`.
