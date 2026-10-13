# Server versus recipient sync handlers

The server handler owns the request's shared validation, mutation and originator result. An optional per-recipient handler exists only when a viewer needs different output, such as filtering private fields or adapting presentation. Do not add an empty recipient handler: it adds work without changing the audience. Source: `../src/handleSyncRequest.ts`, `../src/handleHttpSyncRequest.ts`, `../src/_shared/clientFanout.ts`.

**Security invariant:** the sender's authority to target a room must be checked before the shared mutation or fanout (`../src/_shared/receiverAuth.ts`). A recipient handler is not an originator auth gate, and one recipient's failure does not roll back the mutation or stop other deliveries. Assume shared server output can reach every permitted recipient; keep secrets out of it unless the server-side audience is constrained. Resolve recipient-specific identity from that recipient's session, not the sender's. The originator acknowledgement reports the server result independently of recipient delivery.

**Ordering invariant:** recipients are resolved, across instances, before the server handler runs, on both transports (ADR 0063). The framework cannot undo a handler's side effects, so any failure it can find before the mutation must be reported before the mutation. An empty room or a failed recipient lookup therefore never reaches the server handler. Consequence for handler authors: the audience is fixed before your handler runs, and a socket that joins the room during your handler misses that fanout.

See `./room-fanout.md` for room trust and `./streaming.md` for stream audiences. Route declarations and generated types own signatures.
