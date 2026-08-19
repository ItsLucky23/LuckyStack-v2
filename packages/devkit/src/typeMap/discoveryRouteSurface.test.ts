import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { findAllApiFiles, findAllSyncServerFiles } from './discovery';

//? Exercises the REAL directory walk against the folder shape a consumer
//? reported: `_api/_lib/`, `_api/__tests__/`, test files beside routes, and an
//? `externalApi/` folder that the old suffix match mistook for a route folder.
//?
//? This is the build-time twin of the dev loader's walk; both now share
//? `isRouteSurfaceFile`, so a regression here means the generator and the loader
//? have drifted apart again.

let root: string;

const write = (relative: string): void => {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'export const main = async () => ({ status: "success" });\n');
};

const found = (files: string[]): string[] =>
  files.map((f) => path.relative(root, f).replaceAll('\\', '/')).toSorted();

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-discovery-'));

  //? Real routes — must be found.
  write('chat/_api/send_v1.ts');
  write('chat/_api/threads/list_v1.ts');          //? nested route names are a feature
  write('chat/_sync/message_server_v1.ts');

  //? Private helper subtree under the marker — must be skipped.
  write('_ai/_api/_lib/runAgentTurn.ts');
  write('_ai/_api/_lib/handoff_v1.ts');           //? even a route-shaped NAME stays private
  write('_ai/_api/_lib/__tests__/runAgentTurn.test.ts');

  //? Test folder + test files under the marker — must be skipped.
  write('_ai/_api/__tests__/parseTraceAuth_v1.ts');
  write('_ai/_api/compact_v1.test.ts');
  write('_ai/_api/compact_v1.spec.ts');
  write('_ai/_api/compact_v1.tests.ts');

  //? A folder that merely ENDS in "api" — never a route folder.
  write('_ai/_tools/externalApi/call_v1.ts');
  write('_ai/_tools/externalApi/_lib/authGuard.ts');
  write('legacy/dataSync/push_server_v1.ts');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('findAllApiFiles', () => {
  it('finds real routes, including nested ones', () => {
    expect(found(findAllApiFiles(root))).toEqual([
      'chat/_api/send_v1.ts',
      'chat/_api/threads/list_v1.ts',
    ]);
  });

  it('skips the private helper subtree even when a file is route-shaped', () => {
    const files = found(findAllApiFiles(root));
    expect(files).not.toContain('_ai/_api/_lib/handoff_v1.ts');
    expect(files.some((f) => f.includes('/_lib/'))).toBe(false);
  });

  it('skips test folders and test files under the marker', () => {
    const files = found(findAllApiFiles(root));
    expect(files.some((f) => f.includes('__tests__'))).toBe(false);
    expect(files.some((f) => /\.(?:test|spec|tests)\.ts$/.test(f))).toBe(false);
  });

  it('ignores a folder that merely ends in "api"', () => {
    //? The reported bug: `externalApi/` was walked as a route folder.
    expect(found(findAllApiFiles(root)).some((f) => f.includes('externalApi'))).toBe(false);
  });
});

describe('findAllSyncServerFiles', () => {
  it('finds real sync routes and ignores a folder ending in "sync"', () => {
    expect(found(findAllSyncServerFiles(root))).toEqual(['chat/_sync/message_server_v1.ts']);
  });
});
