# Sync request

The caller asks the server to apply a mutation and selects a receiver; the receiver name is not proof of permission. The request must pass authorization before mutation and fanout on both socket and HTTP/SSE transports. A successful acknowledgement reports the server result; it does not guarantee every recipient accepted the event. See `../src/syncRequest.ts`, `../src/handleSyncRequest.ts`, `../src/handleHttpSyncRequest.ts`, `./server-vs-client-handlers.md`.

Offline queuing is for transient transport loss, not a bypass of server validation or room membership on replay. Regenerate generated types rather than casting a call around a version mismatch. For request types, envelopes and retry policy consult `../src/syncRequest.ts` and `../../core/src/offlineQueue.ts`.
