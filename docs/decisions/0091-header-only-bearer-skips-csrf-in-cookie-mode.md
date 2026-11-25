---
name: header-only-bearer-skips-csrf-in-cookie-mode
title: In cookie mode with acceptBearerInCookieMode, a bearer-only request skips CSRF
status: accepted
date: 2026-11-25
deciders: [user, implementation-agent]
tags: [security, csrf, session, auth, http]
supersedes: []
relates: [0018, 0024]
---

## Context

A consumer runs the server in cookie mode with a `SameSite=Strict` session cookie, and also embeds the app in an iframe on another site. In that third-party context the browser does not send the session cookie. The embedded client therefore uses token mode: the token lives in `sessionStorage` and travels as `Authorization: Bearer` and as the socket handshake token. The server accepts that through `http.acceptBearerInCookieMode`.

The CSRF gate chose "cookie mode" from `session.basedToken` for the whole server. It then required a CSRF header on every state-changing bearer request. The token-mode client never fetches a CSRF token, because token mode is exempt from CSRF. Every write from the iframe failed with `auth.csrfMismatch`.

## Decision

CSRF protects the credential that the browser attaches by itself: the session cookie. In cookie mode with `acceptBearerInCookieMode: true` and `@luckystack/login` installed, a request skips the CSRF gate when it has an `Authorization: Bearer` header and no session cookie. A request that has the session cookie stays under CSRF, also when it has a bearer header as well. Token mode does not change. With the setting off (the default) nothing changes.

This is safe because a cross-site page cannot make the browser add an `Authorization` header. A form or a simple request cannot set it. A `fetch` with it needs a CORS preflight, and an origin that the CORS policy allows can already read the CSRF token. An attacker who has the token does not need the victim's browser. The setting itself (CORE-O10) is the opt-in for header tokens in cookie mode, so no second setting is needed.

## Rejected alternatives

- Let the embedded client fetch `/auth/csrf` with its bearer and send the CSRF header: it adds a round trip and a client change that protect nothing, because the bearer is not an ambient credential. Token mode already skips CSRF for the same reason.
- A separate setting for the CSRF exemption: a server that accepts header tokens in cookie mode but still demands CSRF for them only breaks token-mode clients. `acceptBearerInCookieMode` already marks the decision.
- Exempt every request that has a bearer header: a request that also has the session cookie authenticates with the cookie first (the extractor reads the cookie before the bearer). A page that can add a header, such as a CORS-allowed origin, could then add a dummy bearer to a cookie request and skip the check.

## Consequences

- One server can serve cookie-mode and token-mode clients at the same time, with one session system.
- The exemption depends on the absence of the session cookie under its effective (prefixed) name. A cookie with an empty value counts as absent: it carries no session, so the request authenticates with the bearer, which a cross-site page cannot add.
- The exemption applies only when `@luckystack/login` is installed. Without it there is no session for a bearer to carry, and the double-submit check stays for custom routes that trust a cookie of their own. A CORS-allowed origin that may send `Authorization` but not the CSRF header can therefore not use a dummy bearer to skip that check.
- The OAuth callback still chooses cookie or token delivery from the server's `session.basedToken`; per-request token delivery exists only for the credentials and second-factor login routes.
