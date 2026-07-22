# Branch log — fix/v073-port-oauth-review

## 2026-07-21 18:20 — Alle v0.7.3 port/OAuth-reviewpunten opgelost

**User prompt:** los alle punten op.

**Wat ik deed:** alle elf bevindingen uit de v0.7.3 port/OAuth-review gesloten. De root- en scaffold-Vite-proxy muteren nu zowel Vite's request-clone als de originele http-proxy-opties, waardoor HTTP en directe WebSocket-upgrades een backend-hop echt volgen. De server bewaart intended + actually-bound adressen, gebruikt één canonieke environment-classificatie, leest `httpServer.address().port`, valideert de volledige poort-range en verwijdert de dev-portadvertentie alleen als de PID nog eigenaar is. OAuth herschrijft alleen een auto-derived directe loopbackcallback en respecteert een expliciete lokale router/reverse proxy; IPv6-loopback is inbegrepen. Testtarget-resolutie leeft nu gedeeld in `@luckystack/test-runner`, de scaffold gebruikt `ports.backend` als fallback, vier kapotte root-testscripts zijn gerepareerd en de relevante scripts/configs vallen onder typecheck. Root dogfood gebruikt `loadEnv` + `ports.frontend`. De huidige Vite 8-buildfout en productie-vconsolewaarschuwingen zijn eveneens gesloten.

**Files touched:** core bind-address/OAuth-helper + docs/tests; server listen/port-resolution/dev-server-info + docs/tests; test-runner live-base-url helper + docs/tests; root + scaffold Vite proxy/config/test scripts; findings-ledger; ADR 0031; generated AI-contextindexen.

**Notes:** gekozen beleid is vastgelegd in ADR 0031: intended → bound herschrijven voor directe loopback, expliciete lokale ingress behouden. Geen release of publish uitgevoerd. `.claude/settings.local.json` bleef onaangeraakt.

**Verificatie:** definitieve gates groen — 1867/1867 unit tests; lint + package-lint + ai:lint zonder bevindingen; 4/4 standalone testscripts parsen; 17/17 package builds; warning-vrije root client/server build; 17/17 package tarballs slagen in `pack:dry` en bevatten de nieuwe scaffold/helper-oppervlakken.

## 2026-07-21 22:45 — Test-runner resolveert secrets in eigen proces

**User prompt (summary):** Een consumerrepo liet Layer-5/integratietests falen op een ruwe `DATABASE_URL_V1`; fix frameworkbreed dat de test-runner zijn eigen env/secret-bootstrap uitvoert.

**What I did**:
- `resolveTestEnvironment` toegevoegd aan `@luckystack/test-runner`: env-lagen eerst, consumerconfig lazy, optionele secret-manager daarna in fail-fast remote mode.
- `runAllTests.loadProjectConfig` toegevoegd en root/scaffold `scripts/testAll.ts` erop aangesloten, vóór custom test imports en direct Prisma/Redis-gebruik.
- Optional peer, regressietests, scaffoldguard, changelogs, architectuurdocs, finding-ledger en ADR 0032 toegevoegd.
- AI-indexen geregenereerd.

**Files touched:** `packages/test-runner/**`, `packages/create-luckystack-app/{template/scripts/testAll.ts,src/configSecretsResolved.test.ts,CHANGELOG.md}`, `scripts/testAll.ts`, `docs/{ARCHITECTURE_TESTING.md,ARCHITECTURE_SECRET_MANAGER.md,decisions/0032-*,findings/2026-07-21-test-runner-secret-bootstrap/**}`, generated AI-contextindexen, `package-lock.json`.

**Notes / decisions:** De runner leest niet zelf alleen `LUCKYSTACK_SECRET_MANAGER_URL` (dat zou token/allowlistbeleid dupliceren), maar krijgt de echte consumerconfig via een lazy callback. Geconfigureerd-maar-ontbrekend secret-manager faalt vóór tests; doorgaan met pointers is bewust afgewezen.

**Verificatie:** 24 gerichte regressietests groen; lint, package-lint, ai:lint, tsc en volledige build (17/17 packages + client/server) groen. Volledige unit-suite: 1885 groen, 6 failures in de reeds aanwezige ongerelateerde `emailOtp.ts`-werkboomchange (`emailCodeLogin.test.ts` mockt nog geen nieuwe `redis.eval`).

## 2026-07-21 22:50 — Contextvrije tweeweeksauditbevindingen hersteld

**User prompt (summary):** Pas alle bevindingen die zonder aanvullende product- of infrastructuurkeuzes oplosbaar zijn zelfstandig toe en stel pas daarna de resterende vragen.

**What I did:** dertien van de zeventien auditbevindingen gesloten: gecombineerde ORM-transities, cron-rejectiongrenzen en late `runOnStart`-registraties, atomische email-OTP-generaties, custom Redis-clientownership, router-responsestreamfouten, veilige Windows-scaffoldargumenten, pointer→plain secret-reload, frontend-gebaseerde relatieve OAuth-redirects, canonical telemetryvelden, de volledige-suite-timeout, fail-closed readiness en geserialiseerde TOTP-enrollment. De ontbrekende `redis.eval`-mock in de bestaande email-code-login tests is op de productie-Lua-semantiek aangesloten. Changelogs, packagecontractdocs en de findings-ledger zijn bijgewerkt.

