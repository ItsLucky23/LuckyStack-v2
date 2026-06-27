//? SYNC-20 — targeted disables replacing the former blanket `/* eslint-disable */`.
//? Same rationale as the socket handler: validated-string template interpolation,
//? intentional `||` empty-string fallthrough, runtime `?.` guards on runtime-map
//? values. (The former `user!` assertion at the `validateRequest` call site was
//? removed once core made `validateRequest` null-safe — CORE-06.)
/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/restrict-template-expressions, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-non-null-assertion, eqeqeq */
import type { BaseSessionLayout as SessionLayout, ErrorFormatter, PostSyncFanoutPayload, PostSyncExecutePayload } from '@luckystack/core';
import {
  readSession,
  getProjectConfig,
  getRuntimeSyncMaps as getRuntimeSyncMapsFromSource,
  validateRequest,
  extractTokenFromSocket,
  formatRoomName,
  getIoInstance,
  tryCatch,
  parseTransportRouteName,
  checkRateLimit,
  socketEventNames,
  validateInputByType,
  dispatchHook,
  getLogger,
  runWithErrorTrackerIdentityScope,
  setCurrentErrorTrackerIdentity,
  isLoopbackIp,
  extractLanguageFromHeader,
} from '@luckystack/core';


import { buildSyncStreamEmitters } from './_shared/streamEmitters';
import type {
  RuntimeSyncServerEntry,
  RuntimeSyncClientHandler,
  SyncStreamPayload,
  SyncErrorEnvelopeInput,
} from './_shared/syncTypes';
import { shouldLogDev, shouldLogStream } from './_shared/logFlags';
import { buildFormattedError } from './_shared/errorBuilders';
import { processClientSyncForRecipient } from './_shared/clientFanout';
import { resolveSyncValidationMode } from './_shared/validationMode';
import { authorizeSyncReceiver } from './_shared/receiverAuth';

interface HttpSyncRequestParams {
  name: string;
  cb?: string;
  data: Record<string, unknown>;
  receiver: string;
  ignoreSelf?: boolean;
  token: string | null;
  requesterIp?: string;
  xLanguageHeader?: string | string[];
  acceptLanguageHeader?: string | string[];
  stream?: (payload: HttpSyncStreamEvent) => void;
  /**
   * Optional AbortSignal. The HTTP server (`@luckystack/server`) wires this
   * to `req.on('close', ...)` so a closed SSE connection aborts in-flight
   * stream emits. Sync handlers receive it as `abortSignal` in params.
   */
  abortSignal?: AbortSignal;
}

interface HttpSyncResponse {
  status: 'success' | 'error';
  message: string;
  //? S22 — transport-parity envelope. The Socket.io ack (`handleSyncRequest`)
  //? is the CANONICAL shape: `{ status, message, result: serverOutput }`. The
  //? HTTP/SSE fallback previously FLATTENED `serverOutput` to the top level
  //? (`{ ...serverOutput, status, message }`), so an HTTP caller saw the route
  //? fields hoisted while a socket caller saw them nested under `result`. Both
  //? transports now nest under `result`; `errorCode`/`errorParams`/`httpStatus`
  //? remain on the error envelope only.
  result?: unknown;
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean; }[];
  httpStatus?: number;
}

type HttpSyncErrorBuilder = (args: {
    response: SyncErrorEnvelopeInput;
    preferred?: string | null;
    userLanguage?: string | null;
  }) => HttpSyncResponse;

