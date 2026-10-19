import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, it, expect } from 'vitest';

import { DEFAULT_GRAPH_SOURCE_ROOTS, findNewestGraphSource, resolveNodeId } from './artifacts.js';
import type { Graph } from './artifacts.js';

const graphOf = (ids: string[]): Graph => ({
  version: 3,
  nodes: ids.map((id) => ({ id, kind: 'module', route: null })),
  edges: [],
  godNodes: [],
  blastRadius: {},
  symbolBlastRadius: {},
});

//? A path with folders names one file. Answering for another file that only
//? shares its basename gave agents a wrong change-impact answer (finding 109).
describe('resolveNodeId', () => {
  const graph = graphOf(['shared/tryCatch.ts', 'src/billing/index.ts', 'server/sockets/index.ts', 'src/a/util.ts', 'src/b/util.ts']);

  it('does not answer a foldered path with a different file of the same name', () => {
    expect(resolveNodeId(graph, 'packages/core/src/tryCatch.ts')).toBeNull();
    expect(resolveNodeId(graphOf(['src/billing/index.ts']), 'server/sockets/index.ts')).toBeNull();
  });

  it('still resolves exact ids, src-relative ids and path suffixes', () => {
    expect(resolveNodeId(graph, 'server/sockets/index.ts')).toBe('server/sockets/index.ts');
    expect(resolveNodeId(graph, 'billing/index.ts')).toBe('src/billing/index.ts');
    expect(resolveNodeId(graph, 'sockets/index.ts')).toBe('server/sockets/index.ts');
  });

  it('keeps the basename fallback for a bare file name, listing candidates when ambiguous', () => {
    expect(resolveNodeId(graph, 'tryCatch.ts')).toBe('shared/tryCatch.ts');
    expect(resolveNodeId(graph, 'util.ts')).toEqual(['src/a/util.ts', 'src/b/util.ts']);
  });
});

//? graph_status used to look only at src/, so edits under server/ or to
//? config.ts never made the graph look stale (finding 110).
describe('findNewestGraphSource', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = null;
  });

  const writeAt = async (root: string, rel: string, when: Date): Promise<void> => {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, 'export {};\n');
    await fs.utimes(full, when, when);
  };

  it('sees the newest file in server/ and the root config files, not just src/', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsmcp-graph-'));
    await writeAt(dir, 'src/page.tsx', new Date('2026-01-01T00:00:00Z'));
    await writeAt(dir, 'server/sockets/index.ts', new Date('2026-02-01T00:00:00Z'));
    expect((await findNewestGraphSource(dir, DEFAULT_GRAPH_SOURCE_ROOTS))?.file).toBe('server/sockets/index.ts');

    await writeAt(dir, 'config.ts', new Date('2026-03-01T00:00:00Z'));
    expect((await findNewestGraphSource(dir, DEFAULT_GRAPH_SOURCE_ROOTS))?.file).toBe('config.ts');
  });

  it('ignores files the generator does not scan', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsmcp-graph-'));
    await writeAt(dir, 'src/page.tsx', new Date('2026-01-01T00:00:00Z'));
    await writeAt(dir, 'src/_sockets/apiTypes.generated.ts', new Date('2026-05-01T00:00:00Z'));
    await writeAt(dir, 'src/types.d.ts', new Date('2026-05-01T00:00:00Z'));
    await writeAt(dir, 'other/late.ts', new Date('2026-05-01T00:00:00Z'));
    expect((await findNewestGraphSource(dir, DEFAULT_GRAPH_SOURCE_ROOTS))?.file).toBe('src/page.tsx');
  });

  it('follows the roots a graph records about itself', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsmcp-graph-'));
    await writeAt(dir, 'src/page.tsx', new Date('2026-01-01T00:00:00Z'));
    await writeAt(dir, 'app/late.ts', new Date('2026-05-01T00:00:00Z'));
    expect((await findNewestGraphSource(dir, { dirs: ['src', 'app'], files: [] }))?.file).toBe('app/late.ts');
  });
});
