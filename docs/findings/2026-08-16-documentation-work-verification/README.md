# Documentation-work verification — 2026-08-16

> Independent verification of commits `f830e0f`, `680b439`, `30bb2a3`, and consumer commit `a06b00d` against current source, manifests, lockfiles, generated artifacts, tests, and `../Workspace`. This verifies both the prior “already corrected” claims and the nine remaining documentation findings. Historical records and installed consumer `node_modules` documentation were read only where needed for version comparison and were not edited.

Last updated: 2026-08-16

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---|---|---|---|---|---|
| VFY-01 | The root `README.md` was not brought into line with the corrected central docs. It still says Prisma 6.5, TypeScript 5.7, all 13 workspaces are publishable, sessions/DB/error tracking are Redis/Prisma/Sentry-only, and the scaffold writes about 30 files. The repository has 16 published `@luckystack/*` packages plus `create-luckystack-app`, TypeScript 6, Prisma 6.19, pluggable data/session/error-tracker adapters, and a substantially larger template. | HIGH | open | 2026-08-16 | — | The prior claim that package counts and generic adapter wording were corrected was true for selected docs, not repository-wide. |
| VFY-02 | The package-contract audit was incomplete. Remaining manifest/doc contradictions include: `packages/core/CLAUDE.md` lists optional Prisma under “Required”; `packages/devkit/CLAUDE.md` calls optional Prisma required; `packages/presence/README.md` pins stale `@luckystack/login@^0.2.7` and presents optional peers as unconditional install requirements; `packages/test-runner/CLAUDE.md` pins core `^0.1.0` and secret-manager `^0.7.3`; and `docs/PACKAGE_OVERVIEW.md` calls Presence's optional `socket.io` peer required. | HIGH | open | 2026-08-16 | — | Manifests remain authoritative. Also correct the test-runner text that describes `/_test/reset` as merely non-production instead of exact development/test gating. |
| VFY-03 | `packages/server/package.json` declares optional `@luckystack/cron`, but the `packages/server` entry in `package-lock.json` omits both the peer and `peerDependenciesMeta` entry. | HIGH | open | 2026-08-16 | — | Reconcile with the package manager before release; do not hand-edit lock metadata. |
| VFY-04 | The create-app deep docs were not included in the effective scaffold-contract refresh. `packages/create-luckystack-app/docs/scaffold-flow.md` still describes six prompts, silently ignored flags, no `--key=value` flags, and unconditional npm/Prisma post-processing. `cli-flags.md` omits `--orm` and `--pm`; `template-variables.md` remains Prisma-centric and carries stale source line references. | HIGH | open | 2026-08-16 | — | `packages/create-luckystack-app/src/index.ts`, tests, README, and CLAUDE are the current sources of truth. |
| VFY-05 | `docs/HOSTING.md` still presents Prisma as LuckyStack's only ORM and Redis specifically as the session store, despite the scaffold supporting Prisma, Drizzle, MikroORM, or no ORM and login supporting custom session adapters. The deployment examples may remain Prisma-specific, but the prerequisite/overview must label Prisma and Redis sessions as defaults. | MEDIUM | open | 2026-08-16 | — | This is separate from the valid Bun/port corrections already made in the same file. |
| VFY-06 | Consumer commit `a06b00d` is cleanly documentation-only and did not modify `node_modules`, but its copied `HOSTING.md` is already one port-contract revision behind root after `680b439`. In addition, `../Workspace` runs published `0.8.3` packages while this checkout has only `0.7.6` manifests/changelogs/tags; this checkout therefore cannot independently prove version-aligned consumer snapshots for 0.8.3. | MEDIUM | open | 2026-08-16 | — | Root-vs-consumer diff is one stale `SERVER_PORT` paragraph today. Resolve package/tag provenance separately before treating the consumer copy as release-aligned. |
| VFY-07 | Seven changed packages have no `[Unreleased]` changelog entry according to `npm run ai:changelog-check`: api, cli, cron, email, login, router, and sync. | MEDIUM | open | 2026-08-16 | — | Report-only today, but a release-readiness gap under the documented upgrade contract. |
| VFY-08 | Commit `f830e0f` is not a documentation-only commit despite its message: it includes runtime/config/test changes across core, server, router, scaffold, and the sample app. The current combined state is mechanically healthy, but the commit boundary makes the prior “documentation changes” summary incomplete. | LOW | wontfix | 2026-08-16 | 2026-08-16 | Historical commit cannot be rewritten safely now. Current verification: lint clean, 1,945/1,945 unit tests pass, full build 17/17 packages, TypeScript/Vite/server bundles pass. |

