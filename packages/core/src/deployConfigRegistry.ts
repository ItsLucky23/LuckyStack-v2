//? Deploy-time topology registered by the project at boot. Mirrors the
//? `projectConfig` / `runtimeMapsRegistry` / `notifier` pattern: framework
//? packages read deploy data through `getDeployConfig()` so they don't
//? `import '../../../deploy.config'`.
//?
//? Only the fields core actually consumes are declared here. The project's
//? richer `DeployConfig` (environments, bindings, routing, etc.) stays in
//? `deploy.config.ts` and is consumed directly by the router package, which
//? is project-glue (tier-B) and intentionally stays project-coupled.
//?
//? Project entrypoint registers via the direct file path
//? (`./packages/core/src/deployConfigRegistry`) — same Vite-bundle rule we
//? already use for projectConfig: importing the core barrel from a
//? client-bundled file pulls server-only modules (Redis, paths, etc.).

export interface DeployResourceShape {
  type: 'redis' | 'mongo';
  urlEnvKey: string;
  synchronizedEnvKeys?: string[];
}

export interface DeployEnvironmentShape {
  redis: string;
  mongo: string;
  fallback?: string;
  bindings: Record<string, string>;
}

export interface DeployRoutingShape {
  onMissingService?: 'hard-error' | 'proxy-fallback';
  missingServiceErrorCode?: string;
  enableUnhealthyFallback?: boolean;
  strictBootHandshake?: boolean;
}

export interface DeployDevelopmentShape {
  enableFallbackRouting?: boolean;
  healthPollMs?: number;
  switchNewTrafficToLocalWhenHealthy?: boolean;
}

export interface DeployConfigShape {
  resources: Record<string, DeployResourceShape>;
  environments?: Record<string, DeployEnvironmentShape>;
  routing?: DeployRoutingShape;
  development?: DeployDevelopmentShape;
}

const DEFAULT_DEPLOY_CONFIG: DeployConfigShape = {
  resources: {},
};

let activeConfig: DeployConfigShape = DEFAULT_DEPLOY_CONFIG;
let registered = false;

export const registerDeployConfig = (config: DeployConfigShape): DeployConfigShape => {
  activeConfig = config;
  registered = true;
  return activeConfig;
};

export const getDeployConfig = (): DeployConfigShape => activeConfig;

export const isDeployConfigRegistered = (): boolean => registered;
