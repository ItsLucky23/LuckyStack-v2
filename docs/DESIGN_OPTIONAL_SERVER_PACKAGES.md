# Optional server packages — design

LuckyStack's server can start without every feature package installed. Requiring authentication, presence, email, docs or scheduling just to serve unrelated routes would couple deployment size and dependency risk to unused capabilities. The server discovers installed optional peers and lets them register before consumer overlays, so project customization remains the final writer. Package manifests are authoritative for peer status and ranges.

## Capability versus consumer files

A plain install is appropriate when a capability can register from a package. A feature that needs project-owned pages, route assets or configuration must also deliver editable consumer files through `luckystack add`; an installed library cannot safely replace those files. For supported additions, removals and current commands consult [`LUCKYSTACK_ADD_GUIDE.md`](./LUCKYSTACK_ADD_GUIDE.md) and [`UPGRADING.md`](./UPGRADING.md). Never silently delete edited login pages on removal.

Login's absence is not permission to omit CSRF protection: cookie-mode writes still need the appropriate stateless double-submit boundary when no session-backed provider exists. Secret-manager stays explicit because unresolved credentials demand a deliberate fail-closed choice. The router is a separate process, not an optional in-process route listener. See [HTTP](./ARCHITECTURE_HTTP.md), [secret manager](./ARCHITECTURE_SECRET_MANAGER.md), and [multi-instance](./ARCHITECTURE_MULTI_INSTANCE.md).

Current optional registration and behavior live in `packages/server/src/capabilities.ts` and the relevant package README; they are intentionally not mirrored as a hand-maintained capability table here.
