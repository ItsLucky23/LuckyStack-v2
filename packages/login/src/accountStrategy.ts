//? @adr 0019 — Email uniqueness is opt-in and governed by this knob: the default
//? `'per-provider'` strategy INTENTIONALLY does not require `email @unique`
//? (same address across providers = separate rows); only `'unified'` needs the
//? consumer to add the constraint. A missing `@unique` on `User.email` is
//? by-design, not a bug — see ADR 0019 before flagging it.
//?
//? Implements `auth.providerAccountStrategy` (CFG-04). The knob was declared
//? and documented but no code read it — every lookup was provider-scoped, so
//? `'unified'` silently behaved like `'per-provider'` and produced duplicate
//? accounts for the same email across providers.
//?
//?   - `'per-provider'` (default): resolve a user by (email, provider). The
//?     same address via Google and GitHub is two separate User rows. No schema
//?     change required.
//?   - `'unified'`: resolve a user by email alone (across providers) so the
//?     address maps to a single User; a sign-in via a new provider LINKS to the
//?     existing account instead of creating a duplicate. Requires the User
//?     schema's `email` to be unique (see @luckystack/login README — "Unified
//?     account strategy").
//?
//? Custom `UserAdapter`s that predate this feature may not implement
//? `findByEmailAnyProvider`. When `'unified'` is configured but the adapter
//? lacks it, we log ONCE and fall back to provider-scoped lookup so the project
//? degrades loudly rather than silently mis-resolving.

import { getProjectConfig, getLogger } from '@luckystack/core';

import type { UserAdapter, UserRecord } from './userAdapter';

let warnedMissingAnyProvider = false;

/**
 * Resolve a user account honoring the configured `providerAccountStrategy`.
 * Use this everywhere the login flow needs "does an account for this email
 * exist?" — register dedupe, credentials login, and OAuth find-or-create.
 */
export const resolveUserByEmail = async (
  adapter: UserAdapter,
  { email, provider }: { email: string; provider: string },
): Promise<UserRecord | null> => {
  const strategy = getProjectConfig().auth.providerAccountStrategy;

  if (strategy === 'unified') {
    if (adapter.findByEmailAnyProvider) {
      return adapter.findByEmailAnyProvider({ email });
    }
    if (!warnedMissingAnyProvider) {
      warnedMissingAnyProvider = true;
      getLogger().warn(
        '[login] auth.providerAccountStrategy is "unified" but the registered UserAdapter does not implement findByEmailAnyProvider — falling back to provider-scoped lookup (duplicate accounts per provider are still possible). Implement findByEmailAnyProvider on your adapter to enable unified accounts.',
      );
    }
  }

  return adapter.findByEmail({ email, provider });
};

/** Test-only: reset the one-time missing-method warning latch. */
export const resetAccountStrategyWarningForTests = (): void => {
  warnedMissingAnyProvider = false;
};
