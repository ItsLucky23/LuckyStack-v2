import { randomUUID } from 'node:crypto';
import { redis } from './redis';
import { getDeployConfig } from './deployConfigRegistry';
import { getLogger } from './loggerRegistry';

//? @adr 0036
//? Writes a fresh UUID to `luckystack:boot:<envKey>` on startup. Any router
//? in another env that's truly sharing this Redis can read the same key.
//? Router boot handshake cross-checks against the /_health endpoint to catch
//? the "two Redis URLs that both respond" failure mode.

//? Single source of truth — also consumed by `@luckystack/router`'s
//? `bootHandshake.ts` so the prefix can never drift between writer and reader.
export const BOOT_KEY_PREFIX = 'luckystack:boot:';
const DEFAULT_BOOT_KEY_TTL_SECONDS = 3600;

const getBootKeyTtlSeconds = (): number =>
  getDeployConfig().routing?.bootKeyTtlSeconds ?? DEFAULT_BOOT_KEY_TTL_SECONDS;

const getBootUuidRefreshIntervalMs = (): number =>
  Math.max(100, Math.floor((getBootKeyTtlSeconds() * 1000) / 3));

export const resolveEnvKey = (): string => {
  return process.env.LUCKYSTACK_ENV ?? process.env.NODE_ENV ?? 'development';
};

export const writeBootUuid = async (envKey?: string): Promise<string> => {
  const key = envKey ?? resolveEnvKey();
  const uuid = randomUUID();
  await redis.set(`${BOOT_KEY_PREFIX}${key}`, uuid, 'EX', getBootKeyTtlSeconds());
  return uuid;
};

export const readBootUuid = async (envKey?: string): Promise<string | null> => {
  const key = envKey ?? resolveEnvKey();
  return redis.get(`${BOOT_KEY_PREFIX}${key}`);
};

/**
 * Extends the current environment boot UUID without rotating its value.
 *
 * Every healthy backend may renew the environment-level key, so multi-instance
 * deployments do not depend on whichever process happened to write it last. If
 * Redis recovered after the key expired, the first refresher writes a new UUID.
 */
export const refreshBootUuid = async (envKey?: string): Promise<void> => {
  const key = envKey ?? resolveEnvKey();
  const refreshed = await redis.expire(`${BOOT_KEY_PREFIX}${key}`, getBootKeyTtlSeconds());
  if (refreshed === 0) await writeBootUuid(key);
};

export interface BootUuidHeartbeat {
  stop: () => void;
}

/**
 * Keeps the Redis boot UUID alive for as long as this backend is running.
 *
 * The self-rescheduling timeout waits for each Redis operation to settle before
 * scheduling another, so an outage cannot accumulate overlapping refreshes.
 * The timer is unref'd and therefore never keeps an otherwise-finished process
 * alive. Failures are logged and retried on the next interval.
 */
export const startBootUuidHeartbeat = (envKey?: string): BootUuidHeartbeat => {
  const key = envKey ?? resolveEnvKey();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      void refreshBootUuid(key).then(
        () => { schedule(); },
        (error: unknown) => {
          getLogger().error(
            `[boot-uuid] failed to refresh ${BOOT_KEY_PREFIX}${key}; readiness may degrade if the TTL expires`,
            error instanceof Error ? error : new Error(String(error)),
          );
          schedule();
        },
      );
    }, getBootUuidRefreshIntervalMs());
    timer.unref();
  };

  schedule();

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
};
