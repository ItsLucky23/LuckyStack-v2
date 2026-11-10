---
name: a-foreign-page-load-gets-only-public-static-content
title: A GET page load from a foreign site gets the SPA shell and static files, not a 403; every session route stays origin-gated
status: proposed
date: 2026-11-10
deciders: [ItsLucky23]
tags: [security, http, cors, origin, cloudflare]
supersedes: []
relates: []
---

## Context

The HTTP origin gate takes the origin from `Origin`, else from `Referer`, and answered 403 to every method when that origin was not allowed. Browsers send a `Referer` from the previous site on a normal page load. So when the server itself serves the SPA (production, a Cloudflare tunnel), the landing page after a Cloudflare Access or OAuth login, or after any link from another site, answered "Forbidden". A reload or a typed URL sends no `Referer` and worked, which hid the cause. In development the page comes from the Vite server, so the gate never saw these loads.

## Decision

A GET without an `Origin` header whose `Referer` names a foreign site is served by the static/SPA handler only. Nothing is reflected into `Access-Control-Allow-Origin`, no session cookie is refreshed, and custom routes are skipped. Paths under `/api/`, `/sync/`, `/auth/` and `/uploads/` keep the 403, and so does every request with a foreign `Origin` header and every state-changing request.

## Rejected alternatives

- **Tell projects to add the foreign site to `allowedOrigins`.** That allow-lists the login provider or Access team for CORS on every route, including credentialed API reads. It also has to be repeated for every site that links to the app.
- **Ignore `Referer` for all GET requests.** A cross-site link to a GET API or sync route carries a `SameSite=Lax` session cookie. The `Referer` check is the only cross-site defense for those routes in cookie mode, because CSRF tokens are checked on state-changing methods only.
- **Let a foreign page load run the full pipeline.** Custom routes are opaque handlers that may act on the session, so the gate cannot know they are read-only.

## Consequences

A link from another site to a custom route path now gets the SPA shell (the client router shows its not-found page) instead of 403. A custom route that must answer foreign page loads needs a separate opt-in, which does not exist yet. The `/auth/callback/*` route still requires that the identity provider sends no foreign `Referer`; widening that is a separate choice because the callback creates a session.
