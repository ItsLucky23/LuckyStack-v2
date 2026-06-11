import type { BaseSessionLayout as SessionLayout } from '@luckystack/core';
import { dispatchHook, validateInputByType, getLogger } from '@luckystack/core';
import { shouldLogDev } from './logFlags';
import { warnIfInputTypeMissing } from './inputTypeWarning';

//? HTTP-transport input-validation stage. Mirrors the socket variant
//? (`runSocketApiValidation`) for transport symmetry, extracted from
//? `runHandleHttpApiRequestInner` per the `api` package audit. Behaviour is
//? identical to the former inline block:
//?   • warns once if the route has no generated input type;
//?   • dispatches `preApiValidate`, runs `validateInputByType`, then
//?     `postApiValidate`;
//?   • on failure returns `{ ok: false }` (the caller builds the GENERIC
//?     `api.invalidInputType` network error — the raw validator message is
//?     NEVER echoed to the client; it only travels to the postApiValidate hook
//?     + dev logs).
//? NOTE: unlike the socket handler this stage always validates — the HTTP
//? transport does not honor `validation: 'relaxed'` / `{ input: 'skip' }`
//? (see the `api` audit; behaviour preserved verbatim, not changed here).

export const runHttpApiValidation = async ({
  resolvedName,
  inputType,
  inputTypeFilePath,
  requestData,
  user,
}: {
  resolvedName: string;
  inputType?: string;
  inputTypeFilePath?: string;
  requestData: Record<string, unknown>;
  user: SessionLayout | null;
}): Promise<{ ok: true } | { ok: false }> => {
  // Input-type validation (post-auth so unauthenticated probes don't get input-shape leaks)
  warnIfInputTypeMissing(resolvedName, inputType);
  await dispatchHook('preApiValidate', { routeName: resolvedName, data: requestData, user, transport: 'http' });

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
