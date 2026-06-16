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

//? Vetoable pre-hooks. Fire BEFORE the password mutation actually runs.
//? Handlers may return a HookStopSignal to abort (2FA gate not satisfied,
//? compliance hold, account flagged for review). The companion `post*`
//? events stay observational so existing audit subscribers still work.

export interface PrePasswordResetCompletedPayload {
  /** User whose password is about to be reset via the forgot-password flow. */
  userId: string;
}

export interface PrePasswordChangedPayload {
  /** User whose password is about to be changed via the in-session flow. */
  userId: string;
  /** True if the user verified their current password successfully. */
  verifiedCurrent: boolean;
}

//? Email-change lifecycle. `preEmailChange` fires before a confirmation token
//? is minted/emailed (vetoable — e.g. tenant-policy blocks email changes).
//? `postEmailChangeRequested` fires after the confirmation email is dispatched
//? (observational). `postEmailChanged` fires after the new email is persisted
//? and all sessions are revoked (audit hook for "email rotated" alerts).

export interface PreEmailChangePayload {
  userId: string;
  currentEmail: string;
  newEmail: string;
}

export interface PostEmailChangeRequestedPayload {
  userId: string;
  newEmail: string;
}

export interface PostEmailChangedPayload {
  userId: string;
  oldEmail: string;
  newEmail: string;
}

//? Observational failure signal. Fires on every failed login/register/OAuth
//? attempt so consumers can audit, feed a SIEM, or drive per-account lockout
//? (the built-in brute-force lockout subscribes to this). Never vetoable — the
//? auth outcome the caller already got must not change based on a handler.

export interface LoginFailedPayload {
  /** Email the attempt was for, when available. */
  email?: string;
  /** Resolved userId, when the attempt matched a real account. */
  userId?: string;
  /** Auth provider (e.g. `credentials`, `google`). */
  provider: string;
  /** i18n reason key describing why the attempt failed. */
  reason: string;
  /** Which flow the failure occurred in. */
  stage: 'login' | 'register' | 'oauth';
}

//? Account-deletion lifecycle. `preAccountDelete` is vetoable — compliance /
//? legal-hold / active-subscription add-ons can abort the deletion with their
//? own errorCode before anything is destroyed. `postAccountDelete` is
//? observational — cascade-clean external state (Stripe / S3), audit, goodbye
//? email.

export interface PreAccountDeletePayload {
  userId: string;
  email?: string;
}

export interface PostAccountDeletePayload {
  userId: string;
  email?: string;
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
    prePasswordResetCompleted: PrePasswordResetCompletedPayload;
    passwordResetCompleted: PasswordResetCompletedPayload;
    prePasswordChanged: PrePasswordChangedPayload;
    passwordChanged: PasswordChangedPayload;
    preEmailChange: PreEmailChangePayload;
    postEmailChangeRequested: PostEmailChangeRequestedPayload;
    postEmailChanged: PostEmailChangedPayload;
    loginFailed: LoginFailedPayload;
    preAccountDelete: PreAccountDeletePayload;
    postAccountDelete: PostAccountDeletePayload;
  }
}
