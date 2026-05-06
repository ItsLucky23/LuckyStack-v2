//? Boot-time validation that every registry the framework relies on has been
//? populated by the project's overlay files. Replaces silent runtime crashes
//? deep inside a request handler with a single, descriptive error thrown
//? before `httpServer.listen()` is called.
//?
//? The check is intentionally lightweight: it only confirms that the required
//? registrations happened. It does not validate the contents of those
//? registrations — that's done by the registries' own type / runtime
//? validators (e.g. `getProjectConfig()` always returns a deeply-merged value).

import {
  isProjectConfigRegistered,
  isDeployConfigRegistered,
} from '@luckystack/core';

export interface BootstrapRequirements {
  /**
   * If true, require a deploy config to have been registered. Defaults to
   * false because single-instance deployments don't need one.
   */
  requireDeployConfig?: boolean;
  /**
   * If true, require a services config to have been registered. Defaults to
   * false; only needed when running the router.
   */
  requireServicesConfig?: boolean;
  /**
   * If true, require an OAuth provider list to have been registered.
   * Defaults to false (an app may use credentials only).
   */
  requireOAuthProviders?: boolean;
}

export const verifyBootstrap = async (requirements: BootstrapRequirements = {}): Promise<void> => {
  const missing: string[] = [];

  if (!isProjectConfigRegistered()) {
    missing.push(
      'ProjectConfig — call `registerProjectConfig({...})` from `luckystack/core/bootstrap.ts` (or your config.ts).'
    );
  }

  if (requirements.requireDeployConfig && !isDeployConfigRegistered()) {
    missing.push(
      'DeployConfig — call `registerDeployConfig({...})` from `luckystack/deploy/deploy.config.ts`.'
    );
  }

  if (requirements.requireServicesConfig) {
    const { isServicesConfigRegistered } = await import('@luckystack/core');
    if (!isServicesConfigRegistered()) {
      missing.push(
        'ServicesConfig — call `registerServicesConfig({...})` from `services.config.ts`.'
      );
    }
  }

  if (requirements.requireOAuthProviders) {
    const { getOAuthProviders } = await import('@luckystack/login');
    if (getOAuthProviders().length <= 1) {
      // Default registry is `[{ name: 'credentials' }]` — anything ≤1 means
      // the consumer never registered providers.
      missing.push(
        'OAuth providers — call `registerOAuthProviders([...])` from `luckystack/login/oauthProviders.ts` (or skip this check if your app uses credentials only).'
      );
    }
  }

  if (missing.length === 0) return;

  const detail = missing.map((line, idx) => `  ${idx + 1}. ${line}`).join('\n');
  throw new Error(
    [
      '[LuckyStack] Bootstrap incomplete — the following registrations are missing:',
      detail,
      '',
      'See docs/ARCHITECTURE_PACKAGING.md (overlay layout) for the recommended bootstrap order.',
    ].join('\n')
  );
};
