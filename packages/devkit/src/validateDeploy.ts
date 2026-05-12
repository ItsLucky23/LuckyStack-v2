//? Pure validator for `services.config.ts` + `deploy.config.ts` content.
//? Catches the classes of misconfiguration that otherwise only surface at
//? runtime, often silently (empty service map served, fallback target
//? unreachable, env var typo).
//?
//? Pure module so it can be unit-tested and reused outside the CLI — the
//? CLI in `cli/validateDeploy.ts` is a thin wrapper that loads the config
//? files, calls `validateDeploy(...)`, and prints results.

import type {
  DeployConfigShape,
  ServicesConfigShape,
} from '@luckystack/core';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationFinding {
  severity: ValidationSeverity;
  code: string;
  message: string;
  /** Human-readable location pointer (e.g. `services.config.ts > presets.api`). */
  location?: string;
}

export interface ValidateDeployInput {
  services: ServicesConfigShape;
  deploy: DeployConfigShape;
  /**
   * Environment values to consult for `synchronizedEnvKeys` / `urlEnvKey`
   * presence checks. Defaults to `process.env`. Pass a fixture for tests.
   */
  env?: Record<string, string | undefined>;
}

export interface ValidateDeployResult {
  ok: boolean;
  findings: ValidationFinding[];
  errorCount: number;
  warningCount: number;
}

