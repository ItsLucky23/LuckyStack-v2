import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDevServerInfo, writeDevServerInfo } from './devServerInfo';

const tempRoots: string[] = [];
let cwdSpy: ReturnType<typeof vi.spyOn>;

const infoFile = (root: string): string =>
  path.join(root, 'node_modules', '.luckystack', 'dev-server.json');

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-dev-server-info-'));
  tempRoots.push(root);
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(root);
});

afterEach(() => {
  cwdSpy.mockRestore();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('dev server port advertisement ownership', () => {
  it('writes the actual process owner with the bound address', () => {
    const root = process.cwd();

    writeDevServerInfo('127.0.0.1', 8081);

    expect(JSON.parse(fs.readFileSync(infoFile(root), 'utf8'))).toEqual({
      ip: '127.0.0.1',
      port: 8081,
      pid: process.pid,
    });
  });

  it('removes its own advertisement on exit', () => {
    const root = process.cwd();
    writeDevServerInfo('127.0.0.1', 8081);

    clearDevServerInfo();

    expect(fs.existsSync(infoFile(root))).toBe(false);
  });

  it('does not erase a newer process advertisement', () => {
    const root = process.cwd();
    const file = infoFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ip: '127.0.0.1', port: 8082, pid: process.pid + 1 }));

    clearDevServerInfo();

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      ip: '127.0.0.1',
      port: 8082,
      pid: process.pid + 1,
    });
  });
});
