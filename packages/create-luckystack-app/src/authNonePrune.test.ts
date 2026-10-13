import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneAuthNone } from './index';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('authMode none template prune', () => {
  it('applies every exact-token edit to the current template', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-auth-none-prune-'));
    created.push(target);
    fs.cpSync(path.resolve(import.meta.dirname, '../template'), target, { recursive: true });

    const readme = fs.readFileSync(path.join(target, 'README.md'), 'utf8');
    expect(() => pruneAuthNone(target)).not.toThrow();
    expect(fs.readFileSync(path.join(target, 'README.md'), 'utf8')).toBe(readme);

    const config = fs.readFileSync(path.join(target, 'config.ts'), 'utf8');
    expect(config).toContain("forgotPassword: 'disabled' as const");
    expect(config).toContain('credentials: false');
    expect(config).not.toContain("forgotPassword: 'framework' as const");
    expect(fs.existsSync(path.join(target, 'src/login'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'functions/session.ts'))).toBe(false);
  });
});
