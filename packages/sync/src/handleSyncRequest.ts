//? SYNC-20 — targeted disables replacing the former blanket `/* eslint-disable */`
//? (which masked findings across this security-critical transport file). These
//? mirror the `@luckystack/api` handlers: template expressions interpolate the
//? route name / receiver (already validated strings); nullish-coalescing is
//? deliberately avoided where `||`'s empty-string fallthrough is intended; the
//? `?.` chains on runtime-map values read as "unnecessary" to the typed view but
//? are real runtime guards. (The former `user!` assertion at the `validateRequest`
//? call site was removed once core made `validateRequest` null-safe — CORE-06.)
/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/restrict-template-expressions, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-non-null-assertion, eqeqeq */
import { randomUUID } from "node:crypto";
import type { syncMessage, PostSyncFanoutPayload, PostSyncExecutePayload } from "@luckystack/core";
import { Socket } from "socket.io";
import { readSession, getProjectConfig , getRuntimeSyncMaps ,
  validateRequest,
  extractTokenFromSocket,
  getIoInstance,
  tryCatch,
  parseTransportRouteName,
  checkRateLimit,
  buildSyncProgressEventName,
  buildSyncResponseEventName,
  socketEventNames,
  dispatchHook,
  validateInputByType,
  getLogger,
  resolveClientIp, extractLanguageFromHeader, normalizeErrorResponse ,
  runWithErrorTrackerIdentityScope,
  setCurrentErrorTrackerIdentity,
  registerSyncAbortController,
  unregisterSyncAbortController } from "@luckystack/core";
import type { BaseSessionLayout as SessionLayout } from '@luckystack/core';




import type { ErrorFormatter } from "@luckystack/core";
import { buildSyncStreamEmitters } from './_shared/streamEmitters';

import type {
  RuntimeErrorResponse,
  RuntimeSyncServerEntry,
  RuntimeSyncClientHandler,
  SyncErrorEnvelopeInput,
} from './_shared/syncTypes';
import { shouldLogDev, shouldLogStream } from './_shared/logFlags';
import { buildFormattedError } from './_shared/errorBuilders';
import { processClientSyncForRecipient } from './_shared/clientFanout';
import { resolveSyncValidationMode } from './_shared/validationMode';
import { authorizeSyncReceiver } from './_shared/receiverAuth';

type SyncErrorBuilder = (args: {
    response: SyncErrorEnvelopeInput;
    preferred?: string | null;
    userLanguage?: string | null;
  }) => RuntimeErrorResponse;

