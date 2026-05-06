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

let activeServicesConfig: ServicesConfigShape | null = null;

export const registerServicesConfig = (config: ServicesConfigShape): ServicesConfigShape => {
  activeServicesConfig = config;
  return activeServicesConfig;
};

export const getServicesConfig = (): ServicesConfigShape => {
  if (!activeServicesConfig) {
    throw new Error(
      '@luckystack/core: services config has not been registered. Call ' +
      '`registerServicesConfig({...})` from your `services.config.ts` (which should be ' +
      'imported as a side-effect during boot).'
    );
  }
  return activeServicesConfig;
};

export const isServicesConfigRegistered = (): boolean => activeServicesConfig !== null;
