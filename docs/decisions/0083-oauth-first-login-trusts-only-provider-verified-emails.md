---
name: oauth-first-login-trusts-only-provider-verified-emails
title: OAuth first login trusts only provider-verified emails, and an OAuth account's email belongs to the provider
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [auth, oauth, security, login]
supersedes: []
relates: [0019]
---

## Context

Accounts are found by email and provider (ADR 0019). The guard that refuses a
first OAuth login with an unverified email (M2 in the login security review)
refused every new GitHub and Microsoft user, because neither provider's
userinfo marks its email as verified. At the same time the Microsoft
`userPrincipalName` fallback was wrongly treated as verified. OAuth accounts
could also change their email in the app without re-authenticating, which
detached the account from its provider login or let a stolen session take it
over.

## Decision

A first OAuth login creates an account only for an email the provider vouches
for. GitHub always reads its verified email list and prefers the verified
public email. Microsoft `mail` is trusted only for an app tied to one tenant,
and the principal-name fallback never counts as verified. A provider's email
accessor can report verification explicitly. Only credentials accounts can
change their email in the app; the server enforces this when the change is
requested and when it is confirmed. OAuth users change their email at the
provider.

## Rejected alternatives

- **Always trust Microsoft `mail`.** Under a multi-tenant app any tenant admin
  can set any address there (the "nOAuth" takeover).
- **Never allow Microsoft sign-up.** Rejected in favour of trusting `mail` for
  single-tenant apps, where the organisation sets it.
- **Check GitHub's public email against the verified list only when a public
  email is present.** The owner chose to always use the verified-email
  endpoint.
- **Bind OAuth accounts to the provider's subject id.** It needs a schema
  migration.
- **Confirm an email change from the old address.** It does not fix the
  lockout.

## Consequences

- Microsoft apps on the default `common` tenant (and `organizations`,
  `consumers`) cannot sign up new users; existing accounts still sign in.
- That leaves a residual risk on those tenants: an existing Microsoft account
  is still matched by its unverified `mail`, so an admin of another tenant who
  sets `mail` to a user's address signs in as that user. Refusing those logins
  would lock out every existing multi-tenant user, so that is left to the
  owner; `microsoftProvider` warns once at boot instead. The real fix is a
  single-tenant app, or binding accounts to the provider's subject id (a
  schema change, see above).
- GitHub sign-in depends on access to the user's email list, which the
  default scope grants.
- This record does not number the M2 creation guard or the SEC-21 link guard;
  no ADR records them, and none is invented here.
