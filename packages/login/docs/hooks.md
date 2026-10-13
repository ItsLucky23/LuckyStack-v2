# Login lifecycle hooks

Pre-operation hooks allow a deliberate veto before a login, registration, logout or session mutation. Observational post hooks must not be mistaken for authorization gates or a way to undo completed writes. Handlers see shared payload objects; do not mutate them to control a later handler. Source: `../src/hookPayloads.ts`, `../src/login.ts`, `../src/logout.ts`, `../../core/src/hooks/registry.ts`.

Audit handlers must not log tokens, hashes or sensitive reset links. An unmatched reset request should produce the same visible outcome as a matched one; adding a hook must not reintroduce account enumeration. Cleanup-path logout may have no resolved user, so handlers must tolerate an absent identity. See `../src/forgotPassword.ts`, `./password-reset.md`.
