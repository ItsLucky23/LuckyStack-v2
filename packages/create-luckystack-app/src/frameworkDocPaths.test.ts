//? Guards the AGENTS.md path rewrite that `copyAiDocs` applies on scaffold.
//?
//? The framework's AGENTS.md is written against the framework repo layout
//? (`docs/<X>.md`), but a scaffolded project receives those same docs under
//? `docs/luckystack/`. Without the rewrite every in-body reference is a dead
//? path in the consumer project — the defect that sent a consumer AI down ~26
//? non-existent paths per session via Rule 28's session-start sequence.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { rewriteFrameworkDocPaths, stripFrameworkOnlyBlocks } from './index.js';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

//? A representative slice of the real framework docs/ tree: framework-authored
//? docs plus the consumer-owned entries that must stay at `docs/`.
const ENTRIES = [
  'ARCHITECTURE_API.md',
  'BRANCH_LOG_PROTOCOL.md',
  'PACKAGE_OVERVIEW.md',
  'UPGRADING.md',
  'AI_QUICK_INDEX.md',
  'decisions',
  'lessons',
  'findings',
  'PRODUCT.md',
  'AI_CAPABILITIES.md',
  'AI_PROJECT_INDEX.md',
  'AI_DECISIONS_INDEX.md',
];

describe('rewriteFrameworkDocPaths', () => {
  it('rewrites framework-authored doc references into docs/luckystack/', () => {
    const out = rewriteFrameworkDocPaths('See `docs/ARCHITECTURE_API.md` and `docs/PACKAGE_OVERVIEW.md`.', ENTRIES);
    expect(out).toBe('See `docs/luckystack/ARCHITECTURE_API.md` and `docs/luckystack/PACKAGE_OVERVIEW.md`.');
  });

  it('leaves consumer-owned docs at docs/', () => {
    const src = 'Write `docs/decisions/NNNN-slug.md`, read `docs/AI_PROJECT_INDEX.md`, log under `docs/findings/2026-01-01-x/`.';
    expect(rewriteFrameworkDocPaths(src, ENTRIES)).toBe(src);
  });

  it('leaves lines that already spell out both paths alone', () => {
    const src = '| Architecture deep dives | `docs/ARCHITECTURE_API.md` | `docs/luckystack/ARCHITECTURE_API.md` |';
    expect(rewriteFrameworkDocPaths(src, ENTRIES)).toBe(src);
  });

  it('never double-prefixes on a second pass', () => {
    const once = rewriteFrameworkDocPaths('`docs/BRANCH_LOG_PROTOCOL.md`', ENTRIES);
    expect(rewriteFrameworkDocPaths(once, ENTRIES)).toBe(once);
    expect(once).not.toContain('docs/luckystack/luckystack/');
  });

  it('rewrites framework references in the real AGENTS.md without altering other content', () => {
    const agentsMd = readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
    const before = agentsMd.split('\n');
    const after = rewriteFrameworkDocPaths(agentsMd, ENTRIES).split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.join('\n')).toContain('`docs/luckystack/PACKAGE_OVERVIEW.md`');
    expect(after.join('\n')).toContain('`docs/PRODUCT.md`');
    expect(after.join('\n')).toContain('Follow `docs/luckystack/UPGRADING.md`.');
    for (let i = 0; i < before.length; i++) {
      if (before[i] === after[i]) continue;
      expect(after[i]?.replaceAll('docs/luckystack/', 'docs/')).toBe(before[i]);
    }
  });
});

describe('stripFrameworkOnlyBlocks', () => {
  it('drops fenced blocks and keeps everything else', () => {
    const src = [
      'keep one',
      '<!-- framework-only -->',
      'drop me',
      '<!-- /framework-only -->',
      'keep two',
    ].join('\n');
    expect(stripFrameworkOnlyBlocks(src)).toBe('keep one\nkeep two');
  });

  it('leaves a file without fences untouched', () => {
    const src = 'a\nb\nc';
    expect(stripFrameworkOnlyBlocks(src)).toBe(src);
  });

  it('throws on an unbalanced fence instead of swallowing the rest', () => {
    //? The failure mode worth guarding: a missing closer would silently drop
    //? everything after it, shipping consumers a truncated contract.
    const src = 'keep\n<!-- framework-only -->\nlost\nalso lost';
    expect(() => stripFrameworkOnlyBlocks(src)).toThrow(/unbalanced/);
  });

  it('rejects an unmatched closing fence instead of silently accepting broken guidance', () => {
    expect(() => stripFrameworkOnlyBlocks('keep\n<!-- /framework-only -->')).toThrow(/unexpected/);
  });

  it('the real AGENTS.md has balanced fences and keeps its consumer guidance', () => {
    const agentsMd = readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
    const stripped = stripFrameworkOnlyBlocks(agentsMd);
    expect(stripped).not.toContain('framework-only');
    expect(stripped.trim().length).toBeGreaterThan(0);
  });
});
