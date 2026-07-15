//? CLIENT-BUNDLE-SAFE config entry (`@luckystack/core/config`).
//?
//? A project's `config.ts` is imported by BOTH bundles: the server boots from it,
//? and Vite pulls it into the browser for `backendUrl`, theme, i18n defaults, etc.
//? Importing `registerProjectConfig` from the main barrel therefore drags the
//? whole server surface — ioredis included — into the client bundle. Measured on
//? this repo, clean cache: barrel = 10697 KB with ioredis present in a client
//? chunk; this entry = 10413 KB with none.
//?
//? So this entry re-exports ONLY the project-config registry and the pure types a
//? consumer config needs. It must never grow a transitive edge to redis, paths,
//? bootUuid, or anything else that touches Node built-ins — `projectConfig.ts`
//? itself only imports `configUtils` + `createRegistry`, both pure, and
//? `sessionTypes.ts` imports nothing at all. Keep it that way; the parity test
//? (`configEntry.test.ts`) fails the build if this entry ever reaches redis.
//?
//? tsup `splitting: true` means this entry SHARES the projectConfig chunk with
//? the main barrel, so a config registered through `@luckystack/core/config` is
//? visible via `getProjectConfig()` from `@luckystack/core`. One registry, two
//? doors. (That is also why `splitting` must stay on — see tsup.config.ts.)

export {
  registerProjectConfig,
  getProjectConfig,
  isProjectConfigRegistered,
  DEFAULT_PROJECT_CONFIG,
} from './projectConfig';

export type {
  ProjectConfig,
  ProjectConfigInput,
  LoggingConfig,
  RateLimitingConfig,
  SessionConfig,
  AppConfig,
} from './projectConfig';

export type { BaseSessionLayout, SessionLocation, AuthProps, Jsonify } from './sessionTypes';
