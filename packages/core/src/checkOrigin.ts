/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions */

import { getProjectConfig } from './projectConfig';
import { getLogger } from './loggerRegistry';
import { dispatchHook } from './hooks/registry';
import { getBindAddress } from './bindAddress';

const normalizeOrigin = ({ value, secure }: { value: string; secure: boolean }): string => {
  const trimmedValue = value.trim().toLowerCase();
  if (!trimmedValue) { return ''; }

  const withProtocol = trimmedValue.startsWith('http://') || trimmedValue.startsWith('https://')
    ? trimmedValue
    : `http${secure ? 's' : ''}://${trimmedValue}`;

  // Keep only scheme + host[:port] so paths, query params, and fragments don't affect allowlist checks.
  const extractedOrigin = (/^(https?:\/\/[^/?#]+)/.exec(withProtocol))?.[1] || '';
  if (!extractedOrigin) { return ''; }

  return extractedOrigin
    // Treat explicit :80 as equivalent to implicit default http port.
    .replace(/^http:\/\/(.+):80$/i, 'http://$1')
    // Treat explicit :443 as equivalent to implicit default https port.
    .replace(/^https:\/\/(.+):443$/i, 'https://$1');
};

const isLocalhostOrigin = (normalized: string): boolean => {
  return /^https?:\/\/localhost(:\d+)?$/i.test(normalized);
};

const allowedOrigin = (origin: string): boolean => {
  const secure = process.env.SECURE === 'true';
  const cors = getProjectConfig().http.cors;

  //? Project-supplied origins live in `ProjectConfig.http.cors.allowedOrigins`.
  //? Two modes: static array OR synchronous resolver function. The resolver
  //? form lets consumers do per-tenant / per-time-window allow-listing
  //? without restarting; it must be sync because Socket.io's CORS check is sync.
  const configured = cors.allowedOrigins ?? [];

  //? Bind address comes from the registry (populated by `createLuckyStackServer`
  //? from `options.ip`/`options.port`). Falls back to `SERVER_IP`/`SERVER_PORT`
  //? env vars for legacy boots that don't go through the helper. Empty `port`
  //? produces an unmatchable `host:` entry which is fine — same-origin requests
  //? are typically allowed via `cors.allowLocalhost` or the configured
  //? `allowedOrigins` list anyway.
  const { ip: bindIp, port: bindPort } = getBindAddress();
  const location = bindPort
    ? `http${secure ? 's' : ''}://${bindIp}:${bindPort}`
    : `http${secure ? 's' : ''}://${bindIp}`;
  const normalizedOrigin = normalizeOrigin({ value: origin, secure });

  if (cors.allowLocalhost && normalizedOrigin && isLocalhostOrigin(normalizedOrigin)) {
    return true;
  }

  //? Resolver-function mode: defer entirely to the consumer's logic. The
  //? framework still keeps the same-origin bind address always-allowed.
  if (typeof configured === 'function') {
    if (normalizedOrigin === location) return true;
    if (configured(origin)) return true;
    // Fall through to the rejection path below.
  } else {
    const normalizedAllowedOrigins = new Set(
      [location, ...configured]
        .map((value) => normalizeOrigin({ value, secure }))
        .filter(Boolean)
    );

    if (normalizedOrigin && normalizedAllowedOrigins.has(normalizedOrigin)) {
      return true;
    }
  }

  //? Gated behind `devLogs` to avoid amplifying CORS-rejection traffic into
  //? production logs (an attacker could spam invalid origins otherwise). The
  //? structured `corsRejected` hook is the durable signal for production —
  //? subscribe via `registerHook('corsRejected', ...)` for audit/alerting.
  const debugAllowedOrigins = typeof configured === 'function'
    ? ['<dynamic-resolver>', location]
    : [location, ...configured]
        .map((value) => normalizeOrigin({ value, secure }))
        .filter(Boolean);

  if (getProjectConfig().logging.devLogs) {
    getLogger().warn('cors: origin not allowed', {
      origin,
      normalizedOrigin,
      allowedOrigins: debugAllowedOrigins,
      allowLocalhost: cors.allowLocalhost,
    });
  }
  void dispatchHook('corsRejected', {
    origin,
    normalizedOrigin,
    allowedOrigins: debugAllowedOrigins,
    allowLocalhost: cors.allowLocalhost,
  });
  return false;
};

export default allowedOrigin;
