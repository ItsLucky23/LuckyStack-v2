//? Services config registry. The router (and presetLoader) consume the
//? consumer's services topology — which services exist, which presets bundle
//? them together — through this registry instead of a relative
//? `../../../services.config` import.
//?
//? The consumer's `services.config.ts` registers its config at module import
//? (side-effect pattern, identical to `deploy.config.ts:151`). Router code
//? calls `getServicesConfig()` at request time.

export interface ServiceDefinition {
  /** 'root' -> reserved for the system service. Otherwise a folder name under srcDir. */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- 'root' is documented as the reserved value; the union surfaces it in autocomplete
  source: 'root' | string;
}

export interface PresetDefinition {
  description?: string;
  /** Services that are bundled together into one backend artifact. */
  services: string[];
}

export interface ServicesConfigShape {
  services: Record<string, ServiceDefinition>;
  presets: Record<string, PresetDefinition>;
}

import { createRegistry } from './createRegistry';

const registry = createRegistry<ServicesConfigShape>(
  //? Unregistered sentinel — `get` never returns this because `resolveDefault`
  //? throws first. Typed as the real shape so the slot stays well-typed.
  { services: {}, presets: {} },
  {
    resolveDefault: (): ServicesConfigShape => {
      throw new Error(
        '@luckystack/core: services config has not been registered. Call ' +
        '`registerServicesConfig({...})` from your `services.config.ts` (which should be ' +
        'imported as a side-effect during boot).'
      );
    },
  },
);

export const registerServicesConfig = (config: ServicesConfigShape): ServicesConfigShape =>
  registry.register(config);

export const getServicesConfig = (): ServicesConfigShape => registry.get();

export const isServicesConfigRegistered = (): boolean => registry.isRegistered();
