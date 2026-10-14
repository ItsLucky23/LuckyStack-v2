# LuckyStack Package Purposes

<!-- @covers packages -->

Choose an existing boundary before building the same capability in application code. This is a purpose map, not an export, version or dependency inventory. Exact requirements belong to each installed `package.json`; design constraints belong to package `AGENTS.md` and types/source are authoritative for usage.

| Need | Package | Why this boundary exists |
| --- | --- | --- |
| Shared framework contracts | `@luckystack/core` | Keep cross-package policy independent of application-owned implementations. |
| Host an application backend | `@luckystack/server` | Centralize the admission/security boundary rather than duplicating it per feature. |
| Typed request/response work | `@luckystack/api` | Keep business invocation independent of its transport. |
| Deliver realtime room events | `@luckystack/sync` | Separate authoritative execution from recipient-specific delivery. |
| Authentication and sessions | `@luckystack/login` | Reuse security policy while leaving user/session storage choices to the app. |
| Collaborative presence | `@luckystack/presence` | Treat transient connectivity as awareness, not durable user truth. |
| Transactional mail | `@luckystack/email` | Keep provider choice outside business workflows. |
| Error tracking | `@luckystack/error-tracking` | Separate observability adapters from application failure semantics. |
| Recurring background work | `@luckystack/cron` | Coordinate best-effort scheduling; jobs must tolerate repeat execution. It is not a durable retry queue. |
| Multi-service ingress | `@luckystack/router` | Separate service ownership and health from backend implementation. |
| Development discovery/generation | `@luckystack/devkit` | Derive types and maps from source instead of maintaining them twice. |
| Contract and business-flow testing | `@luckystack/test-runner` | Combine broad mechanical checks with app-owned postcondition assertions. |
| Development API exploration | `@luckystack/docs-ui` | Discover generated contracts without turning an explorer into production access policy. |
| External secret resolution | `@luckystack/secret-manager` | Keep committed references separate from real credentials and rotation ownership. |
| AI context queries | `@luckystack/mcp` | Retrieve relevant generated context rather than loading or hand-maintaining code inventories. |
| Evolve an existing app | `@luckystack/cli` | Preserve consumer ownership while adopting/refreshing framework-authored files. |
| Start a new app | `create-luckystack-app` | Resolve initial choices coherently rather than assembling a partial skeleton by hand. |

For a new project use `npx create-luckystack-app`; for an existing project inspect `npx luckystack list` and use [the adoption guide](LUCKYSTACK_ADD_GUIDE.md). Ask before installing a package. Do not infer prerequisites from this map or propose an unpublished placeholder as an available capability.
