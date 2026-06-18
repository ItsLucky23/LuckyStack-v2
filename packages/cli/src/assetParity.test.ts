//? Guards the invariants that let `luckystack add <feature>` ship a working
//? scaffold. The asset bundle is a COPY of the template's auth UI; when the
//? template moved to a live `GET /auth/providers` fetch but the asset copy was
//? left behind, `add login` produced a non-compiling LoginForm with nothing in
//? CI to notice (audit HB1/QUA-003). These tests fail on that class of drift.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REGISTRY } from './registry';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const ASSET_ROOT = path.resolve(here, '..', 'assets', 'login', 'src');
const TEMPLATE_ROOT = path.join(repoRoot, 'packages', 'create-luckystack-app', 'template', 'src');
const SERVER_CAPABILITIES = path.join(repoRoot, 'packages', 'server', 'src', 'capabilities.ts');

const normalize = (text: string): string => text.replaceAll('\r\n', '\n');

//? Files where the ASSET is intentionally AHEAD of the template: a security fix
//? landed in the asset (this audit) but the template + consumer copies still
//? need the same change applied cross-package. Until that sync lands the file
//? legitimately differs, so we exempt it from strict equality (but still require
//? the template counterpart to EXIST). Shrink this set to empty once the template
//? catches up — that's the desired lockstep end state.
//?   - _components/LoginForm.tsx : asset + template carry two genuinely different
//?     login implementations (asset reads `providers` from config; template fetches
//?     `GET /auth/providers` with a loading-gated `showCredentials`). This is
//?     pre-existing cross-package drift, not a lockstep-able single change —
//?     exempt until the two are deliberately reconciled into one source.
const ASSET_AHEAD_OF_TEMPLATE = new Set<string>([
  '_components/LoginForm.tsx',
]);

//? Walk every file under `dir`, returning paths relative to it (posix slashes).
const relFilesUnder = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile()) out.push(childRel);
    }
  };
  walk(dir, '');
  return out.toSorted();
};

describe('asset ↔ template parity (audit QUA-021)', () => {
  const assetFiles = relFilesUnder(ASSET_ROOT);

  it('every asset file exists in the template tree', () => {
    const missing = assetFiles.filter((rel) => !existsSync(path.join(TEMPLATE_ROOT, rel)));
    expect(missing, `asset files with no template counterpart: ${missing.join(', ')}`).toEqual([]);
  });

  const strictFiles = assetFiles.filter((rel) => !ASSET_AHEAD_OF_TEMPLATE.has(rel));
  it.each(strictFiles)('asset/%s matches the template copy (CRLF-normalized)', (rel) => {
    const templatePath = path.join(TEMPLATE_ROOT, rel);
    expect(existsSync(templatePath)).toBe(true);
    const asset = normalize(readFileSync(path.join(ASSET_ROOT, rel), 'utf8'));
    const template = normalize(readFileSync(templatePath, 'utf8'));
    expect(asset).toBe(template);
  });

  //? The exempted files must still have a template counterpart (so an asset file
  //? can't be orphaned under the exemption) — only their CONTENTS are allowed to
  //? differ until the cross-package sync lands.
  it.each([...ASSET_AHEAD_OF_TEMPLATE])('asset/%s (ahead of template) still has a template counterpart', (rel) => {
    expect(existsSync(path.join(TEMPLATE_ROOT, rel))).toBe(true);
  });
});

describe('feature registry ↔ optional packages (audit QUA-021)', () => {
  it('every registry FEATURE (minus sync) is a known server OPTIONAL_PACKAGE', () => {
    //? Derive the feature list from the REAL `REGISTRY` (imported directly) rather
    //? than scraping source — so adding a registry entry without mirroring it into
    //? OPTIONAL_PACKAGES trips this test. `sync` is intentionally excluded from
    //? OPTIONAL_PACKAGES (client-bridge only, no server register), so exclude it
    //? here too — mirrors the comment in server/src/capabilities.ts.
    const featureKeys = REGISTRY.map((entry) => entry.id).filter((key) => key !== 'sync');

    const capsSrc = readFileSync(SERVER_CAPABILITIES, 'utf8');
    const block = /OPTIONAL_PACKAGES\s*=\s*\[([^\]]*)\]/.exec(capsSrc);
    expect(block, 'could not find OPTIONAL_PACKAGES in capabilities.ts').not.toBeNull();
    const optional = new Set(
      [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]),
    );

    const orphaned = featureKeys.filter((key) => !optional.has(key));
    expect(orphaned, `REGISTRY ids not in OPTIONAL_PACKAGES: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('every registry entry pkg name matches `@luckystack/<id>`', () => {
    const mismatched = REGISTRY.filter((entry) => entry.pkg !== `@luckystack/${entry.id}`);
    expect(mismatched.map((e) => e.id), 'registry id/pkg mismatch').toEqual([]);
  });
});

//? Tiny sanity guard: the bundle the parity suite walks must actually exist.
describe('asset bundle present', () => {
  it('assets/login/src is a directory', () => {
    expect(statSync(ASSET_ROOT).isDirectory()).toBe(true);
  });
});
