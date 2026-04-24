import {
  logContractResult,
  logContractSummary,
  runContractTests,
} from '../packages/test-runner/src';
import { apiMethodMap } from '../src/_sockets/apiTypes.generated';

//? CLI wrapper: boots no server, just hits whatever URL the operator points at.
//? Run `npm run server` in another terminal (or `npm run router`) before this.
//?
//? Config via env:
//?   TEST_BASE_URL    — defaults to http://localhost:80
//?   TEST_SKIP        — comma-separated `<page>/<name>` pairs to skip
//?   TEST_AUTH_TOKEN  — passed through as session cookie when set
const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:80';
const skip = (process.env.TEST_SKIP ?? '').split(',').map(s => s.trim()).filter(Boolean);
const sessionCookieName = process.env.TEST_SESSION_COOKIE_NAME ?? 'luckystack_token';
const authToken = process.env.TEST_AUTH_TOKEN;

const headers: Record<string, string> = {};
if (authToken) {
  headers['Cookie'] = `${sessionCookieName}=${authToken}`;
}

console.log(`[test:contract] walking endpoints against ${baseUrl}`);

const summary = await runContractTests({
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
