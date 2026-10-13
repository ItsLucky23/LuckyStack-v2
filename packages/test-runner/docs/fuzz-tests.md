# Crash-resistance fuzz tests

This slow layer deliberately sends malformed inputs to exercise error shaping and server survival; run it in a scheduled/nightly job rather than making every pull request wait for it. Its success criterion is a reachable server with a valid framework response envelope. **A shaped HTTP 5xx can pass**: this layer does not assert the absence of internal errors. Investigate 5xx rates separately.

In an authenticated sweep, state-changing routes are reported as skipped so junk bodies cannot mutate the test database. Every sync route counts as state-changing, so an authenticated sweep does not fuzz sync routes at all; an anonymous sweep does. GET probes carry the junk payload in the query string like the real client (ADR 0062).

A rejected unauthenticated request does not prove protected handler input was fuzzed; create authenticated, project-specific tests where necessary. Keep test traffic away from production and avoid payloads that trigger irreversible side effects. The fuzz source defines the actual probe catalogue; do not duplicate it as a static list here.
