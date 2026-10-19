/**
 * SERVICES CONFIG (build-time source of truth)
 *
 * Defines which services exist in this project and how they are grouped
 * into presets for backend bundle generation. This file changes only when
 * services are added, renamed, or regrouped. Network topology (URLs, which
 * environment runs which bundle) lives in deploy.config.ts.
 *
 * Rules:
 *   - `system` is reserved and always maps to `src/_api` + `src/_sync` (source: 'root').
 *   - `src/system` is invalid as a service folder.
 *   - A service may belong to EXACTLY ONE preset.
 *   - Every top-level src/ folder with _api/_sync routes must be a declared
 *     service in a preset; the production build fails otherwise.
 *   - Route names follow the service-first contract: `service/name` (see docs/ARCHITECTURE_ROUTING.md).
 */

//? `@luckystack/core/config`, same as deploy.config.ts and config.ts — see the
//? comment there. Client-safe (the barrel would drag ioredis into the browser)
//? AND one module instance (a deep source import splits under Bun).
import { registerServicesConfig } from '@luckystack/core/config';

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
    vehicles: { source: 'vehicles' },
    billing: { source: 'billing' },
    //? The account pages' routes (`src/settings/_api`, `src/reset-password/_api`).
    //? Undeclared, they were silently left out of every production bundle.
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
    'core-preset': {
      description: 'Identity, session, account settings, password reset, and root-level system APIs.',
      services: ['system', 'settings', 'reset-password'],
    },
    'fleet-preset': {
      description: 'Vehicle management service bundle.',
      services: ['vehicles'],
    },
    'finance-preset': {
      description: 'Billing and payments service bundle.',
      services: ['billing'],
    },
  },
};

//? Side-effect registration: any import wires the services topology into
//? @luckystack/core so the router can read it via getServicesConfig().
registerServicesConfig(servicesConfig);

export default servicesConfig;
