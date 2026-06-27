//? SINGLE SOURCE OF TRUTH for the project's frontend (dev) + backend ports.
//?
//? PURE DATA — no imports, no side-effects — so `vite.config.ts` can read the
//? ports WITHOUT importing `config.ts` (which registers projectConfig and pulls
//? server-only `@luckystack/core`). `config.ts` re-exports `ports` and `server.ts`
//? passes `backend` to the server, so there is exactly ONE place to change a port.
//?
//?   - `frontend`: the Vite dev-server port (dev only).
//?   - `backend` : the single-instance backend listen port. Multi-instance setups
//?     define per-service ports in `deploy.config.ts` bindings instead (added by
//?     `npx luckystack add router`); a positional argv port — `npm run server --
//?     <preset> <port>` — still overrides both.
export const ports = {
  frontend: 5173,
  backend: 80,
} as const;