//? Returns an HttpSyncResponse when a rate limit was hit (caller should
//? return it directly), or null when both buckets passed.
const applyHttpSyncRateLimits = async ({
  resolvedName,
  requesterIp,
  user,
  buildSyncError,
  preferredLocale,
  routeLimit,
}: {
  resolvedName: string;
  token: string | null;
  requesterIp: string | undefined;
  user: SessionLayout | null;
  buildSyncError: HttpSyncErrorBuilder;
  preferredLocale: string | null | undefined;
  //? SYNC-11 — per-route `rateLimit` export (parity with the socket handler).
  routeLimit: number | false | undefined;
}): Promise<HttpSyncResponse | null> => {
  const config = getProjectConfig();
  const effectiveSyncLimit = routeLimit === undefined ? config.rateLimiting.defaultApiLimit : routeLimit;
  if (effectiveSyncLimit !== false && effectiveSyncLimit > 0) {
    //? H-TWIN with the api transport: key the per-route bucket on the VALIDATED
    //? user.id (never the token) so an authenticated abuser can't reset the bucket
    //? by re-logging-in. Anonymous callers fall back to the IP ('unknown' sentinel).
    const identityCb = config.rateLimiting.identity;
    const customIdentity = identityCb?.({ routeName: resolvedName, userId: user?.id ?? null, ip: requesterIp ?? '', transport: 'http' }) ?? null;
    //? SYNC-O11 — use 'unknown' (not 'anonymous') when requesterIp is absent,
    //? matching the global-IP-bucket sentinel on line 156. 'anonymous' collapsed
    //? all unauthenticated callers with no IP into one shared per-route bucket;
    //? 'unknown' is the established sentinel that also signals a missing IP to
    //? hook subscribers (rateLimitExceeded ip field).
    const requesterIdentity = customIdentity?.id ?? user?.id ?? (requesterIp ?? 'unknown');
    const keyPrefix = customIdentity?.scope ?? (user?.id ? 'user' : 'ip');
    const rateLimitKey = `${keyPrefix}:${requesterIdentity}:sync:${resolvedName}`;
    const { allowed, resetIn } = await checkRateLimit({
      key: rateLimitKey,
      limit: effectiveSyncLimit,
      windowMs: config.rateLimiting.windowMs,
    });
    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        //? Parity with the API handler: an anonymous per-route bucket is IP-keyed,
        //? so the scope is `ip` (with `route` still set to mark it a per-route
        //? bucket vs the global `:sync:all` IP bucket), never `route`.
        scope: user?.id ? 'user' : 'ip',
        key: rateLimitKey,
        limit: effectiveSyncLimit,
        windowMs: config.rateLimiting.windowMs,
        count: effectiveSyncLimit + 1,
        route: resolvedName,
        userId: user?.id,
        ip: user?.id ? undefined : requesterIp,
      });
      return buildSyncError({
        response: {
          status: 'error',
          errorCode: 'sync.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
          httpStatus: 429,
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }
  }

  const defaultIpLimit = config.rateLimiting.defaultIpLimit;
  //? Mirror handleHttpApiRequest: skip the global per-IP abuse limit for
  //? loopback traffic in non-production (dev + the scalable test suite).
  //? Per-route limits still apply; production is unaffected.
  //? Mirror handleHttpApiRequest API-O2 fix: use isLoopbackIp() + skipLoopbackInDev
  //? config flag so the loopback check is canonical and config-gated.
  const requesterIsLoopback = config.rateLimiting.skipLoopbackInDev
    && process.env.NODE_ENV !== 'production'
    && isLoopbackIp(requesterIp ?? '');
  if (!requesterIsLoopback && defaultIpLimit !== false && defaultIpLimit > 0) {
    const ipBucket = requesterIp ?? 'unknown';
    const ipKey = `ip:${ipBucket}:sync:all`;
    const { allowed, resetIn } = await checkRateLimit({
      key: ipKey,
      limit: defaultIpLimit,
      windowMs: config.rateLimiting.windowMs,
    });
    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        scope: 'ip',
        key: ipKey,
        limit: defaultIpLimit,
        windowMs: config.rateLimiting.windowMs,
        count: defaultIpLimit + 1,
        ip: ipBucket,
      });
      return buildSyncError({
        response: {
          status: 'error',
          errorCode: 'sync.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
          httpStatus: 429,
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }
  }

  return null;
};

export type HttpSyncStreamEvent = SyncStreamPayload;

// ─── Shared context threaded through staged helpers ───────────────────────────

interface HttpSyncContext {
  name: string;
  cb: string | undefined;
  data: Record<string, unknown>;
  normalizedReceiver: string;
  ignoreSelf: boolean | undefined;
  token: string | null;
  requesterIp: string | undefined;
  stream: ((payload: HttpSyncStreamEvent) => void) | undefined;
  effectiveAbortSignal: AbortSignal;
  preferredLocale: string | null;
  user: SessionLayout | null;
  buildSyncError: HttpSyncErrorBuilder;
}

// ─── Stage 1: parse and resolve the route name ───────────────────────────────

