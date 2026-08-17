# Full documentation disagreement audit — 2026-08-16

> AI findings ledger. Scope: active framework docs, package READMEs/CLAUDE files, package deep docs, scaffold-facing docs, and cross-references. Historical ADRs, findings, lessons, and installed consumer `node_modules` docs are intentionally excluded from “current contract” fixes. Method: targeted search followed by source/runtime verification against route handlers, config types, adapters, and package manifests.

Last updated: 2026-08-17

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---|---|---|---|---|---|
| DOC-13 | Several active docs name the CSRF bootstrap endpoint `/csrf-token`, but the runtime route is `GET /auth/csrf`. Affected examples include `packages/server/README.md`, `packages/server/CLAUDE.md`, and the opening of `docs/HOSTING.md`; the same README contains both names. | HIGH | fixed | 2026-08-16 | 2026-08-17 | All active references now use `GET /auth/csrf`; historical records remain unchanged. |
| DOC-14 | `docs/ARCHITECTURE_API.md` and `docs/ARCHITECTURE_SOCKET.md` use the scaffold convenience name `sessionBasedToken` while describing the framework-level mode switch, whose canonical `ProjectConfig` path is `session.basedToken`. Historical ADR/finding references intentionally retain the old name. | MEDIUM | false-positive | 2026-08-16 | 2026-08-17 | `config.sessionBasedToken` is an intentional public consumer field, not a stale rename. Architecture/session/hosting docs now explicitly document its mapping to internal `ProjectConfig.session.basedToken`. |
| DOC-15 | CSRF coverage is under-described in two ways: `packages/server/docs/security-defaults.md` describes only session-bound CSRF, omitting the login-absent stateless double-submit path; `docs/ARCHITECTURE_HTTP.md` says custom paths outside `/api`, `/sync`, and `/auth/api` are not subject to CSRF, while runtime middleware also covers non-`/auth`/non-`/assets` state-changing custom routes unless origin-exempt. | HIGH | fixed | 2026-08-16 | 2026-08-17 | Documented both login/session-bound and login-absent cookie/header branches, custom-route coverage, exemptions, token issue, and configurable cookie/header options. |
| DOC-16 | `packages/login/docs/password-reset.md` documents raw reset tokens as Redis keys and an atomic `GET` + `DEL`, while current code stores only `sha256(token)` at rest through `issueOneTimeToken`, tracks a per-user pointer, and consumes through the shared primitive. | HIGH | fixed | 2026-08-16 | 2026-08-17 | Login/email/session docs now describe SHA-256-at-rest keys, prior-token invalidation, TTL-matched pointer, and shared atomic consumption. |
| DOC-17 | Generic error-flow docs still describe Sentry as the destination even though the active package supports Sentry, Datadog, PostHog, and custom/multiple trackers. Remaining examples include generic sections of `packages/error-tracking/README.md`, `packages/email/docs/*`, `packages/sync/docs/error-states.md`, scaffold examples, and `docs/DEVELOPER_GUIDE.md`. Dedicated Sentry APIs/integration docs remain valid and should stay explicitly Sentry-specific. | MEDIUM | fixed | 2026-08-16 | 2026-08-17 | Generic flows/examples now use registered-tracker terminology; the error-tracking README documents multi-tracker plus distinct Sentry/PostHog/Datadog boot paths. Dedicated Sentry compatibility docs remain vendor-specific. |
| DOC-18 | Several active docs link to the removed `.claude/CLAUDE.md` path (`packages/api/*`, `packages/login/CLAUDE.md`, `packages/sync/docs/*`). They also cite old rule 16 for the generated-typing/no-cast contract, which is now root `CLAUDE.md` rule 21. | MEDIUM | fixed | 2026-08-16 | 2026-08-17 | Links now target repository-root `CLAUDE.md`, cite rule 21, and direct inference failures to `npm run generateArtifacts`. |
| DOC-19 | `docs/ROADMAP.md` still lists the CSRF-header documentation as unfinished, although `packages/server/docs/security-defaults.md` and `http-routes.md` already reference `registerCsrfConfig()` and the configurable header. | LOW | fixed | 2026-08-16 | 2026-08-17 | Removed completed/misleading CSRF roadmap items. |
| DOC-20 | At least 16 package deep docs retain hand-written “Last updated/Bijgewerkt: 2026-05-20” dates despite later content commits. These dates now imply false freshness and are not maintained by the staleness generator. | MEDIUM | fixed | 2026-08-16 | 2026-08-17 | Removed the stale hand-written freshness dates; intentional dated historical/protocol examples remain. |
| DOC-21 | `/_test/reset` directly scans/deletes default Redis session and active-user keys, but its security docs do not state that sessions in a custom `SessionAdapter` are not cleared by that path. | MEDIUM | fixed | 2026-08-16 | 2026-08-17 | Server and test-runner docs now state exact gating and that custom adapters/application DB rows require project-owned cleanup. |

## Already corrected before this audit

- Removed the obsolete root `SESSION_STATE.md` workflow and replaced it with handoff/branch-log guidance.
- Rebuilt the packaging, optional-package, package-overview, hosting, and AI-boost documentation around current manifests/runtime behavior.
- Corrected Prisma/package counts, optional peers, error-tracker adapter wording in central docs, cron lease semantics, Bun/router status, links, and ADR numbering.
- Updated scaffold-bundled framework docs and the direct consumer `../Workspace` snapshots.
- Corrected server port/OAuth documentation and implementation to use the scaffold port registry without mutating `SERVER_PORT` as the default bridge.
- Corrected the main session architecture to describe `SessionAdapter`, Redis as default, nested session config, current token format, and current auth/API references.
- Added the optional `@luckystack/cron` peer to `@luckystack/server` and aligned package README/CLAUDE dependency claims with manifests.

## Deliberately not considered defects

- Historical ADRs, findings, lessons, branch logs, and old audit records may contain superseded terminology; changing them would damage the historical record.
- `packages/error-tracking/docs/sentry-integration.md` and other explicitly Sentry-named sections may remain Sentry-specific, provided generic caller-facing docs distinguish the legacy Sentry path from the adapter-neutral path.
- Installed package documentation in consumer `node_modules` is refreshed by the normal upgrade/install flow, not edited in place.
