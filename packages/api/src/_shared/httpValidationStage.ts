import type { BaseSessionLayout as SessionLayout } from '@luckystack/core';
import { dispatchHook, validateInputByType, getLogger } from '@luckystack/core';
import type { RuntimeApiEntry } from './apiTypes';
import { shouldLogDev } from './logFlags';
import { warnIfInputTypeMissing } from './inputTypeWarning';
import { resolveValidationMode } from './socketValidationStage';

//? HTTP-transport input-validation stage. Mirrors the socket variant
//? (`runSocketApiValidation`) for transport symmetry, extracted from
//? `runHandleHttpApiRequestInner` per the `api` package audit. Behaviour:
//?   • resolves the per-route validation mode (`'relaxed'` / `{ input: 'skip' }`
//?     => skip Zod validation; default `'strict'`) — identical to the socket
//?     stage, so a public webhook route (Stripe/Slack/GitHub) whose third-party
//?     payload can't be modeled in TS is reachable over HTTP, not just sockets;
//?   • warns once if a strict-mode route has no generated input type;
//?   • dispatches `preApiValidate`, runs `validateInputByType` in strict mode,
//?     then `postApiValidate` (always, including the relaxed skip path);
//?   • on failure returns `{ ok: false }` (the caller builds the GENERIC
//?     `api.invalidInputType` network error — the raw validator message is
//?     NEVER echoed to the client; it only travels to the postApiValidate hook
//?     + dev logs).

export const runHttpApiValidation = async ({
  resolvedName,
  inputType,
  inputTypeFilePath,
  requestData,
  user,
  validation,
}: {
  resolvedName: string;
  inputType?: string;
  inputTypeFilePath?: string;
  requestData: Record<string, unknown>;
  user: SessionLayout | null;
  validation: RuntimeApiEntry['validation'];
}): Promise<{ ok: true } | { ok: false }> => {
  //? Per-route validation toggle, honored identically to the socket stage.
  const validationMode = resolveValidationMode(validation);

  // Input-type validation (post-auth so unauthenticated probes don't get input-shape leaks)
  if (validationMode === 'strict') {
    warnIfInputTypeMissing(resolvedName, inputType);
  }
  await dispatchHook('preApiValidate', { routeName: resolvedName, data: requestData, user, transport: 'http' });

  if (validationMode === 'relaxed') {
    //? Relaxed: surface the skip via postApiValidate so audit handlers see it.
    await dispatchHook('postApiValidate', {
      routeName: resolvedName,
      data: requestData,
      user,
      validation: { status: 'success' },
      transport: 'http',
    });
    return { ok: true };
  }

  const inputValidation = await validateInputByType({
    typeText: inputType,
    value: requestData,
    rootKey: 'data',
    filePath: inputTypeFilePath,
  });

  await dispatchHook('postApiValidate', {
    routeName: resolvedName,
    data: requestData,
    user,
    validation: inputValidation,
    transport: 'http',
  });

  if (inputValidation.status === 'error') {
    //? SECURITY: do NOT echo the raw validator message (e.g.
    //? "data.userId should be string") back to the client — that lets an
    //? unauthenticated caller enumerate a route's input schema. The DETAILED
    //? message is routed to the `postApiValidate` hook + dev logs above; the
    //? client only receives the generic `api.invalidInputType` code.
    if (shouldLogDev()) {
      getLogger().warn(`http-api: input validation failed for ${resolvedName}`, { route: resolvedName, message: inputValidation.message, transport: 'http' });
    }
    return { ok: false };
  }

  return { ok: true };
};