//? Returns the resolved name + callback key, or an error response when parsing
//? fails or the route is missing from the sync maps.
async function stageResolveRoute(
  ctx: HttpSyncContext,
): Promise<{ resolvedName: string; callbackName: string; error?: never } | { error: HttpSyncResponse; resolvedName?: never; callbackName?: never }> {
  const { name, cb, data, normalizedReceiver, user, buildSyncError, preferredLocale } = ctx;

  if (!name || typeof name !== 'string') {
    return {
      error: buildSyncError({
        response: { status: 'error', errorCode: 'sync.invalidRequest' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }),
    };
  }

  //? Parity with the socket transport (handleSyncRequest's parseSyncFields, which
  //? rejects `!data || typeof data != 'object' || Array.isArray(data)`). A null /
  //? non-object / array `clientInput` slips past the HTTP route's
  //? `normalizeHttpSyncParams` coercion; `typeof null === 'object'` and
  //? `typeof [] === 'object'` mean the bare object check is insufficient. Without
  //? this a non-object would reach a `_server` handler expecting an object — and
  //? under `validation: 'relaxed'` there is no further runtime shape check. The
  //? socket path rejects it outright, so the HTTP path must too.
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      error: buildSyncError({
        response: { status: 'error', errorCode: 'sync.invalidRequest' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }),
    };
  }

  const parsedRoute = parseTransportRouteName({ value: name, prefix: 'sync' });
  if (parsedRoute.status === 'error') {
    return {
      error: buildSyncError({
        response: {
          status: 'error',
          errorCode: 'routing.invalidServiceRouteName',
          errorParams: [{ key: 'name', value: name }],
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }),
    };
  }

  const resolvedName = parsedRoute.normalizedFullName;
  const callbackName = typeof cb === 'string' && cb.trim().length > 0
    ? cb.trim()
    : `${parsedRoute.serviceRoute.normalizedRouteName}/${parsedRoute.version}`;

  if (!normalizedReceiver) {
    return {
      error: buildSyncError({
        response: { status: 'error', errorCode: 'sync.missingReceiver' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }),
    };
  }

  const { syncObject } = await getRuntimeSyncMapsFromSource();

  if (!syncObject[`${resolvedName}_client`] && !syncObject[`${resolvedName}_server`]) {
    return {
      error: buildSyncError({
        response: { status: 'error', errorCode: 'sync.notFound' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }),
    };
  }

  //? SYNC: reject a CLIENT-ONLY route (parity with the socket handler). The
  //? `_server` file is the MANDATORY auth + input-validation gate; the entire
  //? auth+validate block below lives inside `if (serverSyncEntry)`. Without
  //? this guard a `_client`-only route would fan out fully attacker-controlled,
  //? UNVALIDATED input with NO login check — reachable by unauthenticated
  //? callers. Treat a missing `_server` as a routing error.
  if (!syncObject[`${resolvedName}_server`]) {
    if (shouldLogDev()) {
      getLogger().warn(`http sync: ${resolvedName} has a _client file but no required _server file`, { sync: resolvedName, transport: 'http' });
    }
    return {
      error: buildSyncError({
        response: { status: 'error', errorCode: 'sync.notFound' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }),
    };
  }

  return { resolvedName, callbackName };
}

// ─── Stage 2: auth checks ─────────────────────────────────────────────────────

//? Returns an error response when auth fails, or null when auth passes.
function stageCheckAuth(
  serverSyncEntry: RuntimeSyncServerEntry,
  ctx: Pick<HttpSyncContext, 'user' | 'preferredLocale' | 'buildSyncError'>,
): HttpSyncResponse | null {
  const { user, preferredLocale, buildSyncError } = ctx;
  const { auth } = serverSyncEntry;

  if (auth.login && !user?.id) {
    return buildSyncError({
      response: { status: 'error', errorCode: 'auth.required' },
      preferred: preferredLocale,
    });
  }

  //? SYNC-02 — guard the anonymous `additional`-only case (parity with the
  //? socket handler). A route declaring `auth.additional` but not
  //? `auth.login` would otherwise pass `user! === null` into
  //? `validateRequest` → `condition.key in null` TypeError. The body's
  //? tryCatch would catch it, but it would surface as a generic
  //? `sync.serverExecutionFailed` instead of the correct `auth.required`.
  if (auth.additional && auth.additional.length > 0 && !user) {
    return buildSyncError({
      response: { status: 'error', errorCode: 'auth.required' },
      preferred: preferredLocale,
    });
  }

  //? CORE-06 / SYNC-02 — `validateRequest` is now null-safe: pass the real
  //? (possibly null) session instead of the former `user!` assertion (parity
  //? with the socket handler). The anonymous-additional case is still
  //? rejected explicitly above with `auth.required`.
  const validationResult = validateRequest({ auth, user });
  if (validationResult.status === 'error') {
    return buildSyncError({
      response: {
        status: 'error',
        errorCode: validationResult.errorCode || 'auth.forbidden',
        errorParams: validationResult.errorParams,
        httpStatus: validationResult.httpStatus,
      },
      preferred: preferredLocale,
      userLanguage: user?.language,
    });
  }

  return null;
}

// ─── Stage 3: receiver authorization ─────────────────────────────────────────

//? Returns an error response when receiver auth fails, or null when it passes.
function stageAuthorizeReceiver(
  resolvedName: string,
  ctx: Pick<HttpSyncContext, 'normalizedReceiver' | 'user' | 'preferredLocale' | 'buildSyncError'>,
): HttpSyncResponse | null {
  const { normalizedReceiver, user, preferredLocale, buildSyncError } = ctx;
  const syncConfig = getProjectConfig().sync;

  //? SYNC-07 — default receiver authorization (parity with the socket
  //? handler). Over HTTP/SSE there is no originator socket, so membership is
  //? derived from the SESSION's persisted `roomCodes` (the same list
  //? `loadSocket` re-joins on connect). This closes the bypass where a
  //? consumer who set `requireRoomMembership: true` was protected on
  //? websockets but NOT over the HTTP fallback. When there is no session
  //? (anonymous caller) membership is undeterminable → `isMember: null`, and
  //? `authorizeSyncReceiver` fails closed under `requireRoomMembership`.
  const receiverAuth = authorizeSyncReceiver({
    receiver: normalizedReceiver,
    allowClientReceiverAll: syncConfig.allowClientReceiverAll,
    requireRoomMembership: syncConfig.requireRoomMembership,
    isMember: user ? () => Boolean(user.roomCodes?.includes(normalizedReceiver)) : null,
  });

  if (!receiverAuth.allowed) {
    if (shouldLogDev()) {
      getLogger().warn(`http sync: receiver authorization failed for ${resolvedName}`, { sync: resolvedName, receiver: normalizedReceiver, errorCode: receiverAuth.errorCode, transport: 'http' });
    }
    return buildSyncError({
      response: { status: 'error', errorCode: receiverAuth.errorCode, httpStatus: 403 },
      preferred: preferredLocale,
      userLanguage: user?.language,
    });
  }

  return null;
}

// ─── Stage 4: authorize hooks (preSyncAuthorize / postSyncAuthorize) ──────────

//? Returns an error response when preSyncAuthorize stops the request, or null
//? when the request is allowed through.
async function stageRunAuthorizeHooks(
  resolvedName: string,
  ctx: Pick<HttpSyncContext, 'data' | 'normalizedReceiver' | 'user' | 'preferredLocale' | 'buildSyncError'>,
): Promise<HttpSyncResponse | null> {
  const { data, normalizedReceiver, user, preferredLocale, buildSyncError } = ctx;

  //? Identity propagation hook — runs after basic auth + AuthProps check
  //? and rate-limit pass. `@luckystack/error-tracking`'s
  //? auto-instrumentation subscribes here to call `setSentryUser(user)`.
  const preAuthorizeResult = await dispatchHook('preSyncAuthorize', {
    routeName: resolvedName,
    data,
    user,
    receiver: normalizedReceiver,
    transport: 'http',
  });
  if (preAuthorizeResult.stopped) {
    return buildSyncError({
      response: {
        status: 'error',
        errorCode: preAuthorizeResult.signal.errorCode,
        httpStatus: preAuthorizeResult.signal.httpStatus,
      },
      preferred: preferredLocale,
      userLanguage: user?.language,
    });
  }

  //? Observational mirror of `preSyncAuthorize` (parity with the socket
  //? handler). Fires after the request passes auth + custom policy; lets
  //? audit-log / metrics subscribers record successful authorizations over
  //? the HTTP/SSE transport too. Stop signals are ignored (post-decision).
  void dispatchHook('postSyncAuthorize', {
    routeName: resolvedName,
    data,
    user,
    receiver: normalizedReceiver,
    transport: 'http',
  });

  return null;
}

// ─── Stage 5: input validation ────────────────────────────────────────────────

//? Returns an error response when preSyncValidate stops or input validation
//? fails, or null when validation passes.
async function stageValidateInput(
  resolvedName: string,
  serverSyncEntry: RuntimeSyncServerEntry,
  ctx: Pick<HttpSyncContext, 'data' | 'normalizedReceiver' | 'user' | 'preferredLocale' | 'buildSyncError'>,
): Promise<HttpSyncResponse | null> {
  const { data, normalizedReceiver, user, preferredLocale, buildSyncError } = ctx;

  //? EXT-04 — validation-stage hooks mirroring the API pipeline + socket-sync
  //? handler. `preSyncValidate` may stop before validation; `postSyncValidate`
  //? reports the outcome.
  const preValidateResult = await dispatchHook('preSyncValidate', {
    routeName: resolvedName,
    data,
    user,
    receiver: normalizedReceiver,
    transport: 'http',
  });
  if (preValidateResult.stopped) {
    return buildSyncError({
      response: {
        status: 'error',
        errorCode: preValidateResult.signal.errorCode,
        httpStatus: preValidateResult.signal.httpStatus,
      },
      preferred: preferredLocale,
      userLanguage: user?.language,
    });
  }

  const { inputType, inputTypeFilePath } = serverSyncEntry;

  //? Per-route validation toggle (mirrors the API + socket-sync handler).
  //? `'relaxed'` / `{ input: 'skip' }` skips runtime input validation.
  if (resolveSyncValidationMode(serverSyncEntry.validation) === 'strict') {
    const inputValidation = await validateInputByType({
      typeText: inputType,
      value: data,
      rootKey: 'clientInput',
      filePath: inputTypeFilePath,
    });
    void dispatchHook('postSyncValidate', {
      routeName: resolvedName,
      data,
      user,
      receiver: normalizedReceiver,
      transport: 'http',
      validation: inputValidation.status === 'error'
        ? { status: 'error', message: inputValidation.message }
        : { status: 'success' },
    });
    if (inputValidation.status === 'error') {
      //? SYNC-04 SECURITY: do NOT echo the raw validator message back to the
      //? client (schema enumeration). The detail goes to `postSyncValidate`
      //? + the dev log only; the client receives the generic code. Mirrors
      //? the socket handler + the API package's fix.
      if (shouldLogDev()) {
        getLogger().warn(`http sync: input validation failed for ${resolvedName}`, { sync: resolvedName, message: inputValidation.message, transport: 'http' });
      }
      return buildSyncError({
        response: {
          status: 'error',
          errorCode: 'sync.invalidInputType',
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }
  } else {
    void dispatchHook('postSyncValidate', {
      routeName: resolvedName,
      data,
      user,
      receiver: normalizedReceiver,
      transport: 'http',
      validation: { status: 'success' },
    });
  }

  return null;
}

// ─── Stage 6: execute the server handler ─────────────────────────────────────

//? Returns the server output object on success, or an error response on
//? failure. The payload reference is shared so span-pinning subscribers work.
async function stageExecuteServer(
  resolvedName: string,
  serverSyncEntry: RuntimeSyncServerEntry,
  functionsObject: Record<string, unknown>,
  ctx: Pick<HttpSyncContext, 'data' | 'normalizedReceiver' | 'name' | 'user' | 'preferredLocale' | 'buildSyncError' | 'effectiveAbortSignal' | 'cb' | 'stream'>,
): Promise<{ serverOutput: Record<string, unknown>; error?: never } | { error: HttpSyncResponse; serverOutput?: never }> {
  const { data, normalizedReceiver, user, preferredLocale, buildSyncError, effectiveAbortSignal, cb, stream } = ctx;
  const { main: serverMain } = serverSyncEntry;

  const { emitServerSyncStream, emitBroadcastSyncStream, emitStreamToTokens, flushPressure } =
    buildSyncStreamEmitters({
      cb,
      receiver: normalizedReceiver,
      userId: user?.id ?? null,
      resolvedName,
      logLabel: 'http sync',
      signal: effectiveAbortSignal,
      //? No originatorSocket for HTTP/SSE — `flushPressure` falls back
      //? to room-socket measurement only. SSE backpressure is the
      //? caller's responsibility (Node's `res.write` returns a bool).
      //? Originator chunks travel back via SSE; broadcast / targeted
      //? chunks still flow over Socket.io to recipients in the receiver room.
      emitOriginatorChunk: (payload) => {
        stream?.(payload);
      },
    });

  //? EXT-04 — execution-stage hooks mirroring the API pipeline. `preSyncExecute`
  //? may stop before the `_server` runs; `postSyncExecute` fires on BOTH the
  //? success AND failure paths (previously invisible to hook consumers). The
  //? single payload reference is reused so span-pinning subscribers work.
  const executePayload: PostSyncExecutePayload = {
    routeName: resolvedName,
    data,
    user,
    receiver: normalizedReceiver,
    transport: 'http',
    result: undefined,
    error: null,
    durationMs: 0,
  };
  const preExecuteResult = await dispatchHook('preSyncExecute', executePayload);
  if (preExecuteResult.stopped) {
    return {
      error: buildSyncError({
        response: {
          status: 'error',
          errorCode: preExecuteResult.signal.errorCode,
          httpStatus: preExecuteResult.signal.httpStatus,
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }),
    };
  }

  const executeStart = Date.now();
  const [serverSyncError, serverSyncResult] = await tryCatch(
    async () => await serverMain({
      clientInput: data,
      user,
      functions: functionsObject,
      roomCode: normalizedReceiver,
      stream: emitServerSyncStream,
      broadcastStream: emitBroadcastSyncStream,
      streamTo: emitStreamToTokens,
      abortSignal: effectiveAbortSignal,
      flushPressure,
    }),
    undefined,
    {
      handler: 'handleHttpSyncRequest',
      sync: resolvedName,
      stage: 'server',
      userId: user?.id,
      //? Bug fix: was `name` (the raw route-name string) — should be
      //? `normalizedReceiver` to match the field's semantics and the socket handler.
      receiver: normalizedReceiver,
      transport: 'http',
    },
  );
  executePayload.result = serverSyncResult;
  executePayload.error = serverSyncError ?? null;
  executePayload.durationMs = Date.now() - executeStart;
  await dispatchHook('postSyncExecute', executePayload);

  if (serverSyncError) {
    return {
      error: buildSyncError({
        response: { status: 'error', errorCode: 'sync.serverExecutionFailed' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }),
    };
  }

  if (serverSyncResult?.status == 'error') {
    return {
      error: buildSyncError({
        response: serverSyncResult,
        preferred: preferredLocale,
        userLanguage: user?.language,
      }),
    };
  }

  if (serverSyncResult?.status !== 'success') {
    return {
      error: buildSyncError({
        response: { status: 'error', errorCode: 'sync.invalidServerResponse' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }),
    };
  }

  return { serverOutput: serverSyncResult };
}

// ─── Stage 7: fanout to room members ─────────────────────────────────────────

//? Fans the serverOutput out to every connected socket in the receiver room,
//? respecting `ignoreSelf`, per-recipient hooks, and optional `_client` handlers.
async function stageFanout(
  resolvedName: string,
  callbackName: string,
  serverOutput: Record<string, unknown>,
  syncObject: Record<string, unknown>,
  functionsObject: Record<string, unknown>,
  ctx: Pick<HttpSyncContext, 'data' | 'normalizedReceiver' | 'token' | 'ignoreSelf' | 'user' | 'buildSyncError' | 'preferredLocale'>,
): Promise<HttpSyncResponse | null> {
  const { data, normalizedReceiver, token, ignoreSelf, user, buildSyncError, preferredLocale } = ctx;
  const ioInstance = getIoInstance();

  //? Single payload reference reused by pre/post — span pinning in
  //? `@luckystack/error-tracking` uses WeakMap on this object.
  const fanoutPayload: PostSyncFanoutPayload = {
    routeName: resolvedName,
    data,
    user,
    receiver: normalizedReceiver,
    serverOutput,
    transport: 'http',
    recipientCount: 0,
  };
  //? Parity with the socket handler (handleSyncRequest.ts runSyncFanout): capture
  //? the hook result and bail when the hook stops the fanout.
  const preFanoutResult = await dispatchHook('preSyncFanout', fanoutPayload);
  if (preFanoutResult.stopped) {
    //? Parity with the socket handler: a preSyncFanout stop is a DENY decision,
    //? so the HTTP/SSE transport must surface it as an error response — not a
    //? silent success (which would let a deny hook be bypassed over HTTP).
    return buildSyncError({
      response: {
        status: 'error',
        errorCode: preFanoutResult.signal.errorCode,
        httpStatus: preFanoutResult.signal.httpStatus,
      },
      preferred: preferredLocale,
      userLanguage: user?.language,
    });
  }

  //? Over the HTTP/SSE fallback the caller IS the originator, so a receiver
  //? room with no connected sockets (no peers online, or the originator used
  //? HTTP instead of a websocket) is normal — NOT an error. Fall back to an
  //? empty set so the fanout loop simply runs zero times; the server handler
  //? already ran and its `serverOutput` is the meaningful result returned below.
  //? Cross-instance recipient list (RemoteSocket[]) spanning every backend on
  //? the shared Redis adapter, so an HTTP-triggered sync still fans out to room
  //? members on other instances. Empty array = no peers online, which is normal
  //? over the HTTP fallback (the loop just runs zero times).
  //? Branch off the NORMALIZED receiver so authorize, branch, and fetch all
  //? key off the same value (the auth check above used `normalizedReceiver`).
  //? Using the raw `receiver` here diverged from the socket handler and was a
  //? latent inversion hazard if a future edit changed which value gated auth.
  //? Route through the core room-name formatter (PRESENCE-1) so a non-identity
  //? `registerRoomNameFormatter` targets the same physical room sockets joined.
  const physicalReceiver = normalizedReceiver === 'all' ? 'all' : formatRoomName(normalizedReceiver, { purpose: 'broadcast', userId: user?.id ?? null });
  const sockets = physicalReceiver === 'all'
    ? await ioInstance!.fetchSockets()
    : await ioInstance!.in(physicalReceiver).fetchSockets();

  let recipientCount = 0;
  //? Yield to the event loop periodically so a giant `receiver: 'all'` fanout
  //? doesn't starve other requests (parity with the socket handler). Tunables
  //? live in projectConfig.sync. Clamp to >= 1 so a misconfigured
  //? `fanoutYieldEvery: 0` doesn't produce `n % 0 === NaN` (never truthy).
  const { fanoutYieldEvery, fanoutYieldMs } = getProjectConfig().sync;
  const yieldEvery = Math.max(1, fanoutYieldEvery);
  let fanoutIterCount = 1;
  for (const tempSocket of sockets) {
    fanoutIterCount++;
    if (fanoutIterCount % yieldEvery === 0) { await new Promise(resolve => setTimeout(resolve, fanoutYieldMs)); }

    const tempToken = extractTokenFromSocket(tempSocket);

    //? SYNC-O10 — `token &&` guard: an anonymous (token-less) originator is
    //? never matched as "self" (null === null is always true). Parity with
    //? the socket handler; `ignoreSelf` is a no-op for anonymous callers by design.
    if (ignoreSelf && typeof ignoreSelf === 'boolean' && token && token === tempToken) {
      continue;
    }

    //? SYNC-22 — per-recipient fanout hook (parity with the socket handler).
    //? A stop signal SKIPS just this recipient (loop continues; not counted).
    //? `recipientUserId` is null on the hot path (no per-recipient session
    //? read); a handler can derive it from `recipientSocketId` / `receiver`.
    const preRecipientResult = await dispatchHook('preSyncRecipient', {
      routeName: resolvedName,
      receiver: normalizedReceiver,
      recipientSocketId: tempSocket.id,
      recipientUserId: null,
      serverOutput,
    });
    //? Parity with the socket handler (SYNC-O8): a stop signal with no
    //? overrideOutput skips this recipient entirely; a stop signal WITH
    //? overrideOutput sends the override in place of serverOutput.
    if (preRecipientResult.stopped && preRecipientResult.signal.overrideOutput === undefined) {
      continue;
    }

    const effectiveServerOutput = preRecipientResult.stopped
      ? preRecipientResult.signal.overrideOutput
      : serverOutput;

    //? Count every recipient the request fanned out to — including ones whose
    //? per-recipient `_client` handler later errors — matching the Socket.io
    //? handler (handleSyncRequest.ts) so `postSyncFanout` sees the same total.
    recipientCount++;

    if (syncObject[`${resolvedName}_client`]) {
      const clientSyncHandler = syncObject[`${resolvedName}_client`] as RuntimeSyncClientHandler;
      await processClientSyncForRecipient({
        tempSocket,
        tempToken,
        clientSyncHandler,
        data,
        functionsObject,
        serverOutput: effectiveServerOutput,
        receiver: normalizedReceiver,
        resolvedName,
        callbackKey: callbackName,
        transport: 'http',
        handlerName: 'handleHttpSyncRequest',
        logLabel: 'http sync',
        shouldLogDev,
        shouldLogStream,
        buildSyncError,
        //? HTTP transport prefers `accept-language` over `x-language`
        //? (reversed vs. the socket handler) — preserved verbatim from the
        //? previous inlined error path.
        resolvePreferredLocale: (headers) =>
          extractLanguageFromHeader(headers['accept-language'] || headers['x-language']),
        sourceUserId: user?.id,
      });
      continue;
    }

    tempSocket.emit(socketEventNames.sync, {
      cb: callbackName,
      fullName: resolvedName,
      serverOutput: effectiveServerOutput,
      clientOutput: {},
      message: `${resolvedName} sync success`,
      status: 'success',
    });
  }

  fanoutPayload.recipientCount = recipientCount;
  await dispatchHook('postSyncFanout', fanoutPayload);
  return null;
}

//? ET-02 — wrap the whole HTTP/SSE sync request in a per-request error-tracker
//? identity scope (opened before `readSession`, the first interleaving await).
//? The resolved session is written into the scope's ALS box the moment it
//? resolves, so concurrent HTTP syncs with different users can't cross-attribute
//? captures. Each request gets its own isolated box.
export default async function handleHttpSyncRequest(args: HttpSyncRequestParams): Promise<HttpSyncResponse> {
  return runWithErrorTrackerIdentityScope(() => handleHttpSyncRequestScoped(args));
}

async function handleHttpSyncRequestScoped({
  name,
  cb,
  data,
  receiver,
  ignoreSelf,
  token,
  requesterIp,
  xLanguageHeader,
  acceptLanguageHeader,
  stream,
  abortSignal,
}: HttpSyncRequestParams): Promise<HttpSyncResponse> {
  if (shouldLogDev()) {
    getLogger().debug(`http sync: ${name} called`);
  }

  //? B1 — HTTP/SSE transport. The caller (typically `@luckystack/server`'s
  //? SSE bridge) wires `req.on('close', ...)` to a controller and passes its
  //? signal in. If no signal was provided we build a dummy controller so
  //? `signal` is always defined for handler param shape. The dummy never
  //? aborts on its own, which preserves current behavior for callers that
  //? don't opt in.
  const effectiveAbortSignal = abortSignal ?? new AbortController().signal;

  const normalizedReceiver = typeof receiver === 'string' ? receiver.trim() : '';
  const preferredLocale =
    extractLanguageFromHeader(xLanguageHeader)
    || extractLanguageFromHeader(acceptLanguageHeader);
  const user = await readSession(token);
  //? ET-02 — bind the resolved session into the active per-request ALS identity
  //? box so every capture in this request attributes to this user. Identity also
  //? still flows to the legacy global via the `preSyncAuthorize` hook subscriber;
  //? the ALS read wins at capture time.
  setCurrentErrorTrackerIdentity(user?.id ? { id: user.id, email: user.email ?? undefined, username: user.name ?? undefined } : null);

  //? Per-route formatter ref. Mirrors the socket-sync + API handler pattern —
  //? set after the syncEntry lookup; pre-lookup errors fall through to global
  //? formatter only because there's no entry yet to read from.
  let currentRouteName: string | undefined;
  let currentPerRouteFormatter: ErrorFormatter | undefined;

  const buildSyncError = ({
    response,
    preferred,
    userLanguage,
  }: {
    response: SyncErrorEnvelopeInput;
    preferred?: string | null;
    userLanguage?: string | null;
  }): HttpSyncResponse => buildFormattedError({
    response,
    preferred,
    userLanguage,
    routeName: currentRouteName,
    transport: 'http',
    userId: user?.id,
    perRouteFormatter: currentPerRouteFormatter,
  });

  const ioInstance = getIoInstance();

  //? Wrap the body so the span always closes — including on an unexpected
  //? throw. tryCatch returns `[error, value]` so we can call `span.end()`
  //? in one place after the inner work resolves.
  const [bodyError, bodyResult] = await tryCatch(async () => {
    if (!ioInstance) {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.ioUnavailable' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    // Build the shared context once — all stage helpers read from this.
    const ctx: HttpSyncContext = {
      name,
      cb,
      data,
      normalizedReceiver,
      ignoreSelf,
      token,
      requesterIp,
      stream,
      effectiveAbortSignal,
      preferredLocale,
      user,
      buildSyncError,
    };

    // Stage 1: parse and resolve the route name.
    const routeResult = await stageResolveRoute(ctx);
    if (routeResult.error) return routeResult.error;
    const { resolvedName, callbackName } = routeResult;
    currentRouteName = resolvedName;

    const { syncObject, functionsObject } = await getRuntimeSyncMapsFromSource();
    const serverSyncEntry = syncObject[`${resolvedName}_server`] as RuntimeSyncServerEntry | undefined;
    currentPerRouteFormatter = serverSyncEntry?.errorFormatter;

    // Stage 2: auth checks (only when a _server entry exists, which is always true after stage 1).
    if (serverSyncEntry) {
      const authError = stageCheckAuth(serverSyncEntry, ctx);
      if (authError) return authError;
    }

    // Stage 3: receiver authorization.
    const receiverError = stageAuthorizeReceiver(resolvedName, ctx);
    if (receiverError) return receiverError;

    //? SYNC-O4 — rate-limit runs BEFORE the consumer `preSyncAuthorize` hook
    //? so an unauthenticated (login:false) caller cannot trigger potentially-
    //? expensive DB/tenant lookups on every message with no throttle.
    const rateLimitResult = await applyHttpSyncRateLimits({
      resolvedName,
      token,
      requesterIp,
      user,
      buildSyncError,
      preferredLocale,
      routeLimit: serverSyncEntry?.rateLimit,
    });
    if (rateLimitResult) return rateLimitResult;

    // Stage 4: authorize hooks.
    const authorizeHookError = await stageRunAuthorizeHooks(resolvedName, ctx);
    if (authorizeHookError) return authorizeHookError;

    let serverOutput: Record<string, unknown> = {};
    if (serverSyncEntry) {
      // Stage 5: input validation.
      const validationError = await stageValidateInput(resolvedName, serverSyncEntry, ctx);
      if (validationError) return validationError;

      // Stage 6: execute the server handler.
      const executeResult = await stageExecuteServer(resolvedName, serverSyncEntry, functionsObject, ctx);
      if (executeResult.error) return executeResult.error;
      serverOutput = executeResult.serverOutput;
    }

    // Stage 7: fanout to room members.
    const fanoutError = await stageFanout(resolvedName, callbackName, serverOutput, syncObject, functionsObject, ctx);
    if (fanoutError) return fanoutError;

    if (shouldLogDev()) {
      getLogger().debug(`http sync: ${resolvedName} completed`);
    }

    //? S22 — conform to the CANONICAL Socket.io ack envelope: nest the route's
    //? `serverOutput` under `result` (was: flattened to the top level). The
    //? socket handler emits `{ status, message, result: serverOutput }`; the
    //? HTTP/SSE fallback now returns the identical shape so a consumer reading
    //? `response.result` gets the route's fields on BOTH transports. The
    //? `message` still prefers the route's own message when it supplied one,
    //? falling back to the generic success line (HttpSyncResponse requires it).
    const serverMessage = (serverOutput as { message?: unknown }).message;
    return {
      status: 'success' as const,
      message: typeof serverMessage === 'string' ? serverMessage : `${resolvedName} sync success`,
      result: serverOutput,
    };
  });
  if (bodyError) {
    getLogger().error(`http sync: ${name} threw`, bodyError, { sync: name });
    return buildSyncError({
      response: { status: 'error', errorCode: 'sync.serverExecutionFailed' },
      preferred: preferredLocale,
      userLanguage: user?.language,
    });
  }
  return bodyResult ?? buildSyncError({
    response: { status: 'error', errorCode: 'sync.serverExecutionFailed' },
    preferred: preferredLocale,
    userLanguage: user?.language,
  });
}
