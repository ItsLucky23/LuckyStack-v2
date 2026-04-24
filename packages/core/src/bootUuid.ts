import { randomUUID } from 'node:crypto';
import { redis } from './redis';

//? Writes a fresh UUID to `luckystack:boot:<envKey>` on startup. Any router
//? in another env that's truly sharing this Redis can read the same key.
//? Router boot handshake cross-checks against the /_health endpoint to catch
//? the "two Redis URLs that both respond" failure mode.

const BOOT_KEY_PREFIX = 'luckystack:boot:';
const BOOT_KEY_TTL_SECONDS = 3600;

export const resolveEnvKey = (): string => {
  return process.env.LUCKYSTACK_ENV ?? process.env.NODE_ENV ?? 'development';
};

export const writeBootUuid = async (envKey?: string): Promise<string> => {
  const key = envKey ?? resolveEnvKey();
  const uuid = randomUUID();
  await redis.set(`${BOOT_KEY_PREFIX}${key}`, uuid, 'EX', BOOT_KEY_TTL_SECONDS);
  return uuid;
};

export const readBootUuid = async (envKey?: string): Promise<string | null> => {
  const key = envKey ?? resolveEnvKey();
  return redis.get(`${BOOT_KEY_PREFIX}${key}`);
};
