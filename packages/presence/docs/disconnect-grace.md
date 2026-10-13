# Disconnect grace

Immediate cleanup would make refreshes, tab switches and transient network loss appear to peers as a permanent departure. Reason-specific grace allows reconnection while avoiding indefinitely stale online state. Multi-tab sessions must not be deleted merely because one socket closes; check for other live connections before teardown. Source: `../src/activity/lifecycle.ts`, `../src/presenceConfig.ts`.

**Trust boundary:** intentional disconnect is client-asserted. It can influence grace and cleanup but cannot authorize access, attest identity or act as reliable revocation. A client can request that its session survive a disconnect; session TTL and explicit logout are the real security bounds. Identity and room membership for notifications come from the server-side session. See `../src/activity/peerNotifier.ts`, `../../login/src/session.ts`.

Review timer and reason configuration in `../src/presenceConfig.ts` against the app's expected reconnection behavior. Do not copy its defaults into a second policy table.
