//? Client-side hook bus. Counterpart to the server-side `registerHook` /
//? `dispatchHook` system in `hookRegistry.ts`, but lives here in the
//? browser-safe surface and listens for client-side lifecycle moments:
//? session login, session logout (and room for `sessionUpdate` later).
//?
//? Fired from `react/sessionContext.ts` when `setLatestSession` observes
//? a null → non-null (postLogin) or non-null → null (postLogout) transition.
//? That makes the fire-point framework-controlled — consumers don't have to
//? add their own useEffect in `SessionProvider` to detect these moments.
//?
//? Handlers are best-effort: errors are caught + logged but don't break the
//? session pipeline. Async handlers fire-and-forget; the caller of
//? `setLatestSession` does not await.
//?
//? Typical use:
//?   import { registerClientHook } from '@luckystack/core/client';
//?
//?   registerClientHook('postLogin', ({ session }) => {
//?     const letter = session.name?.[0]?.toLowerCase();
//?     if (letter) joinRoom(`letter-${letter}`);
//?   });
//?
//? Consumers with extended session shapes get narrow typing via the same
//? `BaseSessionLayout` module augmentation pattern the rest of the framework
//? uses (see ARCHITECTURE_EXTENSION_POINTS.md `@luckystack/login` section).

import type { BaseSessionLayout } from './sessionTypes';
import { getLogger } from './loggerRegistry';

export interface ClientHookPayloadMap {
  //? Fires BEFORE the framework commits a null → session transition.
  //? Handlers may return a `ClientHookStopSignal` to veto the login (e.g.
  //? account suspended since last visit, feature-flag gate, geo block).
  //? Only fires when the consumer commits the transition through the
  //? vetoable entry point — see `proposeLogin` in `react/sessionContext.ts`.
  preLogin: { candidateSession: BaseSessionLayout };
  postLogin: { session: BaseSessionLayout };
  postLogout: { previousSession: BaseSessionLayout };
  //? Fires when the offline queue drops a request (full queue with a
  //? `drop-oldest`/`drop-newest`/`reject` policy, or an item past `maxAgeMs`).
  //? The in-memory queue is not durable across refreshes; this is the seam to
  //? surface a "your change wasn't sent" toast or to persist the item
  //? elsewhere. `queue` says which queue, `reason` why it was dropped.
  queueItemDropped: {
    queue: 'api' | 'sync';
    key: string;
    reason: 'queue-full' | 'expired';
    dropPolicy: 'drop-oldest' | 'drop-newest' | 'reject';
  };
}

export type ClientHookName = keyof ClientHookPayloadMap;

//? Stop signal returned by a `pre*` client hook handler to veto the
//? framework's main flow. Mirrors the server-side `HookStopSignal` shape so
//? `errorCode` flows through the same i18n / responseNormalizer pipeline a
//? consumer already wires up.
export interface ClientHookStopSignal {
  stop: true;
  errorCode: string;
}

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- mirrors server-side HookResult, see hooks/types.ts
export type ClientHookResult = void | undefined | ClientHookStopSignal;

export type ClientDispatchResult =
  | { stopped: false }
  | { stopped: true; signal: ClientHookStopSignal };

export type ClientHookHandler<N extends ClientHookName> = (
  payload: ClientHookPayloadMap[N],
) => ClientHookResult | Promise<ClientHookResult>;

//? Storage uses `unknown` handler sets so the generic `N` doesn't have to
//? narrow at every access — the cast happens once at read/write inside the
//? typed wrappers below, which is sound because each hook name's Set only
//? ever sees handlers registered under that same name.
type AnyHandler = (payload: unknown) => ClientHookResult | Promise<ClientHookResult>;
const handlerSets: Partial<Record<ClientHookName, Set<AnyHandler>>> = {};

/**
 * Subscribe to a client-side lifecycle hook. Returns an unsubscribe function
 * — call it to remove the handler (e.g. inside a React effect cleanup).
 *
 * Multiple handlers can be registered for the same hook; they all fire on
 * each dispatch. A handler that throws (sync) or rejects (async) is logged
 * to `console.error` and does not affect other handlers.
 */
export function registerClientHook<N extends ClientHookName>(
  name: N,
  handler: ClientHookHandler<N>,
): () => void {
  const existing = handlerSets[name];
  const set = existing ?? new Set<AnyHandler>();
  if (!existing) handlerSets[name] = set;
  const wrapped = handler as AnyHandler;
  set.add(wrapped);
  return () => {
    set.delete(wrapped);
  };
}

/**
 * Fire a client-side hook (fire-and-forget). Framework-internal — consumers
 * should not call this directly. Used for `post*` hooks where any stop-signal
 * returned by a handler is intentionally ignored: a `postLogin` listener that
 * tried to "stop" the framework would be too late — the transition already
 * happened. Use `dispatchVetoableClientHook` for `pre*` hooks where the
 * caller actually awaits the veto decision.
 */
export function dispatchClientHook<N extends ClientHookName>(
  name: N,
  payload: ClientHookPayloadMap[N],
): void {
  const set = handlerSets[name];
  if (!set || set.size === 0) return;
  //? Snapshot the set before iterating so a handler that unregisters itself
  //? (or a sibling) mid-dispatch doesn't skip un-visited handlers — Set
  //? iteration honors mid-iter deletes per ECMAScript spec, which we don't
  //? want here.
  const handlers = [...set];
  for (const handler of handlers) {
    try {
      const result = handler(payload);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch((error: unknown) => {
          getLogger().error(`[clientHook:${name}] async handler rejected`, error);
        });
      }
    } catch (error) {
      getLogger().error(`[clientHook:${name}] handler threw`, error);
    }
  }
}

/**
 * Awaits every registered handler for a `pre*` client hook. If any handler
 * returns a `ClientHookStopSignal`, dispatch short-circuits and returns
 * `{ stopped: true, signal }`; callers must respect the veto (skip the
 * pending action). Handlers that throw or reject are logged but treated as
 * `undefined` — a buggy handler must not silently block the user flow.
 *
 * Mirrors `dispatchHook` from `@luckystack/core` so consumer/framework code
 * can use the same stop-signal pattern on both sides of the wire.
 */
export async function dispatchVetoableClientHook<N extends ClientHookName>(
  name: N,
  payload: ClientHookPayloadMap[N],
): Promise<ClientDispatchResult> {
  const set = handlerSets[name];
  if (!set || set.size === 0) return { stopped: false };
  //? Snapshot the set (see `dispatchClientHook` for why).
  const handlers = [...set];
  for (const handler of handlers) {
    let result: ClientHookResult;
    try {
      result = await handler(payload);
    } catch (error) {
      getLogger().error(`[clientHook:${name}] vetoable handler threw`, error);
      continue;
    }
    if (result?.stop) {
      return { stopped: true, signal: result };
    }
  }
  return { stopped: false };
}

/** Test helper — drop every registered handler. Not part of the public API. */
export function _resetClientHooksForTests(): void {
  for (const key of Object.keys(handlerSets) as ClientHookName[]) {
    handlerSets[key]?.clear();
  }
}
