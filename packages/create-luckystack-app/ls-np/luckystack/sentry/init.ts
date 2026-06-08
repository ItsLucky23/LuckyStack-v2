//? Server-side error tracking — env-driven, auto-loaded at boot by
//? `bootstrapLuckyStack` (the `sentry` overlay slot). `initializeSentry()` is a
//? safe no-op when SENTRY_DSN is unset, so keeping this file in every project
//? costs nothing until you opt in.
//?
//? Enable it later WITHOUT touching code:
//?   1. `npm i @sentry/node`   (the SDK is an optional peer — not installed by default)
//?   2. set SENTRY_DSN in `.env.local` (dev) or `.env` (prod)
//?   3. restart the server
//?
//? By default Sentry only SENDS events in production; set SENTRY_ENABLED=true to
//? capture in dev too. For Datadog / PostHog / a custom backend instead, replace
//? this call with `registerErrorTracker(...)` — see
//? `node_modules/@luckystack/error-tracking/CLAUDE.md`.

import { initializeSentry } from '@luckystack/error-tracking';

initializeSentry();
