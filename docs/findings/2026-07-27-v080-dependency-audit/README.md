# v0.8.0 dependency audit — 2026-07-27

> Release-gate assessment of the 18 high-severity warnings observed in a clean generated scaffold and the framework root audit.

Last updated: 2026-07-27

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| 1 | PostCSS previous-source-map path traversal/file disclosure | HIGH | fixed | 2026-07-27 | 2026-07-27 | Root + scaffold now use `postcss ^8.5.23` (patched above 8.5.17). |
| 2 | `brace-expansion <=5.0.7` unbounded expansion DoS through lint tooling | HIGH | fixed | 2026-07-27 | 2026-07-27 | Root override moved all trees to `5.0.8`; lint/build/tests verify compatibility. |
| 3 | Latest React Router 7.18.1 remains flagged for an RSC action CSRF advisory | HIGH | wontfix | 2026-07-27 | 2026-07-27 | LuckyStack uses browser routing, not React Router RSC/actions. npm's suggested 7.11 downgrade predates fixes for several other router advisories, so latest 7.x is safer. Monitor upstream for a patched release. |
| 4 | MCP SDK 1.29.0 pins `@hono/node-server ^1.19.9`, flagged for Windows `serve-static` encoded-backslash traversal | MOD | wontfix | 2026-07-27 | 2026-07-27 | `@luckystack/mcp` is stdio-only and exposes no Hono HTTP/static server. Latest MCP SDK still pins 1.x; npm's forced downgrade to SDK 1.24.3 is not a security upgrade for LuckyStack's use case. Monitor upstream. |

## Result

The original clean-scaffold report collapsed multiple advisory paths into 18 high findings. Updating React Router to latest, PostCSS to 8.5.23, brace-expansion to 5.0.8 and refreshing the lockfile reduces the root audit to four reported paths: two accepted, non-reachable advisories above. No production LuckyStack HTTP path uses the vulnerable Hono static middleware or React Router RSC action transport.

Release policy: do not use `npm audit fix --force`; it would downgrade React Router/MCP SDK and trade current fixes/features for older trees. Re-check both accepted advisories on every release until upstream versions clear them.
