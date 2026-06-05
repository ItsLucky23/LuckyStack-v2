//? PostHog error/analytics tracking — enable-later, no code edit. Auto-loaded at
//? boot (the `sentry` overlay slot is shared by every error-tracking adapter).
//? Activates only when POSTHOG_KEY is set; a no-op otherwise. Runs ALONGSIDE
//? Sentry (Sentry uses the legacy shared-DI slot, this uses the error-tracker
//? adapter registry).
//?
//? Enable it later:
//?   1. npm i posthog-node
//?   2. set POSTHOG_KEY (+ optional POSTHOG_HOST) in `.env.local`
//?   3. restart
//?
//? To register MULTIPLE adapters (e.g. PostHog + a custom one) use
//? `registerErrorTrackers([...])` instead of `registerErrorTracker(...)`.

import { getLogger, tryCatch } from '@luckystack/core';
import { createPostHogAdapter, registerErrorTracker, type PostHogAdapterOptions } from '@luckystack/error-tracking';

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
    const client = new mod.PostHog(posthogKey, { host: process.env.POSTHOG_HOST });
    registerErrorTracker(createPostHogAdapter({ client }));
  })();
}
