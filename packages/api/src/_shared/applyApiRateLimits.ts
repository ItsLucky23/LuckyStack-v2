import type { BaseSessionLayout as SessionLayout } from '@luckystack/core';
import { checkRateLimit, getProjectConfig, dispatchHook, getLogger } from '@luckystack/core';
import { deriveTokenBucketId } from './rateLimitIdentity';
import { shouldLogDev } from './logFlags';

//? API-O8 — shared rate-limit apply helper for BOTH API transports (socket +
//? HTTP). Extracted so the two-bucket logic (per-route + global IP) stays in
//? one place; each transport resolves the effective IP before calling here.

export interface ApplyApiRateLimitsArgs {
  /** Effective client IP (already resolved by the caller's transport adapter). */
  resolvedIp: string;
  token: string | null;
  user: SessionLayout | null;
  resolvedName: string;
  rateLimit: number | false | undefined;
  transport: 'socket' | 'http';
  /**
   * When true, skip the global-IP (`ip:…:api:all`) bucket check. Used by the
   * HTTP transport to honour `rateLimiting.skipLoopbackInDev` for loopback
   * callers without duplicating bucket logic here. The socket transport never
   * sets this (loopback skip is HTTP-only).
   */
  skipGlobalIpBucket?: boolean;
}

export interface ApplyApiRateLimitsResult {
  /** True when all buckets allow the request; false when any bucket exceeded. */
  allowed: boolean;
  /** The error payload to emit when `allowed` is false. */
  errorCode?: string;
  resetIn?: number;
}

/**
 * Checks per-route + global-IP rate-limit buckets for an API request.
 * Returns `{ allowed: true }` when all buckets allow through, or
 * `{ allowed: false, errorCode, resetIn }` when any bucket is full.
 */
export const applyApiRateLimits = async ({
  resolvedIp,
  token,
  user,
  resolvedName,
  rateLimit,
  transport,
  skipGlobalIpBucket = false,
}: ApplyApiRateLimitsArgs): Promise<ApplyApiRateLimitsResult> => {
  const config = getProjectConfig();
  const effectiveApiLimit = rateLimit ?? config.rateLimiting.defaultApiLimit;

  if (effectiveApiLimit !== false && effectiveApiLimit > 0) {
    const identityCb = config.rateLimiting.identity;
    const customIdentity = identityCb?.({ routeName: resolvedName, userId: user?.id ?? null, ip: resolvedIp, transport }) ?? null;
    const requesterIdentity = customIdentity?.id ?? (token ? deriveTokenBucketId(token) : resolvedIp);
    const keyPrefix = customIdentity?.scope ?? (token ? 'token' : 'ip');
    const rateLimitKey = `${keyPrefix}:${requesterIdentity}:api:${resolvedName}`;

    const { allowed, resetIn } = await checkRateLimit({
      key: rateLimitKey,
      limit: effectiveApiLimit,
      windowMs: config.rateLimiting.windowMs,
    });

    if (!allowed) {
      //? The per-route bucket is keyed by the validated user when a token is
      //? present, else by the resolved IP (keyPrefix `ip`). Report the scope
      //? that matches the bucket's actual identity — an anonymous per-route
      //? bucket is IP-keyed, so it is `ip` (with `route` still set to mark it
      //? a per-route bucket vs the global `:api:all` IP bucket), never `route`.
      void dispatchHook('rateLimitExceeded', {
        scope: token ? 'user' : 'ip',
        key: rateLimitKey,
        limit: effectiveApiLimit,
        windowMs: config.rateLimiting.windowMs,
        count: effectiveApiLimit + 1,
        route: resolvedName,
        userId: user?.id,
        ip: token ? undefined : resolvedIp,
      });
      if (shouldLogDev()) {
        getLogger().warn(`api: rate limit exceeded for ${resolvedName}`, { route: resolvedName, key: rateLimitKey, transport });
      }
      return { allowed: false, errorCode: 'api.rateLimitExceeded', resetIn };
    }
  }

  const defaultIpLimit = config.rateLimiting.defaultIpLimit;
  if (!skipGlobalIpBucket && defaultIpLimit !== false && defaultIpLimit > 0) {
    const { allowed, resetIn } = await checkRateLimit({
      key: `ip:${resolvedIp}:api:all`,
      limit: defaultIpLimit,
      windowMs: config.rateLimiting.windowMs,
    });

    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        scope: 'ip',
        key: `ip:${resolvedIp}:api:all`,
        limit: defaultIpLimit,
        windowMs: config.rateLimiting.windowMs,
        count: defaultIpLimit + 1,
        ip: resolvedIp,
      });
      if (shouldLogDev()) {
        getLogger().warn(`api: global IP rate limit exceeded`, { ip: resolvedIp, transport });
      }
      return { allowed: false, errorCode: 'api.rateLimitExceeded', resetIn };
    }
  }

  return { allowed: true };
};
