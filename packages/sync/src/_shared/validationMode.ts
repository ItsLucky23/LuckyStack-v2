//? Per-route input-validation toggle for sync `_server` handlers. Mirrors the
//? API package's `resolveValidationMode` (socketValidationStage.ts) so both
//? transports interpret the `validation` export identically:
//?
//?   - `'relaxed'` or `{ input: 'skip' }` → skip runtime input validation
//?     entirely. Useful for routes whose payload shape can't reasonably be
//?     modelled in TypeScript (third-party webhook fan-in, dynamic blobs).
//?   - `'strict'`, `{ input: 'strict' }`, or omitted → validate (default).
//?
//? Before this existed, `RuntimeSyncServerEntry.validation` was declared,
//? generated, and documented but never read — both sync handlers always
//? validated, so the documented escape hatch silently did nothing (QUA-044).

import type { RuntimeSyncServerEntry } from './syncTypes';

export const resolveSyncValidationMode = (
  validation: RuntimeSyncServerEntry['validation'],
): 'strict' | 'relaxed' => {
  if (!validation) return 'strict';
  if (typeof validation === 'string') return validation;
  return validation.input === 'skip' ? 'relaxed' : 'strict';
};
