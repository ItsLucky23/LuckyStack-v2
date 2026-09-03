import type { Server as SocketIOServer } from 'socket.io';
import type { Redis as RedisClient } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import type { RedisAdapterOptions } from '@socket.io/redis-adapter';
import { redis } from './redis';
import { getLogger } from './loggerRegistry';
import { getProjectName } from './projectConfig';
import { resolveEnvKey } from './bootUuid';

export interface AttachSocketRedisAdapterOptions {
  /**
   * Options forwarded to `@socket.io/redis-adapter`'s `createAdapter`
   * (e.g. `key` prefix, `requestsTimeout`, `publishOnSpecificResponseChannel`).
   * `key` defaults to {@link resolveSocketAdapterKey} when omitted.
   */
  adapterOptions?: Partial<RedisAdapterOptions>;
  /**
   * Supply a pre-built pub client instead of `redis.duplicate()`. Use this for
   * a dedicated adapter connection, custom auth, or a sentinel/cluster handle.
   * When omitted the framework duplicates the default `redis` handle.
   */
  pubClient?: RedisClient;
  /** Pre-built sub client (see `pubClient`). */
  subClient?: RedisClient;
}

//? The adapter's `key` names the Redis pub/sub channels — every instance on the
//? same key AND the same Redis is one Socket.io cluster: broadcasts fan out to
//? all of them, and `fetchSockets()` waits for an answer from EACH of them (or
//? times out). The upstream default is the fixed string `socket.io`, so two
//? deployments that merely share a Redis server (a dev laptop tunnelled into
//? the staging Redis, staging and production on one managed instance) silently
//? become one cluster: staging's role change reaches the developer's sockets,
//? and staging's `fetchSockets()` hangs on a laptop that went to sleep.
//? Deriving the key from the project name plus the deploy-topology key keeps
//? every instance of ONE environment together (same PROJECT_NAME, same
//? LUCKYSTACK_ENV) and separates environments without a single extra setting.
export const resolveSocketAdapterKey = (): string => `${getProjectName()}:${resolveEnvKey()}:socket.io`;

//? Cross-instance Socket.io pub/sub. Without this, room broadcasts only reach
//? clients connected to the same process. The router can route a client to
//? service instance A, but a sync event fired from instance B never reaches
//? them unless both instances share a pub/sub channel.
//?
//? Uses `redis.duplicate()` rather than the main handle because ioredis in
//? subscribe mode blocks non-pub/sub commands on that connection. Pass
//? `pubClient`/`subClient` to override (e.g. a separate adapter connection),
//? and `adapterOptions` to tune the underlying `createAdapter` — an explicit
//? `adapterOptions.key` wins over the derived one.
export const attachSocketRedisAdapter = (
  io: SocketIOServer,
  options: AttachSocketRedisAdapterOptions = {},
): void => {
  const pubClient = options.pubClient ?? redis.duplicate();
  const subClient = options.subClient ?? redis.duplicate();

  pubClient.on('error', (err) => {
    getLogger().error('[socket-redis-adapter] pub client error', err);
  });
  subClient.on('error', (err) => {
    getLogger().error('[socket-redis-adapter] sub client error', err);
  });

  io.adapter(createAdapter(pubClient, subClient, {
    ...options.adapterOptions,
    key: options.adapterOptions?.key ?? resolveSocketAdapterKey(),
  }));
};
