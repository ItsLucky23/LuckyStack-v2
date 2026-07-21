import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDynamicProxyOptions, isProcessRunning } from '../template/viteBackendProxy';

const TEMPLATE = path.resolve(import.meta.dirname, '../template');
const ROOT = path.resolve(import.meta.dirname, '../../..');

describe('dynamic Vite backend proxy', () => {
  it('updates both Vite request metadata and the original live proxy options', async () => {
    let target = 'http://127.0.0.1:80';
    const originalOptions = createDynamicProxyOptions(() => target);

    //? Vite passes the ORIGINAL object to configure, then stores a shallow clone
    //? for bypass. http-proxy keeps the original object in its request closure.
    originalOptions.configure?.(null as never, originalOptions);
    const requestOptions = { ...originalOptions };

    target = 'http://127.0.0.1:81';
    await requestOptions.bypass?.(null as never, undefined, requestOptions);

    expect(requestOptions.target).toBe(target);
    expect(originalOptions.target).toBe(target);
  });

  it('rejects a stale advertisement owner while accepting the current process', () => {
    expect(isProcessRunning(process.pid)).toBe(true);
    expect(isProcessRunning(2_147_483_647)).toBe(false);
  });

  it('keeps the root dogfood helper byte-identical to the shipped scaffold helper', () => {
    const rootHelper = fs.readFileSync(path.join(ROOT, 'viteBackendProxy.ts'), 'utf8');
    const templateHelper = fs.readFileSync(path.join(TEMPLATE, 'viteBackendProxy.ts'), 'utf8');

    expect(rootHelper).toBe(templateHelper);
  });

  it('wires config ports and environment loading on both surfaces', () => {
    const rootConfig = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
    const templateConfig = fs.readFileSync(path.join(TEMPLATE, 'vite.config.ts'), 'utf8');

    for (const config of [rootConfig, templateConfig]) {
      expect(config).toContain('loadEnv(');
      expect(config).toContain('port: ports.frontend');
      expect(config).toContain('createDynamicProxyOptions(');
    }
  });

  it('makes the scaffold test command follow the live port with a config fallback', () => {
    const testAll = fs.readFileSync(path.join(TEMPLATE, 'scripts', 'testAll.ts'), 'utf8');

    expect(testAll).toContain('resolveTestBaseUrl({');
    expect(testAll).toContain('ports.backend');
    expect(testAll).not.toContain("process.env.TEST_BASE_URL ?? 'http://localhost:80'");
  });
});
