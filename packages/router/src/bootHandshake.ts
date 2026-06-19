import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  BOOT_KEY_PREFIX,
  collectSynchronizedEnvKeys,
  getDeployConfig,
  getLogger,
  getRedisConnectionOptions,
  hashSynchronizedValue,
  hashSynchronizedValueWith,
  resolveHealthHashConfigFromDescriptor,
  tryCatch,
  tryCatchSync,
} from '@luckystack/core';
import type { HealthHashDescriptor } from '@luckystack/core';

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
  /**
   * Override Redis connection options for the **fallback** env's Redis client.
   * When omitted, the fallback client reuses the same options as the primary
   * client (i.e. the current env's Redis, derived from `getRedisConnectionOptions()`).
   *
   * Supply this when the fallback env uses a different Redis instance
   * (different host / port / password / TLS config) from the current env.
   * Without it, a cross-credential mismatch will cause the Redis compare step
   * to fail or silently succeed against the wrong instance — logged as a
   * warning (or thrown in strict mode) via `reportIssue`.
   */
  fallbackRedisOptions?: {
    host?: string;
    port?: number;
    password?: string;
    tls?: boolean;
  };
}

interface FallbackHealthResponse {
  bootUuid?: string;
  synchronizedHashes?: Record<string, string | null>;
  healthHash?: HealthHashDescriptor;
}

const ALLOWED_HEALTH_PROBE_SCHEMES = new Set(['http:', 'https:']);

const probeFallbackHealth = async (baseUrl: string): Promise<FallbackHealthResponse | null> => {
  //? Validate that fallbackBaseUrl is an http: or https: URL before calling
  //? fetch. An attacker-controlled value (e.g. `file://` or a localhost bypass)
  //? would turn this probe into an SSRF vector. We also parse the URL to extract
  //? the `Host` header so the probe reaches the right virtual-host when the
  //? fallback sits behind a virtual-host router. A missing or invalid URL
  //? returns null — the caller logs a warning or throws (strict mode).
  const [urlParseError, parsedBase] = tryCatchSync(() => new URL(baseUrl));
  if (urlParseError || !parsedBase || !ALLOWED_HEALTH_PROBE_SCHEMES.has(parsedBase.protocol)) {
    return null;
  }
  const probeUrl = `${parsedBase.origin}/_health`;
  const hostHeader = parsedBase.host;

  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); }, getHealthProbeTimeoutMs());
  const [error, payload] = await tryCatch<FallbackHealthResponse | null, undefined>(async () => {
    const response = await fetch(probeUrl, {
      signal: controller.signal,
      headers: { host: hostHeader },
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
  fallbackBootUuid: string,
  fallbackHealthHash: HealthHashDescriptor | undefined,
  report: (msg: string) => void,
): void => {
  const keys = collectSynchronizedEnvKeys();
  if (keys.length === 0) return;

  if (!fallbackHashes) {
    report(`synchronized-env check: fallback /_health did not return hashes — cannot verify ${keys.length} synchronized key(s)`);
    return;
  }

  //? The router process never loads the backend's `config.ts`, so its own
  //? `getProjectConfig().http.healthHash` is always the DEFAULT. To compare
  //? hashes we MUST use the config the BACKEND reported in /_health, not ours —
  //? otherwise any consumer-customized `http.healthHash` produces a false DIFFERS.
  //? `null` from the resolver = the backend uses a STATIC salt (a secret the
  //? router cannot see), so we cannot reproduce the hash: skip + report, never
  //? claim drift. Absent descriptor = an older backend; fall back to the local
  //? `@bootUuid` resolution (correct for the default config, which both sides use).
  let hashLocal: ((value: string) => string) | null;
  if (fallbackHealthHash) {
    const cfg = resolveHealthHashConfigFromDescriptor(fallbackHealthHash, fallbackBootUuid);
    if (cfg === null) {
      report(`synchronized-env check: fallback uses a static '${fallbackHealthHash.mode}' health-hash salt the router cannot see — cannot verify ${keys.length} synchronized key(s) (set http.healthHash.salt to '@bootUuid', or 'plain', for router-verifiable drift detection)`);
      return;
    }
    hashLocal = (value) => hashSynchronizedValueWith(cfg, value);
  } else {
    hashLocal = (value) => hashSynchronizedValue(value, fallbackBootUuid);
  }

  for (const key of keys) {
    const localValue = process.env[key];
    const localHash = localValue === undefined ? null : hashLocal(localValue);
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
  //? When the fallback env uses a different Redis instance, the caller supplies
  //? `fallbackRedisOptions` to override. Without it we reuse `redisOptions`
  //? (current-env Redis) — this is correct when both envs share one Redis, but
  //? will produce a misleading mismatch report when they use separate instances.
  const fallbackRedisOptions = input.fallbackRedisOptions
    ? { ...redisOptions, ...input.fallbackRedisOptions }
    : redisOptions;

  const client = new Redis({ ...redisOptions, lazyConnect: true });
  //? An ioredis client that emits 'error' with no listener throws as an
  //? unhandled exception and crashes the process. Log instead so the
  //? tryCatch-wrapped connect failure below is the only surfaced error.
  client.on('error', (err) => {
    getLogger().error('[router] boot handshake Redis error', err);
  });
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
  const fallbackClient = new Redis({ ...fallbackRedisOptions, lazyConnect: true });
  fallbackClient.on('error', (err) => {
    getLogger().error('[router] boot handshake fallback Redis error', err);
  });
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
  compareSynchronizedHashes(
    fallbackHealth.synchronizedHashes,
    fallbackHealth.bootUuid,
    fallbackHealth.healthHash,
    (msg) => { reportIssue(msg); },
  );
};
