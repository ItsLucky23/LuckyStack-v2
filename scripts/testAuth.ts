import {
  logContractResult,
  logContractSummary,
  runAuthEnforcementTests,
} from '../packages/test-runner/src';
import { apiMethodMap, apiMetaMap } from '../src/_sockets/apiTypes.generated';

//? Sends unauthenticated requests to every `auth.login: true` endpoint and
//? asserts each one rejects with `auth.required`. Run against a live server.
//?
//? Config via env:
//?   TEST_BASE_URL — defaults to http://localhost:80
//?   TEST_SKIP     — comma-separated `<page>/<name>` pairs to skip
const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:80';
const skip = (process.env.TEST_SKIP ?? '').split(',').map(s => s.trim()).filter(Boolean);

console.log(`[test:auth] walking auth-required endpoints against ${baseUrl}`);

const summary = await runAuthEnforcementTests({
  apiMethodMap,
  apiMetaMap,
  baseUrl,
  skip,
  onResult: logContractResult,
});

logContractSummary(summary);

if (summary.failed > 0) {
  process.exit(1);
}
process.exit(0);
