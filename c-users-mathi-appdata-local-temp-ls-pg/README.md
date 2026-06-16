# C:/Users/mathi/AppData/Local/Temp/ls Pg

Generated with [`create-luckystack-app`](https://github.com/ItsLucky23/LuckyStack-v2).

## Get started

```bash
cp .env_template .env
cp .env.local_template .env.local
# Edit .env.local with your DATABASE_URL and (optional) OAuth secrets

npm run prisma:generate
npm run prisma:migrate:dev   # creates the User table

# In one terminal — backend (HTTP + Socket.io):
npm run server

# In another terminal — frontend (Vite, with proxy to the backend):
npm run client
```

Open <http://localhost:5173>.

## What you got out of the box

The scaffolder ships a working starter — auth flows, settings, shared UI primitives — all in your `src/` so you have full control. The framework lives in `node_modules/@luckystack/*`; everything in your project is YOUR code, customize freely.

### Pages (you can edit these)

| Path | Route | Purpose |
| --- | --- | --- |
| `src/login/page.tsx` | `/login` | Credentials login + OAuth buttons |
| `src/register/page.tsx` | `/register` | Account creation form |
| `src/reset-password/page.tsx` | `/reset-password` | Forgot-password flow |
| `src/settings/page.tsx` | `/settings` | Profile, password, sessions, preferences (uses `home` layout) |
| `src/dashboard/page.tsx` | `/dashboard` | Sample authenticated landing page — replace with yours |

### API routes (you can edit these)

| Path | What it does |
| --- | --- |
| `src/_api/session_v1.ts` | Returns the current session payload to the client |
| `src/_api/logout_v1.ts` | Logs the current session out |
| `src/reset-password/_api/sendReset_v1.ts` | Sends the password-reset email (anti-enumeration) |
| `src/reset-password/_api/confirmReset_v1.ts` | Consumes the reset token + updates the password |
| `src/settings/_api/listSessions_v1.ts` | Active sessions for the current user |
| `src/settings/_api/revokeSession_v1.ts` | Revokes one session by token |
| `src/settings/_api/signOutEverywhere_v1.ts` | Revokes every session including the current |
| `src/settings/_api/changePassword_v1.ts` | Verifies current, updates password, revokes others |
| `src/settings/_api/updateUser_v1.ts` | Profile update + avatar upload (via `processUpload`) |
| `src/settings/_api/updatePreferences_v1.ts` | Saves notify-on-* user preferences |
| `src/settings/_api/deleteAccount_v1.ts` | Permanently deletes the account |

### Shared UI primitives (`src/_components/`)

Components you can modify, restyle, or extend:

- `Avatar.tsx` — user avatar with image + first-letter fallback
- `ConfirmMenu.tsx` — typed-confirm modal form
- `ErrorPage.tsx` — route-level error boundary fallback
- `LoginForm.tsx` — credentials + OAuth form (used by `/login` and `/register`)
- `MenuHandler.tsx` — stack-based modal/sheet system
- `dropdown/Dropdown.tsx` + `dropdown/MultiSelectDropdown.tsx` — single / multi-select inputs with keyboard nav
- `templates/TemplateProvider.tsx` — registers the per-page layouts your site uses
- `templates/Home.tsx` — sample signed-in shell (no Navbar by default — wire your own header/sidebar here)

### Shared helpers (`src/_functions/`)

- `middlewareHandler.ts` — your page-load auth/redirect rules (registered with the framework via `main.tsx`)
- `menuHandler.ts` — imperative `menuHandler.open()` / `confirm()` API
- `confetti.ts` — `canvas-confetti` wrapper, tune the defaults to taste

### Framework-owned plumbing (in `node_modules/@luckystack/*`)

The framework owns these so you don't have to maintain them — but knowing where they come from is useful:

- `useSession()`, `useTheme()`, `useTranslator()`, `useRouter()` — hooks from `@luckystack/core/client`
- `<Middleware>`, `<AvatarProvider>`, `<TranslationProvider>` — providers from `@luckystack/core/client`
- `<LocationProvider>`, `<SocketStatusIndicator>` — presence from `@luckystack/presence/client`
- `i18nNotify` (re-exported as `notify`) — i18n-backed toast wrapper from `@luckystack/core/client`
- Theme + language enums come from your `config.ts` (`defaultTheme`, `defaultLanguage`) and `SessionLayout` types — the framework reads them via `getProjectConfig()`.

To customize translations: add JSON to `src/_locales/` and edit `luckystack/i18n/locales.ts` to register them.

To customize auth/redirect rules: edit `src/_functions/middlewareHandler.ts` — it's registered once from `main.tsx`.

## Where to configure the framework

| Path | What it is |
| --- | --- |
| `config.ts` | Project-wide framework config (CORS, session, logging, rate limiting, …) |
| `deploy.config.ts` | Resource topology (Redis, Mongo) |
| `services.config.ts` | Service / preset definitions for multi-instance deploys |
| `luckystack/login/oauthProviders.ts` | Enabled OAuth providers (Google, GitHub, Discord, …) |
| `luckystack/login/userAdapter.ts` | How auth flows look up / create users |
| `luckystack/core/clients.ts` | Override Prisma / Redis clients (TLS, Accelerate, sentinel, …) |
| `luckystack/server/index.ts` | Hook registrations + `customRoutes` + notification wiring |
| `luckystack/i18n/locales.ts` | Translation registry — register `_locales/*.json` and the language source |
| `prisma/schema.prisma` | Database schema |
| `server/server.ts` | Server entry — usually no need to edit |
| `server/hooks/notifications.ts` | Transactional email wiring (new-sign-in, password-change) |

## File-based routing

- `src/<page>/page.tsx` → route `/<page>` (lowercase folder name)
- `src/<page>/_api/<name>_v{n}.ts` → API endpoint `api/<page>/<name>/v<n>`
- `src/<page>/_sync/<name>_server_v{n}.ts` → sync event `sync/<page>/<name>/v<n>`
- Folders prefixed with `_` are private — they never become routes.

After adding a route, run `npm run generateArtifacts` to regenerate the type maps + Zod schemas.

## Hooks

The framework dispatches lifecycle hooks for every major operation (login, password change, upload, rate-limit, CSRF mismatch, etc.). Subscribe in `luckystack/server/index.ts`:

```ts
import { registerHook } from '@luckystack/core';

registerHook('onUploadComplete', ({ userId, fileName, sizeBytes }) => {
  auditLog.write({ kind: 'upload', userId, fileName, sizeBytes });
});

registerHook('rateLimitExceeded', ({ scope, key, limit }) => {
  // alert ops / increment metric / block IP, your choice
});
```

Full hook list lives in `@luckystack/core/dist/hooks/types.d.ts`.

## Docs

Full framework docs: <https://github.com/ItsLucky23/LuckyStack-v2#readme>
