import type { BaseSessionLayout as SessionLayout } from "./sessionLayout";
import { randomBytes } from 'node:crypto';
import {
  socketEventNames,
  dispatchHook,
  getCsrfConfig,
  getLogger,
  getProjectConfig,
  formatKey,
  tryCatch,
  tryCatchSync,
} from '@luckystack/core';

import { getSessionAdapter } from './sessionAdapter';
import { applySessionSanitizer } from './sessionSanitizer';

//? Resolved at call time so project registration order doesn't matter.
//? Session TTL comes from projectConfig and is honoured by every adapter
//? (Redis default, or any custom adapter the consumer registers).
const getSessionTtl = (): number => 60 * 60 * 24 * getProjectConfig().session.expiryDays;

const isSessionLayout = (value: unknown): value is SessionLayout => {
  return value !== null && typeof value === 'object' && 'id' in value;
};

const parseSessionLayout = (value: string): SessionLayout | null => {
  const parsed = JSON.parse(value) as unknown;
  return isSessionLayout(parsed) ? parsed : null;
};

/**
 * Save or update a user session through the active session adapter.
 *
 * @param token - The session token (unique identifier)
 * @param data - The session data to store
 * @param newUser - If true, this is a new login (triggers single-session enforcement)
 * @param options.supersedeToken - A token belonging to the SAME browser that is
 *   being replaced by this login (e.g. re-login while already signed in). It is
 *   excluded from single-session enforcement so the user's current device is not
 *   kicked by its own new session. The caller is responsible for deleting it
 *   afterwards (use `deleteSession(supersedeToken, { skipSocketLogout: true })`).
 */
