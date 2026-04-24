import { allowMultipleSessions, sessionExpiryDays, sessionBasedToken, SessionLayout } from "../../../config";
import { redis } from '@luckystack/core';
import { captureException, socketEventNames } from '@luckystack/core';
import { dispatchHook } from '../../../server/hooks/registry';

const PROJECT_NAME = process.env.PROJECT_NAME ?? 'luckystack';
const SESSION_TTL = 60 * 60 * 24 * sessionExpiryDays;

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
    const sessionKey = `${PROJECT_NAME}-session:${token}`;
    await redis.set(sessionKey, JSON.stringify(data));
    await redis.expire(sessionKey, SESSION_TTL);

    const { ioInstance } = await import('../../../server/sockets/socket');
    const io = ioInstance;
    if (!io) { return; }

    const userId = data.id;

    // Always track active tokens so server-side user/session updates can fan out in real time
    if (userId) {
      const activeUsersKey = `${PROJECT_NAME}-activeUsers:${userId}`;
      await redis.sadd(activeUsersKey, token);
      await redis.expire(activeUsersKey, SESSION_TTL);
    }

    // Handle single-session enforcement on new login
    if (newUser && !allowMultipleSessions) {
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
      await dispatchHook('postSessionCreate', { token, user: data, persistent: !sessionBasedToken });
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
    await redis.expire(sessionKey, SESSION_TTL);

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

      if (resolvedUserId) {
        const activeUsersKey = `${PROJECT_NAME}-activeUsers:${resolvedUserId}`;
        const { ioInstance } = await import('../../../server/sockets/socket');

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

export { saveSession, getSession, deleteSession, getAllSessions };
