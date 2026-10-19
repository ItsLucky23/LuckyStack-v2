---
name: one-session-cookie-builder-applies-prefix-and-domain
title: One session-cookie builder applies the configured prefix and Domain to every set, refresh and clear
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [security, session, cookies, server, config]
supersedes: []
relates: []
---

## Context

`http.sessionCookiePrefix` (`__Host-` / `__Secure-`) and
`http.sessionCookieDomain` were documented as applied by a cookie builder that
did not exist. Five places wrote the session cookie by hand without them, and
the token extractors read the unprefixed name, so both settings did nothing
(sweep finding 044). An audit note from 2026-07-02 that "prefix support
exists" was therefore wrong.

## Decision

One server module owns the session cookie's name and attributes, built on
core's existing prefix-constraint helper. Every set, refresh and clear goes
through it — login, OAuth callback, email-code and 2FA, sliding refresh and
logout — and the core token extractors resolve the same prefixed name.

## Rejected alternatives

- **Remove both settings and fail boot when they are set.** `__Host-` is the
  standard defence against a subdomain planting its own session cookie, and
  the constraint helper already existed.

## Consequences

- Turning on a prefix renames the cookie, so users are logged out once.
- `__Host-` forces `Path=/` and drops Domain; any prefix forces `Secure`, which
  browsers accept on `http://localhost`.
- Tooling that builds a `Cookie:` header itself, such as the test runner, must
  use the effective cookie name.
