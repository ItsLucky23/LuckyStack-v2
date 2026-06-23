import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatchHook } from '@luckystack/core';

import type { ServiceTargetResolver } from './resolveTarget';
import { resolveServiceKey } from './resolveTarget';
import {
  HTTP_HOP_BY_HOP_HEADERS,
  stripHopByHopHeaders,
  stripForwardedHeaders,
  isOriginFormTarget,
  isHostPinned,
  normalizeForwardedProto,
  buildForwardedFor,
} from './proxyUtils';
import { readErrorCode, inferErrorCause } from './errorClassification';

export interface CreateHttpProxyInput {
  resolver: ServiceTargetResolver;
  missingServiceErrorCode: string;
  /**
   * Upstream request timeout in ms. A backend that accepts TCP but never
   * responds is reaped after this window (client gets a 502
   * `routing.upstreamUnreachable`). Defaults to `UPSTREAM_REQUEST_TIMEOUT_MS`.
   */
  upstreamRequestTimeoutMs?: number;
  /**
   * Maximum request body size in bytes. Requests exceeding this limit are
   * rejected with 413 before the upstream leg is opened. Backends still
   * enforce their own limits; this is a defense-in-depth edge cap.
   * Defaults to `DEFAULT_MAX_BODY_BYTES` (100 MiB). Set to `Infinity` to
   * disable.
   */
  maxRequestBodyBytes?: number;
}

//? Bound the upstream request leg. A backend that accepts the TCP connection but
//? never responds would otherwise pin both the client and the upstream socket
//? indefinitely (resource-exhaustion DoS). On expiry we destroy the upstream
//? request, which surfaces on the `'error'` handler below and emits the existing
//? clean 502. Built-in (not a deploy-config knob) to keep the change inside this
//? package, mirroring the slow-loris timeouts in `startRouter.ts`.
const UPSTREAM_REQUEST_TIMEOUT_MS = 30_000;

//? Generous edge body cap: large enough to not block legitimate file uploads yet
//? small enough to protect backends from trivial body-flood amplification. Set
//? to `Infinity` via `routing.maxRequestBodyBytes` to disable at the edge.
const DEFAULT_MAX_BODY_BYTES = 100 * 1024 * 1024; // 100 MiB

export const createHttpProxy = ({ resolver, missingServiceErrorCode, upstreamRequestTimeoutMs, maxRequestBodyBytes }: CreateHttpProxyInput) => {
  const requestTimeoutMs = upstreamRequestTimeoutMs ?? UPSTREAM_REQUEST_TIMEOUT_MS;
  const bodySizeCap = maxRequestBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  //? The handler returned to `http.createServer` must be `void`-returning so
  //? Node's HTTP internals do not see an unhandled promise. The real work is
  //? in `handleRequest` (async for the `proxyRequestGate` await); the `void`
  //? here is intentional — errors are handled inside `handleRequest` via the
  //? per-stream `'error'` listeners that are registered before any I/O.
  return (req: IncomingMessage, res: ServerResponse): void => {
    void handleRequest(req, res, { resolver, missingServiceErrorCode, requestTimeoutMs, bodySizeCap });
  };
};

const handleRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    resolver: ServiceTargetResolver;
    missingServiceErrorCode: string;
    requestTimeoutMs: number;
    bodySizeCap: number;
  },
): Promise<void> => {
  const { resolver, missingServiceErrorCode, requestTimeoutMs, bodySizeCap } = ctx;
  const pathname = req.url ?? '/';

  //? Defense-in-depth: only strict origin-form targets (a single leading `/`)
  //? are routable. Absolute-form (`http://host/...`), authority-form, and
  //? protocol-relative (`//host/...`) would let `new URL(pathname, base)`
  //? below re-host the upstream to an attacker-controlled origin (SSRF) if the
  //? resolver ever returns a key for such a path. Reject before resolution.
  if (!isOriginFormTarget(pathname)) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'error', errorCode: 'routing.invalidRequestPath' }));
    return;
  }

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

  //? Defense-in-depth host pinning, independent of the resolver: the resolved
  //? upstream host MUST equal the backend the resolver chose. A custom
  //? `ServiceResolver` that returns a fixed service while ignoring the path
  //? must never be able to move the upstream off that backend.
  if (!isHostPinned(targetUrl, resolved.target)) {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      status: 'error',
      errorCode: missingServiceErrorCode,
      errorParams: [{ key: 'service', value: service }],
    }));
    return;
  }

  //? Check the `content-length` header BEFORE opening the upstream leg.
  //? We cap by content-length (fast path: no buffering needed) and also
  //? by accumulated bytes during streaming (defense against chunked bodies
  //? that omit or lie about content-length). Both checks share the same
  //? cap value so backends only see requests within the edge limit.
  const declaredLength = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > bodySizeCap) {
    res.statusCode = 413;
    res.setHeader('content-type', 'application/json');
    //? Drain the request body so the client's TCP connection can be
    //? closed cleanly. Without this the socket stays half-open waiting
    //? for the body to flush before Node can send the 413.
    req.resume();
    res.end(JSON.stringify({ status: 'error', errorCode: 'routing.requestBodyTooLarge' }));
    return;
  }

  //? `proxyRequestGate` is the fail-CLOSED deny gate: any registered handler
  //? that returns a stop signal rejects the request here, before the upstream
  //? leg is opened. Absence of handlers = allow (no registrations → not
  //? stopped). The gate fires AFTER path validation, service resolution, and
  //? host-pin — consumers can rely on those invariants holding.
  const gateResult = await dispatchHook('proxyRequestGate', {
    service,
    pathname,
    method: req.method ?? 'GET',
    target: resolved.target,
    viaFallback: resolved.viaFallback,
    remoteAddress: req.socket.remoteAddress,
  });
  if (gateResult.stopped) {
    const httpStatus = gateResult.signal.httpStatus ?? 403;
    const errorCode = gateResult.signal.errorCode;
    res.statusCode = httpStatus;
    res.setHeader('content-type', 'application/json');
    req.resume();
    res.end(JSON.stringify({ status: 'error', errorCode }));
    return;
  }

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

  //? Track streamed bytes to enforce the body cap even when the client omits
  //? or lies about `content-length` (chunked transfer encoding). When the
  //? limit is hit mid-stream we destroy both legs and respond 413 if headers
  //? have not yet been sent.
  let bytesReceived = 0;

  const forwardRequest = transport.request({
    hostname: targetUrl.hostname,
    //? Boot-time guard in `resolveTarget.ts` ensures every binding URL has
    //? an explicit port — port-less URLs were rejected at startup. So
    //? `targetUrl.port` is always a non-empty numeric string here.
    port: Number(targetUrl.port),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      //? Strip hop-by-hop AND every client-supplied forwarding /
      //? router-authoritative header, THEN set the router's own values, so a
      //? client cannot pre-seed `x-forwarded-for` (IP spoof → rate-limit / ban
      //? / audit evasion), `x-forwarded-proto` (scheme spoof), or the internal
      //? `x-luckystack-*` markers and have them survive via spread order.
      ...stripForwardedHeaders(stripHopByHopHeaders(req.headers, HTTP_HOP_BY_HOP_HEADERS)),
      //? Router-authoritative: XFF is the router's own peer view of the
      //? client, not a trusted inbound chain. Backends must trust only this.
      'x-forwarded-for': buildForwardedFor(req.socket.remoteAddress),
      // Preserve the original host so the upstream knows the public hostname.
      'x-forwarded-host': req.headers.host ?? '',
      'x-forwarded-proto': normalizeForwardedProto(req.headers['x-forwarded-proto']),
      'x-luckystack-resolved-env': resolved.resolvedEnvKey,
      'x-luckystack-via-fallback': resolved.viaFallback ? '1' : '0',
    },
  }, (upstream) => {
    res.statusCode = upstream.statusCode ?? 502;
    for (const [key, value] of Object.entries(upstream.headers)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (HTTP_HOP_BY_HOP_HEADERS.has(lower)) continue;
      //? Mirror the WS upgrade-response filter: a backend must not be able to echo
      //? internal `x-luckystack-*` routing markers back into the client's header
      //? context (would leak resolved-env / fallback topology).
      if (lower.startsWith('x-luckystack-')) continue;
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

  //? Reap a backend that accepts TCP but never responds. `setTimeout` only
  //? schedules the `'timeout'` event; destroying the request with an explicit
  //? error routes through the `'error'` handler below, which emits the clean
  //? 502 `routing.upstreamUnreachable` (or `res.end()` if headers already sent).
  forwardRequest.setTimeout(requestTimeoutMs, () => {
    forwardRequest.destroy(new Error('upstream request timed out'));
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
    //? Do NOT expose err.message to the unauthenticated client: for
    //? ECONNREFUSED/ENOTFOUND/EHOSTUNREACH it carries the INTERNAL upstream IP:port
    //? and DNS/cluster name (e.g. "connect ECONNREFUSED 127.0.0.1:4001" /
    //? "getaddrinfo ENOTFOUND internal-api.svc.cluster.local") — free internal-
    //? network reconnaissance for lateral movement / SSRF targeting. The full
    //? message is still on the postProxyResponse hook + logger above.
    res.end(JSON.stringify({
      status: 'error',
      errorCode: 'routing.upstreamUnreachable',
      errorParams: [
        { key: 'service', value: service },
      ],
    }));
  });

  //? Guard the inbound request/response streams. A client abort mid-stream
  //? emits `'error'`/`'aborted'` on `req` (and `'error'` on `res`); with no
  //? listener that surfaces as an uncaught exception and leaks the upstream
  //? socket. Tear the upstream down so a disconnecting client can't crash or
  //? leak the proxy.
  const abortUpstream = (): void => {
    forwardRequest.destroy();
  };
  req.on('error', abortUpstream);
  req.on('aborted', abortUpstream);
  res.on('error', abortUpstream);

  //? Intercept each data chunk to enforce the streaming body cap. Using `'data'`
  //? before `pipe` is safe — Node buffers events in the same tick; the pipe then
  //? takes over delivery without re-emitting buffered chunks.
  req.on('data', (chunk: Buffer) => {
    bytesReceived += chunk.length;
    if (bytesReceived > bodySizeCap) {
      //? Destroy the upstream request first so we don't forward a partial body,
      //? then respond 413 if we haven't already written headers.
      forwardRequest.destroy();
      if (!res.headersSent) {
        res.statusCode = 413;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'error', errorCode: 'routing.requestBodyTooLarge' }));
      }
    }
  });

  req.pipe(forwardRequest);
};
