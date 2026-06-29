/**
 * Hook-based auto-instrumentation for @luckystack/error-tracking.
 *
 * Registers handlers on the core hook bus so the framework's API and sync
 * request handlers no longer need to import `setSentryUser` / `startSpan`
 * directly. The same wiring is shared by:
 *
 *   1. `initializeSentry()` — calls this internally so legacy projects that
 *      only flip the Sentry-init switch automatically get the new wiring.
 *   2. `enableErrorTrackingAutoInstrumentation()` — public export for
 *      adapter-only consumers (Datadog / PostHog / custom) that never call
 *      `initializeSentry()`.
 *
 * Idempotent: a module-scoped flag prevents double-registration when both
 * entry points fire during boot.
 */

import {
  registerHook,
  setCurrentErrorTrackerIdentity,
  startSpanHandle,
  type SpanHandle,
  type PreApiExecutePayload,
  type PostApiExecutePayload,
  type PreApiValidatePayload,
  type PreSyncAuthorizePayload,
  type PreSyncFanoutPayload,
  type PostSyncFanoutPayload,
} from '@luckystack/core';

//? Type-only import of `@luckystack/login` brings the `postLogout` hook
//? augmentation of `HookPayloads` into scope so TypeScript accepts the
//? `registerHook('postLogout', ...)` call below. Erased at compile time —
//? no runtime cycle. The build wave order (see `scripts/buildPackages.mjs`)
//? guarantees `login` is built before `error-tracking` so the `.d.ts` is
//? resolvable during the DTS emit step.
import type { PostLogoutPayload } from '@luckystack/login';

import { setSentryUser } from './sentry';

//? WeakMap-pinning so a span opened in `preApiExecute` can be closed in
//? `postApiExecute` without globals. Works because the framework handlers
//? (`packages/api/src/handleApiRequest.ts` + `handleHttpApiRequest.ts`,
//? `packages/sync/src/handleHttpSyncRequest.ts`) pass the SAME payload object
//? reference through both pre/post dispatches. If a future handler ever
//? clones the payload between the two, the span would leak — verify by
//? running the existing manual smoke tests in `packages/server/docs/`.
//? #62: spans are now core's delegating `SpanHandle` (`{ finish(), durationMs }`)
//? instead of the legacy raw Sentry span — so the request span reaches an
//? adapter-only backend (Datadog/PostHog/custom), not just the legacy Sentry SDK.
const apiSpans = new WeakMap<PreApiExecutePayload, SpanHandle>();
const syncSpans = new WeakMap<PreSyncFanoutPayload, SpanHandle>();

//? Identity propagation maps the same `user` shape from both the API and sync
//? pipelines into the error-tracker's user context (or `null` when anonymous).
//? Extracted so the two hooks below stay in lockstep.
type HookUser = { id?: string | null; email?: string | null; name?: string | null } | null | undefined;

const createSentryUserContext = (
  user: HookUser,
): { id: string; email?: string; username?: string } | null =>
  user?.id
    ? {
        id: user.id,
        email: user.email ?? undefined,
        username: user.name ?? undefined,
      }
    : null;

//? ET-02 identity propagation. PRIMARY: write the per-request AsyncLocalStorage
//? identity box (`setCurrentErrorTrackerIdentity`) — adapters read this at capture
//? time, isolated per concurrent request. FALLBACK: keep mutating the legacy
//? process-global Sentry scope (`setSentryUser`) so the legacy single-Sentry path
//? and any background/non-request capture (no active ALS box) still gets a user.
//? The request handlers also set the ALS box directly after `readSession`; this
//? hook write is idempotent with that and remains the canonical mapping point.
const propagateIdentity = (user: HookUser): void => {
  const context = createSentryUserContext(user);
  setCurrentErrorTrackerIdentity(context);
  setSentryUser(context);
};

let installed = false;

/**
 * Wire `@luckystack/error-tracking` into the core hook bus.
 *
 * Safe to call multiple times — the second call is a no-op. Called
 * automatically by `initializeSentry()`; adapter-only consumers (no Sentry
 * SDK) must call this explicitly after `registerErrorTracker(...)`.
 */
export const enableErrorTrackingAutoInstrumentation = (): void => {
  if (installed) return;
  installed = true;

  //? `preApiValidate` is the earliest API hook that carries `user`. Set
  //? identity here so handlers further down the pipeline (rate-limit + audit)
  //? already see the Sentry user context.
  registerHook('preApiValidate', (payload: PreApiValidatePayload): void => {
    propagateIdentity(payload.user);
  });

  //? Open a performance span around the handler. WeakMap keyed on the payload
  //? object — the framework reuses the same reference for `postApiExecute`.
  registerHook('preApiExecute', (payload: PreApiExecutePayload): void => {
    const op = payload.transport === 'http' ? 'api.request.http' : 'api.request';
    apiSpans.set(payload, startSpanHandle(payload.routeName, op));
  });

  registerHook('postApiExecute', (payload: PostApiExecutePayload): void => {
    apiSpans.get(payload)?.finish();
  });

  //? Sync identity propagation. `preSyncAuthorize` is the first sync hook
  //? that has the resolved session attached.
  registerHook('preSyncAuthorize', (payload: PreSyncAuthorizePayload): void => {
    propagateIdentity(payload.user);
  });

  //? Span lifecycle for sync. Socket fanout currently has no span op tag in
  //? the legacy implementation; HTTP fanout was `sync.request.http`. Preserve
  //? both behaviors — only open a span when transport is `http`.
  registerHook('preSyncFanout', (payload: PreSyncFanoutPayload): void => {
    if (payload.transport !== 'http') return;
    syncSpans.set(payload, startSpanHandle(payload.routeName, 'sync.request.http'));
  });

  registerHook('postSyncFanout', (payload: PostSyncFanoutPayload): void => {
    syncSpans.get(payload)?.finish();
  });

  //? Clear identity immediately on logout. Without this the next anonymous
  //? request from the same socket would still appear as the logged-out user
  //? in the error-tracker's context (until `preApiValidate` runs and resets
  //? it). One round-trip earlier is worth the small type-only import cost.
  registerHook('postLogout', (_payload: PostLogoutPayload): void => {
    setCurrentErrorTrackerIdentity(null);
    setSentryUser(null);
  });
};
