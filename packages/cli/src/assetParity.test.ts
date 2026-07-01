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
import { AUTH_MODES, OAUTH_PROVIDERS, EMAIL_PROVIDERS, MONITORING_PROVIDERS } from './featureOptions';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
//? Walk EVERY shipped asset bundle (the `add <feature>` payloads: login auth UI +
//? functions/session.ts + server/hooks, docs-ui API-explorer page, error-tracking
//? sentry shim) against the template ROOT so every shipped file is parity-checked,
//? not just login's. Drift here is what shipped a non-compiling LoginForm / docs
//? page via `add` (audit HB1/QUA-003 + the docs-ui blocker).
const ASSET_BUNDLES = ['login', 'docs-ui', 'error-tracking', 'router'] as const;
const TEMPLATE_ROOT = path.join(repoRoot, 'packages', 'create-luckystack-app', 'template');
const SERVER_CAPABILITIES = path.join(repoRoot, 'packages', 'server', 'src', 'capabilities.ts');
const SCAFFOLDER_INDEX = path.join(repoRoot, 'packages', 'create-luckystack-app', 'src', 'index.ts');
const ADD_SECRET_MANAGER = path.join(here, 'commands', 'addSecretManager.ts');

const normalize = (text: string): string => text.replaceAll('\r\n', '\n');

//? Files where the ASSET is intentionally AHEAD of the template (CONTENTS may
//? differ temporarily while a cross-package fix is mid-sync; the template
//? counterpart must still EXIST). EMPTY = the desired lockstep end state: every
//? shipped auth file is byte-identical across the `add login` asset bundle and the
//? scaffold template. LoginForm.tsx WAS the exception — the asset still read the
//? removed `providers` config export while the template fetched `GET /auth/providers`
//? — and that drift shipped a non-compiling LoginForm via `add login`. The asset is
//? now reconciled to the template, so this set is empty again. Add an entry ONLY for
//? a deliberate, temporary divergence and shrink it back to empty ASAP.
const ASSET_AHEAD_OF_TEMPLATE = new Set<string>([]);

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

