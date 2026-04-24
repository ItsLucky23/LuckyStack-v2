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
 *   - Route names follow the service-first contract: `service/name` (see docs/ARCHITECTURE_ROUTING.md).
 */

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
    vehicles: { source: 'vehicles' },
    billing: { source: 'billing' },
  },

  presets: {
    'core-preset': {
      description: 'Identity, session, and root-level system APIs.',
      services: ['system'],
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

export default servicesConfig;
