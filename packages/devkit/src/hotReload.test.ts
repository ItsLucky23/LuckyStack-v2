import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

//? Drives the real watcher handlers from `setupWatchers` with chokidar, the
//? loader, the generator and the dependency graph replaced, so each case
//? asserts what a file event actually triggers.

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-hot-reload-'));
const SRC = path.join(ROOT, 'src');

const { watchers } = vi.hoisted(() => ({
  watchers: new Map<string, Record<string, (filePath: string) => void>>(),
}));

vi.mock('chokidar', () => ({
  watch: (target: string) => {
    const handlers: Record<string, (filePath: string) => void> = {};
    watchers.set(String(target), handlers);
    const watcher = {
      on: (event: string, handler: (filePath: string) => void) => {
        handlers[event] = handler;
        return watcher;
      },
    };
    return watcher;
  },
}));

vi.mock('@luckystack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luckystack/core')>();
  return { ...actual, ROOT_DIR: ROOT, getSrcDir: () => SRC, isProductionRuntime: () => false };
});

vi.mock('./loader', () => ({
  initializeFunctions: vi.fn(),
  upsertApiFromFile: vi.fn(),
  removeApiFromFile: vi.fn(),
  upsertSyncFromFile: vi.fn(),
  removeSyncFromFile: vi.fn(),
}));

vi.mock('./typeMapGenerator.js', () => ({ generateTypeMapFile: vi.fn() }));
vi.mock('./prismaClientCheck', () => ({ isPrismaClientMissing: () => false, runPrismaGenerate: vi.fn() }));
vi.mock('./importDependencyGraph', () => ({
  findDependentRouteFiles: vi.fn(() => new Set<string>()),
  invalidateGraphForFile: vi.fn(),
}));
vi.mock('./devServerRestart', () => ({ requestDevServerRestart: vi.fn(() => false) }));

vi.mock('./templateInjector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./templateInjector')>();
  return {
    ...actual,
    extractClientInputFromGeneratedTypes: vi.fn(() => '{ message: string }'),
    updateClientFileForDeletedServer: vi.fn(() => Promise.resolve(true)),
  };
});

const { getGeneratedApiSchemasPath } = await import('@luckystack/core');
const { setupWatchers } = await import('./hotReload');
const loader = await import('./loader');
const { generateTypeMapFile } = await import('./typeMapGenerator.js');
const { findDependentRouteFiles } = await import('./importDependencyGraph');
const { requestDevServerRestart } = await import('./devServerRestart');
const templateInjector = await import('./templateInjector');

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

const writeFile = (relative: string, content: string): string => {
  const file = path.join(SRC, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file.replaceAll('\\', '/');
};

const srcEvents = (): Record<string, (filePath: string) => void> => {
  const handlers = watchers.get('src');
  if (!handlers) throw new Error('setupWatchers did not watch the src dir');
  return handlers;
};

//? Debounce (120ms default) plus slack for the coalesced follow-up tasks.
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(1000);
};

const logged = (): string => logSpy.mock.calls.map((call) => String(call[0])).join('\n');

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate'] });
  setupWatchers();
  await settle(); //? let the boot-time generation run before the cases start
});

afterAll(() => {
  vi.useRealTimers();
  fs.rmSync(ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findDependentRouteFiles).mockReturnValue(new Set());
  vi.mocked(requestDevServerRestart).mockReturnValue(false);
});

describe('deleting a sync server', () => {
  it('still migrates the client when another sync event lands in the debounce window', async () => {
    const clientPath = writeFile('chat/_sync/x_client_v1.ts', 'export const main = () => ({});\n');
    const serverPath = path.join(SRC, 'chat/_sync/x_server_v1.ts').replaceAll('\\', '/');
    const otherSync = writeFile('chat/_sync/y_server_v1.ts', 'export const main = () => ({});\n');

    srcEvents().unlink?.(serverPath);
    await vi.advanceTimersByTimeAsync(30);
    //? Reschedules the 'sync' task, which used to drop the client rewrite.
    srcEvents().change?.(otherSync);
    await settle();

    expect(templateInjector.extractClientInputFromGeneratedTypes).toHaveBeenCalledWith('chat', 'x', 'v1');
    expect(templateInjector.updateClientFileForDeletedServer).toHaveBeenCalledWith(clientPath, '{ message: string }');
  });

  it('leaves the client alone when the server is back before the task runs', async () => {
    writeFile('chat/_sync/z_client_v1.ts', 'export const main = () => ({});\n');
    const serverPath = writeFile('chat/_sync/z_server_v1.ts', 'export const main = () => ({});\n');

    srcEvents().unlink?.(serverPath);
    await settle();

    expect(templateInjector.updateClientFileForDeletedServer).not.toHaveBeenCalled();
  });
});