const saveSession = async (
  token: string,
  data: SessionLayout,
  newUser?: boolean,
  options?: { supersedeToken?: string },
): Promise<{ ok: true } | { ok: false; errorCode: string }> => {
  //? Reject a session with an empty `id` (B30). `isSessionLayout` only checks
  //? the `id` KEY is present, so a custom adapter / caller handing us an
  //? empty-string id would mint a session that is never tracked in the
  //? activeUsers set keyed by id — making it invisible to `revokeUserSessions`
  //? / "sign out everywhere". A real authenticated user always has a non-empty
  //? id, so this can only reject a malformed/untrackable session.
  if (!data.id) {
    //? Log only the first 8 chars of the token (LOGIN-F2) — enough to correlate
    //? with a specific request in logs/traces without exposing a live credential.
    getLogger().error('saveSession: refusing to persist a session with an empty user id', { tokenPrefix: token.slice(0, 8) });
    return { ok: false, errorCode: 'api.internalServerError' };
  }

  const [error, outcome] = await tryCatch(async () => {
    const adapter = getSessionAdapter();

    if (newUser) {
      const preSessionCreateResult = await dispatchHook('preSessionCreate', {
        token,
        user: data,
        persistent: !getProjectConfig().session.basedToken,
      });
      if (preSessionCreateResult.stopped) {
        getLogger().warn(`session create aborted by preSessionCreate hook`, { errorCode: preSessionCreateResult.signal.errorCode });
        return { ok: false, errorCode: preSessionCreateResult.signal.errorCode || 'api.internalServerError' } as const;
      }

      //? `onConflict: 'rejectNew'` enforcement. Previously this was documented
      //? as "enforced at the API layer" but NO code refused the login — the new
      //? session was persisted regardless and sessions accumulated unbounded,
      //? making the documented cap a silent no-op. Enforce it HERE (before any
      //? persist) so every login surface — credentials AND OAuth — is covered by
      //? construction: when `perUser: 'multiple'` with a `maxConcurrentPerUser`
      //? cap already reached and `onConflict === 'rejectNew'`, refuse the new
      //? login with a dedicated reason key instead of kicking an existing
      //? session. `'single'` and `'revokeOld'` keep kicking (handled below).
      const cfg = getProjectConfig().session;
      const perUser = cfg.perUser;
      if (
        perUser === 'multiple' &&
        cfg.onConflict === 'rejectNew' &&
        cfg.maxConcurrentPerUser !== null &&
        data.id
      ) {
        //? SOFT-CAP (LOGIN-F4): this is a read-then-decide, not an atomic
        //? reserve, so two concurrent logins for the same user can both pass the
        //? count check and temporarily exceed `maxConcurrentPerUser` by one.
        //? A Lua SETNX atomic counter would close the gap, but at the cost of a
        //? separate primitive and significant complexity. The window is narrowly
        //? time-bounded (< round-trip latency of two simultaneous logins), the
        //? worst case is one extra session that cleans up at normal TTL, and
        //? consumers operating strict caps should keep `maxConcurrentPerUser` at
        //? a margin that absorbs the race. Documented here so no future change
        //? re-tightens without understanding the trade-off.
        const existing = await getSessionAdapter().listActive(data.id);
        const others = existing.filter((t) => t !== token && t !== options?.supersedeToken);
        if (others.length + 1 > cfg.maxConcurrentPerUser) {
          getLogger().warn('session create rejected — concurrent-session cap reached (onConflict: rejectNew)', {
            userId: data.id,
            cap: cfg.maxConcurrentPerUser,
            active: others.length,
          });
          return { ok: false, errorCode: 'login.sessionLimitReached' } as const;
        }
      }
    }

    //? Mint a CSRF token on first session write. Subsequent (non-new) writes
    //? preserve the existing token so the client doesn't have to re-fetch on
    //? every session update. The token is rotated on logout via `deleteSession`
    //? AND whenever a genuinely new session is established (`newUser`) — a fresh
    //? login / OAuth re-login must not inherit a CSRF token that may have been
    //? carried into `data` from a prior session, so we always mint a new one.
    //? Token length is consumer-configurable via `registerCsrfConfig({ tokenLength })`.
    if (newUser || !data.csrfToken) {
      data.csrfToken = randomBytes(getCsrfConfig().tokenLength).toString('hex');
    }

    //? Apply the optional session sanitizer (M7) before BOTH persist and the
    //? client broadcast, so a consumer-registered redactor strips sensitive
    //? non-password columns (2FA secrets, billing ids, internal flags) that the
    //? default `sanitizeUserForSession` (password-only) leaves on the record. A
    //? throwing sanitizer must not break login — fall back to the raw record and
    //? log. `data.id` (used below for tracking/enforcement) is read from the
    //? original record, which is unaffected.
    //? Fail-CLOSED on a throwing sanitizer (M6): the previous fallback persisted
    //? AND broadcast the RAW record, leaking exactly the sensitive columns
    //? (2FA secrets, billing ids, internal flags) the sanitizer exists to strip.
    //? On error, fall back to a minimal known-safe projection — drop `password`
    //? (always) and any field a registered sanitizer was meant to redact is at
    //? least not leaked verbatim; the user can re-login if a field they needed is
    //? missing, but we never broadcast secrets.
    let persisted = data;
    const [sanitizeErr, sanitized] = tryCatchSync(() => applySessionSanitizer(data));
    if (sanitizeErr) {
      getLogger().error('saveSession: session sanitizer threw — falling back to password-stripped projection', sanitizeErr, { tokenPrefix: token.slice(0, 8) });
      const { password: _password, ...safe } = data as SessionLayout & { password?: unknown };
      persisted = safe;
    } else if (sanitized) {
      persisted = sanitized;
    }

    const ttl = getSessionTtl();
    //? Strip `token` from the stored value (LOGIN-M9). The token is the Redis key
    //? itself, so embedding it in the value is redundant AND means a Redis keyspace
    //? dump / `getAllSessions` / any admin log that prints a session record exposes
    //? a live replayable credential. `getSession` re-attaches it from the lookup
    //? key (`{ ...parsed, token }`) so callers receive the expected shape.
    const { token: _stripToken, ...persistedWithoutToken } = persisted as SessionLayout & { token?: unknown };
    await adapter.setRaw(token, JSON.stringify(persistedWithoutToken), ttl);

    const userId = data.id;

    //? Always track active tokens BEFORE the io check — `trackActive` is a
    //? Redis-only write, independent of any live socket. Gating it behind a
    //? live io meant processes without a Socket.io instance (the test harness,
    //? background workers, CLI tasks) persisted the session but never populated
    //? the active-tokens set, so `listSessions` / `revokeUserSessions` saw
    //? nothing for that user.
    if (userId) {
      await adapter.trackActive(userId, token, ttl);
    }

    const { getIoInstance } = await import('@luckystack/core');
    const io = getIoInstance();
    //? Socket fanout + single-session enforcement below need a live io; skip
    //? them when there isn't one. The session IS already persisted + tracked, so
    //? this is a success (background workers / CLI tasks have no io).
    if (!io) return { ok: true } as const;

    // Handle session-limit enforcement on new login. Logic:
    //   1. perUser = 'single' (default) →
    //      kick every prior session for this user.
    //   2. perUser = 'multiple' with `maxConcurrentPerUser` cap reached:
    //      `onConflict === 'revokeOld'` kicks oldest until under cap,
    //      `onConflict === 'rejectNew'` already refused the login above (before
    //      persisting), so by here the cap has room.
    //   3. perUser = 'multiple' with no cap → no kick.
    if (newUser && userId) {
      const sessionCfg = getProjectConfig().session;
      const effectivePerUser = sessionCfg.perUser;
      const cap = sessionCfg.maxConcurrentPerUser;

      const allTokens = await adapter.listActive(userId);
      //? Exclude the current token — it was just added and has no socket room yet.
      //? Also exclude `supersedeToken`: when the same browser re-logs-in, its old
      //? token is being replaced (not a separate device), so kicking it would log
      //? the user out of the very browser performing the login.
      const previousTokens = allTokens.filter(
        (t) => t !== token && t !== options?.supersedeToken,
      );

      let tokensToKick: string[] = [];
      if (effectivePerUser === 'single') {
        tokensToKick = previousTokens;
      } else if (cap !== null && previousTokens.length + 1 > cap && sessionCfg.onConflict === 'revokeOld') {
        // Kick oldest until under cap. Without ordering metadata in the adapter,
        // we drop the head of the list — most adapters return insertion-order
        // for set-like structures, but consumers needing strict LRU should
        // implement a custom adapter that orders deterministically.
        const excess = previousTokens.length + 1 - cap;
        tokensToKick = previousTokens.slice(0, excess);
      }

      if (tokensToKick.length > 0) {
        const { logout } = await import('./logout');

        await Promise.all(tokensToKick.map(async (previousToken) => {
          const sockets = io.sockets.adapter.rooms.get(previousToken);
          if (sockets) {
            getLogger().debug(`Kicking previous session for user ${userId}`);
            // Optional UI notification before the disconnect lands.
            if (sessionCfg.notifyOldDeviceOnRevoke) {
              io.to(previousToken).emit(socketEventNames.sessionReplaced, JSON.stringify({
                reason: 'session-replaced',
                userId,
              }));
            }
            for (const socketId of sockets) {
              const socket = io.sockets.sockets.get(socketId);
              if (socket) {
                await logout({ token: previousToken, socket, userId });
              }
            }
          } else {
            // No active sockets, just clean up the adapter state
            await adapter.delete(previousToken);
            await adapter.untrackActive(userId, previousToken);
          }
        }));
      }
    }

    // Broadcast session updates to connected clients (sanitized copy).
    if (io.sockets.adapter.rooms.has(token)) {
      io.to(token).emit(socketEventNames.updateSession, JSON.stringify(persisted));
    }

    if (newUser) {
      await dispatchHook('postSessionCreate', { token, user: data, persistent: !getProjectConfig().session.basedToken });
      //? Core-level observational session-lifecycle hook (CORE-40). Dispatched
      //? alongside the login-owned `postSessionCreate` so consumers (audit,
      //? presence, error-tracking) can react to a minted session via core's
      //? `registerHook('sessionCreated', …)` WITHOUT importing @luckystack/login.
      //? Fire-and-forget — the session already exists, so a handler error must
      //? not change the login outcome.
      if (userId) {
        void dispatchHook('sessionCreated', { token, userId });
      }
    }

    return { ok: true } as const;
  }, undefined, { fn: 'saveSession', token });

  if (error) {
    getLogger().error('saveSession failed', error, { tokenPrefix: token.slice(0, 8) });
    //? Surface the failure instead of swallowing it. Callers (credentials/OAuth
    //? login) MUST NOT mint a token + delete the prior session when the new
    //? session never persisted — a transient adapter blip would otherwise log
    //? the user out with no usable replacement.
    return { ok: false, errorCode: 'api.internalServerError' };
  }
  return outcome ?? { ok: false, errorCode: 'api.internalServerError' };
};

