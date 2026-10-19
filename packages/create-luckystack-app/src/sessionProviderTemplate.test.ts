//? Finding 055: the scaffold's SessionProvider returned early when the first
//? `system/session` fetch failed and never set `sessionLoaded`. Middleware then
//? waited ~5s on every guarded navigation and sent a signed-in user to /login
//? until a full reload. Its `updateSession` listener also ran a raw JSON.parse
//? that throws on a malformed frame. The reference app had fixed both; the
//? template had not. These checks pin the template's behaviour in its source,
//? since the template is not compiled or rendered inside this package.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', 'template', 'src', '_providers', 'SessionProvider.tsx'),
  'utf8',
);

describe('template SessionProvider', () => {
  it('never returns from the initial fetch on a non-success status without marking loaded', () => {
    expect(source).not.toMatch(/if \(response\.status !== 'success'\) return;/);
  });

  it('retries the initial fetch and marks the session loaded after the last attempt', () => {
    expect(source).toMatch(/for \(let attempt = 1; attempt <= maxAttempts; attempt\+\+\)/);
    expect(source).toMatch(/if \(!run\.cancelled\) setSessionLoaded\(true\);/);
  });

  it('parses updateSession frames through tryCatch, never a raw JSON.parse', () => {
    expect(source).toContain('tryCatch,');
    const parses = [...source.matchAll(/JSON\.parse\(data\)/g)];
    expect(parses).toHaveLength(1);
    expect(source).toMatch(/await tryCatch<SessionLayout>\(\(\) => JSON\.parse\(data\) as SessionLayout\)/);
  });
});
