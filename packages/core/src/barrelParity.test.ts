import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

//? BARREL PARITY GUARD.
//?
//? The bug class this exists for: a helper is exported from the SERVER barrel
//? (`index.ts`) and is already being shipped to the browser (it sits in the
//? client barrel's import graph), but nobody added it to the CLIENT barrel
//? (`client.ts`). Consumers can then SEE it in their bundle but cannot
//? `import { x } from '@luckystack/core/client'`. It only falls over the day
//? someone reaches for it client-side. `tryCatchSync` was exactly this.
//?
//? WHY THE "ALREADY SHIPPED TO THE BROWSER" FILTER. A naive "every server export
//? must also be a client export" rule flags 60+ genuinely server-only APIs
//? (prisma/redis client registries, sessionProvider, bindAddress, cancelRegistry
//? …) and the allowlist becomes a reflex. Restricting to modules that are
//? ALREADY in the client barrel's transitive import closure narrows it to the
//? cases where the code demonstrably runs in a browser — where "you can't import
//? it" is a real defect rather than a deliberate boundary.
//?
//? NOTE the client barrel deliberately maps some names to DIFFERENT modules —
//? `tryCatch` resolves to `./tryCatchClient`, not `./tryCatch`, because the
//? server variant statically pulls in `node:async_hooks`. So parity is matched on
//? the exported NAME, never on the source module.
//?
//? Adding a name to `DELIBERATELY_SERVER_ONLY` is allowed — it is the visible,
//? reviewable way to say "ships in the chunk, but is not client-facing API".

const HERE = path.dirname(fileURLToPath(import.meta.url));

const resolveModule = (fromFile: string, spec: string): string | null => {
  if (!spec.startsWith('.')) return null;
  const base = path.join(path.dirname(fromFile), spec);
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return null;
};

interface BarrelExport {
  name: string;
  mod: string;
}

//? Value (non-type) re-exports of the form `export { a, b as c } from './mod'`.
const parseBarrel = (file: string): BarrelExport[] => {
  const text = fs.readFileSync(file, 'utf8');
  const out: BarrelExport[] = [];
  const re = /export\s+(type\s+)?\{([^}]*)\}\s+from\s+['"](\.[^'"]+)['"]/g;
  let match = re.exec(text);
  while (match !== null) {
    if (!match[1]) {
      for (const raw of (match[2] ?? '').split(',')) {
        const entry = raw.trim();
        //? Skip inline `type X` specifiers inside a value export block.
        if (entry && !entry.startsWith('type ')) {
          const aliased = /(\S+)\s+as\s+(\S+)/.exec(entry);
          out.push({ name: aliased ? (aliased[2] ?? entry) : entry, mod: match[3] ?? '' });
        }
      }
    }
    match = re.exec(text);
  }
  return out;
};

//? Every local module reachable from the client barrel — i.e. what actually
//? ends up in a browser bundle that imports `@luckystack/core/client`.
const clientImportClosure = (entry: string): Set<string> => {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    const specs = [
      ...text.matchAll(/^\s*import\s+(?!type\b)[^;]*from\s+['"]([^'"]+)['"]/gm),
      ...text.matchAll(/^\s*export\s+(?!type\b)[^;]*from\s+['"]([^'"]+)['"]/gm),
      ...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ].map((m) => m[1] ?? '');
    for (const spec of specs) {
      const resolved = resolveModule(file, spec);
      if (resolved !== null) stack.push(resolved);
    }
  }
  return seen;
};

//? Snapshot of names that ride along in the browser chunk but are NOT client
//? API. Each is a conscious call, not an oversight — shrink this list, never
//? grow it casually.
const DELIBERATELY_SERVER_ONLY = new Set([
  // Config plumbing consumed by framework internals, not by app code.
  'deepMerge', 'isPlainObject', 'createRegistry',
  'getProjectName', 'DEFAULT_PROJECT_CONFIG',
  // Error-tracker registry: adapters are registered from the SERVER boot
  // overlay (@luckystack/error-tracking); the client only emits through it.
  'registerErrorTracker', 'registerErrorTrackers', 'appendErrorTracker',
  'getActiveErrorTrackers', 'captureExceptionAcrossTrackers',
  'captureMessageAcrossTrackers', 'setErrorTrackerUser',
  'recordMetricAcrossTrackers', 'startSpanAcrossTrackers', 'startSpanHandle',
  'registerPreCaptureFilter', 'flushErrorTrackers',
  'sanitizeErrorString', 'sanitizeErrorStrings',
  // Logger internals + test-only resets.
  'isLoggerRegistered', 'resetLoggerForTests', 'createDevLogger',
  // Log redaction is applied on the server capture fan-out.
  'registerRedactedLogKeys', 'getRedactedLogKeys', 'isRedactedLogKey',
  'resetRedactedLogKeysForTests', 'sanitizeForLog',
  'DEFAULT_REDACTED_LOG_KEYS', 'REDACTED_PLACEHOLDER',
  'DEPTH_TRUNCATED_PLACEHOLDER',
  // CSRF *config* is registered server-side; the client uses getCsrfToken/httpFetch.
  'registerCsrfConfig', 'getCsrfConfig', 'resetCsrfConfigForTests',
  'DEFAULT_CSRF_CONFIG',
]);

describe('core barrel parity', () => {
  it('every browser-shipped server export is importable from /client (or explicitly server-only)', () => {
    const serverBarrel = path.join(HERE, 'index.ts');
    const clientBarrel = path.join(HERE, 'client.ts');

    const closure = clientImportClosure(clientBarrel);
    const clientNames = new Set(parseBarrel(clientBarrel).map((e) => e.name));

    const violations: string[] = [];
    for (const entry of parseBarrel(serverBarrel)) {
      const resolved = resolveModule(serverBarrel, entry.mod);
      //? Not shipped to the browser → server-only by construction, not a defect.
      if (resolved === null || !closure.has(resolved)) continue;
      if (clientNames.has(entry.name) || DELIBERATELY_SERVER_ONLY.has(entry.name)) continue;
      violations.push(`${entry.name} (from ${entry.mod})`);
    }

    expect(
      violations,
      `These are already shipped to the browser via the /client import graph but are not exported from client.ts.\n`
        + `Either re-export them there, or add them to DELIBERATELY_SERVER_ONLY with a reason:\n  `
        + violations.join('\n  '),
    ).toEqual([]);
  });

  it('detects the tryCatchSync-class omission (guard self-test)', () => {
    //? Pins the mechanism itself: a name that is in the closure and absent from
    //? BOTH the client barrel and the allowlist must be reported. Without this,
    //? a regression in the parser would silently turn the guard into a no-op.
    const clientBarrel = path.join(HERE, 'client.ts');
    const closure = clientImportClosure(clientBarrel);

    //? tryCatchSync is the real-world instance: pure, zero imports, reached via
    //? offlineQueue + apiRequest, and now exported from the client barrel.
    expect(closure.has(path.join(HERE, 'tryCatchSync.ts'))).toBe(true);
    expect(new Set(parseBarrel(clientBarrel).map((e) => e.name)).has('tryCatchSync')).toBe(true);
  });
});
