import type { BaseSessionLayout as SessionLayout } from "./sessionLayout";
import { randomBytes } from 'node:crypto';
import { redis, captureException, socketEventNames, dispatchHook, getProjectConfig } from '@luckystack/core';

const PROJECT_NAME = process.env.PROJECT_NAME ?? 'luckystack';
//? Resolved at call time so project registration order doesn't matter.
const getSessionTtl = (): number => 60 * 60 * 24 * getProjectConfig().session.expiryDays;

const isSessionLayout = (value: unknown): value is SessionLayout => {
  return value !== null && typeof value === 'object' && 'id' in value;
};

const parseSessionLayout = (value: string): SessionLayout | null => {
  const parsed = JSON.parse(value) as unknown;
  return isSessionLayout(parsed) ? parsed : null;
};

/**
 * Save or update a user session in Redis.
 *
 * @param token - The session token (unique identifier)
 * @param data - The session data to store
 * @param newUser - If true, this is a new login (triggers single-session enforcement)
 */
const saveSession = async (token: string, data: SessionLayout, newUser?: boolean): Promise<void> => {
  try {
    if (newUser) {
      const preSessionCreateResult = await dispatchHook('preSessionCreate', {
        token,
        user: data,
        persistent: !getProjectConfig().session.basedToken,
      });
      if (preSessionCreateResult.stopped) {
        console.log(`session create aborted by preSessionCreate hook: ${preSessionCreateResult.signal.errorCode}`, 'yellow');
        return;
      }
    }

    //? Mint a CSRF token on first session write. Subsequent writes preserve
    //? the existing token so the client doesn't have to re-fetch on every
    //? session update. The token is rotated on logout via `deleteSession`.
    if (!data.csrfToken) {
      data.csrfToken = randomBytes(32).toString('hex');
    }

    const sessionKey = `${PROJECT_NAME}-session:${token}`;
    await redis.set(sessionKey, JSON.stringify(data));
    await redis.expire(sessionKey, getSessionTtl());

    const { getIoInstance } = await import('@luckystack/core');
    const ioInstance = getIoInstance();
    const io = ioInstance;
    if (!io) { return; }

    const userId = data.id;

    // Always track active tokens so server-side user/session updates can fan out in real time
    if (userId) {
      const activeUsersKey = `${PROJECT_NAME}-activeUsers:${userId}`;
      await redis.sadd(activeUsersKey, token);
      await redis.expire(activeUsersKey, getSessionTtl());
    }

    // Handle single-session enforcement on new login
    if (newUser && !getProjectConfig().session.allowMultiple) {
      if (!userId) return;

      const activeUsersKey = `${PROJECT_NAME}-activeUsers:${userId}`;
      const allTokens = await redis.smembers(activeUsersKey);
      // Exclude the current token — it was just added and has no socket room yet
      const previousTokens = allTokens.filter(t => t !== token);

      if (previousTokens.length > 0) {
        const { logout } = await import('./logout');

        // Kick all previous sessions for this user
        await Promise.all(previousTokens.map(async (previousToken) => {
          const sockets = io.sockets.adapter.rooms.get(previousToken);
          if (sockets) {
            console.log(`Kicking previous session for user ${userId}`, 'yellow');
            for (const socketId of sockets) {
              const socket = io.sockets.sockets.get(socketId);
              if (socket) {
                await logout({ token: previousToken, socket, userId });
              }
            }
          } else {
            // No active sockets, just clean up Redis
            await redis.del(`${PROJECT_NAME}-session:${previousToken}`);
            await redis.srem(activeUsersKey, previousToken);
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
  } catch (error) {
    console.log('Error saving session:', error, 'red');
    captureException(error, { fn: 'saveSession', token });
  }
};

/**
 * Retrieve a user session from Redis.
 *
 * @param token - The session token
 * @returns The session data or null if not found
 */
const getSession = async (token: string | null): Promise<SessionLayout | null> => {
  if (!token) return null;

  try {
    const sessionKey = `${PROJECT_NAME}-session:${token}`;
    const session = await redis.get(sessionKey);
    if (!session) return null;

    // Sliding expiration: each successful authenticated access extends session lifetime.
    await redis.expire(sessionKey, getSessionTtl());

    const parsed = parseSessionLayout(session);
    if (!parsed) return null;

    return { ...parsed, token };
  } catch (error) {
    console.log('Error getting session:', error, 'red');
    captureException(error, { fn: 'getSession', token });
    return null;
  }
};

/**
 * Delete a user session from Redis and notify connected clients.
 *
 * @param token - The session token to delete
 * @returns true if successful
 */
const deleteSession = async (token: string): Promise<boolean> => {
  try {
    const rawUser = await redis.get(`${PROJECT_NAME}-session:${token}`);
    let resolvedUserId: string | null = null;

    if (rawUser) {
      resolvedUserId = parseSessionLayout(rawUser)?.id ?? null;
    }

    const preSessionDeleteResult = await dispatchHook('preSessionDelete', { token, userId: resolvedUserId });
    if (preSessionDeleteResult.stopped) {
      console.log(`session delete aborted by preSessionDelete hook: ${preSessionDeleteResult.signal.errorCode}`, 'yellow');
      return false;
    }

    if (rawUser) {

      if (resolvedUserId) {
        const activeUsersKey = `${PROJECT_NAME}-activeUsers:${resolvedUserId}`;
        const { getIoInstance } = await import('@luckystack/core');
    const ioInstance = getIoInstance();

        // Reuse the same logout flow as single-session enforcement.
        if (ioInstance) {
          const { logout } = await import('./logout');
          const sockets = ioInstance.sockets.adapter.rooms.get(token);

          if (sockets) {
            await Promise.all([...sockets].map(async (socketId) => {
              const socket = ioInstance.sockets.sockets.get(socketId);
              if (!socket) { return; }

              await logout({
                token,
                socket,
                userId: resolvedUserId,
                skipSessionDelete: true,
              });
            }));
          }
        }

        await redis.srem(activeUsersKey, token);
      }
    }

    await redis.del(`${PROJECT_NAME}-session:${token}`);
    await dispatchHook('postSessionDelete', { token, userId: resolvedUserId });
    return true;
  } catch (error) {
    console.log('Error deleting session:', error, 'red');
    captureException(error, { fn: 'deleteSession', token });
    return false;
  }
};

/**
 * Get all active sessions (admin utility).
 *
 * @returns Array of all session data
 */
const getAllSessions = async (): Promise<SessionLayout[]> => {
  try {
    const pattern = `${PROJECT_NAME}-session:*`;
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batchKeys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (Array.isArray(batchKeys) && batchKeys.length > 0) {
        keys.push(...batchKeys);
      }
    } while (cursor !== '0');

    const sessions = await Promise.all(keys.map((key) => redis.get(key)));

    const parsedSessions: SessionLayout[] = [];
    for (const session of sessions) {
      if (!session) {
        continue;
      }

      const parsed = parseSessionLayout(session);
      if (parsed) {
        parsedSessions.push(parsed);
      }
    }

    return parsedSessions;
  } catch (error) {
    console.log('Error getting all sessions:', error, 'red');
    captureException(error, { fn: 'getAllSessions' });
    return [];
  }
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

  const activeUsersKey = `${PROJECT_NAME}-activeUsers:${userId}`;
  const tokens = await redis.smembers(activeUsersKey);
  const targets = exceptToken ? tokens.filter((t) => t !== exceptToken) : tokens;

  await Promise.all(targets.map((token) => deleteSession(token)));
  return targets.length;
};

export { saveSession, getSession, deleteSession, getAllSessions, revokeUserSessions };