//? Returns true when both buckets passed; false when one rejected and the
//? caller should bail. The caller still owns the socket emit + responseIndex
//? wiring because the existing code structure interleaves emit logic with
//? other guard returns.
const applySyncRateLimits = async ({
  resolvedName,
  token,
  socket,
  user,
  responseIndex,
  buildSyncError,
  preferredLocale,
  routeLimit,
}: {
  resolvedName: string;
  token: string | null;
  socket: Socket;
  user: SessionLayout | null;
  responseIndex: number | undefined;
  buildSyncError: SyncErrorBuilder;
  preferredLocale: string | null | undefined;
  //? SYNC-11 — per-route `rateLimit` export. `undefined` ⇒ fall back to the
  //? global `defaultApiLimit`; a number overrides the per-requester bucket;
  //? `false` disables it (the global per-IP bucket below still applies).
  routeLimit: number | false | undefined;
}): Promise<boolean> => {
  const config = getProjectConfig();
  //? Resolve the real client IP once for both buckets. Default
  //? `http.trustProxy: false` returns `socket.handshake.address` verbatim
  //? (only IPv4-mapped IPv6 canonicalized), preserving historical keys; a
  //? trusted proxy honors X-Forwarded-For / X-Real-IP.
  const resolvedIp = resolveClientIp({
    rawAddress: socket.handshake.address,
    headers: socket.handshake.headers,
    trustProxy: config.http.trustProxy,
  });
  const defaultApiLimit = routeLimit === undefined ? config.rateLimiting.defaultApiLimit : routeLimit;
  if (defaultApiLimit !== false && defaultApiLimit > 0) {
    const requesterIdentity = token ?? resolvedIp;
    const keyPrefix = token ? 'token' : 'ip';
    const rateLimitKey = `${keyPrefix}:${requesterIdentity}:sync:${resolvedName}`;
    const { allowed, resetIn } = await checkRateLimit({
      key: rateLimitKey,
      limit: defaultApiLimit,
      windowMs: config.rateLimiting.windowMs,
    });
    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        //? Parity with the API handler: an anonymous per-route bucket is IP-keyed,
        //? so the scope is `ip` (with `route` still set to mark it a per-route
        //? bucket vs the global `:sync:all` IP bucket), never `route`.
        scope: token ? 'user' : 'ip',
        key: rateLimitKey,
        limit: defaultApiLimit,
        windowMs: config.rateLimiting.windowMs,
        count: defaultApiLimit + 1,
        route: resolvedName,
        userId: user?.id,
        ip: token ? undefined : resolvedIp,
      });
      if (typeof responseIndex === 'number') {
        socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
          response: {
            status: 'error',
            errorCode: 'sync.rateLimitExceeded',
            errorParams: [{ key: 'seconds', value: resetIn }],
            httpStatus: 429,
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        }));
      }
      return false;
    }
  }

  const defaultIpLimit = config.rateLimiting.defaultIpLimit;
  if (defaultIpLimit !== false && defaultIpLimit > 0) {
    const requesterIp = resolvedIp;
    const ipKey = `ip:${requesterIp}:sync:all`;
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
        ip: requesterIp,
      });
      if (typeof responseIndex === 'number') {
        socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
          response: {
            status: 'error',
            errorCode: 'sync.rateLimitExceeded',
            errorParams: [{ key: 'seconds', value: resetIn }],
            httpStatus: 429,
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        }));
      }
      return false;
    }
  }

  return true;
};


// export default async function handleSyncRequest({ name, clientData, user, serverOutput, roomCode }: syncMessage) {
//? ET-02 — open a per-request error-tracker identity scope around the ENTIRE sync
//? handler before any await that could interleave with another concurrent request
//? (`readSession` below is such a boundary). The resolved session is written into
//? the scope's ALS box the moment it resolves, so two concurrent syncs with
//? different users can't cross-attribute captures. Each request gets its own box.
export default async function handleSyncRequest(args: {
  msg: syncMessage,
  socket: Socket,
  token: string | null,
}): Promise<void> {
  await runWithErrorTrackerIdentityScope(() => handleSyncRequestInner(args));
}

