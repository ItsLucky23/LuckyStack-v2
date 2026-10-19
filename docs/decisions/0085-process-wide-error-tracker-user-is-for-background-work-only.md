---
name: process-wide-error-tracker-user-is-for-background-work-only
title: The process-wide error-tracker user is for background work only; inside a request only the request's own identity counts
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [error-tracking, observability, privacy, security]
supersedes: []
relates: []
---

## Context

Auto-instrumentation wrote every request's user to each adapter's process-wide
user as a fallback. Adapters used that fallback whenever the request identity
was empty, which is also the case for an anonymous request. So the last request
to finish decided who an anonymous error was attributed to, email included, and
PostHog received an `$identify` on every request.

## Decision

Per-request hooks write only the request identity scope. Whenever a scope is
active, adapters use its identity, so an anonymous request stays anonymous;
core exposes whether a scope is active. The process-wide user is used only
outside any request scope, and only explicit `setSentryUser` calls set it.

## Rejected alternatives

- **Make the exported identity getter return `undefined` outside a scope and
  `null` for an anonymous request.** A silent change to the meaning of an
  exported function.
- **Keep writing the process-wide user and clear it at the end of each
  request.** Concurrent requests still race on it.

## Consequences

- Background errors keep the explicitly set user.
- Projects on the deprecated `initSharedSentry` path lose the per-request user
  on their events; the supported adapter path keeps it.
