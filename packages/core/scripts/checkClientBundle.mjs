#!/usr/bin/env node
//? Build-time boundary guard for @luckystack/core/client. Source-only import
//? walks are insufficient: tsup/esbuild may coalesce a lazy server module and a
//? client-used module into one shared chunk. Walk the ACTUAL emitted chunk graph
//? and reject every Node builtin before the package can be packed or published.
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'dist', 'client.js');
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const visited = new Set();
const violations = [];

const resolveRelative = (fromFile, specifier) => {
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  if (path.extname(resolved)) return resolved;
  return `${resolved}.js`;
};

const visit = (filePath) => {
  if (visited.has(filePath)) return;
  if (!fs.existsSync(filePath)) {
    throw new Error(`client bundle references missing chunk: ${path.relative(root, filePath)}`);
  }
  visited.add(filePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const specifiers = [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]).filter((value) => value !== undefined);

  for (const specifier of specifiers) {
    const normalized = specifier.replace(/^node:/, '');
    if (builtins.has(normalized)) {
      violations.push(`${path.relative(root, filePath)} -> ${specifier}`);
    } else if (specifier.startsWith('.')) {
      visit(resolveRelative(filePath, specifier));
    }
  }
};

visit(entry);

if (violations.length > 0) {
  console.error('[core:client-boundary] Node builtins reached from dist/client.js:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`[core:client-boundary] ${String(visited.size)} emitted file(s), 0 Node builtins`);
