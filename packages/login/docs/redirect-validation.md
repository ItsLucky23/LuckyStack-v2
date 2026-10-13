# Post-login redirect validation

A single value-returning resolver is used instead of a stop/continue hook: the application chooses one destination, rather than composing competing hook handlers. A resolver failure should fall back to the trusted default rather than prevent login. Source: `../src/redirectResolver.ts`, `../src/login.ts`.

**Open-redirect boundary:** both resolver results and OAuth state return URLs are untrusted until validated. Relative paths are anchored to the trusted frontend origin, not the callback server; absolute destinations must pass the configured allowed-origin policy. Backslash and malformed URL tricks must not smuggle an external destination through the relative-path branch. Never bypass validation or broaden allowed origins just to make a redirect work. Source: `../src/login.ts` (`isAllowedRedirectUrl` and callback state checks), `../src/redirectResolver.ts`, `../../server/src/httpRoutes/authCallbackRoute.ts`.

An authenticated bounce to a hostile domain can make a phishing destination appear to have the application's endorsement. Keep OAuth state, callback and redirect validation connected, and test a requested cross-origin destination against the actual deployed origin policy (`../../core/src/checkOrigin.ts`).
