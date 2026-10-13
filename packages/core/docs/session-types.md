# Session types

The shared session layout provides a common identity contract across authentication and transport packages; applications extend it in their own type declarations rather than modifying the framework base. A session exposed to a browser is not a safe place for credential hashes or private adapter data. See `../src/sessionTypes.ts`, `../../login/src/sessionSanitizer.ts`.

Authorization predicates must be evaluated on server-resolved session data, not caller-supplied request fields. Missing or invalid session fields should not grant permissions; see `../src/validateRequest.ts`. Keep input validation and session authorization separate: a well-formed payload does not imply an authorized caller (`../src/runtimeTypeValidation.ts`).
