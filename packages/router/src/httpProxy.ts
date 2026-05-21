import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatchHook } from '@luckystack/core';

import type { ServiceTargetResolver } from './resolveTarget';
import { resolveServiceKey } from './resolveTarget';
import type { PostProxyResponseErrorCause } from './hookPayloads';

// Node attaches `code` to system errors but the public Error type does not expose it,
// so we narrow via a structural property check rather than a cast.
const readErrorCode = (err: Error): string | undefined => {
  if (!('code' in err)) return undefined;
  const candidate: unknown = err.code;
  return typeof candidate === 'string' ? candidate : undefined;
};

const inferErrorCause = (code: string | undefined): PostProxyResponseErrorCause => {
  if (!code) return 'unknown';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout';
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'EPIPE'
  ) {
    return 'network';
  }
  return 'upstream-throw';
};

// Headers that should not be forwarded to the upstream (they're hop-by-hop).
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const stripHopByHopHeaders = (headers: IncomingMessage['headers']): Record<string, string | string[]> => {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
};

export interface CreateHttpProxyInput {
  resolver: ServiceTargetResolver;
  missingServiceErrorCode: string;
}

export const createHttpProxy = ({ resolver, missingServiceErrorCode }: CreateHttpProxyInput) => {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const pathname = req.url ?? '/';
    const service = resolveServiceKey({
      pathname,
      headers: req.headers,
      host: req.headers.host ?? '',
    });

    if (!service) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'error', errorCode: 'routing.invalidRequestPath' }));
      return;
    }

    const resolved = resolver.resolve(service);
    if (!resolved) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        status: 'error',
        errorCode: missingServiceErrorCode,
        errorParams: [{ key: 'service', value: service }],
      }));
      return;
    }

    const proxyStart = Date.now();
    const targetUrl = new URL(pathname, resolved.target);
    const transport = targetUrl.protocol === 'https:' ? https : http;

    //? `preProxyRequest` fires before the upstream call. Consumers add
    //? tracing IDs, redact path segments, or audit cross-env routing.
    void dispatchHook('preProxyRequest', {
      service,
      pathname,
      method: req.method ?? 'GET',
      target: resolved.target,
      viaFallback: resolved.viaFallback,
    });

    const forwardRequest = transport.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: {
        ...stripHopByHopHeaders(req.headers),
        // Preserve the original host so the upstream knows the public hostname.
        'x-forwarded-host': req.headers.host ?? '',
        'x-forwarded-proto': req.headers['x-forwarded-proto'] ?? 'http',
        'x-luckystack-resolved-env': resolved.resolvedEnvKey,
        'x-luckystack-via-fallback': resolved.viaFallback ? '1' : '0',
      },
    }, (upstream) => {
      res.statusCode = upstream.statusCode ?? 502;
      for (const [key, value] of Object.entries(upstream.headers)) {
        if (value === undefined) continue;
        if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
        res.setHeader(key, value);
      }
      upstream.pipe(res);
      //? On the happy path `statusCode` is always populated; the `?? 0`
      //? sentinel is intentionally aligned with the error-path emission so
      //? consumers can branch on `statusCode === 0` plus `payload.error`.
      void dispatchHook('postProxyResponse', {
        service,
        pathname,
        method: req.method ?? 'GET',
        target: resolved.target,
        viaFallback: resolved.viaFallback,
        statusCode: upstream.statusCode ?? 0,
        latencyMs: Date.now() - proxyStart,
      });
    });

    forwardRequest.on('error', (err) => {
      const errorCode = readErrorCode(err);
      //? Fire `postProxyResponse` on the error path too so monitoring/tracing
      //? consumers see failed requests. `statusCode: 0` is the network-error
      //? indicator (no HTTP response was received), and the `error` field
      //? carries the underlying failure detail.
      void dispatchHook('postProxyResponse', {
        service,
        pathname,
        method: req.method ?? 'GET',
        target: resolved.target,
        viaFallback: resolved.viaFallback,
        statusCode: 0,
        latencyMs: Date.now() - proxyStart,
        error: {
          message: err.message,
          ...(errorCode === undefined ? {} : { code: errorCode }),
          cause: inferErrorCause(errorCode),
        },
      });

      if (res.headersSent) {
        res.end();
        return;
      }
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        status: 'error',
        errorCode: 'routing.upstreamUnreachable',
        errorParams: [
          { key: 'service', value: service },
          { key: 'message', value: err.message },
        ],
      }));
    });

    req.pipe(forwardRequest);
  };
};
