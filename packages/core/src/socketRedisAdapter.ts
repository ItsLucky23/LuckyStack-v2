import type { Server as SocketIOServer } from 'socket.io';
import type { Redis as RedisClient } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import type { RedisAdapterOptions } from '@socket.io/redis-adapter';
import { redis } from './redis';
import { getLogger } from './loggerRegistry';

export interface AttachSocketRedisAdapterOptions {
  /**
   * Options forwarded to `@socket.io/redis-adapter`'s `createAdapter`
   * (e.g. `key` prefix, `requestsTimeout`, `publishOnSpecificResponseChannel`).
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

//? Cross-instance Socket.io pub/sub. Without this, room broadcasts only reach
//? clients connected to the same process. The router can route a client to
//? service instance A, but a sync event fired from instance B never reaches
//? them unless both instances share a pub/sub channel.
//?
//? Uses `redis.duplicate()` rather than the main handle because ioredis in
//? subscribe mode blocks non-pub/sub commands on that connection. Pass
//? `pubClient`/`subClient` to override (e.g. a separate adapter connection),
//? and `adapterOptions` to tune the underlying `createAdapter`.
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

  io.adapter(createAdapter(pubClient, subClient, options.adapterOptions));
};
