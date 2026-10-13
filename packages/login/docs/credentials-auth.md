# Credential authentication

Login and registration share a dispatcher for a shared form, but their security rules differ. Validate password strength when creating or replacing a password, not before checking an existing login: imposing a new policy on sign-in would lock out older valid credentials and could let attackers trigger account lockouts with policy-invalid attempts. Source: `../src/login.ts`, `../src/passwordPolicy.ts`, `../src/authLockout.ts`.

Do not transform passwords as if they were HTML: hashing and comparison need the original bytes. Normalize identifiers and keep authentication failure messages resistant to account enumeration. Never include a stored password hash in a browser-visible session (`../src/sessionSanitizer.ts`). Render reason keys through the translation layer, not as raw user-facing text. See `../../../docs/ARCHITECTURE_AUTH.md`.
