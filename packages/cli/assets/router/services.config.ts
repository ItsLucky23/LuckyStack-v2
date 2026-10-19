//? Services topology — added by `npx luckystack add router`. A single-service app
//? maps `system` -> 'root' (the project's `src/_api` + `src/_sync`) and bundles it
//? into one `default` preset, so a bare `npm run server` (prod) keeps working.
//? Scale to multi-instance by adding services + a preset per backend bundle, then
//? run `npm run server -- <preset>`:
//?
//?   services: { system: { source: 'root' }, vehicles: { source: 'vehicles' } },
//?   presets:  { default: { services: ['system'] }, fleet: { services: ['vehicles'] } },
//?
//? Every top-level `src/` folder holding `_api` / `_sync` routes is a service and
//? must be declared here and placed in a preset; the production build fails
//? otherwise, because no bundle would contain those routes.

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
  /** HTTP path-prefix → owning service for routes outside /api and /sync. */
  customRoutes?: Record<string, string>;
}

const servicesConfig: ServicesConfig = {
  services: {
    system: { source: 'root' },
    //? The account pages' routes (`src/settings/_api`, `src/reset-password/_api`).
    settings: { source: 'settings' },
    'reset-password': { source: 'reset-password' },
  },
  customRoutes: {
    '/auth': 'system',
    '/uploads': 'system',
    '/hooks': 'system',
    '/_health': 'system',
    '/livez': 'system',
    '/readyz': 'system',
    '/_docs': 'system',
  },
  presets: {
    default: {
      description: 'Default bundle — every API/sync route in src/_api and src/_sync, plus the account pages.',
      services: ['system', 'settings', 'reset-password'],
    },
  },
};

registerServicesConfig(servicesConfig);

export default servicesConfig;
