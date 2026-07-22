# Branch log — fix/boot-uuid-heartbeat

## 2026-07-22 22:49 — Boot-UUID blijft geldig tijdens langlevende server

**User prompt (summary):** Valideer en herstel de externe finding dat de boot-UUID na de standaard-TTL van één uur verloopt, waarna een gezonde server onterecht not-ready wordt.

**What I did:** de finding execution-path voor execution-path bevestigd: core schreef één `SET ... EX 3600`, server deed dat alleen tijdens constructie en `/readyz` vereist de key. Core heeft nu een environment-level refreshprimitive en een unref'd, zelfplannende heartbeat op TTL/3. De bestaande UUID wordt met `EXPIRE` verlengd zodat routervergelijkingen en `@bootUuid`-HMACs stabiel blijven; alleen een werkelijk verdwenen key wordt na Redis-herstel opnieuw aangemaakt. Refreshes overlappen nooit, fouten worden gelogd en later opnieuw geprobeerd. Server start de heartbeat pas nadat HTTP-listen echt slaagt en stopt hem vóór graceful shutdown. De onjuiste routerdocumentatie is gecorrigeerd.

**Files touched:** `packages/core/src/{bootUuid.ts,bootUuid.test.ts,index.ts}` plus core docs/changelog; `packages/server/src/{createServer.ts,bootUuidHeartbeatWiring.test.ts}` plus server docs/changelog; router boot-handshake-doc/changelog; `docs/ARCHITECTURE_PACKAGING.md`; finding-ledger `docs/findings/2026-07-22-boot-uuid-ttl-review/`; ADR 0036; gegenereerde AI-indexen; deze branch-log en `branch-logs/INDEX.md`.

**Notes:** BU-01 is HIGH en fixed. ADR 0036 legt vast waarom de TTL blijft, de UUID tijdens refresh stabiel blijft en iedere gezonde instance hem mag verlengen. Geen release uitgevoerd. `.claude/settings.local.json` en het ongetrackte `nul`-bestand zijn niet aangepast.

**Verificatie:** gerichte regressies 27/27; volledige unit-suite 1922/1922; root- en package-lint groen; volledige build groen (17/17 packages, TypeScript, Vite en serverbundle); `ai:lint`, changelog-, doc-staleness- en `git diff --check`-gates groen.