async function handleSyncRequestInner({ msg, socket, token }: {
  msg: syncMessage,
  socket: Socket,
  token: string | null,
}) {

  const ioInstance = getIoInstance();
  if (!ioInstance) { return; }

  //? first we validate the data
  if (typeof msg != 'object') {
    if (shouldLogDev()) {
      getLogger().warn('sync: socket message was not a json object');
    }
    const normalized = normalizeErrorResponse({
      response: { status: 'error', errorCode: 'sync.invalidRequest' },
      preferredLocale:
        extractLanguageFromHeader(socket.handshake.headers['x-language'])
        || extractLanguageFromHeader(socket.handshake.headers['accept-language']),
    });
    return socket.emit(socketEventNames.sync, {
      status: normalized.status,
      message: normalized.message,
      errorCode: normalized.errorCode,
      errorParams: normalized.errorParams,
      httpStatus: normalized.httpStatus,
    });
  }

  const { name, data, cb, receiver: rawReceiver, responseIndex, ignoreSelf } = msg;
  const receiver = typeof rawReceiver === 'string' ? rawReceiver.trim() : '';
  const preferredLocale =
    extractLanguageFromHeader(socket.handshake.headers['x-language'])
    || extractLanguageFromHeader(socket.handshake.headers['accept-language']);

  //? EXT-02 — per-message socket interception seam (websocket counterpart to
  //? `preHttpRequest`). Fires before session lookup / route resolution / auth
  //? so a consumer can gate, throttle, or audit individual sync messages. A
  //? stop signal rejects the message: we emit a localized error envelope on the
  //? response channel (when the client supplied a `responseIndex`) and abort.
  const preMessageResult = await dispatchHook('preSocketMessage', {
    channel: 'sync',
    socketId: socket.id,
    ip: socket.handshake.address,
    authenticated: Boolean(token),
    routeName: typeof name === 'string' ? name : undefined,
  });
  if (preMessageResult.stopped) {
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), normalizeErrorResponse({
      response: {
        status: 'error',
        errorCode: preMessageResult.signal.errorCode,
        httpStatus: preMessageResult.signal.httpStatus,
      },
      preferredLocale,
    }));
  }

  //? Per-route formatter ref + resolved-name ref — both undefined until the
  //? sync entry is looked up. Pre-lookup errors (invalid message, unknown
  //? route) emit with global formatter only because there's no syncEntry yet.
  //? `let` (not `const`): each is declared here, captured by the `buildSyncError`
  //? closure below, and assigned only further down once the route/session resolves
  //? — so a `const` at declaration is impossible (TDZ in the closure). The
  //? flow-based `prefer-const` mis-reads the single later assignment as the sole
  //? init for the two `string | undefined` refs; disabled with that rationale.
  // eslint-disable-next-line prefer-const
  let currentRouteName: string | undefined;
  let currentPerRouteFormatter: ErrorFormatter | undefined;
  // eslint-disable-next-line prefer-const
  let currentUserId: string | undefined;

  const buildSyncError = ({
    response,
    preferred,
    userLanguage,
  }: {
    response: SyncErrorEnvelopeInput;
    preferred?: string | null;
    userLanguage?: string | null;
  }): RuntimeErrorResponse => buildFormattedError({
    response,
    preferred,
    userLanguage,
    routeName: currentRouteName,
    transport: 'socket',
    userId: currentUserId,
    perRouteFormatter: currentPerRouteFormatter,
  });

  //? Positive plain-object guard. `typeof data != 'object'` alone let an ARRAY
  //? `clientInput` through (`typeof [] === 'object'`), reaching a `_server`
  //? handler that assumes a plain object — and with `validation: 'relaxed'`
  //? there is no further runtime shape check. `!data` already excludes `null`.
  if (!name || !data || typeof name != 'string' || typeof data != 'object' || Array.isArray(data)) {
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.invalidRequest' },
      preferred: preferredLocale,
    }))
  }

  const normalizedData = data as Record<string, unknown>;

  const parsedRoute = parseTransportRouteName({ value: name, prefix: 'sync' });
  if (parsedRoute.status === 'error') {
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: {
        status: 'error',
        errorCode: 'routing.invalidServiceRouteName',
        errorParams: [{ key: 'name', value: name }],
      },
      preferred: preferredLocale,
    }));
  }

  const resolvedName = parsedRoute.normalizedFullName;
  currentRouteName = resolvedName;

  if (!cb || typeof cb != 'string') {
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.invalidCallback' },
      preferred: preferredLocale,
    }));
  }

  if (!receiver) {
    if (shouldLogDev()) {
      getLogger().warn('sync: missing receiver / roomCode', { receiver });
    }
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.missingReceiver' },
      preferred: preferredLocale,
    }));
  }

  if (shouldLogDev()) {
    getLogger().debug(`sync: ${resolvedName} called`, { sync: resolvedName });
  }

  const user = await readSession(token);
  currentUserId = user?.id;
  //? ET-02 — bind the resolved session into the active per-request ALS identity
  //? box so every subsequent capture (server handler throw, `_client` fanout,
  //? hook subscriber) attributes to this user. Identity also still flows to the
  //? legacy global via the `preSyncAuthorize` hook subscriber; the ALS read wins
  //? at capture time.
  setCurrentErrorTrackerIdentity(user?.id ? { id: user.id, email: user.email ?? undefined, username: user.name ?? undefined } : null);
  const { syncObject, functionsObject } = await getRuntimeSyncMaps();

  //? B1 / S13 — per-request AbortController. The controller drives three things:
  //?   1. Aborts when the client emits `syncCancel { cb: <cancelId> }`.
  //?   2. Aborts when the originator socket disconnects (listener below).
  //?   3. Gates further chunk emits via the signal handed to streamEmitters.
  //?
  //? S13 SECURITY: the registry key MUST NOT be the client-controlled callback
  //? string (`cb` = `${name}/${version}`). That value is REUSED across every
  //? concurrent request of the same route, so two in-flight `sync/chat/send/v1`
  //? calls would register under the identical `${socket.id}:${cb}` key — the
  //? second `Map.set` clobbered the first's controller, a `syncCancel` aborted
  //? the wrong request, and the first request's `unregister` deleted the
  //? second's entry (registry corruption). We now key on a SERVER-ISSUED,
  //? per-request unique `cancelId` and hand that id to the client via a
  //? handshake frame on the progress channel; the client cancels by echoing it
  //? back as `syncCancel { cb: cancelId }`. The wire field stays `cb` so the
  //? existing server-side cancel listener is unchanged — only its value is now
  //? a unique id instead of a reused callback name.
  const cancelId = randomUUID();
  const abortController = new AbortController();
  const abortKey = registerSyncAbortController(socket.id, cancelId, abortController);
  //? Hand the server-issued cancel id to the originator on the progress channel
  //? BEFORE any work runs, so an abort fired mid-flight (even on a non-streaming
  //? route) can target THIS exact request. The client filters this frame out of
  //? its `onStream` delivery by the reserved `__cancelId` marker key.
  if (typeof responseIndex === 'number') {
    socket.emit(buildSyncProgressEventName(responseIndex), { __cancelId: cancelId });
  }
  const onSocketDisconnect = () => {
    abortController.abort();
  };
  socket.once(socketEventNames.disconnect, onSocketDisconnect);
  let cleanupDone = false;
  const cleanupRequest = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    socket.off(socketEventNames.disconnect, onSocketDisconnect);
    unregisterSyncAbortController(abortKey);
  };

  //? SYNC-02 — top-level error envelope. The socket handler runs un-`.catch()`'d
  //? from loadSocket (`void (async () => …)()`), so ANY throw below — a
  //? `fetchSockets()` Redis-adapter timeout, a misbehaving `_server`/`_client`
  //? handler, a hook subscriber — would surface as a fatal unhandledRejection
  //? (process kill on modern Node). The HTTP twin already wraps its body the
  //? same way. On throw we run cleanup and emit `sync.serverExecutionFailed`.
  const [handlerError] = await tryCatch(async () => {

  //? we check if there is a client file or/and a server file, if they both dont exist we abort
  if (!syncObject[`${resolvedName}_client`] && !syncObject[`${resolvedName}_server`]) {
    if (shouldLogDev()) {
      getLogger().warn(`sync: ${name} has no _client or _server file`, { sync: name });
    }
    cleanupRequest();
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.notFound' },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
  }

  //? SYNC: reject a CLIENT-ONLY route (a `_client` file with no `_server`) as
  //? misconfigured. The `_server` file is the documented, MANDATORY gate that
  //? owns auth (`auth.login` / `additional`) and input validation; the entire
  //? auth+validate block below lives inside `if (serverSyncEntry)`. Without
  //? this guard a `_client`-only route would run receiver-auth + the `_client`
  //? fanout with fully attacker-controlled, UNVALIDATED input and NO login
  //? check — reachable by unauthenticated sockets. Treat it as a routing error.
  if (!syncObject[`${resolvedName}_server`]) {
    if (shouldLogDev()) {
      getLogger().warn(`sync: ${resolvedName} has a _client file but no required _server file`, { sync: resolvedName });
    }
    cleanupRequest();
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.notFound' },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
  }

  const { emitServerSyncStream, emitBroadcastSyncStream, emitStreamToTokens, flushPressure } =
    buildSyncStreamEmitters({
      cb,
      receiver,
      resolvedName,
      logLabel: 'sync',
      signal: abortController.signal,
      originatorSocket: socket,
      emitOriginatorChunk: (payload) => {
        if (typeof responseIndex !== 'number') return;
        socket.emit(buildSyncProgressEventName(responseIndex), payload);
      },
    });

  //? Pipeline order: auth → rate-limit → validate → execute → respond.
  //? Auth runs first so unauthenticated probes can't consume rate-limit budget
  //? or learn input shape from `inputValidation.message`. Mirrors api handlers.
  const serverSyncEntry = syncObject[`${resolvedName}_server`] as RuntimeSyncServerEntry | undefined;
  currentPerRouteFormatter = serverSyncEntry?.errorFormatter;
  if (serverSyncEntry) {
    const { auth } = serverSyncEntry;
    if (auth.login && !user?.id) {
      if (shouldLogDev()) {
        getLogger().warn(`sync: ${resolvedName} requires login`, { sync: resolvedName });
      }
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
        response: { status: 'error', errorCode: 'auth.required' },
        preferred: preferredLocale,
      }));
    }

    //? SYNC-02 — guard the anonymous `additional`-only case. When a route
    //? declares `auth.additional` predicates but NOT `auth.login`, an
    //? unauthenticated socket reaches here with `user === null`. Passing
    //? `user!` into `validateRequest` would execute `condition.key in null`
    //? → a fatal `TypeError` that, because loadSocket invokes this handler as
    //? an un-`.catch()`'d `void` IIFE, becomes a process-killing
    //? unhandledRejection. Reject as `auth.required` BEFORE the call (a route
    //? gating on session fields legitimately requires a session).
    if (auth.additional && auth.additional.length > 0 && !user) {
      if (shouldLogDev()) {
        getLogger().warn(`sync: ${resolvedName} requires a session for additional auth`, { sync: resolvedName });
      }
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
        response: { status: 'error', errorCode: 'auth.required' },
        preferred: preferredLocale,
      }));
    }

    //? CORE-06 / SYNC-02 — `validateRequest` is now null-safe: pass the real
    //? (possibly null) session instead of the former `user!` assertion. The
    //? anonymous-additional case is still rejected explicitly above with
    //? `auth.required`; core forbids any `additional[]` predicate when no
    //? session rather than throwing on `condition.key in null`.
    const validationResult = validateRequest({ auth, user });
    if (validationResult.status === 'error') {
      if (shouldLogDev()) {
        getLogger().warn(`sync: auth failed for ${resolvedName}`, { sync: resolvedName, errorCode: validationResult.errorCode });
      }
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
        response: {
          status: 'error',
          errorCode: validationResult.errorCode || 'auth.forbidden',
          errorParams: validationResult.errorParams,
          httpStatus: validationResult.httpStatus,
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }));
    }
  }

  //? SYNC-07 — default receiver authorization. Reject a cluster-wide `'all'`
  //? broadcast when `sync.allowClientReceiverAll` is false, and (when
  //? `sync.requireRoomMembership` is true) a room the originator socket has not
  //? actually joined. Both flags default to today's permissive behavior, so a
  //? missing key changes nothing. Runs before `preSyncAuthorize` so the
  //? framework baseline is enforced first; the hook still applies finer policy.
  const syncConfig = getProjectConfig().sync;
  const receiverAuth = authorizeSyncReceiver({
    receiver,
    allowClientReceiverAll: syncConfig.allowClientReceiverAll,
    requireRoomMembership: syncConfig.requireRoomMembership,
    isMember: () => socket.rooms.has(receiver),
  });
  if (!receiverAuth.allowed) {
    if (shouldLogDev()) {
      getLogger().warn(`sync: receiver authorization failed for ${resolvedName}`, { sync: resolvedName, receiver, errorCode: receiverAuth.errorCode });
    }
    cleanupRequest();
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: receiverAuth.errorCode, httpStatus: 403 },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
  }

  //? Custom authorization hook. Fires after basic auth + AuthProps check
  //? pass, before rate-limit + input validation. Consumers use this to
  //? enforce room-membership rules ("user X may only emit sync to room
  //? Y"), per-tenant policies, or audit trails. Stop with a specific
  //? errorCode to reject without revealing input shape.
  const preAuthorizeResult = await dispatchHook('preSyncAuthorize', {
    routeName: resolvedName,
    data: normalizedData,
    user,
    receiver,
    transport: 'socket',
  });
  if (preAuthorizeResult.stopped) {
    if (shouldLogDev()) {
      getLogger().warn(`sync: preSyncAuthorize stopped ${resolvedName}`, { sync: resolvedName, errorCode: preAuthorizeResult.signal.errorCode });
    }
    cleanupRequest();
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: {
        status: 'error',
        errorCode: preAuthorizeResult.signal.errorCode,
        httpStatus: preAuthorizeResult.signal.httpStatus,
      },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
  }

  //? Observational mirror of `preSyncAuthorize`. Fires after the request
  //? passes auth + custom policy; lets audit-log / metrics subscribers
  //? record successful authorizations without forking the dispatch path.
  //? Stop signals from handlers are ignored (this is post-decision).
  void dispatchHook('postSyncAuthorize', {
    routeName: resolvedName,
    data: normalizedData,
    user,
    receiver,
    transport: 'socket',
  });

  //? Rate limit check: per-sync bucket fallback + global per-IP cap
  const rateLimitOk = await applySyncRateLimits({
    resolvedName,
    token,
    socket,
    user,
    responseIndex,
    buildSyncError,
    preferredLocale,
    routeLimit: serverSyncEntry?.rateLimit,
  });
  if (!rateLimitOk) { cleanupRequest(); return; }

  let serverOutput = {};
  if (serverSyncEntry) {
    const { main: serverMain, inputType, inputTypeFilePath } = serverSyncEntry;

    //? EXT-04 — validation-stage hooks mirroring the API pipeline. `preSyncValidate`
    //? may stop before validation; `postSyncValidate` reports the outcome.
    const preValidateResult = await dispatchHook('preSyncValidate', {
      routeName: resolvedName,
      data: normalizedData,
      user,
      receiver,
      transport: 'socket',
    });
    if (preValidateResult.stopped) {
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
        response: {
          status: 'error',
          errorCode: preValidateResult.signal.errorCode,
          httpStatus: preValidateResult.signal.httpStatus,
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }));
    }

    //? Per-route validation toggle (mirrors the API handler). `'relaxed'` or
    //? `{ input: 'skip' }` skips runtime input validation entirely — for routes
    //? whose payload shape can't be modelled in TS. Default `'strict'`.
    if (resolveSyncValidationMode(serverSyncEntry.validation) === 'strict') {
      const inputValidation = await validateInputByType({
        typeText: inputType,
        value: normalizedData,
        rootKey: 'clientInput',
        filePath: inputTypeFilePath,
      });
      void dispatchHook('postSyncValidate', {
        routeName: resolvedName,
        data: normalizedData,
        user,
        receiver,
        transport: 'socket',
        validation: inputValidation.status === 'error'
          ? { status: 'error', message: inputValidation.message }
          : { status: 'success' },
      });
      if (inputValidation.status === 'error') {
        //? SYNC-04 SECURITY: do NOT echo the raw validator message (e.g.
        //? "clientInput.userId should be string") back to the client — that lets
        //? an unauthenticated caller enumerate a route's input schema. The
        //? DETAILED message travels to the `postSyncValidate` hook above + the
        //? dev log below only; the client receives the generic code. Mirrors the
        //? API fix in `@luckystack/api`'s socketValidationStage.
        if (shouldLogDev()) {
          getLogger().warn(`sync: input validation failed for ${resolvedName}`, { sync: resolvedName, message: inputValidation.message });
        }
        cleanupRequest();
        return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
          response: {
            status: 'error',
            errorCode: 'sync.invalidInputType',
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        }));
      }
    } else {
      void dispatchHook('postSyncValidate', {
        routeName: resolvedName,
        data: normalizedData,
        user,
        receiver,
        transport: 'socket',
        validation: { status: 'success' },
      });
    }

    //? EXT-04 — execution-stage hooks mirroring the API pipeline. `preSyncExecute`
    //? may stop before the `_server` runs; the single `executePayload` reference is
    //? reused so `@luckystack/error-tracking` can pin spans via WeakMap, and
    //? `postSyncExecute` fires on BOTH the success AND failure paths (the error
    //? path was previously invisible to hook consumers).
    const executePayload: PostSyncExecutePayload = {
      routeName: resolvedName,
      data: normalizedData,
      user,
      receiver,
      transport: 'socket',
      result: undefined,
      error: null,
      durationMs: 0,
    };
    const preExecuteResult = await dispatchHook('preSyncExecute', executePayload);
    if (preExecuteResult.stopped) {
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
        response: {
          status: 'error',
          errorCode: preExecuteResult.signal.errorCode,
          httpStatus: preExecuteResult.signal.httpStatus,
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }));
    }

    //? if the user has passed all the checks we call the preload sync function and return the result
    const executeStart = Date.now();
    const [serverSyncError, serverSyncResult] = await tryCatch(
      async () => await serverMain({
        clientInput: normalizedData,
        user,
        functions: functionsObject,
        roomCode: receiver,
        stream: emitServerSyncStream,
        broadcastStream: emitBroadcastSyncStream,
        streamTo: emitStreamToTokens,
        abortSignal: abortController.signal,
        flushPressure,
      }),
      undefined,
      {
        handler: 'handleSyncRequest',
        sync: resolvedName,
        stage: 'server',
        userId: user?.id,
        receiver,
        transport: 'socket',
      },
    );
    executePayload.result = serverSyncResult;
    executePayload.error = serverSyncError ?? null;
    executePayload.durationMs = Date.now() - executeStart;
    await dispatchHook('postSyncExecute', executePayload);
    if (serverSyncError) {
      if (shouldLogDev()) {
        getLogger().error(`sync: server execution failed for ${resolvedName}`, serverSyncError, { sync: resolvedName });
      }
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
        response: { status: 'error', errorCode: 'sync.serverExecutionFailed' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }));
    } else if (serverSyncResult?.status == 'error') {
      const normalizedServerError = buildSyncError({
        response: serverSyncResult,
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
      if (shouldLogDev()) {
        getLogger().warn(`sync: server returned error for ${resolvedName}`, { sync: resolvedName, message: normalizedServerError.message });
      }
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), normalizedServerError);
    } else if (serverSyncResult?.status !== 'success') {
      //? badReturn means it doesnt include a status key with the value 'success' || 'error'
      if (shouldLogDev()) {
        getLogger().warn(`sync: ${resolvedName}_server returned invalid response`, { sync: resolvedName });
      }
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
        response: { status: 'error', errorCode: 'sync.invalidServerResponse' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }));
    } else if (serverSyncResult?.status == 'success') {
      serverOutput = serverSyncResult;
    }
  }

  //? from here on we can assume that we have either called a server sync and got a proper result of we didnt call a server sync

  //? Cross-instance recipient list. `fetchSockets()` (via the Redis adapter)
  //? returns RemoteSocket objects spanning EVERY backend sharing the adapter —
  //? not just this process's room view — so a normal sync fan-out reaches room
  //? members connected to other instances. `remoteSocket.emit()` routes to the
  //? owning instance. (Per-sync Redis round-trip; see docs/ARCHITECTURE_MULTI_INSTANCE.md.)
  const sockets = receiver === 'all'
    ? await ioInstance.fetchSockets()
    : await ioInstance.in(receiver).fetchSockets();

  //? now we check if we found any sockets
  if (sockets.length === 0) {
    if (shouldLogDev()) {
      getLogger().warn('sync: no sockets found for receiver', { receiver, sync: resolvedName });
    }
    cleanupRequest();
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.noReceiversFound' },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
  }

  //? Single payload reference reused by pre/post — span pinning in
  //? `@luckystack/error-tracking` uses WeakMap on this object. `recipientCount`
  //? is mutated in place after fanout completes.
  const fanoutPayload: PostSyncFanoutPayload = {
    routeName: resolvedName,
    data: normalizedData,
    user,
    receiver,
    serverOutput,
    transport: 'socket',
    recipientCount: 0,
  };
  const preFanoutResult = await dispatchHook('preSyncFanout', fanoutPayload);
  if (preFanoutResult.stopped) {
    cleanupRequest();
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: {
        status: 'error',
        errorCode: preFanoutResult.signal.errorCode,
        httpStatus: preFanoutResult.signal.httpStatus,
      },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
  }

  //? here we loop over all the connected clients
  //? Yield to the event loop periodically so a giant `receiver: 'all'` fanout
  //? doesn't starve other requests. Tunables live in projectConfig.sync.
  const { fanoutYieldEvery, fanoutYieldMs } = getProjectConfig().sync;
  //? SYNC-16 — clamp to >= 1 so a misconfigured `fanoutYieldEvery: 0` doesn't
  //? produce `n % 0 === NaN` (never truthy) → the loop never yields and a giant
  //? `receiver: 'all'` fanout can starve the event loop.
  const yieldEvery = Math.max(1, fanoutYieldEvery);
  let recipientCount = 0;
  let tempCount = 1;
  for (const tempSocket of sockets) {
    tempCount++;
    if (tempCount % yieldEvery === 0) { await new Promise(resolve => setTimeout(resolve, fanoutYieldMs)); }

    //? check if they have a token stored in their cookie or session based on the settings
    const tempToken = extractTokenFromSocket(tempSocket);

    //? Symmetry with the HTTP handler: strict equality + a `token` guard so an
    //? anonymous (token-less) socket is never treated as "self" (null == null).
    if (ignoreSelf && typeof ignoreSelf === 'boolean' && token && token === tempToken) {
        continue;
      }

    //? SYNC-22 — per-recipient fanout hook. Fires ONCE per resolved recipient,
    //? before this socket receives anything, letting a consumer FILTER the
    //? fanout (block users, per-tenant visibility) without a `_client` file. A
    //? stop signal SKIPS just this recipient — the loop continues and the
    //? recipient is NOT counted as delivered. `recipientUserId` is left null on
    //? the hot path (resolving it would cost a session read per recipient); a
    //? handler that needs it can derive it from `recipientSocketId` / `receiver`.
    const preRecipientResult = await dispatchHook('preSyncRecipient', {
      routeName: resolvedName,
      receiver,
      recipientSocketId: tempSocket.id,
      recipientUserId: null,
      serverOutput,
    });
    if (preRecipientResult.stopped) {
      continue;
    }

    recipientCount++;

    if (syncObject[`${resolvedName}_client`]) {
      const clientSyncHandler = syncObject[`${resolvedName}_client`] as RuntimeSyncClientHandler;
      await processClientSyncForRecipient({
        tempSocket,
        tempToken,
        clientSyncHandler,
        data: normalizedData,
        functionsObject,
        serverOutput,
        receiver,
        resolvedName,
        callbackKey: cb,
        transport: 'socket',
        handlerName: 'handleSyncRequest',
        logLabel: 'sync',
        shouldLogDev,
        shouldLogStream,
        buildSyncError,
        //? Socket transport prefers `x-language` over `accept-language` —
        //? preserved verbatim from the previous inlined error path.
        resolvePreferredLocale: (headers) =>
          extractLanguageFromHeader(headers['x-language'])
          || extractLanguageFromHeader(headers['accept-language']),
        sourceUserId: user?.id,
      });
    } else {
      //? if there is no client function we still want to send the server data to the clients
      const result = {
        cb,
        fullName: resolvedName,
        serverOutput,
        clientOutput: {},  // No client file, so empty output
        message: `${resolvedName} sync success`,
        status: 'success'
      };
      if (shouldLogDev()) {
        getLogger().debug(`sync: ${resolvedName} server-only success`, { result });
      }
      tempSocket.emit(socketEventNames.sync, result);
    }
  }

  fanoutPayload.recipientCount = recipientCount;
  await dispatchHook('postSyncFanout', fanoutPayload);

  cleanupRequest();
  return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), {
    status: 'success',
    message: `sync ${resolvedName} success`,
    result: serverOutput,
  });

  }, undefined, {
    handler: 'handleSyncRequest',
    sync: currentRouteName,
    stage: 'handler',
    userId: currentUserId,
    receiver,
    transport: 'socket',
  });
  if (handlerError) {
    if (shouldLogDev()) {
      getLogger().error(`sync: unhandled error for ${currentRouteName ?? name}`, handlerError, { sync: currentRouteName });
    }
    cleanupRequest();
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.serverExecutionFailed' },
      preferred: preferredLocale,
    }));
  }
}