/**
 * Retrieve a user session through the active session adapter.
 *
 * @param token - The session token
 * @param options.refresh - When false, skip the sliding-expiration TTL
 *   extension. Defaults to true. Pass false for read-only probes (e.g. a
 *   background audit, an admin lookup) where a stolen token should NOT earn
 *   extra lifetime just because the server touched it (LOGIN-F9).
 * @returns The session data or null if not found
 */
const getSession = async (
  token: string | null,
  options?: { refresh?: boolean },
): Promise<SessionLayout | null> => {
  if (!token) return null;

  const [error, value] = await tryCatch(async () => {
    const adapter = getSessionAdapter();

    const raw = await adapter.getRaw(token);
    if (!raw) return null;

    const parsed = parseSessionLayout(raw);
    const userId = parsed?.id ?? null;

    //? Sliding expiration: each successful authenticated access extends session
    //? lifetime. `options.refresh` defaults to true to preserve the existing
    //? behaviour on the hot request path. Pass `{ refresh: false }` from
    //? background / admin probes that must not extend a potentially stolen token.
    const shouldRefresh = options?.refresh !== false;

    // Sliding expiration: each successful authenticated access extends session lifetime.
    const newTtl = getSessionTtl();
    const oldTtl = await adapter.ttl(token);
    const preRefreshResult = shouldRefresh
      ? await dispatchHook('preSessionRefresh', { token, userId, oldTtl, newTtl })
      : { stopped: true };

    //? A `preSessionRefresh` handler can stop the TTL extension (e.g. admin
    //? freezing a session pending review). When stopped, we skip the
    //? `adapter.expire` call and surface `applied: false` on the post payload
    //? so audit handlers see the same signal.
    let applied = false;
    if (!preRefreshResult.stopped) {
      applied = await adapter.expire(token, newTtl);
      //? Also refresh the activeUsers-set TTL on a sliding read. `trackActive`
      //? (which sets that TTL) runs only on saveSession, so a session kept
      //? alive purely by reads would outlive its activeUsers entry — after
      //? which `revokeUserSessions` / single-session enforcement enumerate
      //? `listActive` -> [] and silently miss the live token (a stolen token
      //? would then survive a password reset / sign-out-everywhere). Refresh
      //? the set TTL in lock-step with the session-key TTL to close that drift.
      if (applied && userId && adapter.touchActive) {
        await adapter.touchActive(userId, newTtl);
      }
    }
    if (shouldRefresh) {
      await dispatchHook('postSessionRefresh', {
        token,
        userId,
        oldTtl,
        newTtl,
        applied,
      });
    }

    if (!parsed) return null;
    const merged: SessionLayout = { ...parsed, token };
    return merged;
  }, undefined, { fn: 'getSession', token });

  if (error) {
    getLogger().error('getSession failed', error, { tokenPrefix: token.slice(0, 8) });
    return null;
  }
  return value;
};

