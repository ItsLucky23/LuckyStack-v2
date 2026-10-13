# Presence lifecycle

Presence owns transient connect/reconnect/leave events because authentication owns session credentials, not presentation of peer availability. Boot-time registration should happen before connections so lifecycle hooks are not missed. A reconnect during grace should cancel pending departure rather than publish a false leave-and-return. See `../src/register.ts`, `../src/activity/lifecycle.ts`.

A post-grace-expiry hook is for recording a true departure, while logout explicitly revokes credentials; these are not interchangeable. Keep disconnect cleanup safe when multiple tabs share a session and when repeated events arrive. Presence notifications may be skipped when disabled, without bypassing auth/session decisions. See `./disconnect-grace.md`, `../../login/docs/logout-flow.md`.
