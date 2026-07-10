//? Guards the exact drift class that once silently dropped the `cron` overlay
//? slot from production: the server bundler carries a FALLBACK copy of
//? @luckystack/server's OVERLAY_ORDER (used before the server package is
//? built/installed). This test pins every fallback copy — the repo-root
//? bundler AND the shipped template bundler — to the canonical exported list.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OVERLAY_ORDER } from '../../server/src/bootstrap';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const BUNDLER_COPIES = [
  'scripts/bundleServer.mjs',
  'packages/create-luckystack-app/template/scripts/bundleServer.mjs',
];

const extractFallbackOrder = (filePath: string): string[] => {
  const source = fs.readFileSync(filePath, 'utf8');
  const match = /const FALLBACK_OVERLAY_ORDER = \[([^\]]+)\]/.exec(source);
  const captured = match?.[1];
  expect(captured, `${filePath} must declare FALLBACK_OVERLAY_ORDER`).toBeDefined();
  return (captured ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter((entry) => entry.length > 0);
};

describe('bundleServer FALLBACK_OVERLAY_ORDER parity', () => {
  for (const relative of BUNDLER_COPIES) {
    it(`${relative} matches the canonical @luckystack/server OVERLAY_ORDER`, () => {
      const fallback = extractFallbackOrder(path.join(REPO_ROOT, relative));
      expect(fallback).toEqual([...OVERLAY_ORDER]);
    });
  }
});
