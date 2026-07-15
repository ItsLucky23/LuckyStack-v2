import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT_DIR } from '@luckystack/core';
import { getServerProgram } from './tsProgram';
import { findAllApiFiles, findAllSyncServerFiles, findAllSyncClientFiles } from './discovery';
import {
  getInputTypeDetailsFromFile,
  getOutputTypeDetailsFromFile,
  getSyncClientDataTypeDetailsFromFile,
  getSyncServerOutputTypeDetailsFromFile,
  getSyncClientOutputTypeDetailsFromFile,
} from './extractors';

//? GOLDEN BASELINE — the regression net for the type inliner.
//?
//? `tsProgram.ts` shipped with no tests, so there was nothing stopping a change
//? to `expandTypeDetailed` from silently reshaping every generated route type.
//? This walks THIS repo's real routes through the real extractors and pins the
//? exact generated type text.
//?
//? ── HOW TO UPDATE ────────────────────────────────────────────────────────────
//? The golden file is a vitest snapshot. When you change the inliner ON PURPOSE:
//?
//?     npx vitest run packages/devkit/src/typeMap/goldenRouteTypes.test.ts -u
//?
//? then READ THE DIFF in `__snapshots__/goldenRouteTypes.test.ts.snap` before
//? committing it. A diff here is not noise — it is every consumer's client-side
//? API types changing. An unexplained diff is a bug, not a snapshot to bless.
//? ─────────────────────────────────────────────────────────────────────────────

const SRC_DIR = path.join(ROOT_DIR, 'src');

// Route keys are repo-relative + posix so the snapshot is stable across machines.
const routeKey = (filePath: string): string =>
  path.relative(SRC_DIR, filePath).replaceAll('\\', '/');

interface RouteTypes { input?: string; output?: string; clientInput?: string; serverOutput?: string; clientOutput?: string }

let apiFiles: string[] = [];
let syncServerFiles: string[] = [];
let syncClientFiles: string[] = [];

//? Building the ts.Program over tsconfig.server.json is the expensive part
//? (tens of seconds on a cold cache). `getServerProgram()` memoizes it, so warm
//? it HERE — otherwise whichever test touches it first pays the cost and trips
//? vitest's 5s default timeout, which makes this suite flaky depending on run
//? order. The per-test timeouts below cover the extraction work itself.
beforeAll(() => {
  apiFiles = findAllApiFiles(SRC_DIR).sort();
  syncServerFiles = findAllSyncServerFiles(SRC_DIR).sort();
  syncClientFiles = findAllSyncClientFiles(SRC_DIR).sort();
  getServerProgram();
}, 180_000);

const EXTRACTION_TIMEOUT_MS = 120_000;

describe('golden baseline — generated route types', () => {
  it('discovers the expected route surface (guards against a silent discovery regression)', () => {
    //? If these counts change, a route was added/removed — update the snapshot
    //? deliberately (see the header) rather than loosening this assertion.
    expect(apiFiles.length).toBe(20);
    expect(syncServerFiles.length + syncClientFiles.length).toBe(5);
  });

  it('pins the inlined input + output type of every API route', () => {
    const golden: Record<string, RouteTypes> = {};
    for (const file of apiFiles) {
      golden[routeKey(file)] = {
        input: getInputTypeDetailsFromFile(file).text,
        output: getOutputTypeDetailsFromFile(file).text,
      };
    }
    expect(golden).toMatchSnapshot();
  }, EXTRACTION_TIMEOUT_MS);

  it('pins the inlined types of every sync route', () => {
    const golden: Record<string, RouteTypes> = {};
    for (const file of syncServerFiles) {
      golden[routeKey(file)] = {
        clientInput: getSyncClientDataTypeDetailsFromFile(file).text,
        serverOutput: getSyncServerOutputTypeDetailsFromFile(file).text,
      };
    }
    for (const file of syncClientFiles) {
      golden[routeKey(file)] = {
        clientOutput: getSyncClientOutputTypeDetailsFromFile(file).text,
      };
    }
    expect(golden).toMatchSnapshot();
  }, EXTRACTION_TIMEOUT_MS);

  it('pins every unresolved type symbol the extractors report', () => {
    //? `generateTypeMapFile()` ABORTS when a route reports an unresolved symbol,
    //? so this set is a release gate, not a curiosity.
    const unresolved: Record<string, string[]> = {};
    for (const file of [...apiFiles, ...syncServerFiles]) {
      const names = [
        ...getInputTypeDetailsFromFile(file).unresolvedSymbols,
        ...getOutputTypeDetailsFromFile(file).unresolvedSymbols,
      ].map((s) => s.name);
      if (names.length > 0) unresolved[routeKey(file)] = [...new Set(names)].sort();
    }
    expect(unresolved).toMatchSnapshot();
  }, EXTRACTION_TIMEOUT_MS);
});

describe('golden baseline — the shipped generated artifact', () => {
  //? A cheap invariant over the COMMITTED artifact. It is what consumers'
  //? editors actually read, and the `__@` markers are exactly what would make it
  //? unparseable.
  it('the committed apiTypes.generated.ts contains no `__@` markers', () => {
    const generated = path.join(SRC_DIR, '_sockets', 'apiTypes.generated.ts');
    if (!fs.existsSync(generated)) return;
    expect(fs.readFileSync(generated, 'utf8')).not.toContain('__@');
  });

  it('the committed apiTypes.generated.ts emits `createdAt: string` — what the client receives', () => {
    const generated = path.join(SRC_DIR, '_sockets', 'apiTypes.generated.ts');
    if (!fs.existsSync(generated)) return;
    //? End-to-end, at the artifact level. This assertion used to pin
    //? `createdAt: Date` as the deliberate wire-INCORRECT baseline, so that
    //? fixing it would produce a visible diff. It did; this is the other side.
    //?
    //? Proven against the real stack rather than argued: a Prisma row's
    //? `createdAt` is a Date on the server and arrives as
    //? `"2026-07-15T15:20:15.553Z"` in the client, where `.getTime()` does not
    //? exist. The old type said `Date`, so that call compiled and threw.
    const content = fs.readFileSync(generated, 'utf8');
    expect(content).toContain('createdAt: string');
    expect(content, 'no Date may survive into a client-facing generated type').not.toMatch(/:\s*Date;/);
  });
});
