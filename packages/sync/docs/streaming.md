# Sync streaming

Streaming communicates progress, not a replacement for the final request result. An originator-targeted stream, a room broadcast and a selected-recipient stream have different audiences: do not substitute one for another, particularly for private data. Recipient-side streaming is an output concern, not permission to broadcast to other viewers. Source: `../src/_shared/streamEmitters.ts`, `../src/_shared/clientFanout.ts`.

Delivery must tolerate slow connections without blocking unrelated requests; producer throttling and pressure handling protect memory and responsiveness. Stream hooks are observational so slow tracking cannot stall chunks; abort/reset must not flush stale partial content into a later request. The HTTP/SSE fallback needs the same auth/receiver checks even though it has a different originator transport. See `../src/streamThrottle.ts`, `../src/handleHttpSyncRequest.ts`.
