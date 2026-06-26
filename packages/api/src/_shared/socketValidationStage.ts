import type { BaseSessionLayout as SessionLayout } from '@luckystack/core';
import { dispatchHook, validateInputByType, getLogger } from '@luckystack/core';
import type { RuntimeApiEntry } from './apiTypes';
import { shouldLogDev } from './logFlags';
import { warnIfInputTypeMissing } from './inputTypeWarning';

//? SOCKET-transport input-validation stage. Extracted from `handleApiRequest`
//? per the `api` package audit (god-function decomposition). Behaviour is
//? identical to the former inline block:
//?   • resolves the per-route validation mode (`'relaxed'` / `{ input: 'skip' }`
//?     => skip Zod validation; default `'strict'`);
//?   • dispatches `preApiValidate`, runs `validateInputByType` in strict mode,
//?     then `postApiValidate` (always, including the relaxed skip path);
//?   • on validation failure emits the GENERIC `api.invalidInputType` (the raw
//?     validator message is NEVER echoed to the client — it only travels to the
//?     postApiValidate hook + dev logs) and returns `false`.
//? Error emission + per-request cleanup are delegated to the caller's closures
//? so the orchestrator keeps ownership of the abort/cleanup/emitError refs.

type EmitInvalidInputType = () => void | Promise<void>;

export const resolveValidationMode = (validation: RuntimeApiEntry['validation']): 'strict' | 'relaxed' => {
  if (!validation) return 'strict';
  //? FAIL CLOSED on an unrecognized value (parity with the sync transport's
  //? `resolveSyncValidationMode`). Only the exact string `'relaxed'` (or the
  //? object form `{ input: 'skip' }`) skips validation; ANY other value — a
  //? typo like `'Strict'`/`'on'` — falls back to `'strict'` (validate) rather
  //? than being returned verbatim and silently DISABLING validation.
  if (typeof validation === 'string') {
    return validation === 'relaxed' ? 'relaxed' : 'strict';
  }
  return validation.input === 'skip' ? 'relaxed' : 'strict';
};

export const runSocketApiValidation = async ({
  apiEntry,
  resolvedName,
  normalizedData,
  user,
  cleanupRequest,
  emitInvalidInputType,
}: {
  apiEntry: RuntimeApiEntry;
  resolvedName: string;
  normalizedData: Record<string, unknown>;
  user: SessionLayout | null;
  cleanupRequest: () => void;
  emitInvalidInputType: EmitInvalidInputType;
}): Promise<boolean> => {
  //? Per-route validation toggle. `'relaxed'` or `{ input: 'skip' }` skips
  //? runtime input validation entirely — useful for public webhooks (Stripe,
  //? Slack, GitHub) where the third party's payload shape isn't reasonable
  //? to model in TypeScript. Default `'strict'`.
  const validationMode = resolveValidationMode(apiEntry.validation);

  if (validationMode === 'strict') {
    warnIfInputTypeMissing(resolvedName, apiEntry.inputType);
  }
  await dispatchHook('preApiValidate', { routeName: resolvedName, data: normalizedData, user, transport: 'socket' });

  if (validationMode === 'strict') {
    const inputValidation = await validateInputByType({
      typeText: apiEntry.inputType,
      value: normalizedData,
      rootKey: 'data',
      filePath: apiEntry.inputTypeFilePath,
    });

    await dispatchHook('postApiValidate', {
      routeName: resolvedName,
      data: normalizedData,
      user,
      validation: inputValidation,
      transport: 'socket',
    });

    if (inputValidation.status === 'error') {
      //? SECURITY: do NOT echo the raw validator message (e.g.
      //? "data.userId should be string") back to the client — that lets an
      //? unauthenticated caller enumerate a route's input schema. The DETAILED
      //? message is routed to the `postApiValidate` hook above (and dev logs);
      //? the client only receives the generic `api.invalidInputType` code.
      if (shouldLogDev()) {
        getLogger().warn(`api: input validation failed for ${resolvedName}`, { route: resolvedName, message: inputValidation.message });
      }
      cleanupRequest();
      await emitInvalidInputType();
      return false;
    }
  } else {
    //? Relaxed: surface the skip via postApiValidate so audit handlers see it.
    await dispatchHook('postApiValidate', {
      routeName: resolvedName,
      data: normalizedData,
      user,
      validation: { status: 'success' },
      transport: 'socket',
    });
  }

  return true;
};
