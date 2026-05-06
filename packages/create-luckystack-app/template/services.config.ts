//? Services topology. A simple single-service app maps `system` -> 'root'
//? (i.e. the project's `src/_api/` and `src/_sync/`). Add more services and
//? presets later if you split into multi-instance deployments.

import { registerServicesConfig } from '@luckystack/core';

const servicesConfig = {
  services: {
    system: { source: 'root' as const },
  },
  presets: {
    'core-preset': {
      description: 'Default bundle — every API/sync route in src/_api and src/_sync.',
      services: ['system'],
    },
  },
};

registerServicesConfig(servicesConfig);

export default servicesConfig;
