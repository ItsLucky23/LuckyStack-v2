/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/require-await */

import Redis from 'ioredis';
import { env } from '../bootstrap/env';

//? here we create a Redis instance
const redis = new Redis({
  host: env.REDIS_HOST,
  port: Number.parseInt(env.REDIS_PORT, 10),
  ...(process.env.REDIS_USERNAME && { username: process.env.REDIS_USERNAME }),
  ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
  
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
});

redis.on('connect', async () => {
  console.log('Connected to Redis');

  // if (process.env.NODE_ENV == 'development') { return; }

  // const prefix = `${process.env.PROJECT_NAME}-games:`;
  // await clearKeysWithPrefix(prefix);
});

redis.on('error', (err) => {
  console.error('Error connecting to Redis:', err);
});

// async function clearKeysWithPrefix(prefix: string) {
//   let cursor = '0';
//   do {
//     const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
//     cursor = nextCursor;
//     if (keys.length > 0) {
//       // delete keys in bulk
//       await redis.del(...keys);
//       console.log(`Deleted Redis keys: ${keys.join(', ')}`);
//     }
//   } while (cursor !== '0');
// }

export { redis };
export default redis;