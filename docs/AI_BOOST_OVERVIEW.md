# Why LuckyStack has AI context layers

The code answers structural questions; written memory answers intent and rationale. Mixing these into hand-maintained function tables produces a second, less reliable implementation description.

## The ownership split

- **Source and generated types** are authoritative for exports, configuration and execution.
- **Generated context** is a rebuildable local cache. Query the relevant route, capability or dependency instead of reading the whole corpus.
- **AGENTS.md** holds shared working rules; package instructions hold local design constraints.
- **Product intent** explains who the application is for.
- **Decisions, lessons and branch logs** preserve rationale, costly dead-ends and cross-session intent. Their capture bars deliberately exclude casual exploration.

Framework history must not masquerade as a consumer project's own memory. Consumers generate context for their app and keep their own records; framework guidance explains reusable design, not the reference app's current inventory.

## Keep retrieval proportionate

Start with source search and structured context queries. A semantic/vector retrieval layer is justified only after measured failures of the simpler approach; extra indexing complexity is not a remedy for stale context.

Refresh the cache with `npm run ai:refresh`. Use root `AGENTS.md` for lookup and capture policy, and the [framework eval rationale](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/eval/README.md) for measuring whether added context improves actual work. Tool names and signatures live in the query server, not a copied tool catalogue here.
