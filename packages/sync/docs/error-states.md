# Sync error states

A request failure, a local connection failure and a single recipient's failure are different outcomes. The originator acknowledgement reports server-handler success or failure, not the result of each recipient's filter; one rejected recipient must not prevent delivery to authorized peers. See `../src/handleSyncRequest.ts`, `../src/handleHttpSyncRequest.ts`, `../src/_shared/clientFanout.ts`.

Localize recipient errors using that recipient's locale, not the sender's. Do not expose raw exceptions or sensitive tokens in errors or logs. Offline queue overflow is a delivery failure, not a license to replay a mutation without rechecking authorization. For current envelopes and reason codes consult `../src/_shared/errorBuilders.ts` and `../src/syncRequest.ts`.

## Which errors mean "nothing was saved"

Receiver policy and recipient resolution run before the `_server` handler on both transports (ADR 0063). A rejection at that point is a pre-commit rejection: nothing was persisted and a retry is safe. That covers a refused receiver (`sync.receiverNotAllowed`, `sync.notRoomMember`), an empty room (`sync.noReceiversFound`) and a failed cross-instance recipient lookup. The order exists because the framework cannot undo a handler's side effects; when the lookup ran after the handler, a caller was told `error` about a change that had been saved, retried, and applied it twice.

- `sync.noReceiversFound` means "not saved, nobody was listening" — not "saved, nobody was listening". UI written against the older reading is wrong.
- An empty room is an error on every transport, including routed HTTP (ADR 0058). A silent success hid wrong room names, sockets that never re-joined after a reconnect and formatter mismatches; the error is the only runtime signal for that class of bug.
- A recipient-lookup failure reuses `sync.serverExecutionFailed`, the same code a throwing handler produces. Only the lookup case is guaranteed pre-commit, so the code alone does not prove nothing was saved. A lookup that times out usually means an instance on the same adapter channel did not answer, for example an environment sharing another environment's Redis; see `../../../docs/ARCHITECTURE_MULTI_INSTANCE.md`.
- `sync.notRoomMember` is tested from a different source per transport (ADR 0059). See `./room-fanout.md`.

## Locale coverage

The framework ships no message catalog. The `sync.*` keys live in the project's locale files, and a missing key appears in the UI as the raw code. The authoritative list of every `sync.*` code either transport can emit is `SYNC_ERROR_CODES` (`../src/_shared/errorCodes.ts`, exported from both the server and `/client` entries). Keep locale files complete with a parity test against that list rather than a hand-copied table.
