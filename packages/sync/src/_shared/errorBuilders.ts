//? Shared error-envelope builders for the sync transports. Both
//? `handleSyncRequest` (socket) and `handleHttpSyncRequest` (HTTP/SSE)
//? previously hand-rolled an identical `buildSyncError` closure that did
//? normalize → envelope → applyErrorFormatter, plus a duplicate
//? `ensureSyncErrorShape`. Centralizing them removes the duplication AND the
//? `as unknown as` double-casts: `applyErrorFormatter` is now generic over the
//? envelope type (see `@luckystack/core` errorFormatterRegistry), so a typed
//? envelope flows in and the SAME type flows out — no boundary cast required.

import {
  applyErrorFormatter,
  normalizeErrorResponse,
  type ErrorFormatter,
} from '@luckystack/core';
import type { SyncErrorEnvelopeInput } from './syncTypes';

//? The post-normalization envelope. `applyErrorFormatter` is generic over this
//? shape, so the formatted result keeps the same type — both sync handlers can
//? assign it directly to their `RuntimeErrorResponse` / `HttpSyncResponse`
//? return types without casting.
export interface FormattedSyncErrorEnvelope {
  status: 'error';
  message: string;
  errorCode: string;
  errorParams?: { key: string; value: string | number | boolean }[];
  httpStatus?: number;
  [key: string]: unknown;
}

export interface BuildFormattedErrorArgs {
  response: SyncErrorEnvelopeInput;
  preferred?: string | null;
  userLanguage?: string | null;
  routeName: string | undefined;
  transport: 'socket' | 'http';
  userId?: string | null;
  perRouteFormatter?: ErrorFormatter | undefined | null;
}

/**
 * Normalize an error envelope (i18n message + envelope shape), then run it
 * through the per-route → global → identity formatter chain. Transport
 * handlers pass the same logical inputs; only `transport`, `routeName`, and
 * the per-route formatter differ. Returns a typed, formatted error envelope.
 */
export const buildFormattedError = ({
  response,
  preferred,
  userLanguage,
  routeName,
  transport,
  userId,
  perRouteFormatter,
}: BuildFormattedErrorArgs): FormattedSyncErrorEnvelope => {
  const normalized = normalizeErrorResponse({
    response,
    preferredLocale: preferred,
    userLanguage,
  });

  const baseEnvelope: FormattedSyncErrorEnvelope = {
    status: 'error',
    message: normalized.message,
    errorCode: normalized.errorCode,
    errorParams: normalized.errorParams,
    httpStatus: normalized.httpStatus,
  };

  return applyErrorFormatter({
    response: baseEnvelope,
    routeName: routeName ?? 'sync/unknown',
    transport,
    userId,
    perRouteFormatter,
  });
};

/**
 * Guarantee a client-rejection envelope always carries a non-empty
 * `errorCode`, falling back to `sync.clientRejected`. Shared by both
 * transports' per-recipient `_client` error path.
 */
export const ensureSyncErrorShape = (
  response: SyncErrorEnvelopeInput,
): SyncErrorEnvelopeInput => {
  if (typeof response.errorCode === 'string' && response.errorCode.trim().length > 0) {
    return response;
  }
  return { ...response, errorCode: 'sync.clientRejected' };
};
