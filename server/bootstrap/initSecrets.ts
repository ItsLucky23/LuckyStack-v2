//? Optional @luckystack/secret-manager boot seam. Resolves `.env` pointers
//? (`NAME=BASE_V<n>`) into process.env BEFORE any framework code reads a secret,
//? then hands control back to the normal boot. Deliberately fail-OPEN on absence
//? and fail-CLOSED on misconfiguration:
//?
//?   • url empty                       → skip; the plain local env files are used.
//?   • url set, package NOT installed  → warn + skip; plain local env is used.
//?   • url set, package installed      → initSecretManager in `'remote'` mode: an
//?                                       unresolved pointer or an unreachable
//?                                       server is a HARD boot failure (throws).
//?
//? The injectable `importer` is the test seam (see initSecrets.test.ts); the
//? default dynamically imports the optional package so a project that never sets
//? LUCKYSTACK_SECRET_MANAGER_URL boots fine without it installed.

import type { initSecretManager, SecretManagerConfig, SecretManagerToken } from '@luckystack/secret-manager';

/**
 * Minimal boot-seam config for `resolveSecretsIfConfigured`. This deliberately
 * omits `envNames` — the boot seam is intended as a thin wiring layer that
 * resolves ALL pointer-shaped env values for the project. If `envNames` is not
 * forwarded here, `initSecretManager`'s secure default (deny-all, with a boot
 * warning) applies and NOTHING will be resolved off-host.
 *
 * Consumers who need to scope resolution to a specific allowlist of env names
 * should call `initSecretManager` from `@luckystack/secret-manager` directly,
 * passing `envNames`, instead of using this boot-seam helper.
 */
export interface SecretManagerBootConfig {
  /** Base URL of the secret-manager server. An empty string disables resolution. */
  url?: string;
  /** Shared bearer token — a literal string or a gitignored `{ fromFile }`. */
  token: SecretManagerToken;
  /** Optional dev-only hot reload (e.g. the rotation poll). Ignored in production. */
  dev?: SecretManagerConfig['dev'];
}

interface SecretManagerModule {
  initSecretManager: typeof initSecretManager;
}

export const resolveSecretsIfConfigured = async (
  config: SecretManagerBootConfig,
  importer: () => Promise<SecretManagerModule> = () => import('@luckystack/secret-manager'),
): Promise<void> => {
  const { url, token, dev } = config;
  if (!url) return;

  const secretManager = await importer().catch(() => null);
  if (!secretManager) {
    console.warn(
      '[secret-manager] LUCKYSTACK_SECRET_MANAGER_URL is set but @luckystack/secret-manager is not installed — booting on the local env files as-is.',
    );
    return;
  }

  //? Installed + configured → remote mode: fail-fast on an unresolved pointer or
  //? an unreachable server, so a misconfigured secret never boots silently.
  await secretManager.initSecretManager({ url, token, source: 'remote', dev });
};
