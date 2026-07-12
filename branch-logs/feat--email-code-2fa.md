# Branch log — feat/email-code-2fa

## 2026-07-12 12:15 — Backend: passwordless email-code login + 2FA (TOTP + email-fallback + recovery codes)

**User prompt:** "kunnen we nu de 2fa en email code checken, resend is opgezet voor de repo en voor 2fa vraag ik me af of we gewoon de verified apps van microsoft of google 2fa kunnen gebruiken" → AskUserQuestion-besluiten: TOTP + email-code-fallback + recovery codes; passwordless email-code login in dezelfde ronde; BACKWARDS COMPATIBLE voor bestaande v0.5.1-repo's (dep-upgrade + aanzetten via manage, geen re-scaffold).

**Antwoord op de kernvraag:** ja — Google/Microsoft Authenticator werken via TOTP (RFC 6238, open standaard). Geen externe dienst: wij genereren secret + otpauth://-QR, hun app scant, wij verifiëren HMAC-codes met node:crypto (nul deps).

**Wat ik deed (backend compleet, alle gates groen):**
- **Prerequisite — LoginForm-drift verzoend** (3 kopieën waren twee kanten op gedreven): merge op template-basis (CSRF-envelope-fix, REDIRECT_DELAY_MS, img onError, text-title-primary) + dev's search-preservatie, OAuth `?return_url=`, reset-password `login.loading`-i18n. Dev-locales op de template-keyset (registerTitle/noAccount/haveAccount, 4 talen). `assetParity.test.ts` uitgebreid: dev-app (src/) zit nu in het parity-net (LoginForm + login/register/reset-password pages byte-identiek aan template).
- **@luckystack/login**:
  - `totp.ts` — RFC 6238/4226 hand-rolled (base32, hotp, verifyTotp timing-safe over het hele drift-window + matched-timestep voor replay-guard, secret-gen, otpauth-URI). 30 tests incl. alle officiële RFC-vectoren.
  - `emailOtp.ts` — numeric-code store: bewust NIET het oneTimeToken-primitief (dat hasht het KEY-materiaal — veilig bij 256-bit, brute-forceable bij 6 digits); keyed op purpose+identity, hash in de VALUE, atomaire attempt-counter (INCR), winner-take-all consume (DEL), één actieve code per slot. 11 tests.
  - `twoFactor.ts` — challenge-store (high-entropy token, hashed at rest, attempts branden de challenge niet per foutcode), TOTP-verify met replay-guard (-2fa-laststep), recovery codes (10× hex 5-5, sha256 at rest, fail-closed burn), email-fallback (gebonden aan actieve challenge), enrollment (pending secret in Redis → confirm met eerste code → pas dan user-record), AES-256-GCM secret-at-rest via optionele TOTP_ENCRYPTION_KEY (plaintext-compat als key later komt), disable vereist geldige code. 20 tests.
  - `emailCodeLogin.ts` — passwordless flow: request (anti-enumeration altijd ok; throttle per-email 3/15m + per-IP 10/15m VÓÓR de lookup), verify → 2FA-gate → `finalizeLogin`. 12 tests.
  - `login.ts` — chirurgische refactor: sessie-tail geëxtraheerd naar exported `finalizeLogin` (gedeeld door password/email-code/2FA — gedrag identiek, 144 bestaande tests ongemoeid groen); `registerTwoFactorGate`-DI-slot (geen module-cycle; twoFactor.ts registreert zichzelf via de package-index → alleen al installeren armt de gate); result-union + `CredentialsLoginChallenge` (status true, geen newToken); `sanitizeUserForSession` stript nu ook totpSecret/recoveryCodes (altijd-aan floor), session.ts fail-closed fallback idem.
  - Config (core `AuthConfig` + defaults, allemaal additive/backwards-compatible): `emailCodeLogin:false`, `emailCodeTtlSeconds:600`, `emailCodeLength:6`, `emailCodeMaxAttempts:5`, `twoFactor:'disabled'`, `twoFactorEmailFallback:true`, `twoFactorChallengeTtlSeconds:300`, `twoFactorMaxAttempts:5`. `UserRecord` + optionele `twoFactorEnabled`/`totpSecret`/`recoveryCodes`.
