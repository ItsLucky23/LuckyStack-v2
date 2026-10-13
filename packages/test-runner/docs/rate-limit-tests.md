# Rate-limit checks and reset safety

The rate-limit layer checks that eligible requests consume a bucket and that a later request is rejected. A request rejected earlier by auth or CSRF does not fill the limiter, so reporting a failed limiter after such a probe would be misleading. Establish authentication and CSRF conditions before interpreting rate-limit results; the runner source defines current response matching. Sync routes are checked too when the sweep receives the generated sync metadata, which carries their limits.

The test-reset route exists only for deliberate development/test environments and requires a non-empty matching token. Never expose it in production or assume an unset environment means safe access. Reset clears framework rate-limit and default session-related state, **not** application database rows or custom session stores; rows a sweep creates persist after its bookend resets.

## Scoped reset

An unscoped reset also deletes every default session, including the one an authenticated sweep runs on. The reset therefore accepts a target selector, and the runner's own resets (bookends and between rate-limit endpoints) always clear rate limits only (ADR 0064).

- An unknown or empty target is rejected rather than ignored: a typo must not silently reset nothing, or everything.
- The unscoped reset keeps its old meaning on purpose; CI setups that call it directly to log users out between suites keep working. A direct call without a selector still logs out every logged-in test.
- The valid targets are one shared list in `@luckystack/core`, read by both server and runner so they cannot drift; a new target is added there.

Isolate tests that reset state from concurrent authenticated sessions, and do not clear framework hooks in a long-running server or test process: boot-time registrations may not return until restart. See the server implementation for the current reset scope.
