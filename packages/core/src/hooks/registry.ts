import type { HookName, HookPayloads, HookHandler, HookResult, HookStopSignal } from './types';

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
): void => {
  const existing = hookHandlers.get(name) ?? [];
  existing.push(handler as AnyHandler);
  hookHandlers.set(name, existing);
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
    } catch {
      // Isolated per hook — one failing handler never interrupts the main flow.
      continue;
    }

    if (result !== undefined) {
      return { stopped: true, signal: result };
    }
  }

  return { stopped: false };
};
