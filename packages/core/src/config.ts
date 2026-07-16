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

//? The deploy + services registries belong here for the same two reasons as
//? projectConfig: `deploy.config.ts` is client-bundled too (its own comment says
//? so), and reaching for `./packages/core/src/...` instead splits into a separate
//? module instance under Bun — which is exactly why `npm run router` died on
//? "services config has not been registered" there while working on Node. Both
//? modules import only `createRegistry`, so they cost the browser nothing.
export {
  registerDeployConfig,
  getDeployConfig,
  isDeployConfigRegistered,
} from './deployConfigRegistry';

export {
  registerServicesConfig,
  getServicesConfig,
  isServicesConfigRegistered,
} from './servicesConfigRegistry';

//? A consumer `config.ts` reads env vars at MODULE LOAD, which is before
//? `resolveSecretsIfConfigured()` has overwritten `process.env` with the real
//? values — so any slot derived from a secret-manager pointer freezes as the
//? POINTER. That is not hypothetical: it is finding C-04 (2026-07-02), measured
//? live on 2026-07-16 — `http.cors.allowedOrigins` held `["ORIGINS_BASE_V1"]`
//? while `process.env.EXTERNAL_ORIGINS` already said `https://real.company.com`.
//?
//? Subscribing here lets `config.ts` re-register the env-derived slots the moment
//? secrets land, exactly as core's own `redis.ts` rebuilds its client (ADR 0026).
//? `secretsResolved.ts` imports NOTHING, so this costs the browser nothing and
//? cannot breach the entry's no-server-deps guarantee (`configEntry.test.ts`).
export {
  registerSecretsResolvedListener,
  notifySecretsResolved,
} from './secretsResolved';

export type { SecretsResolvedListener } from './secretsResolved';

export type {
  ProjectConfig,
  ProjectConfigInput,
  LoggingConfig,
  RateLimitingConfig,
  SessionConfig,
  AppConfig,
} from './projectConfig';

export type { BaseSessionLayout, SessionLocation, AuthProps, Jsonify } from './sessionTypes';
