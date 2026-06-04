//? Services topology. A simple single-service app maps `system` -> 'root'
//? (i.e. the project's `src/_api/` and `src/_sync/`). Add more services and
//? presets later if you split into multi-instance deployments.

import { registerServicesConfig } from '@luckystack/core';

export interface ServiceDefinition {
  /** 'root' -> src/_api, src/_sync (reserved for `system`). Otherwise a folder name under src/. */
  source: 'root' | string;
}

export interface PresetDefinition {
  description?: string;
  /** Services that are bundled together into one backend artifact. */
  services: string[];
}

export interface ServicesConfig {
  services: Record<string, ServiceDefinition>;
  presets: Record<string, PresetDefinition>;
}

const servicesConfig: ServicesConfig = {
  services: {
    system: { source: 'root' },
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
