# Branch log — fix/boot-uuid-heartbeat

## 2026-07-22 22:49 — Boot-UUID blijft geldig tijdens langlevende server

**User prompt (summary):** Valideer en herstel de externe finding dat de boot-UUID na de standaard-TTL van één uur verloopt, waarna een gezonde server onterecht not-ready wordt.

**What I did:** de finding execution-path voor execution-path bevestigd: core schreef één `SET ... EX 3600`, server deed dat alleen tijdens constructie en `/readyz` vereist de key. Core heeft nu een environment-level refreshprimitive en een unref'd, zelfplannende heartbeat op TTL/3. De bestaande UUID wordt met `EXPIRE` verlengd zodat routervergelijkingen en `@bootUuid`-HMACs stabiel blijven; alleen een werkelijk verdwenen key wordt na Redis-herstel opnieuw aangemaakt. Refreshes overlappen nooit, fouten worden gelogd en later opnieuw geprobeerd. Server start de heartbeat pas nadat HTTP-listen echt slaagt en stopt hem vóór graceful shutdown. De onjuiste routerdocumentatie is gecorrigeerd.

**Files touched:** `packages/core/src/{bootUuid.ts,bootUuid.test.ts,index.ts}` plus core docs/changelog; `packages/server/src/{createServer.ts,bootUuidHeartbeatWiring.test.ts}` plus server docs/changelog; router boot-handshake-doc/changelog; `docs/ARCHITECTURE_PACKAGING.md`; finding-ledger `docs/findings/2026-07-22-boot-uuid-ttl-review/`; ADR 0036; gegenereerde AI-indexen; deze branch-log en `branch-logs/INDEX.md`.

**Notes:** BU-01 is HIGH en fixed. ADR 0036 legt vast waarom de TTL blijft, de UUID tijdens refresh stabiel blijft en iedere gezonde instance hem mag verlengen. Geen release uitgevoerd. `.claude/settings.local.json` en het ongetrackte `nul`-bestand zijn niet aangepast.

**Verificatie:** gerichte regressies 27/27; volledige unit-suite 1922/1922; root- en package-lint groen; volledige build groen (17/17 packages, TypeScript, Vite en serverbundle); `ai:lint`, changelog-, doc-staleness- en `git diff --check`-gates groen.

## 2026-07-23 08:08 — v0.7.6 release voorbereid

**User prompt (summary):** Merge de boot-UUID-fix naar main en publiceer hem via GitHub CI.

**What I did:** alle 17 publiceerbare packages en interne ranges lockstep naar 0.7.6 gezet, de lockfile met npm ververst, de drie gewijzigde packagechangelogs als 0.7.6 gedateerd en de capability-index op de nieuwe versie gebracht. De release gaat via een PR naar `main`; alleen de exacte groene main-commit krijgt daarna de immutable annotated tag `v0.7.6` die de provenance-workflow start.

**Files touched:** alle 17 package-manifests; `package-lock.json`; `docs/AI_CAPABILITIES.md`; changelogs van core/router/server; deze branch-log en `branch-logs/INDEX.md`.

**Notes:** de twee bekende moderate `@modelcontextprotocol/sdk -> @hono/node-server`-advisories blijven via het stdio-only MCP-pad onbereikbaar; de high-auditgate is groen. `.claude/settings.local.json` en `nul` blijven uitgesloten.

**Verificatie:** 1922/1922 unit-tests; root- en package-lint groen; volledige build 17/17 plus TypeScript/Vite/server groen; 17/17 dry-packs op 0.7.6; high-audit-, AI-, changelog-, doc-staleness- en diff-gates groen; alle 17 lockfile-workspaces staan op 0.7.6.

## 2026-07-23 08:40 — v0.7.6 via GitHub provenance gepubliceerd

**User prompt (summary):** Merge de huidige wijzigingen naar `main` en publiceer via GitHub CI.

**What I did:** release-PR #7 na groene Node 20/22-PR-CI gemerged. De aparte main-CI is vervolgens groen geworden op mergecommit `a2bdea777815c9d6cf512f78dc6fbf075260501e`. Pas daarna is een immutable annotated `v0.7.6`-tag op exact die commit gepusht; GitHub Actions heeft alle 17 packages met npm provenance gepubliceerd.

**Files touched:** alleen deze afsluitende branch-log en `branch-logs/INDEX.md`; de releasebron zelf blijft exact mergecommit `a2bdea7`.

**Notes:** annotated tagobject `6094bf242c6940903964446784199e24690ee04a` peelt naar `a2bdea7`. Publishrun: `https://github.com/ItsLucky23/LuckyStack-v2/actions/runs/29985018632`. De persoonlijke `.claude/settings.local.json` en `nul` zijn niet aangeraakt of gecommit.

**Verificatie:** PR-CI en main-CI groen op Node 20/22; publishworkflow groen; alle 17 npm-packages rapporteren 0.7.6 en een SLSA provenance-attestation.
