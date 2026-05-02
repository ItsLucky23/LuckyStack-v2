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

export interface DeployConfigShape {
  resources: Record<string, DeployResourceShape>;
}

const DEFAULT_DEPLOY_CONFIG: DeployConfigShape = {
  resources: {},
};

let activeConfig: DeployConfigShape = DEFAULT_DEPLOY_CONFIG;
let registered = false;

export const registerDeployConfig = (config: DeployConfigShape): void => {
  activeConfig = config;
  registered = true;
};

export const getDeployConfig = (): DeployConfigShape => activeConfig;

export const isDeployConfigRegistered = (): boolean => registered;
