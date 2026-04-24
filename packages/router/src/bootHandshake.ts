import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import deployConfig from '../../../deploy.config';

//? Detects "two Redis URLs that both respond" — a failure mode where two
//? environments think they share Redis but don't. Protocol:
//?   1. Write a fresh boot UUID under `luckystack:boot:<envKey>`.
//?   2. If the current env declares a fallback, hit `fallback/system/_health`
//?      and assert the returned `bootUuid` matches our write.
//?
//? Warning-only by default. Set `deploy.config.ts -> routing.strictBootHandshake`
//? to `true` to refuse startup on mismatch/unreachable — do this once every
//? service in your deployment is known to expose /_health.

const BOOT_KEY_PREFIX = 'luckystack:boot:';
const HEALTH_PROBE_TIMEOUT_MS = 3000;

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
  const timeout = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/_health`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json() as FallbackHealthResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const collectSynchronizedEnvKeysFromConfig = (): string[] => {
  const keys = new Set<string>();
  for (const resource of Object.values(deployConfig.resources)) {
    for (const key of resource.synchronizedEnvKeys ?? []) {
      keys.add(key);
    }
  }
  return [...keys].sort();
};

const hashLocalEnvValue = (value: string): string => {
  return createHash('sha256').update(value).digest('hex');
};

const compareSynchronizedHashes = (
  fallbackHashes: Record<string, string | null> | undefined,
  report: (msg: string) => void,
): void => {
  const keys = collectSynchronizedEnvKeysFromConfig();
  if (keys.length === 0) return;

  if (!fallbackHashes) {
    report(`synchronized-env check: fallback /_health did not return hashes — cannot verify ${keys.length} synchronized key(s)`);
    return;
  }

  for (const key of keys) {
    const localValue = process.env[key];
    const localHash = localValue === undefined ? null : hashLocalEnvValue(localValue);
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
  const host = process.env.REDIS_HOST ?? '127.0.0.1';
  const port = Number.parseInt(process.env.REDIS_PORT ?? '6379', 10);
  const password = process.env.REDIS_PASSWORD;

  const client = new Redis({ host, port, password, lazyConnect: true });
  const bootUuid = randomUUID();

  try {
    await client.connect();
    await client.set(`${BOOT_KEY_PREFIX}${input.envKey}`, bootUuid, 'EX', 3600);
  } catch (err) {
    throw new Error(
      `[router] boot handshake failed to write Redis key: ${(err as Error).message}`,
    );
  } finally {
    client.disconnect();
  }

  const reportIssue = (message: string): void => {
    if (input.strict) {
      throw new Error(`[router] ${message}`);
    }
    console.warn(`[router] ${message}`);
  };

  if (!input.fallbackBaseUrl) {
    console.log(`[router] boot handshake: wrote UUID to local Redis; no fallback probe target`);
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
  const fallbackClient = new Redis({ host, port, password, lazyConnect: true });
  try {
    await fallbackClient.connect();
    const localReadOfFallbackKey = await fallbackClient.get(`${BOOT_KEY_PREFIX}${input.fallbackEnvKey}`);
    if (localReadOfFallbackKey !== fallbackHealth.bootUuid) {
      reportIssue(
        `boot handshake MISMATCH: fallback env '${input.fallbackEnvKey}' is connected to a different Redis than this router. ` +
        `Expected key ${BOOT_KEY_PREFIX}${input.fallbackEnvKey} to equal '${fallbackHealth.bootUuid}' but got '${localReadOfFallbackKey ?? 'null'}'.`,
      );
      return;
    }
    console.log(`[router] boot handshake: shared Redis verified with fallback env '${input.fallbackEnvKey}'`);
  } catch (err) {
    reportIssue(`boot handshake: Redis compare failed: ${(err as Error).message}`);
  } finally {
    fallbackClient.disconnect();
  }

  //? Once shared Redis is verified, also check that synchronized env vars
  //? (cookie secrets, project-level config) match by hash across the two
  //? envs. Mismatch means sessions minted by one side can't be decrypted
  //? by the other — a subtle failure mode worth catching at boot.
  compareSynchronizedHashes(fallbackHealth.synchronizedHashes, (msg) =>
    reportIssue(msg),
  );
};
