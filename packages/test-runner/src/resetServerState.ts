//? Calls the server's /_test/reset endpoint. Used between rate-limit test
//? endpoints to drain the shared IP-based limiter bucket so one endpoint's
//? N+1 assertion doesn't consume the next endpoint's window.
//?
//? /_test/reset is gated by NODE_ENV !== 'production' on the server side.
//? In staging/preview deploys that enable it for CI, set TEST_RESET_TOKEN
//? on the server and pass the same value here.

export interface ResetServerStateInput {
  baseUrl: string;
  token?: string;
}

export const resetServerState = async ({ baseUrl, token }: ResetServerStateInput): Promise<boolean> => {
  const url = `${baseUrl.replace(/\/$/, '')}/_test/reset`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Test-Reset-Token'] = token;

  try {
    const response = await fetch(url, { method: 'POST', headers });
    return response.ok;
  } catch {
    return false;
  }
};
