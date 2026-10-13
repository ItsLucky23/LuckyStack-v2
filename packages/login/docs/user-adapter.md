# User adapter

A user adapter lets authentication operate with a consumer-owned schema or storage engine, including tenant scoping and soft deletion, without making framework code import the consumer's database. The adapter is an identity boundary: apply tenant filters to every lookup and never treat an unverified provider email as universal account ownership. Source: `../src/userAdapter.ts`, `../src/accountStrategy.ts`.

Provider-scoped and unified-email accounts have different uniqueness requirements. Switching an existing dataset to unified identity requires reconciling duplicates and enforcing uniqueness in storage before enabling linking; a custom adapter must implement the corresponding lookup correctly. Session sanitization remains mandatory regardless of database choice (`../src/sessionSanitizer.ts`). For signatures and current schema consult `../src/userAdapter.ts`, not a copied interface table.
