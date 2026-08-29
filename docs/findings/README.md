# Findings index

> Every AI scan / findings-set / analysis lives in a date-led subfolder here
> (`<YYYY-MM-DD>-<slug>/`), each with its own `README.md` status ledger. See
> `docs/FINDINGS_PROTOCOL.md` for the rules. This index lists them all so open
> items are never lost during a cleanup.

Last updated: 2026-08-21

| Date | Folder | Topic | Items | Rollup status |
| --- | --- | --- | --- | --- |
| 2026-08-17 | [2026-08-17-v084-release-security-audit/](./2026-08-17-v084-release-security-audit/) | v0.8.4 release dependency security audit | 8 | 8 fixed |
| 2026-08-16 | [2026-08-16-documentation-work-verification/](./2026-08-16-documentation-work-verification/) | Independent verification of documentation/runtime/consumer work | 8 | 7 fixed · 1 wontfix |
| 2026-08-16 | [2026-08-16-full-docs-disagreement-audit/](./2026-08-16-full-docs-disagreement-audit/) | Full active-documentation disagreement audit | 9 | 8 fixed · 1 false-positive |
| 2026-08-16 | [2026-08-16-package-contract-audit/](./2026-08-16-package-contract-audit/) | Package manifests versus package docs and session architecture | 4 | 1 duplicate · 3 fixed |
| 2026-08-16 | [2026-08-16-server-port-env-removal/](./2026-08-16-server-port-env-removal/) | Removal of the legacy backend-port env bridge | 4 | 0 open · 4 fixed |
| 2026-08-16 | [2026-08-16-oauth-scaffold-port-contract/](./2026-08-16-oauth-scaffold-port-contract/) | OAuth callback port versus consumer scaffold `config.ports.ts` contract | 4 | 0 open · 4 fixed |
| 2026-08-15 | [2026-08-15-ai-docs-audit/](./2026-08-15-ai-docs-audit/) | AI-context and documentation source-of-truth audit | 12 | 0 open · 12 fixed |
| 2026-08-14 | [2026-08-14-prod-function-map-divergence/](./2026-08-14-prod-function-map-divergence/) | Deployed `functions.sleep` undefined: production map generator ignored `shared/` and flattened nested keys (+ the e2e gate that hid it) | 11 | 0 open · 10 fixed · 1 false-positive |
| 2026-08-04 | [2026-08-04-keyv-cacheable-supply-chain/](./2026-08-04-keyv-cacheable-supply-chain/) | Exposure check for the active keyv/cacheable npm compromise — not exposed | 5 | 0 open · 5 false-positive |
| 2026-07-27 | [2026-07-27-composed-preset-function-collision/](./2026-07-27-composed-preset-function-collision/) | Browser acceptance: composed atomic presets rejected their shared function registry | 2 | 1 open · 1 fixed |
| 2026-07-27 | [2026-07-27-v080-dependency-audit/](./2026-07-27-v080-dependency-audit/) | v0.8.0 dependency audit: clean-scaffold and framework advisory assessment | 4 | 0 open · 1 fixed · 3 wontfix |
| 2026-07-27 | [2026-07-27-distributed-docker-framework-plan/](./2026-07-27-distributed-docker-framework-plan/) | Distributed Docker, shared infrastructure, local-preset fallback and horizontal-scaling framework plan | 11 | 6 open · 5 fixed |
| 2026-07-23 | [2026-07-23-typescript7-voidzero-feasibility/](./2026-07-23-typescript7-voidzero-feasibility/) | TypeScript 7 and VoidZero compatibility assessment | 7 | 6 open · 1 duplicate |
| 2026-07-22 | [2026-07-22-boot-uuid-ttl-review/](./2026-07-22-boot-uuid-ttl-review/) | External finding validation: boot UUID expiry made healthy long-running servers not-ready | 1 | 0 open · 1 fixed |
| 2026-07-22 | [2026-07-22-v074-release-audit/](./2026-07-22-v074-release-audit/) | v0.7.4 release audit: newly published sharp/libvips advisory | 1 | 0 open · 1 fixed |
| 2026-07-21 | [2026-07-21-test-runner-env-bootstrap-review/](./2026-07-21-test-runner-env-bootstrap-review/) | Review of ADR 0032 test-process env/secret bootstrap and direct Layer-5 path | 1 | 0 open · 1 fixed |
| 2026-07-21 | [2026-07-21-two-week-codebase-review/](./2026-07-21-two-week-codebase-review/) | Two-week change review + general correctness/security scan | 17 | 0 open · 17 fixed |
| 2026-07-21 | [2026-07-21-test-runner-secret-bootstrap/](./2026-07-21-test-runner-secret-bootstrap/) | External consumer diagnosis: test-process secret resolution before Layer-5 DB/Redis access | 1 | 0 open · 1 fixed |
| 2026-07-20 | [2026-07-20-v073-port-oauth-review/](./2026-07-20-v073-port-oauth-review/) | Release-blocking review of v0.7.3 port/OAuth/auto-increment flow and root/scaffold parity | 11 | 0 open · 11 fixed |
| 2026-07-16 | [2026-07-16-v070-ci-publish-readiness/](./2026-07-16-v070-ci-publish-readiness/) | v0.7.0 CI publication: cross-platform lock closure and provenance publish | 2 | 0 open · 2 fixed |
| 2026-07-16 | [2026-07-16-v070-npm-audit-readiness/](./2026-07-16-v070-npm-audit-readiness/) | v0.7.0 npm audit readiness: three moderate OpenTelemetry nodes + one low esbuild advisory | 2 | 0 open · 2 fixed |
| 2026-07-16 | [2026-07-16-v066-vitest-core-alias-handoff/](./2026-07-16-v066-vitest-core-alias-handoff/) | Validate v0.6.6 consumer handoff: Vite core alias breaks server-side Vitest imports | 2 | 0 open · 2 fixed |
| 2026-07-16 | [2026-07-16-v070-orm-runtime-readiness/](./2026-07-16-v070-orm-runtime-readiness/) | v0.7.0 evidence audit: Prisma/MikroORM/Drizzle × Node/Bun | 5 | 0 open · 4 fixed · 1 wontfix |
| 2026-07-16 | [2026-07-16-npm-vs-bun-benchmark/](./2026-07-16-npm-vs-bun-benchmark/) | npm+node vs Bun benchmark (runtime, HTTP, install) | — | analysis (no defects) — Bun 1.83× faster on realistic HTTP; install winner depends on clean vs repeat |
| 2026-07-16 | [2026-07-16-unpushed-branch-review/](./2026-07-16-unpushed-branch-review/) | Review of all unpushed commits + working-tree changes | 7 | 0 open · 7 fixed |
| 2026-07-15 | [2026-07-15-scaffold-e2e/](./2026-07-15-scaffold-e2e/) | Real-registry scaffold + install e2e (`npm run e2e:verdaccio`) | 1 | 0 open · 1 fixed |
| 2026-07-15 | [2026-07-15-type-generation/](./2026-07-15-type-generation/) | Wire-type lie + ORM degradation — **projection shipped, T1/T2/T11/T14 all closed** | 18 | 0 open · 11 fixed · 3 wontfix · 2 informational · 1 false-positive · 1 superseded |
| 2026-07-15 | [2026-07-15-bun-feasibility/](./2026-07-15-bun-feasibility/) | Bun runtime + PM + **router WS proxy** — runtime, PM, all 4 databases verified on both runtimes; router proxies WS on node, refuses on bun (upstream) | 22 | 0 open · 20 fixed · 1 wontfix · 1 mitigated |
| 2026-07-02 | [2026-07-02-security/](./2026-07-02-security/) | Security & correctness scan (10 agents, full codebase) | 13 | 0 open · 10 fixed · 3 wontfix |

> All release, runtime, audit, and CI publication findings currently listed here are terminal or
> explicitly tracked as open in their own ledger. The current published package line is 0.8.4.

<!--
Add a row per findings-folder, e.g.:
| 2026-07-14 | 2026-07-14-security/ | Security scan | 12 | 3 open · 9 fixed |
Rollup status = a quick tally (open / in-progress / terminal) from that folder's ledger.
-->
