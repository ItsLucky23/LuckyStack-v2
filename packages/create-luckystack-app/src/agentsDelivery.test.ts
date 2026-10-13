import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyAiDocs, isTextFile, replacePlaceholders, rewriteFrameworkDocPaths, stripFrameworkOnlyBlocks } from './index';
import { collectFileHashes, hashFileContent, writeScaffoldManifest } from './scaffoldManifest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const temporary: string[] = [];
const temp = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-agents-delivery-'));
  temporary.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('AGENTS-only AI instruction delivery', () => {
  it('bundles AGENTS.md rather than CLAUDE.md from an isolated framework', () => {
    const root = temp();
    const packageDir = path.join(root, 'packages', 'create-luckystack-app');
    const script = path.join(packageDir, 'scripts', 'bundleFrameworkDocs.mjs');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'packages', 'create-luckystack-app', 'scripts', 'bundleFrameworkDocs.mjs'), script);
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Design guidance\n');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'legacy rules\n');
    fs.mkdirSync(path.join(root, 'docs', 'findings', '2026-01-01-audit'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'PRODUCT.md'), 'framework identity');
    fs.writeFileSync(path.join(root, 'docs', 'ROADMAP.md'), 'framework roadmap');
    fs.writeFileSync(path.join(root, 'docs', 'findings', 'README.md'), 'framework findings ledger');
    fs.writeFileSync(path.join(root, 'docs', 'findings', '2026-01-01-audit', 'README.md'), 'framework historical findings');
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const bundle = path.join(packageDir, 'framework-docs');
    expect(fs.readFileSync(path.join(bundle, 'AGENTS.md'), 'utf8')).toBe('# Design guidance\n');
    expect(fs.existsSync(path.join(bundle, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(bundle, 'docs', 'PRODUCT.md'))).toBe(false);
    expect(fs.existsSync(path.join(bundle, 'docs', 'ROADMAP.md'))).toBe(false);
    expect(fs.existsSync(path.join(bundle, 'docs', 'findings', '2026-01-01-audit'))).toBe(false);
    expect(fs.existsSync(path.join(bundle, 'docs', 'findings'))).toBe(false);
  });

  it('refuses to bundle when the canonical AGENTS.md is absent', () => {
    const root = temp();
    const script = path.join(root, 'packages', 'create-luckystack-app', 'scripts', 'bundleFrameworkDocs.mjs');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'packages', 'create-luckystack-app', 'scripts', 'bundleFrameworkDocs.mjs'), script);
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'old instructions\n');
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('missing required AGENTS.md');
  });

  it('rejects a stale generated bundle rather than delivering legacy instructions', () => {
    const bundle = path.join(REPO_ROOT, 'packages', 'create-luckystack-app', 'framework-docs');
    const exists = fs.existsSync;
    vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => {
      if (candidate === bundle) return true;
      if (candidate === path.join(bundle, 'AGENTS.md')) return false;
      return exists(candidate);
    });
    expect(() => copyAiDocs(temp(), {}, '0.9.0')).toThrow('AGENTS.md is missing');
  });

  it('scaffolds rewritten AGENTS.md with an accurate rendered manifest hash and no CLAUDE.md', () => {
    // Test the source fallback independently of an ignored generated bundle.
    const bundle = path.join(REPO_ROOT, 'packages', 'create-luckystack-app', 'framework-docs');
    const exists = fs.existsSync;
    vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => candidate === bundle ? false : exists(candidate));
    const target = temp();
    copyAiDocs(target, { PROJECT_NAME: 'my-app' }, '0.9.0');
    const agents = path.join(target, 'AGENTS.md');
    expect(fs.existsSync(agents)).toBe(true);
    expect(fs.existsSync(path.join(target, 'CLAUDE.md'))).toBe(false);
    for (const ownDoc of ['PRODUCT.md', 'ROADMAP.md']) {
      expect(fs.existsSync(path.join(target, 'docs', 'luckystack', ownDoc))).toBe(false);
    }
    expect(fs.existsSync(path.join(target, 'docs', 'luckystack', 'findings'))).toBe(false);
    const config = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'create-luckystack-app', 'template', 'luckystack.ai.json'), 'utf8');
    expect(config).toContain('AGENTS.md');
    expect(config).not.toContain('CLAUDE.md');
    const source = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
    const expected = stripFrameworkOnlyBlocks(rewriteFrameworkDocPaths(
      replacePlaceholders(source, { PROJECT_NAME: 'my-app' }),
      fs.readdirSync(path.join(REPO_ROOT, 'docs')),
    ));
    const rendered = fs.readFileSync(agents, 'utf8');
    expect(rendered).toBe(expected);
    expect(rendered).toContain('`docs/luckystack/PACKAGE_OVERVIEW.md`');
    expect(rendered).toContain('`docs/PRODUCT.md`');
    expect(rendered).toContain('Follow `docs/luckystack/UPGRADING.md`.');
    expect(rendered).not.toContain('Follow `docs/UPGRADING.md`');
    const manifest = writeScaffoldManifest(target, {
      luckystackVersion: '0.9.0', projectName: 'my-app', choices: {}, isTextFile,
    });
    const entry = manifest.files.find((file) => file.path === 'AGENTS.md');
    expect(entry?.sha256).toBe(hashFileContent(fs.readFileSync(agents), true));
    expect(manifest.files.some((file) => file.path === 'CLAUDE.md')).toBe(false);
    expect(collectFileHashes(target, isTextFile).find((file) => file.path === 'AGENTS.md')).toEqual(entry);
  });
});
