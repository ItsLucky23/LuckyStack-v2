//? Deploy-time topology. Single-instance projects can leave this minimal —
//? only `resources` is consumed by the framework's synchronizedEnvHashes
//? check. `environments` / `routing` / `development` are read by the optional
//? `@luckystack/router` for split/multi-instance deployments.

import { registerDeployConfig } from '@luckystack/core';

const deployConfig = {
  resources: {
    redisShared: {
      type: 'redis' as const,
      urlEnvKey: 'REDIS_HOST',
      synchronizedEnvKeys: ['PROJECT_NAME'],
    },
    mongoShared: {
      type: 'mongo' as const,
      urlEnvKey: 'DATABASE_URL',
    },
  },
};

registerDeployConfig(deployConfig);

export default deployConfig;
