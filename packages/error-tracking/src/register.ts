//? Side-effect `./register` entry for @luckystack/error-tracking. Auto-imported
//? at boot by @luckystack/server's `bootstrapLuckyStack` when this package is
//? installed, so server-side error tracking wires itself with NO consumer code
//? edit — `npm i @luckystack/error-tracking` (+ the backend SDK) + env + restart.
//?
//? Two env-gated, independent sub-phases (each a safe no-op when its env/peer is
//? absent):
//?   1. Sentry — `initializeSentry()` reads SENTRY_DSN; no-op when unset. By
//?      default it only SENDS in production; set SENTRY_ENABLED=true for dev too.
//?      Requires the optional `@sentry/node` peer.
//?   2. PostHog — activates only when POSTHOG_KEY is set; requires the optional
//?      `posthog-node` peer. Runs ALONGSIDE Sentry (Sentry uses the legacy
//?      shared-DI slot; PostHog uses the error-tracker adapter registry).
//?
//? For Datadog, use the separate `--import @luckystack/error-tracking/datadog-preload`
//? mechanism (dd-trace must be the process's first import) — not this register.
//?
//? A consumer overlay (`luckystack/sentry/*.ts`) runs AFTER this import and can
//? register additional adapters via `registerErrorTracker(s)(...)`.

import { appendErrorTracker, getLogger, tryCatch } from '@luckystack/core';
import { initializeSentry } from './sentry';
import { createPostHogAdapter, type PostHogAdapterOptions } from './adapters/posthog';
import { getPostHogConfig } from './posthogConfig';

//? Sentry (env-gated no-op without SENTRY_DSN).
initializeSentry();

//? PostHog (env-gated on POSTHOG_KEY; optional `posthog-node` peer).
const posthogKey = process.env.POSTHOG_KEY;

if (posthogKey) {
  type PostHogClient = PostHogAdapterOptions['client'];

  //? Optional peer — string-variable specifier so an absent `posthog-node`
  //? doesn't become an unresolved static import.
  const lazyPostHog = (): Promise<{ PostHog: new (key: string, options?: { host?: string }) => PostHogClient }> => {
    const posthogModule = 'posthog-node';
    return import(posthogModule) as Promise<{ PostHog: new (key: string, options?: { host?: string }) => PostHogClient }>;
  };

  void (async () => {
    const [error, mod] = await tryCatch(lazyPostHog);
    if (error || !mod) {
      getLogger().error('[posthog] POSTHOG_KEY is set but `posthog-node` is not installed. Run `npm i posthog-node`.', { err: error });
      return;
    }
    //? Wrap client construction + adapter registration so a synchronous throw
    //? here (e.g. a malformed POSTHOG_HOST) is logged rather than rejecting the
    //? `void`-discarded promise and surfacing as an unhandled rejection.
    const [registerError] = await tryCatch(() => {
      //? ET-N1: read the consumer-registered PostHog config (anonymousDistinctId,
      //? beforeSend, clientOptions) so `registerPostHogConfig` is actually wired
      //? rather than being a dead surface. clientOptions.host wins over POSTHOG_HOST.
      const phConfig = getPostHogConfig();
      const host = phConfig.clientOptions?.host ?? process.env.POSTHOG_HOST;
      const clientOptions = host ? { ...phConfig.clientOptions, host } : phConfig.clientOptions;
      const client = new mod.PostHog(posthogKey, clientOptions);
      //? APPEND (not REPLACE): the legacy `registerErrorTracker` clobbers the whole
      //? active-tracker list, so an async PostHog auto-register could silently wipe a
      //? Sentry adapter (or a consumer overlay) already registered before this microtask
      //? resolves. `appendErrorTracker` accumulates and de-dupes by `name`, so the
      //? zero-config PostHog adapter coexists with whatever else is registered.
      appendErrorTracker(createPostHogAdapter({
        client,
        anonymousDistinctId: phConfig.anonymousDistinctId,
        beforeSend: phConfig.beforeSend,
      }));
    });
    if (registerError) {
      getLogger().error('[posthog] Failed to initialise the PostHog error tracker.', { err: registerError });
    }
  })();
}
