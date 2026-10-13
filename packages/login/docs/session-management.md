# Session management

Redis-backed sessions and a pluggable adapter support different persistence needs without binding login to a particular database. An adapter must preserve expiry and active-session tracking: a non-expiring record is a security regression. Session contents can be sent to a browser; sanitize credentials and provider extras before storing/broadcasting. Source: `../src/session.ts`, `../src/sessionAdapter.ts`, `../src/sessionSanitizer.ts`.

Sliding expiry keeps active sessions alive; it does not replace explicit logout or revocation. Single-session enforcement needs to notify and revoke the displaced device without recursive logout. A session update has a separate broadcast because the browser must receive the new state, not merely the adapter write. Session mode matters: cookie credentials are ambient and require CSRF; bearer credentials must not be accepted as a fallback in cookie mode without reviewing bypass risk (`../../core/src/extractToken.ts`, `../../server/docs/security-defaults.md`).

Reset links are hashed, single-use secrets stored separately from session records (`../../core/src/oneTimeToken.ts`). Do not log full token values, even in diagnostics.
