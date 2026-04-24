/**
 * Module augmentation: extends `@luckystack/core`'s `HookPayloads` interface
 * with auth and session lifecycle hooks owned by this package.
 *
 * This file is picked up by the TypeScript compiler because it is in the
 * tsconfig `include` path. A side-effect `import './hookPayloads';` in
 * `index.ts` makes the dependency explicit for readers even though TS would
 * merge the declaration regardless.
 */

import type { BaseSessionLayout } from './sessionLayout';

export interface PostLoginPayload {
  userId: string;
  provider: string;
  isNewUser: boolean;
  token: string;
}

export interface PostRegisterPayload {
  userId: string;
  provider: string;
}

export interface PostLogoutPayload {
  userId: string | null;
  token: string | null;
}

export interface PostSessionCreatePayload {
  token: string;
  user: BaseSessionLayout;
  persistent: boolean;
}

export interface PostSessionDeletePayload {
  token: string;
  userId: string | null;
}

declare module '@luckystack/core' {
  interface HookPayloads {
    postLogin: PostLoginPayload;
    postRegister: PostRegisterPayload;
    postLogout: PostLogoutPayload;
    postSessionCreate: PostSessionCreatePayload;
    postSessionDelete: PostSessionDeletePayload;
  }
}
