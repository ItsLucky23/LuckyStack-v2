import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveServerPort } from '../../server/src/portResolution';

//? Use a non-default consumer port so this test catches the exact regression:
//? the consumer-owned config.ports.ts default and the typed CLI override must
//? stay aligned with the server's resolution order.
vi.mock('../template/config.ports', () => ({
  ports: { frontend: 5391, backend: 4787 },
}));

const configKeys = [
  'LUCKYSTACK_ENV_FILES',
  'LUCKYSTACK_ENV',
  'NODE_ENV',
  'PUBLIC_URL',
  'EXTERNAL_ORIGINS',
] as const;

const savedValues: Partial<Record<(typeof configKeys)[number], string | undefined>> = {};
const tempDirs: string[] = [];

const setEnv = (key: (typeof configKeys)[number], value: string | undefined): void => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

const loadTemplateProjectConfig = async (options: {
  environment: 'development' | 'production';
  portOverride?: number;
  publicUrl?: string;
}) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-scaffold-ports-'));
  tempDirs.push(tempDir);
  fs.writeFileSync(path.join(tempDir, '.env.test'), 'NODE_ENV=test\n');
  vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

  process.env.LUCKYSTACK_ENV_FILES = '.env.test';
  process.env.LUCKYSTACK_ENV = options.environment;
  process.env.NODE_ENV = options.environment;
  setEnv('PUBLIC_URL', options.publicUrl);
  delete process.env.EXTERNAL_ORIGINS;

  vi.resetModules();
  const { registerPortOverride } = await import('@luckystack/core/config');
  if (options.portOverride !== undefined) registerPortOverride(options.portOverride);
  await import('../template/config');
  const { getProjectConfig } = await import('@luckystack/core');
  return getProjectConfig();
};

beforeEach(() => {
  for (const key of configKeys) savedValues[key] = process.env[key];
});

afterEach(() => {
  for (const key of configKeys) setEnv(key, savedValues[key]);
  vi.restoreAllMocks();
  vi.resetModules();
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('scaffold OAuth callback port contract', () => {
  it('uses config.ports.backend for the single-instance default', async () => {
    const config = await loadTemplateProjectConfig({ environment: 'development' });

    expect(resolveServerPort({ parsedPort: null, defaultPort: 4787 })).toBe(4787);
    expect(config.oauthCallbackBase).toBe('http://localhost:4787');
  });

  it('uses the explicit CLI port from the typed override registry', async () => {
    const config = await loadTemplateProjectConfig({
      environment: 'development',
      portOverride: 4911,
    });

    expect(resolveServerPort({ parsedPort: 4911, defaultPort: 4787 })).toBe(4911);
    expect(config.oauthCallbackBase).toBe('http://localhost:4911');
  });

  it('uses PUBLIC_URL in production instead of a dev backend port', async () => {
    const config = await loadTemplateProjectConfig({
      environment: 'production',
      publicUrl: 'https://app.example.com',
    });

    expect(config.oauthCallbackBase).toBe('https://app.example.com');
  });
});

describe('single-instance scaffold assets', () => {
  const templatePath = (relativePath: string): string =>
    path.resolve(import.meta.dirname, '../template', relativePath);

  it('ships config.ports.ts independently of the optional router', () => {
    const portsPath = templatePath('config.ports.ts');
    const scaffoldSource = fs.readFileSync(path.resolve(import.meta.dirname, 'index.ts'), 'utf8');
    const serverSource = fs.readFileSync(templatePath('server/server.ts'), 'utf8');

    expect(fs.existsSync(portsPath)).toBe(true);
    expect(scaffoldSource).not.toContain("removeScaffoldPath(targetDir, 'config.ports.ts')");
    expect(serverSource).toContain("import { ports } from '../config.ports';");
    expect(serverSource).toContain('defaultPort: ports.backend');
    expect(serverSource).not.toContain("from '@luckystack/router'");
  });
});
