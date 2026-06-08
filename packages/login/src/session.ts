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
} from '@luckystack/core';

import { getSessionAdapter } from './sessionAdapter';

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
    }

    //? Mint a CSRF token on first session write. Subsequent writes preserve
    //? the existing token so the client doesn't have to re-fetch on every
    //? session update. The token is rotated on logout via `deleteSession`.
    //? Token length is consumer-configurable via `registerCsrfConfig({ tokenLength })`.
    data.csrfToken ??= randomBytes(getCsrfConfig().tokenLength).toString('hex');

    const ttl = getSessionTtl();
    await adapter.setRaw(token, JSON.stringify(data), ttl);

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
    //   1. perUser = 'single' (default) OR legacy `allowMultiple: false` →
    //      kick every prior session for this user.
    //   2. perUser = 'multiple' with `maxConcurrentPerUser` cap reached:
    //      `onConflict === 'revokeOld'` kicks oldest until under cap,
    //      `onConflict === 'rejectNew'` would refuse the new login (handled
    //      at the login API layer, not here).
    //   3. perUser = 'multiple' with no cap → no kick.
    if (newUser && userId) {
      const sessionCfg = getProjectConfig().session;
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- BC shim: legacy `allowMultiple` still honored when set
      const effectivePerUser = sessionCfg.allowMultiple ? 'multiple' : sessionCfg.perUser;
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

    // Broadcast session updates to connected clients
    if (io.sockets.adapter.rooms.has(token)) {
      io.to(token).emit(socketEventNames.updateSession, JSON.stringify(data));
    }

    if (newUser) {
      await dispatchHook('postSessionCreate', { token, user: data, persistent: !getProjectConfig().session.basedToken });
    }

    return { ok: true } as const;
  }, undefined, { fn: 'saveSession', token });

  if (error) {
    getLogger().error('saveSession failed', error, { token });
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
 * @returns The session data or null if not found
 */
const getSession = async (token: string | null): Promise<SessionLayout | null> => {
  if (!token) return null;

  const [error, value] = await tryCatch(async () => {
    const adapter = getSessionAdapter();

    const raw = await adapter.getRaw(token);
    if (!raw) return null;

    const parsed = parseSessionLayout(raw);
    const userId = parsed?.id ?? null;

    // Sliding expiration: each successful authenticated access extends session lifetime.
    const newTtl = getSessionTtl();
    const oldTtl = await adapter.ttl(token);
    const preRefreshResult = await dispatchHook('preSessionRefresh', { token, userId, oldTtl, newTtl });

    //? A `preSessionRefresh` handler can stop the TTL extension (e.g. admin
    //? freezing a session pending review). When stopped, we skip the
    //? `adapter.expire` call and surface `applied: false` on the post payload
    //? so audit handlers see the same signal.
    let applied = false;
    if (!preRefreshResult.stopped) {
      applied = await adapter.expire(token, newTtl);
    }
    await dispatchHook('postSessionRefresh', {
      token,
      userId,
      oldTtl,
      newTtl,
      applied,
    });

    if (!parsed) return null;
    const merged: SessionLayout = { ...parsed, token };
    return merged;
  }, undefined, { fn: 'getSession', token });

  if (error) {
    getLogger().error('getSession failed', error, { token });
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

    await adapter.delete(token);
    await dispatchHook('postSessionDelete', { token, userId: resolvedUserId });
    return true;
  }, undefined, { fn: 'deleteSession', token });

  if (error) {
    getLogger().error('deleteSession failed', error, { token });
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

  await Promise.all(targets.map((token) => deleteSession(token)));
  return targets.length;
};

//? Legacy key-builders preserved as exports for downstream code that
//? assumed a stable Redis layout (admin tooling, dev REPL scripts). New
//? callers should use the active SessionAdapter instead.
const sessionKeyFor = (token: string): string => formatKey('-session', token);
const activeUsersKeyFor = (userId: string): string => formatKey('-activeUsers', userId);

export { saveSession, getSession, deleteSession, getAllSessions, revokeUserSessions, sessionKeyFor, activeUsersKeyFor };
