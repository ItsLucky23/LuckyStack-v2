# Password reset

Framework-managed email and consumer-managed UI are separate choices so a project need not install mail infrastructure it does not use. Reset and email-change credentials are short-lived, single-use and hashed at rest: a Redis snapshot should not contain a redeemable link. They do not share the pluggable session-store adapter. See `../src/forgotPassword.ts`, `../src/passwordReset.ts`, `../../core/src/oneTimeToken.ts`.

An unknown email must not produce a distinguishable user-facing response, including from audit hooks. Apply password policy when changing a password, and consider revoking existing sessions after reset; a changed hash alone does not invalidate an already-issued session. This package uses bcrypt to avoid the deployment friction of a native hashing dependency; changing the algorithm requires a coordinated login/verification and migration plan, not only a storage adapter. Source: `../src/passwordPolicy.ts`, `../src/session.ts`, `./hooks.md`.
