import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

//? The dependency cascade decides which routes reload after a helper edit. It
//? must recognise routes the way the rest of devkit does: by the configured
//? srcDir and route markers, not by a literal `/src/`, `/_api/` or `/_sync/`.

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-dep-graph-'));
const SRC = path.join(ROOT, 'app');

vi.mock('@luckystack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luckystack/core')>();
  return {
    ...actual,
    ROOT_DIR: ROOT,
    getSrcDir: () => SRC,
    getSharedDir: () => path.join(ROOT, 'shared'),
    getServerFunctionDirs: () => [],
  };
});

const { findDependentRouteFiles, invalidateGraphForFile } = await import('./importDependencyGraph');
const { registerRoutingRules } = await import('./routingRules');

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

afterEach(() => {
  registerRoutingRules({}); //? restore defaults
});

const writeFile = (relative: string, content: string): string => {
  const file = path.join(SRC, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  invalidateGraphForFile(file);
  return path.resolve(file).replaceAll('\\', '/');
};

describe('findDependentRouteFiles', () => {
  it('honours a custom srcDir and API marker, and walks through private helpers', () => {
    registerRoutingRules({ apiMarker: '_routes' });
    const helper = writeFile('chat/helpers.ts', 'export const x = 1;\n');
    const direct = writeFile('chat/_routes/get_v1.ts', "import { x } from '../helpers';\nexport const main = () => x;\n");
    writeFile('chat/_routes/_lib/wrap.ts', "import { x } from 'app/chat/helpers';\nexport const wrap = () => x;\n");
    const viaLib = writeFile('chat/_routes/list_v1.ts', "import { wrap } from './_lib/wrap';\nexport const main = wrap;\n");

    expect([...findDependentRouteFiles(helper)].toSorted()).toEqual([direct, viaLib].toSorted());
  });

  it('still finds sync routes with the default markers', () => {
    const helper = writeFile('feed/format.ts', 'export const f = (s: string) => s;\n');
    const sync = writeFile('feed/_sync/push_server_v1.ts', "import { f } from '@/feed/format';\nexport const main = f;\n");

    expect([...findDependentRouteFiles(helper)]).toEqual([sync]);
  });
});
