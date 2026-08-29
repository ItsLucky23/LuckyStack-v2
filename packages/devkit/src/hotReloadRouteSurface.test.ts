import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

//? Self-review catch: pruning private/test subtrees in the BOOT scan
//? (`collectTsFiles`) without guarding the hot-reload path left the two
//? disagreeing. `_api/_lib/handoff_v1.ts` still matches the `_v<N>` regex, so
//? saving that file registered `api/<page>/_lib/handoff/v1` — a route that
//? exists until the next restart and then silently vanishes.
//?
//? Driven through the PUBLIC entry point (`upsertApiFromFile`), not the
//? internal resolver, so the guard cannot be satisfied in the wrong place.

const SRC = path.resolve('/virtual/app/src');

vi.mock('@luckystack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luckystack/core')>();
  return { ...actual, getSrcDir: () => SRC };
});

const { upsertApiFromFile, upsertSyncFromFile, devApis, devSyncs } = await import('./loader');

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

beforeEach(() => {
  logSpy.mockClear();
  for (const key of Object.keys(devApis)) delete devApis[key];
  for (const key of Object.keys(devSyncs)) delete devSyncs[key];
});

describe('hot reload agrees with the boot scan', () => {
  it('does not register a route-shaped file inside a private subtree', async () => {
    await upsertApiFromFile(path.join(SRC, 'chat', '_api', '_lib', 'handoff_v1.ts'));

    expect(Object.keys(devApis)).toHaveLength(0);
    //? …and stays quiet about it: it is a helper, not a misnamed route.
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('does not register one inside a test folder', async () => {
    await upsertApiFromFile(path.join(SRC, 'chat', '_api', '__tests__', 'send_v1.ts'));
    expect(Object.keys(devApis)).toHaveLength(0);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('does not warn about a test file co-located with routes', async () => {
    await upsertApiFromFile(path.join(SRC, 'chat', '_api', 'send.test.ts'));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('still warns about a genuinely misnamed route file', async () => {
    //? The warning must survive — this is the case it exists for.
    await upsertApiFromFile(path.join(SRC, 'chat', '_api', 'BADNAME.ts'));
    expect(logSpy).toHaveBeenCalledOnce();
    expect(String(logSpy.mock.calls[0]?.[0])).toContain('invalid filename');
  });

  it('applies the same guard to sync routes', async () => {
    await upsertSyncFromFile(path.join(SRC, 'chat', '_sync', '_lib', 'push_server_v1.ts'));
    expect(Object.keys(devSyncs)).toHaveLength(0);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
