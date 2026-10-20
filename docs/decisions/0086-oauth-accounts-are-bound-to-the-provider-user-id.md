---
name: oauth-accounts-are-bound-to-the-provider-user-id
title: OAuth accounts are bound to the provider's stable user id, and an email match signs in only an unbound account with a verified email
status: accepted
date: 2026-10-20
deciders: [ItsLucky23]
tags: [auth, oauth, security, login, schema]
supersedes: []
relates: [0019, 0083]
---

## Context

OAuth accounts were found by email and provider (ADR 0019). ADR 0083 made a
first login trust only provider-verified emails, but left a residual risk: on a
multi-tenant Microsoft app (`tenant: 'common'`) an existing account was still
matched by Graph `mail`, which any Entra tenant admin can set, so another
tenant's admin could sign in as an existing user. ADR 0083 rejected binding to
the provider's id because it needs a schema change. The owner has now accepted
that change. Microsoft sign-in was never used in practice, so no existing
multi-tenant users need to keep working.

## Decision

OAuth accounts are bound to the provider's stable user id. A sign-in first
looks up (provider, provider id) and signs in that account, whatever email the
provider reports now, as long as it still reports a usable email (a login
without one is refused before the lookup); the stored email is not overwritten,
because the new value may be unverified (multi-tenant Microsoft) and the app
owns the email once the account exists. Only when no account carries the id
does the email decide. An email match whose stored id differs is always
refused, even with a verified email, on a row of this provider and on a row
whose provider is unknown (a custom adapter that leaves `provider` out). Any
stored value counts as an id, and it matches only when its string form equals
the provider's id. An email match on this provider's row with no stored id
signs in only when the provider verified the email, and is bound on that
login. Otherwise a new account is created with the id, behind the existing
creation guards (verified email, `allowRegistration`, `preRegister`).

- **Storage:** one nullable `providerAccountId` column on the user row, owned by
  the row's own `provider`. Under `'unified'` a row is bound only for its own
  provider; another provider that links by verified email (the existing
  cross-provider guard) is not stored. A second provider's id is never written
  onto a row of another provider.
- **Index:** `@@index([provider, providerAccountId])`, not `@@unique`. A MongoDB
  unique index treats a missing value as null and rejects the second unbound
  row, and Prisma cannot declare a partial index. The lookup orders by
  `createdAt` so a duplicate from a concurrent first login resolves to the same
  row every time. The drizzle starter, which is SQL-only, uses a unique index,
  because PostgreSQL, MySQL and SQLite allow several NULLs there.
- **Providers:** every built-in names its id (`FullOAuthProvider.accountIdKey`):
  Google `sub`, GitHub numeric `id`, Discord `id`, Facebook `id`, Microsoft
  Graph `id` (the Entra object id). A custom provider opts in. A response
  without the declared id is refused, never matched by email.
- **Microsoft tenant id:** Graph `/me` carries no tenant id, so the object id is
  used alone. It is assigned by Microsoft and cannot be set by a tenant admin:
  a GUID for work and school accounts, a 16-hex-digit id for personal
  accounts, unique to that user either way. Reading `tid` would need the id
  token, which the code does not keep.
- **Hooks and session:** `preLogin` for an existing account receives the
  stored email and the `userId`, so a block on the account still holds after
  an email change at the provider. A refusal reports its own `loginFailed`
  reason (`oauth.accountIdMissing`, `oauth.accountBoundElsewhere`,
  `oauth.emailUnverified`) and the `userId` when it concerns an account. The id
  never reaches the session; only the server-side lookup needs it.
- **Adapter fallback:** `findByProviderAccountId` is optional. Without it the
  framework warns once and neither reads nor writes the binding: verified
  emails sign in as before, an unverified email on an existing account is
  refused, and a stored id that differs is still refused.
- **Boot warning:** `microsoftProvider` keeps a one-time warning for `common`,
  `organizations` and `consumers`, reworded: the takeover is closed, but there
  Graph `mail` is unverified, so new users are refused and unbound accounts
  cannot bind. Without the warning such an app would fail every Microsoft
  login without saying why.

## Rejected alternatives

- **A separate accounts table (one row per provider identity).** It would bind
  every provider of a unified account, but it needs a second model in three
  ORMs, link and unlink semantics and more adapter methods. The single column
  closes the takeover for every provider's own accounts; cross-provider links
  already require a verified email.
- **Overwrite the stored email with the provider's current email.** An
  unverified Microsoft `mail` could then rewrite an account's email to a
  victim's address, and under `'unified'` it could collide with another row.
- **Keep signing in unbound accounts on an unverified email (legacy support).**
  That is exactly the takeover; the owner chose no legacy path for Microsoft.
- **`@@unique([provider, providerAccountId])`.** It breaks on MongoDB as soon as
  two rows are unbound.
- **Combine the Microsoft object id with the tenant id from the id token.** The
  object id is already unforgeable; parsing the id token adds a second trust
  path for no gain.

## Consequences

- Projects add the nullable column and index and push or migrate the schema;
  until then OAuth logins with the default adapter fail (credentials keep
  working). Custom adapters should implement `findByProviderAccountId` and
  persist the id.
- Existing Google, GitHub, Discord and Facebook accounts bind silently on their
  next login, because those providers verify the email.
- On a multi-tenant Microsoft app nobody can sign in unless the account was
  bound earlier (for example under a single-tenant setup). That is deliberate.
- A bound account keeps the email it was created with; the user changes it at
  the provider, but the app's copy does not follow. A different person who
  later holds that address at the same provider is refused, not merged.
- A bound login still needs a usable email from the provider. A provider that
  stops returning one (for example a GitHub account without a verified email)
  cannot sign in to the bound account until it returns one again.
- Under `'unified'`, a secondary provider's sign-in still depends on a verified
  email and does not follow an email change at that provider.
- Two concurrent first logins can still create two rows bound to the same id
  (the index is not unique). Both belong to the same provider identity; the
  oldest is used afterwards. This is not a takeover.
