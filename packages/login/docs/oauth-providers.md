# OAuth providers

Provider adapters keep protocol-specific account retrieval separate from application identity. A provider email is not automatically proof that two different provider accounts should be merged; select an account-linking strategy deliberately and enforce its database uniqueness assumptions. See `../src/oauthProviders.ts`, `../src/accountStrategy.ts`, `./user-adapter.md`.

Bind authorization callbacks with server-generated, single-use state and validate return URLs before redirecting the newly authenticated browser. The provider callback origin and public frontend origin can differ; do not turn a relative redirect into an attacker-controlled backend URL. Extra provider session data is visible to that user's browser; keep secrets out. Provider-supplied names are untrusted text and must be safely rendered wherever used. Source: `../src/login.ts`, `../src/redirectResolver.ts`, `../../server/src/httpRoutes/authCallbackRoute.ts`.
