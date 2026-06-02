import { describe, expect, it, vi } from 'vitest';

import { resolveSecretsIfConfigured } from './initSecrets';

describe('resolveSecretsIfConfigured', () => {
  it('skips entirely when no url is configured — the package is never imported', async () => {
    const importer = vi.fn();
    await resolveSecretsIfConfigured({ url: '', token: 'tok' }, importer);
    expect(importer).not.toHaveBeenCalled();
  });

  it('warns and falls through to local env when the package is not installed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* swallow the expected warning */
    });
    const importer = vi.fn().mockRejectedValue(new Error('Cannot find module'));

    await expect(
      resolveSecretsIfConfigured({ url: 'http://localhost:4000', token: 'tok' }, importer),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('initializes in remote mode when configured and installed', async () => {
    const initSecretManager = vi.fn(() => Promise.resolve());
    const importer = vi.fn().mockResolvedValue({ initSecretManager });

    await resolveSecretsIfConfigured(
      { url: 'http://localhost:4000/', token: { fromFile: '.secret-manager-token' } },
      importer,
    );

    expect(initSecretManager).toHaveBeenCalledWith({
      url: 'http://localhost:4000/',
      token: { fromFile: '.secret-manager-token' },
      source: 'remote',
      dev: undefined,
    });
  });

  it('forwards the dev config (rotation poll) to initSecretManager', async () => {
    const initSecretManager = vi.fn(() => Promise.resolve());
    const importer = vi.fn().mockResolvedValue({ initSecretManager });
    const dev = { watch: false, pollIntervalMs: 30_000 };

    await resolveSecretsIfConfigured({ url: 'http://localhost:4000', token: 'tok', dev }, importer);

    expect(initSecretManager).toHaveBeenCalledWith({
      url: 'http://localhost:4000',
      token: 'tok',
      source: 'remote',
      dev,
    });
  });

  it('propagates a remote resolve failure as a hard boot stop', async () => {
    const initSecretManager = vi.fn().mockRejectedValue(new Error('Server did not resolve: TEST_V99'));
    const importer = vi.fn().mockResolvedValue({ initSecretManager });

    await expect(
      resolveSecretsIfConfigured({ url: 'http://localhost:4000', token: 'tok' }, importer),
    ).rejects.toThrow('Server did not resolve');
  });
});
