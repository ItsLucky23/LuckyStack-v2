//? Intentional relative import — NOT `@luckystack/core`. The barrel re-exports
//? this module identically (no surface difference), but going through the
//? barrel would pull in `bootUuid` -> `node:crypto` and other server-only deps
//? which bloat the Vite client bundle. Same rationale as `shared/sleep.ts` +
//? `shared/tryCatch.ts`.
export * from '../packages/core/src/responseNormalizer';
