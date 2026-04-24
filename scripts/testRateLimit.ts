import {
  logContractResult,
  logContractSummary,
  runRateLimitTests,
} from '../packages/test-runner/src';
import { apiMethodMap, apiMetaMap } from '../src/_sockets/apiTypes.generated';

//? Fires rateLimit+1 requests per endpoint and asserts the N+1 is blocked.
//? Mutates server limiter state — run on a throwaway server or after a reset.
//?
//? Config via env:
//?   TEST_BASE_URL       — defaults to http://localhost:80
//?   TEST_SKIP           — comma-separated `<page>/<name>` pairs to skip
//?   TEST_MAX_RATE_LIMIT — skip endpoints with a rateLimit above this (default 50)
const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:80';
const skip = (process.env.TEST_SKIP ?? '').split(',').map(s => s.trim()).filter(Boolean);
const maxRateLimitToTest = Number.parseInt(process.env.TEST_MAX_RATE_LIMIT ?? '50', 10);

console.log(`[test:rate-limit] walking rate-limited endpoints against ${baseUrl}`);

const summary = await runRateLimitTests({
  apiMethodMap,
  apiMetaMap,
  baseUrl,
  skip,
  maxRateLimitToTest,
  onResult: logContractResult,
});

logContractSummary(summary);

if (summary.failed > 0) {
  process.exit(1);
}
process.exit(0);
