import { tryCatchSync } from '@luckystack/core';
import { extractApiName, extractApiVersion, extractPagePath, extractSyncName, extractSyncPagePath, extractSyncVersion } from './routeMeta';

//? DEVKIT-1 / DD-DEVKIT-D3. `extractors.ts` wraps every extraction in a
//? try/catch, so a THROW inside `expandTypeDetailed` degrades the route to its
//? DEFAULT (`{ }` / `{ status: string }`) with a `console.error` as the only
//? signal. That made a whole-payload-shape loss indistinguishable — in the
//? emitted artifact AND in `apiTypeDiagnostics.generated.json` — from a route
//? that legitimately has no typed shape: both surface as `default-fallback`.
//?
//? This registry is the seam that carries "this field's extraction THREW" from
//? the extractor to the emitter, so it can be reported as its own first-class
//? `extraction-error` reason. It exists because the two are only wired together
//? through `typeMapGenerator.ts`, which copies just the `.text` of each
//? extraction result into the emitter's entry — there is no field on that entry
//? to thread an error through.
//?
//? SAFETY OF MODULE-LEVEL STATE: every extractor CLEARS its key on entry
//? (`error: null`) and only SETS it from its catch block, so a re-extraction can
//? never leave a stale "failed" verdict behind — including when the extractor
//? bails out early (no source file / no `ApiParams` / no `data`), which is why
//? the clear is on entry rather than on the success path. `collectFallbacks`
//? only ever CONSULTS this registry for routes it is already iterating (it never
//? adds routes from it), so an entry for a file that is no longer discovered is
//? inert rather than a phantom diagnostic.

export type ExtractionKind = 'api' | 'sync';

export interface ExtractionFailure {
  filePath: string;
  kind: ExtractionKind;
  field: string;
  message: string;
}

const failures = new Map<string, ExtractionFailure>();

const keyOf = (filePath: string, kind: ExtractionKind, field: string): string => `${filePath}|${kind}|${field}`;

//? `String(error)` on an `unknown` trips @typescript-eslint/no-base-to-string (a
//? plain object would stringify to a useless '[object Object]'), so narrow first
//? and JSON-encode anything that is neither an Error nor a string.
//?
//? `JSON.stringify` is DECLARED to return `string`, but it returns `undefined`
//? for `undefined`/functions/symbols and THROWS on a circular value or a BigInt.
//? This runs inside a catch handler, so it must not be the thing that throws —
//? hence the `tryCatchSync` guard and the widened return annotation.
const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const [, encoded] = tryCatchSync((): string | undefined => JSON.stringify(error));
  return encoded ?? Object.prototype.toString.call(error);
};

//? Records the outcome of one extraction. `error === null` means "no failure"
//? and CLEARS any previous verdict for that file+field; callers pass it on ENTRY
//? so that every exit path (success OR early bail-out) leaves the key clear
//? unless the catch block re-sets it.
export const recordExtractionOutcome = ({
  filePath,
  kind,
  field,
  error,
}: {
  filePath: string;
  kind: ExtractionKind;
  field: string;
  error: unknown;
}): void => {
  const key = keyOf(filePath, kind, field);
  if (error === null) {
    failures.delete(key);
    return;
  }
  failures.set(key, { filePath, kind, field, message: messageOf(error) });
};

//? Derives the `<pagePath>/<name>@<version>` route key the emitter's diagnostics
//? use. `extractPagePath` throws for a file outside the configured srcDir (e.g.
//? a test fixture), so the lookup is guarded via `tryCatchSync` (the sync
//? sibling of `tryCatch` — this whole path is synchronous; same helper
//? `apiMeta.ts` uses): an underivable path simply never matches a real route,
//? which is the correct outcome.
const routeKeyOf = ({ filePath, kind }: ExtractionFailure): string | null => {
  const [, route] = tryCatchSync((): string => (
    kind === 'api'
      ? `${extractPagePath(filePath)}/${extractApiName(filePath)}@${extractApiVersion(filePath)}`
      : `${extractSyncPagePath(filePath)}/${extractSyncName(filePath)}@${extractSyncVersion(filePath)}`
  ));
  return route;
};

//? Returns the error message for a route field whose extraction threw, or
//? `undefined` when that field extracted cleanly.
export const findExtractionFailure = (
  route: string,
  kind: ExtractionKind,
  field: string,
): string | undefined => {
  for (const failure of failures.values()) {
    if (failure.kind !== kind || failure.field !== field) continue;
    if (routeKeyOf(failure) === route) return failure.message;
  }
  return undefined;
};

//? Test seam / explicit reset.
export const clearExtractionFailures = (): void => {
  failures.clear();
};

export const getExtractionFailures = (): ExtractionFailure[] => [...failures.values()];
