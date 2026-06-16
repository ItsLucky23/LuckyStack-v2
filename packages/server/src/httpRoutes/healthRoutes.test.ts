import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerDeployConfig, registerProjectConfig } from '@luckystack/core';

//? SEC-13 regression: `/_health` must HMAC the synchronized-env fingerprints
//? with the per-boot UUID (the 0.2.0 default `http.healthHash` =
//? `{ mode: 'hmac', salt: '@bootUuid' }`) so the wire never carries a stable,
//? unsalted `sha256(secret)`. The bug was `handleHealthRoute` calling
//? `computeSynchronizedEnvHashes()` with NO bootUuid, collapsing the
//? `'@bootUuid'` sentinel back to `'plain'`. These tests use the REAL
//? `@luckystack/core` hashing + config registries so they pin the actual wire
//? bytes; only `readBootUuid` (Redis-backed) is stubbed.
const BOOT_UUID = 'boot-uuid-1234';
const SYNC_VALUE = 'super-secret-session-key';

vi.mock('@luckystack/core', async () => {
  const actual = await vi.importActual<typeof import('@luckystack/core')>('@luckystack/core');
  return {
    ...actual,
    readBootUuid: () => Promise.resolve(BOOT_UUID),
    prisma: {},
    redis: {},
  };
});

import { handleHealthRoute } from './healthRoutes';
import type { HttpRouteContext } from './types';

const makeCtx = (routePath: string): { ctx: HttpRouteContext; ended: () => string | undefined } => {
  let body: string | undefined;
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0,
    setHeader: (name: string, value: string) => { headers[name] = value; },
    end: (chunk?: string) => { body = chunk; },
  };
  const ctx = { res, routePath } as unknown as HttpRouteContext;
  return { ctx, ended: () => body };
};

beforeEach(() => {
  process.env.SYNC_SECRET = SYNC_VALUE;
  //? Default healthHash (`{ mode: 'hmac', salt: '@bootUuid' }`) is what we
  //? assert against — register a no-op config so defaults apply.
  registerProjectConfig({});
  registerDeployConfig({
    resources: {
      db: { type: 'redis', urlEnvKey: 'REDIS_URL', synchronizedEnvKeys: ['SYNC_SECRET'] },
    },
  });
});

describe('handleHealthRoute — SEC-13 salted fingerprints', () => {
  it('ignores non-matching paths', async () => {
    const { ctx } = makeCtx('/not-health');
    expect(await handleHealthRoute(ctx)).toBe(false);
  });

  it('HMACs synchronized-env fingerprints with the boot UUID (not unsalted sha256)', async () => {
    const { ctx, ended } = makeCtx('/_health');
    expect(await handleHealthRoute(ctx)).toBe(true);

    const payload = JSON.parse(ended() ?? '{}') as {
      status: string;
      bootUuid: string;
      synchronizedHashes: Record<string, string | null>;
    };

    const expectedHmac = createHmac('sha256', BOOT_UUID).update(SYNC_VALUE).digest('hex');
    const unsaltedSha = createHash('sha256').update(SYNC_VALUE).digest('hex');

    expect(payload.synchronizedHashes.SYNC_SECRET).toBe(expectedHmac);
    //? The whole point of SEC-13: the wire must NOT carry the reversible,
    //? dictionary-attackable unsalted sha256 of the secret.
    expect(payload.synchronizedHashes.SYNC_SECRET).not.toBe(unsaltedSha);
    expect(payload.status).toBe('ok');
    expect(payload.bootUuid).toBe(BOOT_UUID);
  });
});