- **@luckystack/server** — `authSecondFactorRoutes.ts` (framework-laag: alleen die mag Set-Cookie schrijven): POST `/auth/api/email-code/request|verify`, `/auth/api/2fa` (challenge-verify → cookie-seam), `/auth/api/2fa/email-code`, en authed `/auth/api/2fa/setup|enable|disable|recovery-codes` (verse user via adapter — de sessie-kopie is gesanitized). Registratie VÓÓR handleAuthApiRoute (die catch-allt /auth/api/*). Per-IP-shields. authApiRoute: challenge-passthrough-envelope (requiresTwoFactor/challengeToken/twoFactorMethods, géén transport). csrfMiddleware: login-completing routes in de bootstrap-set; enrollment-routes bewust CSRF-plichtig. 13 route-tests.
- **Backwards-compat-ontwerp**: alle logica in framework-packages (komt mee met dep-upgrade), routes zelf-wired, velden optioneel, features default uit — een v0.5.1-project + upgrade + config-flags = werkend.

**Files touched:** packages/login/src/{totp.ts,totp.test.ts,emailOtp.ts,emailOtp.test.ts,twoFactor.ts,twoFactor.test.ts,emailCodeLogin.ts,emailCodeLogin.test.ts,login.ts,session.ts,userAdapter.ts,index.ts}, packages/core/src/projectConfig.ts, packages/server/src/{httpHandler.ts,httpRoutes/authSecondFactorRoutes.ts,httpRoutes/authSecondFactorRoutes.test.ts,httpRoutes/authApiRoute.ts,httpRoutes/csrfMiddleware.ts}, LoginForm×3 + reset-password×3 + src/_locales×4, packages/cli/src/assetParity.test.ts.

**Nog te doen (fase 2):** LoginForm phase-state (2FA-challenge-stap + email-code-tab) in alle 3 kopieën + locales; 2FA-sectie in settings (prisma) / starter-docs; template config-block + .env.local_template (TOTP_ENCRYPTION_KEY) + prisma-schema-velden + starter-adapters (parity); wizard/manage-substappen; ARCHITECTURE_AUTH.md + ADR 0024; e2e met console-email-adapter; CHANGELOGs.

## 2026-07-12 12:30 — Fase 2a: LoginForm-statemachine + template-laag (schema/config/env) + providers-advertentie

**Wat ik deed:**
- **LoginForm** (3 kopieën byte-identiek, parity-net bewaakt): nu een phase-statemachine `credentials | emailCode | twoFactor`. Gedeelde `postAuth` (module-scope) + `handleAuthOutcome` (failure-toast / 2FA-challenge → phase-switch / succes → token+redirect). Email-code view (request → code-invoer → verify, resend, terug-naar-wachtwoord); 2FA-view (TOTP/email-fallback/recovery method-switch links, autoComplete="one-time-code"). Entry-point "inloggen met e-mailcode" alleen zichtbaar als de server het adverteert.
- **/auth/providers** adverteert nu `emailCodeLogin` (boolean uit config — zelfde trustniveau als providernamen); route-test bijgewerkt.
- **Template**: prisma-schema User + `twoFactorEnabled/totpSecret/recoveryCodes` (optioneel — bestaande DB's blijven werken); config.ts auth-blok met commented `emailCodeLogin`/`twoFactor: 'optional'` opties (pruneAuthNone-token in scaffolder mee-geüpdatet); `.env.local_template` + TOTP_ENCRYPTION_KEY blok.
- **Locales**: 31 nieuwe `login.*` keys (2FA + email-code UI- en server-reason-keys) × 4 talen × dev+template trees; JSON gevalideerd.
- Gates: build, pkg-lint, dev-lint, alle tests, ai:lint groen.

**Nog te doen (fase 2b):** settings-2FA-sectie (enroll/disable/recovery UI op de framework-routes), wizard/manage-substappen, docs (ARCHITECTURE_AUTH, http-routes.md, package-CLAUDE.md's, ADR 0024), CHANGELOGs, e2e met console-email-adapter.

## 2026-07-12 12:50 — Fase 2b-1: 2FA-sectie in settings (3 trees) + settings-locale-keys

- **TwoFactorSection**: enroll (setup → secret/otpauth-URI met copy → eerste code → recovery codes eenmalig tonen), disable (code vereist), recovery-codes regenereren. Praat met de framework-routes via fetch + getCsrfToken() (cookie-mode CSRF) + Bearer (token-mode). Template: inline Section-wrapper in page.tsx (na PasswordSection, credentials-only); cli-asset = byte-identieke kopie (parity ✓); dev-app: eigen variant met lokale Section-wrapper + named export (dev-settings is component-gesplitst — VERDER gedrift van template dan gedacht; verzoening = aparte klus, genoteerd).
- 19 nieuwe `settings.twoFactor*` locale-keys × 4 talen × dev+template.
- INCIDENT (hersteld, les herbevestigd): recursieve delete van src/settings/_components wiste bestaande dev-componenten (git checkout herstelde alles — was gecommit); PowerShell -replace op een .tsx corrumpeerde UTF-8 → reset vanaf template + Edit-tool. Beide bekende valkuilen uit eerdere sessies.
- Gates: build, dev-lint, pkg-lint, cli-tests (parity), ai:lint groen.

**Rest fase 2b-2:** docs (ADR 0024, ARCHITECTURE_AUTH, http-routes.md, CLAUDE.md's core/login/server/scaffolder, CHANGELOGs) + e2e (scaffold+install, console-email, echte login/2FA-flow) + dev-settings-page-drift als bewuste rest melden.

## 2026-07-12 13:00 — Fase 2b-2: docs/ADR/CHANGELOGs + RUNTIME-e2e vond & fixte een echte bug

- **Docs**: ADR 0024 (email-code login + TOTP-2fa, backwards-compatible; alternatieven — Google/MS als dienst, TOTP-lib, oneTimeToken-hergebruik — afgewezen); ARCHITECTURE_AUTH.md endpoint-tabel + config-hint; server/docs/http-routes.md pre/post-lijst + route-referentie; CHANGELOGs login/server/core/create-luckystack-app/cli (onder [Unreleased] — release-keuze aan user); ai:index + ai:decisions geregenereerd.
- **Runtime-e2e** (`C:\code\ls-e2e\runtime-2fa-harness.mjs`): drijft de GEBOUWDE login-dist tegen een ECHTE Redis (WSL :6399) met in-memory UserAdapter + capturing email-sender. 24 asserts over enroll → login-gate → replay → email-fallback → recovery → passwordless email-code → disable.
- **BUG GEVONDEN & GEFIXT** (unit-fakes misten 'm — bevestigt de "runtime-test voor ship-safe"-les): de TOTP single-use timestep-replay-guard werd óók afgedwongen op de authenticated management-acties (disable/regenerate). Gevolg: een net-ingelogde user kon 2FA niet uitzetten binnen hetzelfde 30s-venster (z'n app toont nog dezelfde, nu verbruikte code). Fix: `verifyTotpForUser(user, code, enforceSingleUse)` — login-grens dwingt de guard af (replay-defense), management doet plain proof-of-possession (al door sessie beschermd). Regressietest toegevoegd (disable direct na login met dezelfde code). Harness daarna 24/24 groen.
- Gates: volledige unit-suite, build, lint, ai:lint groen.

**Klaar voor user-review.** Volledige feature (backend + UI 3 trees + template + docs + runtime-bewijs) op feat/email-code-2fa. Open beslissing: merge + release (minor bump → 0.6.0 wegens nieuwe features?). Bewuste rest: dev-settings-page is verder gedrift van template (buiten 2FA om) — aparte verzoening; QR-code render is consumer-keuze (otpauth-URI wordt geleverd).

## 2026-07-12 16:05 — Security-scan (5 adversariële lenzen) + fixes vóór 0.6.0

**User prompt:** vóór 0.6.0-publish een security-scan op de nieuwe 2FA/email-code code + de vraag of missende session/user-model-waarden en config-keys geseed worden bij upgrade of onduidelijk breken.

**Aanpak:** 5 parallelle review-agents (crypto/replay, auth-bypass/logic, brute-force/DoS, secret-exposure/CSRF, upgrade-compat). Elke HIGH/relevante bevinding zelf her-geverifieerd; fixes daarna bewezen tegen ECHTE Redis via de uitgebreide runtime-harness (30 asserts, incl. concurrency).

**Bevestigde issues + fixes (allemaal in framework-packages, komt mee met dep-bump):**
- **Re-enrollment zonder step-up (MEDIUM)** — gekaapte sessie kon 2FA overschrijven. Fix: `beginTotpEnrollment`/`confirmTotpEnrollment` weigeren als 2FA al aan is (disable-first vereist, dat vraagt een geldige code) of als de feature globaal uit staat; route relayt de union. Nieuwe reason-keys `twoFactorAlreadyEnabled`/`twoFactorDisabledByServer` (×4 talen ×2 trees).
- **TOTP replay-guard TOCTOU (MEDIUM)** — niet-atomair get→set liet 2 gelijktijdige verifies met dezelfde code beide slagen. Fix: atomaire per-(user,timestep) `SET NX` claim.
- **Recovery-code burn niet-atomair (MEDIUM)** — double-spend/lost-update. Fix: per-user Redis-lease (core acquire/releaseLease) + RE-READ via findById binnen de lease.
- **Geen cross-IP per-account 2FA-verify-cap (MEDIUM)** — per-challenge-budget resetbaar door nieuwe challenge (wachtwoord-houder). Fix: identity-keyed account-lockout (10 fouten/15m) vóór de per-challenge-check.
- **Recovery-codes 40-bit → 80-bit (MEDIUM)** — `randomBytes(5)`→`randomBytes(10)` (offline-kraakbaar bij DB-lek).
- **Timing/reason-enumeratie-oracle in email-code request (MEDIUM)** — bestaande-account-pad awaitte de mail (traag + reason-lek). Fix: fire-and-forget send, altijd identiek `{ok:true}`, send-fout alleen server-log.
- **`recoveryCodes` mist in log-redactie (LOW)** — toegevoegd aan `DEFAULT_REDACTED_LOG_KEYS` (`totpSecret` matchte al via `secret`-suffix).
- **7/8-cijfer-codes geaccepteerd (LOW)** — `verifyTotpForUser` gepind op exact 6 (matcht de otpauth-URI); generieke `verifyTotp` blijft RFC-flexibel.
- **Management-routes throttle (LOW-MED)** — per-IP shield `2fa-manage` op disable/recovery-codes.
- **Counter-TTL-race (INFO)** — fallback-expire zodat een INCR'd counter nooit zonder TTL blijft.

**Bewust NIET gewijzigd (gedocumenteerd i.p.v. gefixt):** plaintext TOTP-secret als default (opt-in encryptie via `TOTP_ENCRYPTION_KEY`, boot-warning bestaat) + KDF-note; `twoFactorEmailFallback` default `true` (mailbox = factor — user koos expliciet email-fallback; posture-note toegevoegd, flip mogelijk).

**Upgrade-verdict (kernvraag):** config-keys → automatisch geseed via deepMerge, feature default UIT; session-waarden → `twoFactorEnabled` (bool) stroomt door, secrets altijd gestript; user-kolommen → handmatig (3 optionele Prisma-velden) maar de fout is LUID (log noemt exacte kolommen + `login.twoFactorPersistFailed`). Enige stille gaten: config-flag niet flippen (bedoeld) + UI hand-porten (geen auto-aflevering). ARCHITECTURE_AUTH.md kreeg een expliciete upgrade-runbook + posture-notes.

**Verificatie:** unit-suite volledig groen (login 199 incl. nieuwe guard/concurrency/lockout-tests), build/pkg-lint/dev-lint/ai:lint groen, en de runtime-harness tegen echte Redis 30/30 — inclusief de atomaire NX-race (exact 1 winnaar), account-lockout en re-enroll-guard.

**Files touched:** packages/login/src/{twoFactor.ts,twoFactor.test.ts,emailOtp.ts,emailCodeLogin.ts}, packages/core/src/redactedLogKeys.ts, packages/server/src/httpRoutes/authSecondFactorRoutes.ts + .test.ts, docs/ARCHITECTURE_AUTH.md, LoginForm/settings-locales (2 keys ×4×2). Runtime-harness: C:\code\ls-e2e\runtime-2fa-harness.mjs.
