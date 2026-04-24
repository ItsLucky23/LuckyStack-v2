import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServiceTargetResolver } from './resolveTarget';
import { parseServiceFromPath } from './resolveTarget';

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
    const service = parseServiceFromPath(pathname);

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

    const targetUrl = new URL(pathname, resolved.target);
    const transport = targetUrl.protocol === 'https:' ? https : http;

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
    });

    forwardRequest.on('error', (err) => {
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
