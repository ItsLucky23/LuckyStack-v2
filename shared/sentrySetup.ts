//? Intentional relative import — NOT `@luckystack/core`. Barrel-route would
//? pull in server-only deps (bootUuid -> node:crypto). Same rationale as
//? `shared/sleep.ts` + `shared/tryCatch.ts`.
export * from '../packages/core/src/sentrySetup';
