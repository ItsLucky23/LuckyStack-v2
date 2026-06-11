import type { BaseSessionLayout as SessionLayout } from '@luckystack/core';
import { defaultHttpStatusForResponse, normalizeErrorResponse, getLogger } from '@luckystack/core';
import { shouldLogDev } from './logFlags';
import type { ApiResponseEnvelope, RuntimeApiResponse } from './apiTypes';

//? CC-6 — shared response-envelope assembly used by both API transports.
//? Turns the `(error, result)` pair from the handler into the final wire
//? envelope: localized error shapes (via `normalizeErrorResponse`) for
//? failures/empty/invalid responses, or a success envelope with an inferred
//? default HTTP status. Previously duplicated between `handleApiRequest`'s
//? `buildApiResponseEnvelope` and `handleHttpApiRequest`'s inline assembly.

export const normalizeApiResponse = ({
  resolvedName,
  error,
  result,
  preferredLocale,
  user,
}: {
  resolvedName: string;
  error: Error | null;
  result: RuntimeApiResponse | undefined | null;
  preferredLocale: string | null | undefined;
  user: SessionLayout | null;
}): ApiResponseEnvelope => {
  if (error) {
    if (shouldLogDev()) {
      getLogger().error(`api: error in ${resolvedName}`, error, { route: resolvedName });
    }
    return {
      ...normalizeErrorResponse({
        response: { status: 'error', errorCode: 'api.internalServerError' },
        preferredLocale,
        userLanguage: user?.language,
        fallbackHttpStatus: 500,
      }),
    };
  }

  if (result === undefined || result === null) {
    if (shouldLogDev()) {
      getLogger().warn(`api: ${resolvedName} returned nothing`);
    }
    return {
      ...normalizeErrorResponse({
        response: { status: 'error', errorCode: 'api.emptyResponse' },
        preferredLocale,
        userLanguage: user?.language,
        fallbackHttpStatus: 500,
      }),
    };
  }

  if (shouldLogDev()) {
    getLogger().debug(`api: ${resolvedName} completed`);
  }

  //? Runtime guard: a handler is user code and can return a status outside the
  //? typed 'success' | 'error' union despite the RuntimeApiResponse type.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive against malformed handler return at runtime
  if (result.status !== 'success' && result.status !== 'error') {
    return {
      ...normalizeErrorResponse({
        response: { status: 'error', errorCode: 'api.invalidResponseStatus' },
        preferredLocale,
        userLanguage: user?.language,
        fallbackHttpStatus: 500,
      }),
    };
  }

  if (result.status === 'error') {
    return {
      ...normalizeErrorResponse({
        response: result,
        preferredLocale,
        userLanguage: user?.language,
        fallbackHttpStatus: defaultHttpStatusForResponse({
          status: 'error',
          explicitHttpStatus: typeof result.httpStatus === 'number' ? result.httpStatus : undefined,
        }),
      }),
    };
  }

  return {
    ...result,
    status: 'success',
    httpStatus: defaultHttpStatusForResponse({
      status: 'success',
      explicitHttpStatus: typeof result.httpStatus === 'number' ? result.httpStatus : undefined,
    }),
  };
};