describe.each(ASSET_BUNDLES)('asset ↔ template parity: %s (audit QUA-021)', (bundle) => {
  const assetRoot = path.resolve(here, '..', 'assets', bundle);
  const assetFiles = relFilesUnder(assetRoot);

  it('every asset file exists in the template tree', () => {
    const missing = assetFiles.filter((rel) => !existsSync(path.join(TEMPLATE_ROOT, rel)));
    expect(missing, `asset files with no template counterpart: ${missing.join(', ')}`).toEqual([]);
  });

  const strictFiles = assetFiles.filter((rel) => !ASSET_AHEAD_OF_TEMPLATE.has(rel));
  it.each(strictFiles)('asset/%s matches the template copy (CRLF-normalized)', (rel) => {
    const templatePath = path.join(TEMPLATE_ROOT, rel);
    expect(existsSync(templatePath)).toBe(true);
    const asset = normalize(readFileSync(path.join(assetRoot, rel), 'utf8'));
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
    //? OPTIONAL_PACKAGES trips this test. Some entries are intentionally NOT in
    //? server OPTIONAL_PACKAGES (which lists boot-auto-detected `./register`
    //? packages): `sync` (client bridge), `secret-manager` (config-gated init in
    //? server.ts), `router` (separate process), `mcp` (dev tool). Exclude those.
    const NOT_BOOT_AUTODETECTED = new Set(['sync', 'secret-manager', 'router', 'mcp']);
    const featureKeys = REGISTRY.map((entry) => entry.id).filter((key) => !NOT_BOOT_AUTODETECTED.has(key));

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

//? ADR 0014 D3: featureOptions.ts is the CLI's own copy of the reconfigurable
//? PROVIDER_OPTIONS. This guards it against drift from the scaffolder's source —
//? add a provider/mode in one place without the other and this trips.
describe('featureOptions ↔ scaffolder PROVIDER_OPTIONS parity (ADR 0014 D3)', () => {
  const src = readFileSync(SCAFFOLDER_INDEX, 'utf8');
  //? NOTE: this non-greedy capture assumes PROVIDER_OPTIONS stays a FLAT object of
  //? arrays (no nested braces). If a value ever becomes a nested object, the regex
  //? truncates at the first `}` — the per-list extract() calls below would return
  //? null and trip the it.each tests, surfacing the need to update this matcher.
  const block = /const PROVIDER_OPTIONS\s*=\s*\{([\s\S]*?)\}\s*as const;/.exec(src);

  it('PROVIDER_OPTIONS block is present in the scaffolder', () => {
    expect(block, 'could not find PROVIDER_OPTIONS in create-luckystack-app/src/index.ts').not.toBeNull();
  });

  const extract = (key: string): string[] | null => {
    //? Escape the key before interpolating into a RegExp (defensive — keys are known
    //? identifiers today, but a future key with a metacharacter must not corrupt the pattern).
    const safeKey = key.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const m = new RegExp(`${safeKey}:\\s*\\[([^\\]]*)\\]`).exec(block?.[1] ?? '');
    return m ? [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] ?? '') : null;
  };

  it.each([
    ['authMode', [...AUTH_MODES]],
    ['oauthProviders', [...OAUTH_PROVIDERS]],
    ['emailProvider', [...EMAIL_PROVIDERS]],
    ['monitoringProvider', [...MONITORING_PROVIDERS]],
  ])('CLI %s matches the scaffolder list', (key, cliList) => {
    expect(extract(key), `${key} not found in PROVIDER_OPTIONS`).toEqual(cliList);
  });
});

//? The secret-manager enable-blocks are duplicated in the CLI (addSecretManager.ts
//? CONFIG_ACTIVE / SERVER_ACTIVE) and the scaffolder (wireSecretManager). Crucially,
//? `removeSecretManager` re-comments them by matching the CLI's verbatim ACTIVE
//? strings, so ANY scaffolder-side edit to those blocks silently turns
//? `remove secret-manager` / manage→off into a no-op on a `--secret-manager`
//? scaffolded project (dep dropped, but the active `await import(...)` block stays).
//? Assert the scaffolder source still contains the exact ACTIVE blocks the CLI matches.
describe('secret-manager block parity (CLI ↔ scaffolder)', () => {
  const scaffolder = normalize(readFileSync(SCAFFOLDER_INDEX, 'utf8'));
  const cliSrc = normalize(readFileSync(ADD_SECRET_MANAGER, 'utf8'));

  //? Extract a top-level template-literal const BODY from the CLI source as RAW
  //? source text (with `\``-escapes intact) so it can be substring-matched against
  //? the scaffolder source — which stores the same block the same way. Comparing
  //? the SOURCE forms (not the runtime-evaluated strings) keeps escaping identical.
  const literalBody = (name: string): string => {
    const m = new RegExp('const ' + name + ' = `([\\s\\S]*?)`;').exec(cliSrc);
    expect(m, `${name} template literal not found in addSecretManager.ts`).not.toBeNull();
    return m?.[1] ?? '';
  };

  it('scaffolder wireSecretManager contains the CLI CONFIG_ACTIVE block verbatim', () => {
    expect(scaffolder.includes(literalBody('CONFIG_ACTIVE'))).toBe(true);
  });

  it('scaffolder wireSecretManager contains the CLI SERVER_ACTIVE block verbatim', () => {
    expect(scaffolder.includes(literalBody('SERVER_ACTIVE'))).toBe(true);
  });

  //? The same enable-later block ALSO lives in the template's
  //? scripts/prismaWithSecrets.ts (so `prisma:*` resolves DATABASE_URL pointers).
  //? add/remove toggle it with the CLI's SERVER_COMMENTED/SERVER_ACTIVE strings, so
  //? the shipped template file must contain the COMMENTED form verbatim, and the
  //? scaffolder must uncomment that same file for a `--secret-manager` scaffold.
  it('template scripts/prismaWithSecrets.ts ships the CLI SERVER_COMMENTED block verbatim', () => {
    const wrapper = normalize(
      readFileSync(path.join(TEMPLATE_ROOT, 'scripts', 'prismaWithSecrets.ts'), 'utf8'),
    );
    expect(wrapper.includes(literalBody('SERVER_COMMENTED'))).toBe(true);
  });

  it('scaffolder wireSecretManager uncomments scripts/prismaWithSecrets.ts', () => {
    expect(scaffolder.includes("editScaffoldFile(targetDir, 'scripts/prismaWithSecrets.ts'")).toBe(true);
  });
});

//? Tiny sanity guard: the bundle the parity suite walks must actually exist.
describe.each(ASSET_BUNDLES)('asset bundle present: %s', (bundle) => {
  it('the assets bundle dir exists', () => {
    expect(statSync(path.resolve(here, '..', 'assets', bundle)).isDirectory()).toBe(true);
  });
});
