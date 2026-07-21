import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveTestBaseUrl } from './resolveTestBaseUrl';

let root: string;
const savedBaseUrl = process.env.TEST_BASE_URL;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-test-base-url-'));
  delete process.env.TEST_BASE_URL;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (savedBaseUrl === undefined) delete process.env.TEST_BASE_URL;
  else process.env.TEST_BASE_URL = savedBaseUrl;
});

const writeAdvertisement = (value: unknown): void => {
  const file = path.join(root, 'node_modules', '.luckystack', 'dev-server.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};

describe('resolveTestBaseUrl', () => {
  it('gives the explicit operator override first priority', () => {
    process.env.TEST_BASE_URL = 'https://test.example.com';
    writeAdvertisement({ port: 8081, pid: process.pid });

    expect(resolveTestBaseUrl({ cwd: root, fallbackUrl: 'http://localhost:4100' }))
      .toBe('https://test.example.com');
  });

  it('follows the actually-bound dev server port', () => {
    writeAdvertisement({ port: 8081, pid: process.pid });

    expect(resolveTestBaseUrl({ cwd: root, fallbackUrl: 'http://localhost:4100' }))
      .toBe('http://localhost:8081');
  });

  it('uses the config-derived fallback for absent, invalid, or stale advertisements', () => {
    const fallbackUrl = 'http://localhost:4100';
    expect(resolveTestBaseUrl({ cwd: root, fallbackUrl })).toBe(fallbackUrl);

    writeAdvertisement({ port: 65_536, pid: process.pid });
    expect(resolveTestBaseUrl({ cwd: root, fallbackUrl })).toBe(fallbackUrl);

    writeAdvertisement({ port: 8081, pid: 2_147_483_647 });
    expect(resolveTestBaseUrl({ cwd: root, fallbackUrl })).toBe(fallbackUrl);
  });
});