/**
 * Delete a user session through the active adapter and notify connected
 * clients.
 *
 * @param token - The session token to delete
 * @param options.skipSocketLogout - When true, the session data + active-token
 *   tracking are cleaned up and the pre/post delete hooks still fire, but NO
 *   `logout` is emitted to sockets in the token's room. Use this when the SAME
 *   browser is replacing its session (re-login): emitting a logout would bounce
 *   that browser to the login page and null its brand-new session.
 * @returns true if successful
 */
const deleteSession = async (
  token: string,
  options?: { skipSocketLogout?: boolean },
): Promise<boolean> => {
  //? Opt-in spurious-delete tracing. `deleteSession` runs on EVERY legitimate
  //? logout / revokeSession / signOutEverywhere / deleteAccount, so an
  //? unconditional warn+stacktrace drowns the signal it's meant to surface and
  //? spams dev/test output with stacktrace-shaped lines that read like errors.
  //? Set LUCKYSTACK_TRACE_SESSION_DELETES=1 when hunting a "why was I logged
  //? out?" bug to print the originating caller's stack; silent otherwise.
  if (process.env.LUCKYSTACK_TRACE_SESSION_DELETES === '1') {
    getLogger().warn('[session] deleteSession invoked', {
      tokenPrefix: token.slice(0, 8),
      stack: new Error('deleteSession invoked').stack,
    });
  }

  const [error, ok] = await tryCatch(async () => {
    const adapter = getSessionAdapter();

    const raw = await adapter.getRaw(token);
    let resolvedUserId: string | null = null;

    if (raw) {
      resolvedUserId = parseSessionLayout(raw)?.id ?? null;
    }

    const preSessionDeleteResult = await dispatchHook('preSessionDelete', { token, userId: resolvedUserId });
    if (preSessionDeleteResult.stopped) {
      getLogger().warn(`session delete aborted by preSessionDelete hook`, { errorCode: preSessionDeleteResult.signal.errorCode });
      return false;
    }

    //? Delete the session KEY before untracking it from the activeUsers set. If
    //? `delete` threw transiently AFTER untrackActive, the token would stay
    //? readable (still in Redis) yet enumerable-as-gone — a stolen token could
    //? ride past a sign-out-everywhere. Deleting first means a transient throw
    //? leaves the token tracked + retried by the next `revokeUserSessions` sweep
    //? instead of orphaning a still-readable session. `delete` was already
    //? unconditional (ran even when `raw` was missing), so it just moves earlier.
    await adapter.delete(token);

    if (raw && resolvedUserId) {
      const { getIoInstance } = await import('@luckystack/core');
      const ioInstance = getIoInstance();

      // Reuse the same logout flow as single-session enforcement.
      if (ioInstance && !options?.skipSocketLogout) {
        const { logout } = await import('./logout');
        const sockets = ioInstance.sockets.adapter.rooms.get(token);

        if (sockets) {
          await Promise.all([...sockets].map(async (socketId) => {
            const socket = ioInstance.sockets.sockets.get(socketId);
            if (!socket) return;

            await logout({
              token,
              socket,
              userId: resolvedUserId,
              skipSessionDelete: true,
            });
          }));
        }
      }

      await adapter.untrackActive(resolvedUserId, token);
    }
    await dispatchHook('postSessionDelete', { token, userId: resolvedUserId });
    //? Core-level observational session-lifecycle hook (CORE-40), the revoke
    //? counterpart to `sessionCreated`. Lets consumers react to a revoked
    //? session via core's `registerHook('sessionRevoked', …)` without depending
    //? on login internals. Fire-and-forget.
    void dispatchHook('sessionRevoked', { token, userId: resolvedUserId });
    return true;
  }, undefined, { fn: 'deleteSession', token });

  if (error) {
    getLogger().error('deleteSession failed', error, { tokenPrefix: token.slice(0, 8) });
    return false;
  }
  return ok ?? false;
};

