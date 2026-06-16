import type {
  HookName,
  HookPayloads,
  HookHandler,
  HookResult,
  HookStopSignal,
  SyncHookHandler,
  SyncHookName,
  SyncHookPayloads,
} from './types';
import { captureException } from '../sentrySetup';
import { getLogger } from '../loggerRegistry';

export type DispatchResult =
  | { stopped: false }
  | { stopped: true; signal: HookStopSignal };

// Internal type — wider than the typed handlers but safe because register/dispatch
// use the same TName key to guarantee payload shape consistency.
type AnyHandler = (payload: unknown) => Promise<HookResult> | HookResult;

const hookHandlers = new Map<string, AnyHandler[]>();

export const registerHook = <TName extends HookName>(
  name: TName,
  handler: HookHandler<HookPayloads[TName]>,
): (() => void) => {
  const existing = hookHandlers.get(name) ?? [];
  const wrapped = handler as AnyHandler;
  existing.push(wrapped);
  hookHandlers.set(name, existing);
  //? Return an unsubscribe that splices THIS exact handler (matching
  //? `onClientHook`'s symmetry). Lets conditional plugins / per-tenant toggles /
  //? hot-reload detach a single handler without `clearAllHooks` nuking the
  //? framework-internal handlers too.
  return () => {
    const handlers = hookHandlers.get(name);
    if (!handlers) return;
    const index = handlers.indexOf(wrapped);
    if (index !== -1) handlers.splice(index, 1);
  };
};

export const dispatchHook = async <TName extends HookName>(
  name: TName,
  payload: HookPayloads[TName],
): Promise<DispatchResult> => {
  const handlers = hookHandlers.get(name) ?? [];

  for (const handler of handlers) {
    let result: HookResult;
    try {
      result = await handler(payload);
    } catch (error) {
      // Isolated per hook — one failing handler never interrupts the main flow,
      // but plugin failures must still be visible. Surface to logger + Sentry
      // so installers can spot bugs in their registered handlers.
      //? Wrap the reporter calls themselves (CORE-N10): if the logger or error
      //? tracker throws (misconfigured adapter, serialisation error), we must
      //? not propagate out of `dispatchHook` — that would surface as an
      //? unhandled rejection on the caller and undo the isolation guarantee.
      try { getLogger().error(`hook: handler for "${name}" threw`, error, { hook: name }); } catch { /* luckystack-allow: reporter must not break hook isolation */ }
      try { captureException(error, { hook: name }); } catch { /* luckystack-allow */ }
      continue;
    }

    if (result !== undefined) {
      return { stopped: true, signal: result };
    }
  }

  return { stopped: false };
};

//? Test-only: drop every registered hook handler. Used by the dev `/_test/reset`
//? endpoint when integration tests need a clean slate. Never call this from
//? production code paths — it would silently break framework-internal hooks
//? (presence post-logout cleanup, etc.).
export const clearAllHooks = (): void => {
  hookHandlers.clear();
  syncHookHandlers.clear();
};

// --- Synchronous hooks ---

type AnySyncHandler = (payload: unknown) => void;

const syncHookHandlers = new Map<string, AnySyncHandler[]>();

export const registerSyncHook = <TName extends SyncHookName>(
  name: TName,
  handler: SyncHookHandler<SyncHookPayloads[TName]>,
): (() => void) => {
  const existing = syncHookHandlers.get(name) ?? [];
  const wrapped = handler as AnySyncHandler;
  existing.push(wrapped);
  syncHookHandlers.set(name, existing);
  //? Returns an unsubscribe that splices THIS exact handler. See `registerHook`.
  return () => {
    const handlers = syncHookHandlers.get(name);
    if (!handlers) return;
    const index = handlers.indexOf(wrapped);
    if (index !== -1) handlers.splice(index, 1);
  };
};

export const dispatchSyncHook = <TName extends SyncHookName>(
  name: TName,
  payload: SyncHookPayloads[TName],
): void => {
  const handlers = syncHookHandlers.get(name) ?? [];
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch (error) {
      // Isolated per hook — one failing handler never interrupts the main flow.
      //? Same guard as the async hook path (CORE-N10).
      try { getLogger().error(`hook: sync handler for "${name}" threw`, error, { hook: name }); } catch { /* luckystack-allow */ }
      try { captureException(error, { hook: name }); } catch { /* luckystack-allow */ }
    }
  }
};
