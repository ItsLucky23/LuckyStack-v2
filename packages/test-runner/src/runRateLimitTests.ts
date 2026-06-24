import { walkEndpoints } from './walkEndpoints';
import { runRateLimitCheck } from './rateLimitCheck';
import { resetServerState } from './resetServerState';
import { shouldSkip, requiresLogin, getRateLimit, calculateSummary, STATE_CHANGING_METHODS } from './testLayerHelpers';
import type { ApiMethodMap, ApiMetaMap, ContractCheckResult, EndpointDescriptor, RunContractSummary } from './types';

export interface RunRateLimitTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  baseUrl: string;
  skip?: string[];
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
  /**
   * Max rateLimit value to test. Endpoints with a higher limit are skipped
   * to avoid firing thousands of requests in CI.
   */
  maxRateLimitToTest?: number;
  /**
   * When true, hit `/_test/reset` before each endpoint so limiter state is
   * clean. Requires the server to allow the endpoint: `NODE_ENV` in
   * { 'development', 'test' } AND `TEST_RESET_TOKEN` set on the server with a
   * matching `resetToken` here (an unset token is 403, never open). Without
   * resetting, the shared IP bucket leaks state between endpoints.
   */
  resetBetweenEndpoints?: boolean;
  /**
   * Token forwarded as `X-Test-Reset-Token` when resetting. Only relevant in
   * staging/preview deploys that enable the endpoint behind a token.
   */
  resetToken?: string;
  onResult?: (result: ContractCheckResult) => void;
}

export const runRateLimitTests = async (
  input: RunRateLimitTestsInput,
): Promise<RunContractSummary> => {
  const endpoints = walkEndpoints(input.apiMethodMap);
  const skip = input.skip ?? [];
  const maxRateLimit = input.maxRateLimitToTest ?? 50;
  //? A login-required route returns `auth.required` BEFORE the rate limiter
  //? runs, so it can only be rate-limit-tested with a session. A Cookie header
  //? means an authenticated sweep. We deliberately do NOT auto-authenticate the
  //? sweep — that would execute real mutations (delete/update) with junk input.
  //? Set TEST_AUTH_TOKEN to opt in and cover login-gated routes.
  const isAuthenticatedSweep = Boolean(input.headers?.Cookie);
  const results: ContractCheckResult[] = [];

  for (const endpoint of endpoints) {
    const rateLimit = getRateLimit(input.apiMetaMap, endpoint);
    if (rateLimit === null) continue;

    if (!isAuthenticatedSweep && requiresLogin(input.apiMetaMap, endpoint)) {
      const skipped: ContractCheckResult = {
        endpoint,
        status: 'skipped',
        durationMs: 0,
        reason: 'login-required route — set TEST_AUTH_TOKEN to rate-limit-test it (unauthenticated calls hit auth.required before the limiter)',
      };
      results.push(skipped);
      input.onResult?.(skipped);
      continue;
    }

    //? In cookie-mode the rate-limit check fires the endpoint `rateLimit + 1`
    //? times with junk input. State-changing routes (POST/PUT/DELETE) execute
    //? real mutation handlers on each hit — skip them to avoid side-effects on
    //? the test database. Their rate limits are better covered by a custom test
    //? that supplies valid input.
    if (isAuthenticatedSweep && STATE_CHANGING_METHODS.has(endpoint.method)) {
      const skipped: ContractCheckResult = {
        endpoint,
        status: 'skipped',
        durationMs: 0,
        reason: 'state-changing route skipped in cookie-mode rate-limit sweep (mutation risk with junk bodies)',
      };
      results.push(skipped);
      input.onResult?.(skipped);
      continue;
    }

    if (rateLimit > maxRateLimit) {
      const skipped: ContractCheckResult = {
        endpoint,
        status: 'skipped',
        durationMs: 0,
        reason: `rateLimit ${rateLimit} exceeds maxRateLimitToTest=${maxRateLimit}`,
      };
      results.push(skipped);
      input.onResult?.(skipped);
      continue;
    }

    if (shouldSkip(endpoint, skip)) {
      const skipped: ContractCheckResult = {
        endpoint,
        status: 'skipped',
        durationMs: 0,
        reason: 'Explicitly skipped',
      };
      results.push(skipped);
      input.onResult?.(skipped);
      continue;
    }

    if (input.resetBetweenEndpoints) {
      await resetServerState({ baseUrl: input.baseUrl, token: input.resetToken });
    }

    const result = await runRateLimitCheck({
      endpoint,
      baseUrl: input.baseUrl,
      rateLimit,
      inputFor: input.inputFor,
      headers: input.headers,
    });
    results.push(result);
    input.onResult?.(result);
  }

  return calculateSummary(results);
};