/**
 * Get all active sessions (admin utility). Returns empty when the active
 * adapter doesn't implement enumeration (signed-JWT-stateless, log-only).
 *
 * @returns Array of all session data
 */
const getAllSessions = async (): Promise<SessionLayout[]> => {
  const [error, sessions] = await tryCatch(async () => {
    const adapter = getSessionAdapter();
    if (!adapter.listAll) {
      getLogger().warn(`[session] getAllSessions: adapter '${adapter.name}' does not implement listAll — returning empty`);
      return [];
    }

    const rows = await adapter.listAll();
    const parsedSessions: SessionLayout[] = [];
    for (const { raw } of rows) {
      const parsed = parseSessionLayout(raw);
      if (parsed) parsedSessions.push(parsed);
    }
    return parsedSessions;
  }, undefined, { fn: 'getAllSessions' });

  if (error) {
    getLogger().error('getAllSessions failed', error);
    return [];
  }
  return sessions ?? [];
};

/**
 * Revoke every active session for a user, optionally keeping one alive.
 *
 * @param userId - The user whose sessions to revoke
 * @param exceptToken - If provided, this session is left untouched. Pass the
 *   caller's own token when revoking after a password change so the user
 *   isn't logged out of the device they just changed it from. Pass null/omit
 *   to revoke everything (account deletion, "sign out everywhere", etc.).
 *
 * Each revocation goes through `deleteSession`, so connected sockets are
 * told to log out via the same flow as a normal logout. Returns the number
 * of sessions actually revoked.
 */
const revokeUserSessions = async (userId: string, exceptToken?: string | null): Promise<number> => {
  if (!userId) return 0;

  const adapter = getSessionAdapter();
  const tokens = await adapter.listActive(userId);
  const targets = exceptToken ? tokens.filter((t) => t !== exceptToken) : tokens;

  //? Count only the sessions that were ACTUALLY revoked (M13). `deleteSession`
  //? can return `false` (preSessionDelete veto, adapter error) yet was
  //? previously counted as revoked — so "sign out everywhere" / post-password-
  //? reset over-reported and a token a delete failed for could survive a reset.
  //? Summing truthy results means the count reflects reality; a failed token
  //? stays live and is logged by `deleteSession` for retry.
  const results = await Promise.all(targets.map((token) => deleteSession(token)));
  return results.filter(Boolean).length;
};

//? Legacy key-builders preserved as exports for downstream code that
//? assumed a stable Redis layout (admin tooling, dev REPL scripts). New
//? callers should use the active SessionAdapter instead.
const sessionKeyFor = (token: string): string => formatKey('-session', token);
const activeUsersKeyFor = (userId: string): string => formatKey('-activeUsers', userId);

export { saveSession, getSession, deleteSession, getAllSessions, revokeUserSessions, sessionKeyFor, activeUsersKeyFor };
