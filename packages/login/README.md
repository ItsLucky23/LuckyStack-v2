# @luckystack/login

Authentication and session lifecycle for LuckyStack, with credential, OAuth and adapter-backed identity options. Install with `npm install @luckystack/login socket.io`; add optional `@prisma/client` for the default user adapter and `@luckystack/email` for framework-managed email flows. Register user/session adapters before handling logins. Consult `package.json`, `src/register.ts` and `src/userAdapter.ts` for integration requirements.

Before switching an existing app to unified provider accounts: reconcile duplicate emails and dependent rows; enforce email uniqueness in the database (application checks cannot close the registration race); ensure a custom user adapter implements cross-provider email lookup; then enable the strategy. Changing cookie policy requires a CSRF/origin review. OAuth redirects must pass trusted-origin validation. Password-reset responses must not reveal whether an account exists; never expose tokens or hashes in sessions. See [design context](./AGENTS.md), [session safety](./docs/session-management.md), [redirect trust](./docs/redirect-validation.md) and [account strategy](./docs/user-adapter.md).

## Existing-project OAuth account binding (0.16)

1. Add a nullable `providerAccountId` to the user store with a non-unique index on (`provider`, `providerAccountId`); for the default Prisma adapter `providerAccountId String?` and `@@index([provider, providerAccountId])`. Review/apply the database change with authorization and regenerate the client. Until the column exists, OAuth logins with the default adapter fail; credentials logins keep working.
2. A custom adapter implements `findByProviderAccountId` and persists `providerAccountId` from `create` and `update` (`src/userAdapter.ts`). Without it the framework warns once and keeps email matching.
3. Existing accounts bind on their next login when the provider verified the email; an unbound account whose provider email is unverified (multi-tenant Microsoft) is refused. See ADR 0086.

## Existing-project email-code / 2FA adoption

1. Obtain feature approval before opting into `auth.emailCodeLogin: true` and/or `auth.twoFactor: 'optional'`. Register a real email sender for email-code login and any email fallback; console delivery is not sufficient.
2. Before 2FA enrollment, add persistence for `twoFactorEnabled` (initially false), nullable `totpSecret` and nullable `recoveryCodes` to the user store. For the default Prisma adapter the fields are `Boolean @default(false)`, `String?` and `Json?` respectively. Review/apply the database change with authorization and regenerate the client; custom adapters must support these fields in `src/userAdapter.ts`.
3. **Set a high-entropy secret `TOTP_ENCRYPTION_KEY` before enrollment. Without it new TOTP secrets are stored unencrypted.** Keep it outside Git/logs. During rotation retain previous values in `TOTP_ENCRYPTION_LEGACY_KEYS` (a JSON array of strings) until old records are migrated; deleting them early can lock users out. See `src/twoFactor.ts` for the installed keyring contract.
4. Run `npx luckystack update --app`, review/merge UI `.new` sidecars without overwriting consumer edits, then verify enrollment, login, recovery and rotation in an authorized environment. Schema and real secrets remain manually owned.
