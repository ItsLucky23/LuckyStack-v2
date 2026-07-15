import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { capabilities } from './capabilities';

//? Comments are stripped before matching: capabilities.ts documents the broken
//? pattern verbatim so the next reader understands the trap, and a guard that
//? trips on its own explanation would be worse than no guard.
const SOURCE_CODE = fs
  .readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'capabilities.ts'), 'utf8')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n');

describe('optional-package capability detection', () => {
  it('reports workspace-installed @luckystack packages as present', () => {
    //? These are real workspace symlinks in this repo, so a detector that
    //? regressed to CJS `require.resolve` would report them ABSENT (the
    //? @luckystack/* exports maps are import-only). That was the original bug
    //? this module exists to fix; this is its regression net.
    expect(capabilities.login).toBe(true);
    expect(capabilities.presence).toBe(true);
    expect(capabilities.sync).toBe(true);
  });

  it('never detaches import.meta.resolve from its object', () => {
    //? A SOURCE-level guard, deliberately, because this failure mode is
    //? UNREPRODUCIBLE from a Node test runner: Node happily calls a detached
    //? `import.meta.resolve`, while Bun throws "import.meta.resolve must be
    //? bound to an import.meta object". `has()` catches that throw and returns
    //? false, so under Bun EVERY optional package reported absent — login/auth,
    //? sync, presence, cron, docs-ui and error-tracking all silently off while
    //? the server booted and served a green /_health. Verified empirically on
    //? bun 1.3.14: detached => false, bound => true; on Node both => true,
    //? which is exactly why it survived review.
    //?
    //? So: assert the shape, since we cannot assert the behaviour here. The real
    //? runtime check lives in the Bun leg of `npm run e2e:verdaccio`.
    const detachedAssignment = /(?:const|let|var)\s+\w+\s*=[^;]*\.resolve\s*;/;
    expect(
      SOURCE_CODE,
      'capabilities.ts must call `resolve` as a member of the import.meta object ' +
        '(`importMeta.resolve(pkg)`), never assign it to a variable first — a detached ' +
        'call throws under Bun and silently reports every optional package as absent.',
    ).not.toMatch(detachedAssignment);
  });
});
