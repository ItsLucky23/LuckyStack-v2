# Logout and revocation

Logout revokes a session rather than merely changing browser UI. Session deletion, room departure and notifications need a single coordinated path so stale sockets do not keep receiving session-scoped events. The same path also supports forced replacement of an older session; avoid recursive deletion when invoked from session cleanup. Source: `../src/logout.ts`, `../src/session.ts`.

Diagnosing unexpected logouts matters, but never write full tokens to logs. A pre-logout veto is a real security/product decision; do not use one casually to prevent users from ending a session. Reconnect and disconnect behavior is separate from explicit revocation (`../../presence/docs/disconnect-grace.md`).
