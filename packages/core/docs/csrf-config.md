# CSRF configuration

CSRF protects cookie-mode writes because browsers attach cookies without an explicit action from JavaScript. It does not replace the HTTP origin policy or authorization. Token-mode requests explicitly supply bearer credentials and follow a different boundary. See `../src/csrfConfig.ts`, `../src/csrf.ts`, `../../server/src/httpRoutes/csrfMiddleware.ts` and `../../server/docs/security-defaults.md`.

Changing token/header or cookie policy must keep the issuer, browser helper and verifier in agreement. Do not exempt a state-changing route merely to avoid obtaining a token; a signed webhook exemption must authenticate independently. Consult `../src/csrfConfig.ts` for names and defaults.
