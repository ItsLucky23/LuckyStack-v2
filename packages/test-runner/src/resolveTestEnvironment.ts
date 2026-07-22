//? @adr 0032 — test-process env/secret bootstrap through lazy consumer config.
//? Test-process bootstrap for environment-backed integrations. The live server
//? resolves secret-manager pointers in its own process, but Layer-5 tests also
//? use Prisma/Redis directly inside the runner process. That process therefore
//? needs the same env prefix BEFORE custom test modules are imported.

import { loadEnvFiles, tryCatch } from '@luckystack/core';

type MaybePromise<T> = T | Promise<T>;

interface SecretManagerConfigLike {
  url: string;
  token: string | { fromFile: string };
  [key: string]: unknown;
}

export interface ResolveTestEnvironmentInput {
  /**
   * Loads the consumer's default-exported `config.ts` object after `.env` files
   * are available. Keeping this as a callback avoids hardcoding a consumer path
   * inside the package and keeps `@luckystack/secret-manager` optional.
   */
  loadProjectConfig?: () => MaybePromise<unknown>;
}

interface RequiredProjectConfigLoader {
  loadProjectConfig: NonNullable<ResolveTestEnvironmentInput['loadProjectConfig']>;
}

/** @internal Runtime guard for untyped callers of the public orchestrators. */
export const assertProjectConfigLoader: (
  input: unknown,
  caller: 'runAllTests' | 'runCustomTests',
) => asserts input is RequiredProjectConfigLoader = (input, caller) => {
  if (
    typeof input !== 'object'
    || input === null
    || !('loadProjectConfig' in input)
    || typeof input.loadProjectConfig !== 'function'
  ) {
    throw new TypeError(`[test-runner] ${caller} requires a lazy loadProjectConfig callback`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isToken = (value: unknown): value is SecretManagerConfigLike['token'] =>
  typeof value === 'string'
  || (isRecord(value) && typeof value.fromFile === 'string');

const readSecretManagerConfig = (projectConfig: unknown): SecretManagerConfigLike | null => {
  if (!isRecord(projectConfig)) return null;
  const candidate = projectConfig.secretManager;
  if (!isRecord(candidate)) return null;

  const url = candidate.url;
  if (url === undefined || url === '') return null;
  if (typeof url !== 'string') {
    throw new TypeError('[test-runner] config.secretManager.url must be a string.');
  }
  if (!isToken(candidate.token)) {
    throw new TypeError(
      '[test-runner] config.secretManager.token must be a string or { fromFile: string }.',
    );
  }

  return { ...candidate, url, token: candidate.token };
};

/**
 * Load the project's env files and resolve optional secret-manager pointers for
 * the TEST process. Call before importing integration-test modules that touch a
 * database, Redis, or another env-backed SDK.
 */
export const resolveTestEnvironment = async (
  input: ResolveTestEnvironmentInput = {},
): Promise<void> => {
  loadEnvFiles();
  if (!input.loadProjectConfig) return;

  const projectConfig = await input.loadProjectConfig();
  const secretManagerConfig = readSecretManagerConfig(projectConfig);
  if (!secretManagerConfig) return;

  const [importError, secretManager] = await tryCatch(
    () => import('@luckystack/secret-manager'),
  );
  if (importError || !secretManager) {
    throw new Error(
      '[test-runner] config.secretManager.url is set, but @luckystack/secret-manager '
      + 'could not be loaded. Install the package or remove the secret-manager config; '
      + 'tests will not continue with unresolved env pointers.',
      { cause: importError ?? undefined },
    );
  }

  await secretManager.initSecretManager({
    ...secretManagerConfig,
    //? Match the normal server/ORM bootstrap: configured remote resolution is
    //? fail-fast. A raw DATABASE_URL_V<n> must never leak into Prisma.
    source: 'remote',
  });
};