**Files touched:** runtime/tests/docs in `packages/{cli,core,cron,devkit,error-tracking,login,router,secret-manager,server}/**`; `docs/findings/2026-07-21-two-week-codebase-review/README.md`; `docs/findings/README.md`; deze branch-log.

**Notes:** TW-06, TW-11, TW-15 en TW-17 blijven open omdat respectievelijk een user-gated install, trusted-proxybeleid, een cancellation/idempotencycontract en TOTP-keyringbeleid nodig zijn. De actuele audit groeide naar 7 advisories (3 high, 3 moderate, 1 low). Geen commit, merge, push of publish uitgevoerd; bestaande test-runner/ADR-0032-, lockfile-, AI-index- en `.claude/settings.local.json`-wijzigingen zijn behouden en niet als dit werk geclaimd.

**Verificatie:** gerichte regressies 198/198; volledige unit-suite 1892/1892; lint groen; build groen (17/17 packages + TypeScript/Vite/serverbundle); `ai:lint`, `ai:changelog-check`, `ai:doc-staleness` en `ai:index` groen. `npm audit --omit=dev --audit-level=low` blijft rood en is TW-06.

## 2026-07-21 23:47 — Resterende auditkeuzes uitgevoerd en test-runner-bootstrap gereviewd

**User prompt (summary):** Voer de dependency-install voor TW-06 uit, verduidelijk en herstel TW-11, keur TW-15/TW-17 goed en review specifiek de nieuwe test-runner env/secret-bootstrap op bugs.

**What I did:**
- TW-06: begrensde dependency-overrides plus lock-refresh toegepast; alle high/low advisories gesloten zonder SDK-downgrade of zwakkere publish-gate. Twee moderate, via stdio onbereikbare `@hono/node-server`-nodes blijven upstream-beperkt.
- TW-11: expliciete `routing.trustedProxyCidrs`-grens toegevoegd; HTTP en WebSocket accepteren HTTPS-forwarding alleen van een geconfigureerde directe proxy. Default is fail-closed.
- TW-15: adapters krijgen optioneel `AbortSignal` + stabiele idempotencykey; Resend gebruikt provider-native idempotency en timeout na dispatch rapporteert eerlijk `deliveryOutcome: 'unknown'`.
- TW-17: `enc:v2:<key-id>` plus primaire/legacy TOTP-keyring toegevoegd; geldige verificatie migreert plaintext, `gcm:` en oude v2-ciphertext lazy.
- Test-runner-review: `TR-ENV-01` gevonden en hersteld; beide publieke orchestrators vereisen de lazy configloader en weigeren ook bij ongetypeerde calls een ontbrekende loader. Direct `runCustomTests()` bootstrapt env/secrets, terwijl `runAllTests()` de voorbereide interne route gebruikt om resolved secrets niet met pointers te overschrijven.
- ADR's 0033–0035, findings-ledgers, changelogs, scaffold/CLI-pariteit, env-templates en package-docs bijgewerkt.

**Files touched:** dependencyoverrides/lockfile; router/core deploy-config en HTTP/WS forwarding; email/core adaptercontracten; login TOTP crypto/keyring; test-runner public/interne custom-testpaden; root/scaffold/CLI assets; docs/ADRs/findings/changelogs; env-templates.

**Notes:** geen commit, merge, push of publish. `.claude/settings.local.json` en ander parallel werk zijn niet aangepast of geclaimd. De ongetrackte lege `nul` blijft staan in afwachting van expliciete verwijdertoestemming.

**Verificatie:** follow-up regressies 148/148; volledige unit-suite 1907/1907; package/root lint groen; build en dry-pack groen (17/17); deep ORM/wire-gate groen op Node + Bun; exacte high-auditgate groen; MCP stdio-initialize smoke groen; low-audit toont alleen de twee gedocumenteerde moderate SDK-transitives.

## 2026-07-22 09:50 — v0.7.4 provenance-release voorbereid

**User prompt (summary):** Publiceer de afgeronde fixes als v0.7.4 via GitHub CLI.

**What I did:** alle 17 publishable packages en interne ranges lockstep naar 0.7.4 gezet; Unreleased-secties van de twaalf gewijzigde packages gedateerd; lockfile vernieuwd. Tijdens de laatste registry-audit verscheen een nieuwe high `sharp <0.35.0`/libvips-advisory; root en scaffold zijn naar `sharp ^0.35.3` gebracht en finding RA-01 is als fixed vastgelegd. De release blijft de twee bekende moderate, via de stdio-only MCP-route onbereikbare Hono-nodes documenteren.

**Files touched:** alle publishable `package.json`-versies; package-lock; twaalf changelogs; root/scaffold sharp-versie; `docs/findings/2026-07-22-v074-release-audit/`; findingsindex; deze branch-log.

**Notes:** `.claude/settings.local.json` en het losse `nul`-bestand zijn bewust uitgesloten van de releasecommit. Publicatie loopt via de tag-triggered GitHub Actions-workflow met npm provenance.

**Verificatie:** 1907/1907 unit-tests; lint groen; 17/17 builds en 17/17 dry-packs; high-auditgate groen; `sharp 0.35.3` image smoke groen; lockfile dry-run groen op npm 10.9.4, 11.6.1 en 12.0.1; deep ORM/wire-gates groen op Node + Bun; AI/changelog/doc-gates groen.
