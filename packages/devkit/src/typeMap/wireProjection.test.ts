import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getInputTypeDetailsFromFile, getOutputTypeDetailsFromFile } from './extractors';
import { getServerProgram } from './tsProgram';

const FIXTURES = path.join(import.meta.dirname, '__fixtures__');
const MIKRO_ROUTE = path.join(FIXTURES, 'mikroRoute_v1.ts');
const EXTRACTION_TIMEOUT_MS = 120_000;

//? Warm the memoized program here rather than letting whichever test runs first
//? pay for it — under full-suite CPU contention that build exceeds vitest's 5s
//? default and makes the file flaky by run order. Same pattern as
//? extractorsMikro.test.ts. (Learned the hard way: these tests passed in
//? isolation and timed out in the full run.)
beforeAll(() => {
  getServerProgram();
}, 180_000);

describe('wire projection — outputs say what the client actually receives', () => {
  //? THE BUG THIS CLOSES: the generator emitted the type the HANDLER returns, but
  //? the client gets JSON. JSON has no Date — `Date.prototype.toJSON()` makes it
  //? an ISO string. So `createdAt: Date` was a lie TypeScript endorsed:
  //? `user.createdAt.getTime()` compiled and threw at runtime. Verified against
  //? the real transports: socket.io's default parser is JSON.stringify, and the
  //? HTTP route does `res.end(JSON.stringify(result))`.

  it('projects Date to string on an OUTPUT', () => {
    const output = getOutputTypeDetailsFromFile(MIKRO_ROUTE);
    expect(output.text).toContain('createdAt: string');
    expect(output.text, 'a Date must never survive into a client-facing type').not.toMatch(/:\s*Date\b/);
  }, EXTRACTION_TIMEOUT_MS);

  it('leaves an INPUT type untouched — this boundary is load-bearing', () => {
    //? Inputs must NOT be projected. Their text feeds `validateInputByType`, which
    //? in production runs with NO resolver and is fail-closed: project an input
    //? and real payloads start getting rejected. Outputs describe what we SEND
    //? (already serialized); inputs describe what we ACCEPT (validated as-is).
    const input = getInputTypeDetailsFromFile(MIKRO_ROUTE);
    expect(input.text).not.toContain('createdAt: string');
  }, EXTRACTION_TIMEOUT_MS);

  //? The union dedupe (a `Date | string` collapsing to `string` rather than
  //? `string | string`) is covered by the golden snapshot, which pins the real
  //? `previousLogin?: undefined | null | string;` for this repo's session route.
  //? It is NOT asserted here: a text scan of the MikroORM fixture cannot express
  //? it. That fixture legitimately contains `string | string[]` and
  //? `string | string & { }` — the latter a MikroORM branded type the checker
  //? treats as genuinely distinct — so any regex loose enough to catch a
  //? duplicate also catches those, and the test would fail on correct output.
});
