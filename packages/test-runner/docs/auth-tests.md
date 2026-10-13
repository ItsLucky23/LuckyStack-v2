# Auth enforcement tests

This layer deliberately calls protected endpoints **without credentials** to verify that the guard rejects an anonymous request. A rejection from validation or an unrelated handler is not evidence that authorization ran. Routes with additional role or scope predicates still need project-specific checks using authenticated lower-privilege users; anonymous tests alone cannot prove tenant isolation.

Sync routes are covered only when the sweep receives the generated sync metadata, which is also where their auth requirement is read from. Their probes travel over the project's sync transport, so the check exercises the same guard path a real client hits (ADR 0064). GET probes carry their sample payload in the query string like the real client (ADR 0062), so a GET result is not distorted by a payload that never arrived.

Do not add shared auth headers or a cookie to this sweep: that would defeat its purpose. Treat an unexpected rejection code as a security finding to investigate, not a reason to skip or loosen the assertion. Source and generated metadata define which endpoints participate and the expected response envelope; avoid copying a route-by-route inventory here.
