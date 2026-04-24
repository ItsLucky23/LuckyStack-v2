import {
  logContractResult,
  logContractSummary,
  runFuzzTests,
} from '../packages/test-runner/src';
import { apiMethodMap } from '../src/_sockets/apiTypes.generated';

//? Sends well-known junk payloads to every endpoint and asserts no 5xx and
//? that responses stay in the {status, errorCode} envelope. Does not validate
//? against a schema — Zod-driven fuzz is deferred until the generator emits
//? runtime schemas.
//?
//? Config via env:
//?   TEST_BASE_URL    — defaults to http://localhost:80
//?   TEST_SKIP        — comma-separated `<page>/<name>` pairs to skip
//?   TEST_AUTH_TOKEN  — session cookie value; enables testing of auth-required endpoints
const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:80';
const skip = (process.env.TEST_SKIP ?? '').split(',').map(s => s.trim()).filter(Boolean);
const sessionCookieName = process.env.TEST_SESSION_COOKIE_NAME ?? 'luckystack_token';
const authToken = process.env.TEST_AUTH_TOKEN;

const headers: Record<string, string> = {};
if (authToken) {
  headers['Cookie'] = `${sessionCookieName}=${authToken}`;
}

console.log(`[test:fuzz] fuzzing every endpoint against ${baseUrl}`);

const summary = await runFuzzTests({
  apiMethodMap,
  baseUrl,
  skip,
  headers,
  onResult: logContractResult,
});

logContractSummary(summary);

if (summary.failed > 0) {
  process.exit(1);
}
process.exit(0);
