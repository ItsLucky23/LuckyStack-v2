# Routing architecture

LuckyStack derives page routes and typed API/sync routes from source placement rather than maintaining a second registration list. Development discovery and production generation must agree: otherwise a route can work locally and disappear from a deployment. The route conventions and generated types in `@luckystack/devkit` are authoritative.

## Structural invariants

- Page-only structural groups can be invisible in the URL. This lets source organization change without requiring a public URL change; it also means different source paths can collide at the same URL. Detect collisions before shipping rather than relying on router registration order.
- Framework-reserved/private folders must not become page routes. Route markers and versioned names distinguish callable handlers from helpers and tests. A path that looks similar to a marker is not authorization to expose its contents.
- Versioned API and sync routes let callers retain an explicit contract during an evolution. Do not quietly route an unknown page-scoped name to a different root handler; that can bypass the intended ownership or authorization boundary.
- Generated route and response types are derived from actual handler source. An incomplete generated map can briefly lag an edit in development; regenerate and inspect it rather than casting around missing entries. Empty-file scaffold injection is a starter, not a permanent specification.
- Per-page navigation guards explain denial to the user and keep a requested URL available when appropriate; they are a UI boundary, **not** a replacement for server-side auth on API or sync handlers. A denied resource whose existence is sensitive should not be disclosed by a friendly client redirect.
- The framework's logout route is matched by its whole route identity: matching only the last segment could hijack a consumer route with the same suffix.

For live filename rules, template names, middleware return types and routing examples, read `@luckystack/devkit`, `src/main.tsx`, and the relevant package README. See [API](./ARCHITECTURE_API.md), [sync](./ARCHITECTURE_SYNC.md), and [packaging](./ARCHITECTURE_PACKAGING.md).
