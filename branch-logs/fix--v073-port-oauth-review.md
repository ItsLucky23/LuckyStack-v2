# Branch log — fix/v073-port-oauth-review

## 2026-07-21 18:20 — Alle v0.7.3 port/OAuth-reviewpunten opgelost

**User prompt:** los alle punten op.

**Wat ik deed:** alle elf bevindingen uit de v0.7.3 port/OAuth-review gesloten. De root- en scaffold-Vite-proxy muteren nu zowel Vite's request-clone als de originele http-proxy-opties, waardoor HTTP en directe WebSocket-upgrades een backend-hop echt volgen. De server bewaart intended + actually-bound adressen, gebruikt één canonieke environment-classificatie, leest `httpServer.address().port`, valideert de volledige poort-range en verwijdert de dev-portadvertentie alleen als de PID nog eigenaar is. OAuth herschrijft alleen een auto-derived directe loopbackcallback en respecteert een expliciete lokale router/reverse proxy; IPv6-loopback is inbegrepen. Testtarget-resolutie leeft nu gedeeld in `@luckystack/test-runner`, de scaffold gebruikt `ports.backend` als fallback, vier kapotte root-testscripts zijn gerepareerd en de relevante scripts/configs vallen onder typecheck. Root dogfood gebruikt `loadEnv` + `ports.frontend`. De huidige Vite 8-buildfout en productie-vconsolewaarschuwingen zijn eveneens gesloten.

**Files touched:** core bind-address/OAuth-helper + docs/tests; server listen/port-resolution/dev-server-info + docs/tests; test-runner live-base-url helper + docs/tests; root + scaffold Vite proxy/config/test scripts; findings-ledger; ADR 0031; generated AI-contextindexen.

**Notes:** gekozen beleid is vastgelegd in ADR 0031: intended → bound herschrijven voor directe loopback, expliciete lokale ingress behouden. Geen release of publish uitgevoerd. `.claude/settings.local.json` bleef onaangeraakt.

**Verificatie:** definitieve gates groen — 1867/1867 unit tests; lint + package-lint + ai:lint zonder bevindingen; 4/4 standalone testscripts parsen; 17/17 package builds; warning-vrije root client/server build; 17/17 package tarballs slagen in `pack:dry` en bevatten de nieuwe scaffold/helper-oppervlakken.
