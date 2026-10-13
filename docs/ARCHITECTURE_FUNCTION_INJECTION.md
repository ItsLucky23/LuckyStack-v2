# Function injection architecture

API and sync handlers receive a typed `functions` object assembled from configured source roots at boot. This gives consumer-owned shims a place to customize dependencies while generated handler types describe the same surface the runtime loads. See `packages/devkit/src/typeMap/functionsMeta.ts` and `packages/devkit/src/loader.ts` for current extraction and loading rules.

## Why two ownership layers

Consumer functions can wrap or replace integrations without changing framework packages; shared framework helpers remain reusable without duplicating them in every consumer project. Keep one canonical source for each injected path. If two roots claim the same leaf, silently choosing one would make runtime behavior and generated types disagree, so generation fails on collisions rather than applying an implicit override.

Named exports and re-exports keep function types visible to the generator. A loosely inferred injected function defeats the point of typed handlers; when a generated type looks wrong, check its export form and regenerate rather than casting calls to `any`.

To add an injected function, place it in the appropriate consumer or shared root, export a type-visible function, regenerate artifacts, and check the resulting handler type. For the configurable roots and the current export forms, consult the devkit source and [devkit's design guide](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/packages/devkit/docs/type-map-generation.md). For the API and sync trust boundaries, see [API](./ARCHITECTURE_API.md) and [sync](./ARCHITECTURE_SYNC.md).
