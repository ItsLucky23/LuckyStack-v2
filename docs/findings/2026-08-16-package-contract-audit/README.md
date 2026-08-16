# Package contract documentation audit — 2026-08-16

> AI findings ledger. Scope: package manifests versus package README/CLAUDE dependency contracts, plus the shared session architecture documentation. Method: direct comparison of `package.json`, package docs, and runtime adapter/config code. Historical ADRs and installed consumer package docs were not changed.

Last updated: 2026-08-16

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---|---|---|---|---|---|
| PKG-01 | Core, API, sync, server, and login docs described optional `@prisma/client` peers as required; API/sync/server docs also had dependency lists that contradicted their manifests. | HIGH | fixed | 2026-08-16 | 2026-08-16 | Package docs now distinguish required and optional peers and use the current Zod range. |
| PKG-02 | `@luckystack/server` auto-detected the cron registration overlay and the project package matrix documented cron as a server optional, but the server manifest omitted the optional peer declaration. | MEDIUM | fixed | 2026-08-16 | 2026-08-16 | Added the optional `@luckystack/cron` peer and an Unreleased changelog note. |
| PKG-03 | `docs/ARCHITECTURE_SESSION.md` described Redis as the only session store, used pre-package-split config keys, and called the token a UUID; the runtime now has a swappable `SessionAdapter`, nested session config, and 64-character hex tokens. | HIGH | fixed | 2026-08-16 | 2026-08-16 | Reframed Redis as the default adapter, corrected the config/flow/security wording, and aligned auth/API references. |
| PKG-04 | Sentry-specific package docs remain intentionally Sentry-specific, but generic error-flow statements outside that dedicated integration surface need a separate wording pass to consistently say “registered error tracker(s)”. | LOW | duplicate | 2026-08-16 | 2026-08-16 | Tracked with the broader, calibrated scope as DOC-17 in `../2026-08-16-full-docs-disagreement-audit/README.md`. |

## Assessment

The manifests are the dependency source of truth. Package docs may explain a default (for example, Prisma user storage or Redis sessions), but must not present that default as a package requirement when `peerDependenciesMeta` marks it optional. The shared session architecture should describe the adapter contract first and the Redis key layout as a default-specific subsection.
