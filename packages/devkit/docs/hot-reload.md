# Hot reload design

Development route loading serves requests from in-memory registries; regenerating editor-facing type artifacts should not block the Socket.io request path. File-event bursts are coalesced, and a generation already in progress gets a follow-up pass instead of competing builds. Deferring heavy work lets the server listen before the TypeScript Program is built. Consult the watcher source for event classification and timing rather than maintaining a second event-flow implementation here.

When a shared dependency changes, reload only affected routes rather than every route, but invalidate type caches so subsequent requests use fresh source. Generated outputs must not trigger their own watcher loops. Empty route files can receive starter templates; paired sync files should remain type-consistent. Preserve the distinction between runtime reload and generated developer artifacts: a generation failure can leave IDE hints stale without justifying a production-path dependency on devkit.

Production does not start these watchers. If the live registry appears stale, inspect watcher errors and route naming before relying on regenerated files as proof the running handler was replaced.
