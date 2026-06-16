import { createHash, createHmac } from 'node:crypto';
import { getDeployConfig } from './deployConfigRegistry';
import { getProjectConfig } from './projectConfig';
import type { HealthHashConfig } from './projectConfig';


//? Cross-env consistency check: when env A declares `fallback: B`, any env
//? vars listed under `synchronizedEnvKeys` on their shared resource must hold
//? identical values on both deployments — otherwise sessions encrypted by
//? one side can't be decrypted by the other.
//?
//? Secrets never leave the deployment in the clear. `/_health` returns hashes
//? of each synchronized value; the router compares hashes across envs. If
//? hashes match, values match. If they don't, the deployments are out of sync
//? and the router either warns or refuses to start (per `strictBootHandshake`).
//?
//? SEC-13: the historical hash was an UNSALTED `sha256(value)` — unauthenticated
//? `/_health` then exposed a stable, dictionary-attackable fingerprint of each
//? synchronized secret. `http.healthHash` now lets a deployment salt/HMAC the
//? value; BOTH the backend (`/_health`) and the router (compare) MUST use the
//? same `{ mode, salt }`, so {@link resolveHealthHashConfig} +
//? {@link hashSynchronizedValueWith} are exported for the router to reuse. The
//? 0.2.0 DEFAULT is `{ mode: 'hmac', salt: '@bootUuid' }` — the fingerprint is
//? HMAC-keyed on the per-boot UUID, so both sides MUST resolve the salt against
//? the SAME boot UUID (the backend's own; the router reads it from /_health).

const plainHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/**
 * Hash a synchronized value under an EXPLICIT `{ mode, salt }` (SEC-13). The
 * shared primitive the router calls with the same config the backend used, so
 * the cross-env compare still holds:
 *   - `'plain'`  → `sha256(value)` (today's behavior; `salt` ignored).
 *   - `'salted'` → `sha256(salt + value)`.
 *   - `'hmac'`   → `HMAC-SHA256(key=salt, value)`.
 * A `'salted'`/`'hmac'` mode with an empty resolved salt falls back to `'plain'`
 * (and is the caller's responsibility to avoid) rather than silently hashing
 * with an empty key.
 */
export const hashSynchronizedValueWith = (
  config: Pick<HealthHashConfig, 'mode'> & { salt: string },
  value: string,
): string => {
  const { mode, salt } = config;
  if (mode === 'plain' || salt.length === 0) return plainHash(value);
  if (mode === 'salted') return createHash('sha256').update(salt).update(value).digest('hex');
  return createHmac('sha256', salt).update(value).digest('hex');
};

/**
 * Resolve the effective health-hash config from `http.healthHash`, expanding the
 * `'@bootUuid'` salt sentinel to the supplied boot UUID. Honoured for BOTH
 * `'salted'` and `'hmac'` (the 0.2.0 default is `hmac` + `'@bootUuid'`, so the
 * per-boot UUID becomes the HMAC key — the synchronized-env fingerprint rotates
 * every restart instead of being a stable, dictionary-attackable `sha256`). The
 * server passes its current boot UUID; the router, comparing, passes the same
 * value it read from the backend's handshake. When the sentinel is in play but
 * no boot UUID is available the config collapses to `'plain'` so the cross-env
 * compare never silently diverges.
 */
export const resolveHealthHashConfig = (
  bootUuid?: string | null,
): { mode: HealthHashConfig['mode']; salt: string } => {
  const { mode, salt } = getProjectConfig().http.healthHash;
  if (salt === '@bootUuid') {
    if ((mode === 'salted' || mode === 'hmac') && bootUuid && bootUuid.length > 0) {
      return { mode, salt: bootUuid };
    }
    return { mode: 'plain', salt: '' };
  }
  return { mode, salt };
};

/**
 * Safe-to-expose descriptor of the resolved health-hash config. The router needs
 * to hash with the SAME `{ mode, salt }` the backend used, but a static `salt`
 * (mode `'salted'`/`'hmac'` with a non-sentinel salt) is a SECRET and must never
 * leave the backend. So `/_health` exposes only the `mode` + whether the salt is
 * the `'@bootUuid'` sentinel (the bootUuid itself is already in the response).
 * From this the router can reproduce the hash for `'plain'` and `'@bootUuid'`
 * configs, and KNOWS it cannot reproduce a static-salt config (so it skips the
 * compare instead of reporting a false drift).
 */
export interface HealthHashDescriptor {
  mode: HealthHashConfig['mode'];
  bootUuidSalt: boolean;
}

/** Describe the active health-hash config for the `/_health` payload (no secret salt). */
export const describeHealthHashConfig = (): HealthHashDescriptor => {
  const { mode, salt } = getProjectConfig().http.healthHash;
  return { mode, bootUuidSalt: salt === '@bootUuid' };
};

/**
 * Reproduce the backend's resolved `{ mode, salt }` from its `/_health`
 * descriptor + the shared boot UUID. Returns `null` when the backend uses a
 * STATIC salt the router cannot see — the caller must then skip the compare
 * rather than hash with a different (default) config and report a false drift.
 */
export const resolveHealthHashConfigFromDescriptor = (
  descriptor: HealthHashDescriptor,
  bootUuid: string,
): { mode: HealthHashConfig['mode']; salt: string } | null => {
  if (descriptor.mode === 'plain') return { mode: 'plain', salt: '' };
  if (descriptor.bootUuidSalt) return { mode: descriptor.mode, salt: bootUuid };
  return null;
};

export const collectSynchronizedEnvKeys = (): string[] => {
  const keys = new Set<string>();
  for (const resource of Object.values(getDeployConfig().resources)) {
    for (const key of resource.synchronizedEnvKeys ?? []) {
      keys.add(key);
    }
  }
  return [...keys].toSorted();
};

/**
 * Compute the `/_health` hash map for every synchronized env var. Reads
 * `http.healthHash` (call-time) so a consumer's salt/HMAC opt-in applies;
 * `bootUuid` is consulted only when the salt is the `'@bootUuid'` sentinel.
 * The 0.2.0 DEFAULT (`{ mode: 'hmac', salt: '@bootUuid' }`) HMAC-keys the output
 * on `bootUuid`; pass `mode: 'plain'` to restore the historical unsalted output.
 */
export const computeSynchronizedEnvHashes = (
  bootUuid?: string | null,
): Record<string, string | null> => {
  const keys = collectSynchronizedEnvKeys();
  const config = resolveHealthHashConfig(bootUuid);
  const out: Record<string, string | null> = {};
  for (const key of keys) {
    const value = process.env[key];
    out[key] = value === undefined ? null : hashSynchronizedValueWith(config, value);
  }
  return out;
};

//? Router-side helper: hash a single value with the same algorithm the backend's
//? /_health uses. Kept as a named helper distinct from the backend-only collector.
//? Honours the active `http.healthHash` config (call-time) so router + backend
//? stay in lockstep; pass the backend's boot UUID when the salt is `'@bootUuid'`.
export const hashSynchronizedValue = (value: string, bootUuid?: string | null): string =>
  hashSynchronizedValueWith(resolveHealthHashConfig(bootUuid), value);