## Verification of the prior nine open findings

| Existing finding | Verdict | Verification |
|---|---|---|
| DOC-13 | Confirmed | Active server/hosting docs still name `/csrf-token`; runtime matches only `/auth/csrf`. |
| DOC-14 | Partially confirmed | Architecture docs should use `session.basedToken` when discussing `ProjectConfig`; `HOSTING.md` is valid in naming the scaffold's deliberate `config.ts` convenience property `sessionBasedToken`. |
| DOC-15 | Confirmed | Middleware covers login-absent double-submit CSRF and eligible custom routes; both security docs under-describe this. |
| DOC-16 | Confirmed | Current password-reset code stores only the SHA-256 token key, invalidates the prior per-user token, and consumes via the one-time-token primitive; the deep doc shows the old raw-token layout. |
| DOC-17 / PKG-04 | Confirmed with scope correction | Dedicated Sentry APIs/docs remain valid; generic caller-flow text and generic quickstarts should use registered tracker terminology. PKG-04 is a duplicate of DOC-17. |
| DOC-18 | Confirmed and broader | Links target a removed path, and several references also point to old rule 16; the current generated-typing/cast rule is rule 21. |
| DOC-19 | Confirmed | The roadmap item is already implemented/documented. |
| DOC-20 | Confirmed | At least 16 package deep docs carry a manually stale 2026-05-20 date. |
| DOC-21 | Partially confirmed | The `/_test/reset` caveat is real. `getAllSessions()` already documents optional `listAll` and graceful degradation correctly; password-reset Redis storage is a separate intentional subsystem, with only its token-layout description stale under DOC-16. |

## Claims verified as correct

- `SESSION_STATE.md` is gone from the active root workflow; handoffs and branch logs are the current paths.
- Packaging and optional-package architecture were substantially improved and no longer contain the old implementation-log wall of text.
- The central package count, Prisma 6.19 project snapshot, ADR numbering, cron best-effort lease semantics, Bun/router boundary, central session-adapter architecture, and central multi-tracker wording are correct.
- ADR numbers are unique and the generated indexes are current.
- The framework-doc bundle regenerates successfully from all 5/5 source groups and remains gitignored.
- `../Workspace` commit `a06b00d` changes only documentation/context artifacts and branch logs; its worktree is clean, `ai:lint` passes, and all 12 wired docs pass the staleness check.

## Commands rerun

- `npm run lint`
- `npm run lint:packages`
- `npm run ai:lint`
- `npm run test:unit` — 183 files, 1,945 tests passed
- `npm run build` — 17/17 packages plus generated artifacts, TypeScript, Vite, and server bundle passed
- `npm run ai:doc-staleness` — 8/8 wired docs within threshold
- `npm run ai:changelog-check` — seven report-only gaps listed above
- `node packages/create-luckystack-app/scripts/bundleFrameworkDocs.mjs` — 5/5 sources bundled
- Workspace `ai:lint`, `ai:doc-staleness`, and `git diff --check` — passed

Passing `ai:doc-staleness` proves commit proximity, not semantic correctness; the open issues above are concrete examples of content that can remain wrong after a recently touched doc resets the staleness baseline.
