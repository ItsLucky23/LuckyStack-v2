# Development supervisor

A development supervisor restarts the child server when changes cannot safely be handled by live route reload alone. Keeping a small parent process separate from the running server allows a clean replacement without assuming that old module state is reusable. The watcher must coalesce rapid edits to avoid repeatedly starting partially-written code. See the supervisor source for exact state transitions, watched paths and timing.

Shutdown should release the child and watchers rather than leaving duplicate servers attached to the same port. This is development-only machinery; production orchestration belongs to the deployment platform. For route-only changes, prefer in-process hot reload to avoid unnecessary full-server restarts; see `hot-reload.md`.
