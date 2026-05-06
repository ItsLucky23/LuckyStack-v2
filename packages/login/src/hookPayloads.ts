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

//? `pre*` hooks fire before the corresponding side-effect runs. Handlers can
//? side-effect (write to redis, queue a job, etc.) and may return a HookStopSignal
//? to abort the main flow. They do not mutate payloads — handlers that need to
//? attach extra state (e.g. a company-scoped session) write it into their own
//? key space using ids from the payload.

export interface PreLoginPayload {
  email: string;
  provider: string;
}

export interface PostLoginPayload {
  userId: string;
  provider: string;
  isNewUser: boolean;
  token: string;
}

export interface PreRegisterPayload {
  email: string;
  provider: string;
  name?: string;
}

export interface PostRegisterPayload {
  userId: string;
  provider: string;
}

export interface PreLogoutPayload {
  userId: string | null;
  token: string | null;
}

export interface PostLogoutPayload {
  userId: string | null;
  token: string | null;
}

export interface PreSessionCreatePayload {
  token: string;
  user: BaseSessionLayout;
  persistent: boolean;
}

export interface PostSessionCreatePayload {
  token: string;
  user: BaseSessionLayout;
  persistent: boolean;
}

export interface PreSessionDeletePayload {
  token: string;
  userId: string | null;
}

export interface PostSessionDeletePayload {
  token: string;
  userId: string | null;
}

//? Password reset / change lifecycle hooks. Audit-log packages, "notify
//? admin on reset", and 2FA-style add-ons subscribe to these. Note we do
//? NOT include the bcrypt hash or the plaintext password in the payload —
//? handlers that need to store anything pull from the configured user
//? adapter, which keeps the password material out of hook listeners.

export interface PasswordResetRequestedPayload {
  /** Email the user typed in the reset form. May or may not match a real user. */
  email: string;
  /** True when a matching user was found and an email is being sent. */
  matched: boolean;
  /** The userId, when matched. */
  userId?: string;
  /** The reset token (for audit; do not log). */
  token?: string;
  /** Token TTL in seconds. */
  ttlSeconds?: number;
}

export interface PasswordResetCompletedPayload {
  /** User whose password was reset via the forgot-password flow. */
  userId: string;
  /** Whether the framework auto-revoked all other active sessions. */
  revokedOtherSessions: boolean;
}

export interface PasswordChangedPayload {
  /** User whose password was changed via the in-session change flow. */
  userId: string;
  /** True if the user verified their current password successfully. */
  verifiedCurrent: boolean;
  /** Whether sessions other than the current one were revoked. */
  revokedOtherSessions: boolean;
}

declare module '@luckystack/core' {
  interface HookPayloads {
    preLogin: PreLoginPayload;
    postLogin: PostLoginPayload;
    preRegister: PreRegisterPayload;
    postRegister: PostRegisterPayload;
    preLogout: PreLogoutPayload;
    postLogout: PostLogoutPayload;
    preSessionCreate: PreSessionCreatePayload;
    postSessionCreate: PostSessionCreatePayload;
    preSessionDelete: PreSessionDeletePayload;
    postSessionDelete: PostSessionDeletePayload;
    passwordResetRequested: PasswordResetRequestedPayload;
    passwordResetCompleted: PasswordResetCompletedPayload;
    passwordChanged: PasswordChangedPayload;
  }
}
