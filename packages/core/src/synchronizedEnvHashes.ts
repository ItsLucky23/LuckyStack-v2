import { createHash } from 'node:crypto';
import deployConfig from '../../../deploy.config';
import { resolveEnvKey } from './bootUuid';

//? Cross-env consistency check: when env A declares `fallback: B`, any env
//? vars listed under `synchronizedEnvKeys` on their shared resource must hold
//? identical values on both deployments — otherwise sessions encrypted by
//? one side can't be decrypted by the other.
//?
//? Secrets never leave the deployment in the clear. `/_health` returns SHA-256
//? hashes of each synchronized value; the router compares hashes across envs.
//? If hashes match, values match. If they don't, the deployments are out of
//? sync and the router either warns or refuses to start (per `strictBootHandshake`).

const hashValue = (value: string): string => {
  return createHash('sha256').update(value).digest('hex');
};

export const collectSynchronizedEnvKeys = (): string[] => {
  const keys = new Set<string>();
  for (const resource of Object.values(deployConfig.resources)) {
    for (const key of resource.synchronizedEnvKeys ?? []) {
      keys.add(key);
    }
  }
  return [...keys].sort();
};

export const computeSynchronizedEnvHashes = (): Record<string, string | null> => {
  const keys = collectSynchronizedEnvKeys();
  const out: Record<string, string | null> = {};
  for (const key of keys) {
    const value = process.env[key];
    out[key] = value === undefined ? null : hashValue(value);
  }
  return out;
};

//? Router-side helper: hash a single value with the same algorithm the
//? backend's /_health uses. Kept separate from the backend-only collector
//? so the router can import it without loading the core barrel (which
//? opens a Redis connection).
export const hashSynchronizedValue = (value: string): string => hashValue(value);

export { resolveEnvKey };
