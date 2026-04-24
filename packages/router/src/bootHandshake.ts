import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

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

const probeFallbackHealth = async (baseUrl: string): Promise<{ bootUuid?: string } | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/_health`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json() as { bootUuid?: string };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
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
};
