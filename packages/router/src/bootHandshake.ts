import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  BOOT_KEY_PREFIX,
  collectSynchronizedEnvKeys,
  getDeployConfig,
  getLogger,
  getRedisConnectionOptions,
  hashSynchronizedValue,
  tryCatch,
} from '@luckystack/core';

//? Detects "two Redis URLs that both respond" — a failure mode where two
//? environments think they share Redis but don't. Protocol:
//?   1. Write a fresh boot UUID under `luckystack:boot:<envKey>`.
//?   2. If the current env declares a fallback, hit `fallback/system/_health`
//?      and assert the returned `bootUuid` matches our write.
//?
//? Warning-only by default. Set `deploy.config.ts -> routing.strictBootHandshake`
//? to `true` to refuse startup on mismatch/unreachable — do this once every
//? service in your deployment is known to expose /_health.

const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 3000;
const DEFAULT_BOOT_KEY_TTL_SECONDS = 3600;

const getHealthProbeTimeoutMs = (): number =>
  getDeployConfig().routing?.healthProbeTimeoutMs ?? DEFAULT_HEALTH_PROBE_TIMEOUT_MS;
const getBootKeyTtlSeconds = (): number =>
  getDeployConfig().routing?.bootKeyTtlSeconds ?? DEFAULT_BOOT_KEY_TTL_SECONDS;

export interface RunBootHandshakeInput {
  envKey: string;
  fallbackEnvKey: string;
  /**
   * Base URL of the fallback env's `system` service. The router hits
   * `<fallbackBaseUrl>/_health` and expects a JSON body with `bootUuid`.
   * When undefined, only the Redis write happens (no remote probe).
   */
  fallbackBaseUrl?: string;
  /**
   * When true, the handshake throws on mismatch/unreachable instead of
   * logging a warning. Wired through from `deploy.config.ts -> routing.
   * strictBootHandshake`.
   */
  strict?: boolean;
}

interface FallbackHealthResponse {
  bootUuid?: string;
  synchronizedHashes?: Record<string, string | null>;
}

const probeFallbackHealth = async (baseUrl: string): Promise<FallbackHealthResponse | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); }, getHealthProbeTimeoutMs());
  const [error, payload] = await tryCatch<FallbackHealthResponse | null, undefined>(async () => {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/_health`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json() as FallbackHealthResponse;
  });
  clearTimeout(timeout);
  if (error) return null;
  return payload ?? null;
};

const compareSynchronizedHashes = (
  fallbackHashes: Record<string, string | null> | undefined,
  report: (msg: string) => void,
): void => {
  const keys = collectSynchronizedEnvKeys();
  if (keys.length === 0) return;

  if (!fallbackHashes) {
    report(`synchronized-env check: fallback /_health did not return hashes — cannot verify ${keys.length} synchronized key(s)`);
    return;
  }

  for (const key of keys) {
    const localValue = process.env[key];
    const localHash = localValue === undefined ? null : hashSynchronizedValue(localValue);
    const remoteHash = fallbackHashes[key] ?? null;

    if (localHash === null && remoteHash === null) {
      report(`synchronized env '${key}' missing on both router and fallback — cannot detect drift`);
      continue;
    }
    if (localHash !== remoteHash) {
      report(`synchronized env '${key}' DIFFERS between router and fallback — sessions/cookies will not be portable`);
    }
  }
};

export const runBootHandshake = async (input: RunBootHandshakeInput): Promise<void> => {
  //? Centralized connection options so a Redis env-rename touches one file
  //? in core, not both core and router.
  const redisOptions = getRedisConnectionOptions();

  const client = new Redis({ ...redisOptions, lazyConnect: true });
  const bootUuid = randomUUID();

  const [writeError] = await tryCatch(async () => {
    await client.connect();
    await client.set(`${BOOT_KEY_PREFIX}${input.envKey}`, bootUuid, 'EX', getBootKeyTtlSeconds());
  });
  client.disconnect();
  if (writeError) {
    throw new Error(
      `[router] boot handshake failed to write Redis key: ${writeError.message}`,
    );
  }

  const reportIssue = (message: string): void => {
    if (input.strict) {
      throw new Error(`[router] ${message}`);
    }
    getLogger().warn(`[router] ${message}`);
  };

  if (!input.fallbackBaseUrl) {
    getLogger().info(`[router] boot handshake: wrote UUID to local Redis; no fallback probe target`);
    return;
  }

  const fallbackHealth = await probeFallbackHealth(input.fallbackBaseUrl);
  if (!fallbackHealth) {
    reportIssue(
      `boot handshake: fallback env '${input.fallbackEnvKey}' /_health unreachable — cannot verify shared Redis`,
    );
    return;
  }

  if (!fallbackHealth.bootUuid) {
    reportIssue(
      `boot handshake: fallback /_health returned no bootUuid — cannot verify shared Redis`,
    );
    return;
  }

  //? Write our UUID, then read fallback's UUID (should be fallback's own boot
  //? value). If the two envs truly share Redis, fallback's key would be
  //? readable from here too. Check that separately.
  const fallbackClient = new Redis({ ...redisOptions, lazyConnect: true });
  const [compareError, localReadOfFallbackKey] = await tryCatch(async () => {
    await fallbackClient.connect();
    return await fallbackClient.get(`${BOOT_KEY_PREFIX}${input.fallbackEnvKey}`);
  });
  fallbackClient.disconnect();

  if (compareError) {
    reportIssue(`boot handshake: Redis compare failed: ${compareError.message}`);
  } else if (localReadOfFallbackKey === fallbackHealth.bootUuid) {
    getLogger().info(`[router] boot handshake: shared Redis verified with fallback env '${input.fallbackEnvKey}'`);
  } else {
    reportIssue(
      `boot handshake MISMATCH: fallback env '${input.fallbackEnvKey}' is connected to a different Redis than this router. ` +
      `Expected key ${BOOT_KEY_PREFIX}${input.fallbackEnvKey} to equal '${fallbackHealth.bootUuid}' but got '${localReadOfFallbackKey ?? 'null'}'.`,
    );
    return;
  }

  //? Once shared Redis is verified, also check that synchronized env vars
  //? (cookie secrets, project-level config) match by hash across the two
  //? envs. Mismatch means sessions minted by one side can't be decrypted
  //? by the other — a subtle failure mode worth catching at boot.
  compareSynchronizedHashes(fallbackHealth.synchronizedHashes, (msg) =>
    { reportIssue(msg); },
  );
};