describe('generated outputs', () => {
  it('a write to the Zod schema file does not start another generation run', async () => {
    const schemasPath = path.resolve(getGeneratedApiSchemasPath()).replaceAll('\\', '/');

    srcEvents().change?.(schemasPath);
    await settle();

    expect(generateTypeMapFile).not.toHaveBeenCalled();
    expect(findDependentRouteFiles).not.toHaveBeenCalled();
  });
});

describe('files under a marker that are not routes', () => {
  it('a helper edit regenerates types and cascades to dependent routes', async () => {
    const helper = writeFile('chat/_api/_lib/helpers.ts', 'export const greet = () => "hi";\n');

    srcEvents().change?.(helper);
    await settle();

    expect(logged()).not.toContain('Invalid API filename');
    expect(findDependentRouteFiles).toHaveBeenCalledWith(helper);
    expect(generateTypeMapFile).toHaveBeenCalled();
    expect(loader.upsertApiFromFile).not.toHaveBeenCalledWith(helper);
  });

  it('a new empty helper is not overwritten with route guidance', async () => {
    const helper = writeFile('chat/_api/_lib/empty.ts', '');

    srcEvents().add?.(helper);
    await settle();

    expect(fs.readFileSync(helper, 'utf8')).toBe('');
    expect(loader.upsertApiFromFile).not.toHaveBeenCalledWith(helper);
  });

  it('a co-located test file is not treated as a misnamed route', async () => {
    const testFile = writeFile('chat/_api/send.test.ts', 'export {};\n');

    srcEvents().change?.(testFile);
    await settle();

    expect(logged()).not.toContain('Invalid API filename');
  });
});

describe('a dependency of a route changes', () => {
  it('asks the supervisor to restart instead of re-importing the route', async () => {
    const helper = writeFile('chat/helpers.ts', 'export const x = 1;\n');
    const route = path.join(SRC, 'chat/_api/send_v1.ts').replaceAll('\\', '/');
    vi.mocked(findDependentRouteFiles).mockReturnValue(new Set([route]));
    vi.mocked(requestDevServerRestart).mockReturnValue(true);

    srcEvents().change?.(helper);
    await settle();

    expect(requestDevServerRestart).toHaveBeenCalledWith(helper);
    expect(loader.upsertApiFromFile).not.toHaveBeenCalled();
    //? The restarted server generates on boot; a run here only delays it.
    expect(generateTypeMapFile).not.toHaveBeenCalled();
  });

  it('without a supervisor it reloads the routes and says a restart is needed', async () => {
    const helper = writeFile('chat/helpers.ts', 'export const x = 2;\n');
    const route = path.join(SRC, 'chat/_api/send_v1.ts').replaceAll('\\', '/');
    vi.mocked(findDependentRouteFiles).mockReturnValue(new Set([route]));

    srcEvents().change?.(helper);
    await settle();

    expect(loader.upsertApiFromFile).toHaveBeenCalledWith(route);
    expect(logged()).toContain('keep running its old code until you restart the dev server');
  });
});

describe('blocking work is visible', () => {
  it('logs how long type-map regeneration took', async () => {
    const route = writeFile('chat/_api/send_v1.ts', 'export const main = () => ({});\n');

    srcEvents().change?.(route);
    await settle();

    expect(logged()).toMatch(/type map regenerated in \d+ms/);
    expect(logged()).toMatch(/API reloaded in \d+ms/);
  });
});
