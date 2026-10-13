# Development runtime type resolution

The development resolver bridges extracted type text and imported aliases that cannot be validated structurally until expanded through the TypeScript Program. It is development-only; production uses generated runtime schemas and must not depend on source files or TypeScript compiler state. The resolver's result is advisory when a type cannot be expanded, not a reason to claim full validation.

Cycles and unsupported symbols must produce visible unresolved diagnostics rather than inventing a permissive shape. Cache entries depend on both the original source and its imports, so reloads invalidate the resolver cache together with the TypeScript Program. Whole-cache invalidation is simpler and safer than guessing which transitive alias changed. Treat results as ephemeral and inspect the current resolver source for exact supported utility types, return types and limits.
