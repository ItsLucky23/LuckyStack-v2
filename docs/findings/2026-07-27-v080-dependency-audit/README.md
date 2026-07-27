# v0.8.0 dependency audit — 2026-07-27

> Release-gate assessment of the 18 high-severity warnings observed in a clean generated scaffold and the framework root audit.

Last updated: 2026-07-27

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| 1 | PostCSS previous-source-map path traversal/file disclosure | HIGH | fixed | 2026-07-27 | 2026-07-27 | Root + scaffold now use `postcss ^8.5.23` (patched above 8.5.17). |
| 2 | `brace-expansion <=5.0.7` unbounded expansion DoS through optional lint tooling | HIGH | wontfix | 2026-07-27 | 2026-07-27 | No runtime path is reachable: the tree is `devOptional` only because core exposes an optional ESLint peer. Forcing minimatch 10 over CJS minimatch 3 consumers breaks Linux ESLint (`jsx-a11y`); the production gate omits dev + optional trees and the Linux lint gate verifies the compatible toolchain. Monitor plugin upgrades. |
| 3 | Latest React Router 7.18.1 remains flagged for an RSC action CSRF advisory | HIGH | wontfix | 2026-07-27 | 2026-07-27 | LuckyStack uses browser routing, not React Router RSC/actions. npm's suggested 7.11 downgrade reintroduces many high browser/SSR advisories. The fail-closed exact-advisory exception is governed by ADR 0041; monitor upstream. |
| 4 | MCP SDK 1.29.0 pins `@hono/node-server ^1.19.9`, flagged for Windows `serve-static` encoded-backslash traversal | MOD | wontfix | 2026-07-27 | 2026-07-27 | `@luckystack/mcp` is stdio-only and exposes no Hono HTTP/static server. Latest MCP SDK still pins 1.x; npm's forced downgrade to SDK 1.24.3 is not a security upgrade for LuckyStack's use case. Monitor upstream. |

## Result

The original clean-scaffold report collapsed multiple advisory paths into 18 high findings. Updating React Router to latest and PostCSS to 8.5.23, refreshing the lockfile and scoping the production audit to required dependencies reduces the release gate to four reported runtime paths: the two accepted, non-reachable advisories above. The brace-expansion report belongs only to the optional ESLint peer/tooling tree; no production LuckyStack HTTP path uses it, Hono static middleware or React Router RSC action transport.

Release policy: do not use `npm audit fix --force`; it would break the Linux lint toolchain or downgrade React Router/MCP SDK. `npm run audit:production` audits required non-dev dependencies, accepts only the exact reviewed React Router RSC advisory and fails on every additional high/critical finding. Linux lint remains a separate mandatory release gate. Re-check all accepted advisories on every release until upstream versions clear them.
