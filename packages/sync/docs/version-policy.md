# Sync route version policy

Versioning lets old and new clients coexist during contract changes. Keep an existing version's request, response and stream meaning stable while consumers migrate; ship a separate version when a change breaks that contract. A bug fix that preserves the contract does not require a new version. Route filenames, generated maps and wire keys are code-owned (`../../devkit/`, `../src/syncRequest.ts`).

String-literal versions align route naming with TypeScript inference, so casts at the call site conceal a generator mismatch rather than solving it. Regenerate artifacts and fix the declaration or generator first. Keep both versions until the old consumers are retired; deleting the old handler early breaks clients still in flight. See repository `AGENTS.md` and `./server-vs-client-handlers.md`.