export const validateDeploy = ({
  services,
  deploy,
  env = process.env,
}: ValidateDeployInput): ValidateDeployResult => {
  const findings: ValidationFinding[] = [];
  const serviceNames = new Set(Object.keys(services.services));

  //? Rule 1: every service is assigned to exactly one preset.
  const servicesInPresets = new Map<string, string[]>();
  for (const [presetKey, preset] of Object.entries(services.presets)) {
    for (const service of preset.services) {
      const existing = servicesInPresets.get(service) ?? [];
      existing.push(presetKey);
      servicesInPresets.set(service, existing);
    }
  }

  for (const service of serviceNames) {
    const owners = servicesInPresets.get(service) ?? [];
    if (owners.length === 0) {
      findings.push({
        severity: 'error',
        code: 'service-unassigned',
        message: `Service "${service}" is declared in services.services but not assigned to any preset. Every service must belong to exactly one preset.`,
        location: `services.config.ts > services.${service}`,
      });
    } else if (owners.length > 1) {
      findings.push({
        severity: 'error',
        code: 'service-in-multiple-presets',
        message: `Service "${service}" is in multiple presets: ${owners.join(', ')}. A service may belong to exactly one preset.`,
        location: `services.config.ts > services.${service}`,
      });
    }
  }

  //? Rule 2: every preset references services that exist.
  for (const [presetKey, preset] of Object.entries(services.presets)) {
    for (const service of preset.services) {
      if (!serviceNames.has(service)) {
        findings.push({
          severity: 'error',
          code: 'preset-references-unknown-service',
          message: `Preset "${presetKey}" references unknown service "${service}". Add it to services.services or remove the reference.`,
          location: `services.config.ts > presets.${presetKey}.services`,
        });
      }
    }
  }

  //? Rule 3: every binding's service matches an actual service.
  //? Rule 4: fallback env key must exist.
  //? Rule 5: redis/mongo resource keys must exist.
  //? Rule 6: fallback shared-resource invariant.
  const environments = deploy.environments ?? {};
  const resourceNames = new Set(Object.keys(deploy.resources));

  for (const [envKey, envDef] of Object.entries(environments)) {
    if (!envDef) continue;

    for (const bindingService of Object.keys(envDef.bindings)) {
      if (!serviceNames.has(bindingService)) {
        findings.push({
          severity: 'error',
          code: 'binding-references-unknown-service',
          message: `Environment "${envKey}" binds unknown service "${bindingService}". Either add it to services.services or remove the binding.`,
          location: `deploy.config.ts > environments.${envKey}.bindings`,
        });
      }
    }

    if (!resourceNames.has(envDef.redis)) {
      findings.push({
        severity: 'error',
        code: 'unknown-redis-resource',
        message: `Environment "${envKey}" references unknown redis resource "${envDef.redis}". Add it to deploy.resources.`,
        location: `deploy.config.ts > environments.${envKey}.redis`,
      });
    }
    if (!resourceNames.has(envDef.mongo)) {
      findings.push({
        severity: 'error',
        code: 'unknown-mongo-resource',
        message: `Environment "${envKey}" references unknown mongo resource "${envDef.mongo}". Add it to deploy.resources.`,
        location: `deploy.config.ts > environments.${envKey}.mongo`,
      });
    }

    if (envDef.fallback) {
      const fallbackEnv = environments[envDef.fallback];
      if (!fallbackEnv) {
        findings.push({
          severity: 'error',
          code: 'unknown-fallback-env',
          message: `Environment "${envKey}" has fallback "${envDef.fallback}" which does not exist in deploy.environments.`,
          location: `deploy.config.ts > environments.${envKey}.fallback`,
        });
      } else {
        if (fallbackEnv.redis !== envDef.redis) {
          findings.push({
            severity: 'error',
            code: 'fallback-redis-mismatch',
            message: `Environment "${envKey}" and its fallback "${envDef.fallback}" reference different redis resources ("${envDef.redis}" vs "${fallbackEnv.redis}"). Fallback envs must share the same redis resource key to keep the shared-Redis invariant.`,
            location: `deploy.config.ts > environments.${envKey}.fallback`,
          });
        }
        if (fallbackEnv.mongo !== envDef.mongo) {
          findings.push({
            severity: 'error',
            code: 'fallback-mongo-mismatch',
            message: `Environment "${envKey}" and its fallback "${envDef.fallback}" reference different mongo resources ("${envDef.mongo}" vs "${fallbackEnv.mongo}"). Fallback envs must share the same mongo resource key.`,
            location: `deploy.config.ts > environments.${envKey}.fallback`,
          });
        }
      }
    }
  }

  //? Rule 7+8: env var references must resolve at config time.
  for (const [resourceKey, resource] of Object.entries(deploy.resources)) {
    const urlValue = env[resource.urlEnvKey];
    if (urlValue === undefined || urlValue === '') {
      findings.push({
        severity: 'warning',
        code: 'missing-resource-env-var',
        message: `Resource "${resourceKey}" expects env var "${resource.urlEnvKey}" but it is unset. The framework will still boot if the env is provided at runtime, but config-time tooling cannot verify the value.`,
        location: `deploy.config.ts > resources.${resourceKey}.urlEnvKey`,
      });
    }

    for (const synchronizedKey of resource.synchronizedEnvKeys ?? []) {
      const value = env[synchronizedKey];
      if (value === undefined || value === '') {
        findings.push({
          severity: 'warning',
          code: 'missing-synchronized-env-var',
          message: `Resource "${resourceKey}" requires synchronized env var "${synchronizedKey}" but it is unset. Boot will compute an empty hash and fall back to warning-only.`,
          location: `deploy.config.ts > resources.${resourceKey}.synchronizedEnvKeys`,
        });
      }
    }
  }

  //? Rule 9: services declared in services.config but not bound in any
  //? environment will never receive traffic. Warning, not error — that's a
  //? valid intermediate state during a rollout.
  for (const service of serviceNames) {
    const boundIn = Object.entries(environments).filter(([, env]) => env && service in env.bindings);
    if (boundIn.length === 0) {
      findings.push({
        severity: 'warning',
        code: 'service-bound-in-no-environment',
        message: `Service "${service}" is in services.services and assigned to a preset but never bound in any environment. Requests for this service will fall through to the missing-service handler.`,
        location: `services.config.ts > services.${service}`,
      });
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  return {
    ok: errorCount === 0,
    findings,
    errorCount,
    warningCount,
  };
};
