//? Re-exports from @luckystack/core. The canonical definitions live there
//? (see packages/core/src/sessionTypes.ts) to break the core ↔ login type
//? dep cycle that would otherwise prevent core's per-package dts build.
//?
//? Existing imports from `@luckystack/login` continue to work via the
//? package barrel (./index.ts re-exports these names).

export type { BaseSessionLayout, SessionLocation, AuthProps } from '@luckystack/core';
