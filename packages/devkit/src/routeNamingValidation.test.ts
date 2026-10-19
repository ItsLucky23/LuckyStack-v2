import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  assertValidRouteNaming,
  collectDuplicateNormalizedRouteKeyIssues,
  collectInvalidRouteNamingIssues,
} from './routeNamingValidation';
import { registerRoutingRules } from './routingRules';

//? Naming validation runs at dev boot (`initializeAll`) and before type-map
//? generation, and it THROWS. Every file it flags that the loader would accept
//? is a dev server that refuses to start, so these cases pin its agreement with
//? the loader's route-surface predicate.

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-route-naming-'));

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

afterEach(() => {
  registerRoutingRules({}); //? restore defaults
});

const makeSrc = (projectRoot: string, files: string[]): string => {
  const srcDir = path.join(TMP, projectRoot, 'src');
  for (const file of files) {
    const full = path.join(srcDir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'export const main = () => ({ status: "success" });\n');
  }
  return srcDir;
};

describe('co-located test files next to routes', () => {
  it('.test.ts and .spec.ts files are not flagged as misnamed routes', () => {
    const srcDir = makeSrc('colocated', [
      'chat/_api/send_v1.ts',
      'chat/_api/send.test.ts',
      'chat/_api/send.spec.ts',
      'chat/_api/send_v1.tests.ts',
      'chat/_sync/push_server_v1.ts',
      'chat/_sync/push.test.ts',
    ]);

    expect(collectInvalidRouteNamingIssues(srcDir)).toEqual([]);
    expect(() => {
      assertValidRouteNaming({ srcDir, context: 'test' });
    }).not.toThrow();
  });

  it('still flags a genuinely misnamed route file', () => {
    const srcDir = makeSrc('misnamed', ['chat/_api/send.ts']);
    const issues = collectInvalidRouteNamingIssues(srcDir);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toContain('versioned naming');
  });
});

describe('a checkout under a folder named like a marker', () => {
  it('validates route tokens relative to srcDir, not the absolute path', () => {
    const srcDir = makeSrc(path.join('_api', 'proj'), [
      'chat/_api/send_v1.ts',
      'chat/_sync/push_server_v1.ts',
      'lib/util.ts',
      '_admin/_api/list_v1.ts',
    ]);

    expect(collectInvalidRouteNamingIssues(srcDir)).toEqual([]);
  });

  it('still sees the real routes there', () => {
    const srcDir = makeSrc(path.join('_sync', 'proj2'), ['_admin/_api/bad.ts']);
    const issues = collectInvalidRouteNamingIssues(srcDir);
    expect(issues.map((issue) => issue.reason)).toEqual(['API filename does not match versioned naming.']);
  });

  it('classifies sync duplicates as sync even under a parent `_api` folder', () => {
    const srcDir = makeSrc(path.join('_api', 'proj3'), ['a/_sync/x_server_v1.ts', 'b/_sync/x_server_v1.ts']);
    //? Different pages, so no duplicate — the point is that the files are not
    //? misread as API routes (which would have returned no key at all).
    expect(collectDuplicateNormalizedRouteKeyIssues(srcDir)).toEqual([]);

    const dupSrc = makeSrc(path.join('_api', 'proj4'), ['_sync/x_server_v1.ts', 'system/_sync/x_server_v1.ts']);
    expect(collectDuplicateNormalizedRouteKeyIssues(dupSrc).map((issue) => issue.routeKey)).toEqual([
      'sync/system/x/v1_server',
    ]);
  });
});

describe('duplicate route keys', () => {
  it('a root sync collides with a `system` page sync, like a root API does', () => {
    const srcDir = makeSrc('dupes', [
      '_api/y_v1.ts',
      'system/_api/y_v1.ts',
      '_sync/x_server_v1.ts',
      'system/_sync/x_server_v1.ts',
    ]);

    const keys = collectDuplicateNormalizedRouteKeyIssues(srcDir).map((issue) => [issue.kind, issue.routeKey]);
    expect(keys).toEqual([
      ['api', 'api/system/y/v1'],
      ['sync', 'sync/system/x/v1_server'],
    ]);
  });
});
