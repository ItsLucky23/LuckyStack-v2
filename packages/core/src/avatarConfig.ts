//? Configurable avatar serving so installers don't have to fork
//? `serveAvatar` to change the file format, cache headers, or storage path.
//? Defaults match the framework's prior hardcoded behavior (.webp, 24h cache).

import { type DeepPartial } from './configUtils';
import { createRegistry } from './createRegistry';

export interface AvatarConfig {
  /**
   * File format(s) the framework will look for on disk, in order. The first
   * one that exists wins. Each entry is `{ extension, contentType }` so the
   * `Content-Type` response header matches what the file actually is.
   * Default: `[{ extension: 'webp', contentType: 'image/webp' }]`.
   */
  formats: { extension: string; contentType: string }[];
  /**
   * `Cache-Control` value sent with the avatar response.
   * Default: `'public, max-age=86400'` (24 hours).
   */
  cacheControl: string;
}

export const DEFAULT_AVATAR_CONFIG: AvatarConfig = {
  formats: [{ extension: 'webp', contentType: 'image/webp' }],
  cacheControl: 'public, max-age=86400',
};

export type AvatarConfigInput = DeepPartial<AvatarConfig>;

const registry = createRegistry<AvatarConfig, AvatarConfigInput>(DEFAULT_AVATAR_CONFIG, {
  //? Bespoke merge (not a generic deep-merge): an empty `formats` array falls
  //? back to the default formats rather than wiping serving. Built fresh from
  //? the defaults each call, matching the historical behaviour.
  transform: (config) => ({
    formats: config.formats?.length ? (config.formats as AvatarConfig['formats']) : DEFAULT_AVATAR_CONFIG.formats,
    cacheControl: config.cacheControl ?? DEFAULT_AVATAR_CONFIG.cacheControl,
  }),
});

export const registerAvatarConfig = (config: AvatarConfigInput): void => {
  registry.register(config);
};

export const getAvatarConfig = (): AvatarConfig => registry.get();
