import { describe, expect, it } from 'vitest';
import { resolveLuckyStackRange } from './project';

//? Regression guard for the `add <feature>` version-resolution footgun: the
//? helper reuses an existing @luckystack dep's range so a newly-added package
//? matches the rest — but it MUST NOT reuse a protocol spec (`file:`/`link:`/
//? `git`/`http`/`workspace:`/`portal:`), which points at a SPECIFIC package's
//? location and would mis-point a DIFFERENT package's install (the bug that made
//? `add login` resolve `@luckystack/login` to the `luckystack-api` tarball).
describe('resolveLuckyStackRange', () => {
  it('reuses a plain semver range from an existing @luckystack dep', () => {
    expect(resolveLuckyStackRange({ dependencies: { '@luckystack/core': '^0.2.5' } }, '0.2.7')).toBe('^0.2.5');
  });

  it('reuses a range found in devDependencies', () => {
    expect(resolveLuckyStackRange({ devDependencies: { '@luckystack/devkit': '~0.3.0' } }, '0.2.7')).toBe('~0.3.0');
  });

  it('falls back to ^cliVersion when no @luckystack dep exists', () => {
    expect(resolveLuckyStackRange({ dependencies: { react: '^19.0.0' } }, '0.2.7')).toBe('^0.2.7');
  });

  it('falls back to ^cliVersion when the only @luckystack dep uses a file: spec (would mis-point the install)', () => {
    expect(
      resolveLuckyStackRange({ dependencies: { '@luckystack/api': 'file:../tarballs/luckystack-api-0.2.7.tgz' } }, '0.2.7'),
    ).toBe('^0.2.7');
  });

  it('skips protocol specs and reuses a later plain semver range', () => {
    expect(
      resolveLuckyStackRange(
        {
          dependencies: { '@luckystack/api': 'file:../x.tgz' },
          devDependencies: { '@luckystack/cli': '^0.2.6' },
        },
        '0.2.7',
      ),
    ).toBe('^0.2.6');
  });

  it.each([
    ['file:', { '@luckystack/api': 'file:../x.tgz' }],
    ['link:', { '@luckystack/api': 'link:../x' }],
    ['git+', { '@luckystack/api': 'git+https://example.com/x.git' }],
    ['http', { '@luckystack/api': 'https://example.com/x.tgz' }],
    ['workspace:', { '@luckystack/api': 'workspace:*' }],
    ['portal:', { '@luckystack/api': 'portal:../x' }],
  ])('does not reuse a %s spec', (_label, dependencies) => {
    expect(resolveLuckyStackRange({ dependencies }, '0.2.7')).toBe('^0.2.7');
  });
});
