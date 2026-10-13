# Sync callback registration

Component-scoped subscriptions should clean up only their own callback, not another component's listener for the same event. A session reference must be read at event time; closing over an old session could attribute notifications to a logged-out user. See `../src/client.ts` and `../../core/src/client.ts`.

Types for server and recipient output come from generated maps; do not cast payloads around a broken generator. Regenerate artifacts, then correct source definitions if inference still fails. Stream subscriptions exist only for routes that actually stream; keep progress delivery separate from the final acknowledgement. See `./streaming.md`, `../../core/AGENTS.md`.
