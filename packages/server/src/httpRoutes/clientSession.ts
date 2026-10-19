//? @adr 0018 — the raw session token never reaches page JS through the session
//? object, in either mode. Login results carry the server-side session (with
//? `token` and the session-bound `csrfToken`); the HTTP login responses send
//? this projection instead. The token travels only as the HttpOnly cookie or the
//? `X-Session-Token` header, and the client fetches its CSRF token from
//? `/auth/csrf`.
export const toClientSession = (session: unknown): unknown => {
  if (typeof session !== 'object' || session === null) return session;
  const { token: _token, csrfToken: _csrfToken, ...clientSession } = session as { token?: unknown; csrfToken?: unknown };
  return clientSession;
};
