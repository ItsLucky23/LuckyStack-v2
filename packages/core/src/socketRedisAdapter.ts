import type { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis } from './redis';

//? Cross-instance Socket.io pub/sub. Without this, room broadcasts only reach
//? clients connected to the same process. The router can route a client to
//? service instance A, but a sync event fired from instance B never reaches
//? them unless both instances share a pub/sub channel.
//?
//? Uses `redis.duplicate()` rather than the main handle because ioredis in
//? subscribe mode blocks non-pub/sub commands on that connection.
export const attachSocketRedisAdapter = (io: SocketIOServer): void => {
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();

  pubClient.on('error', (err) => {
    console.error('[socket-redis-adapter] pub client error:', err);
  });
  subClient.on('error', (err) => {
    console.error('[socket-redis-adapter] sub client error:', err);
  });

  io.adapter(createAdapter(pubClient, subClient));
};
