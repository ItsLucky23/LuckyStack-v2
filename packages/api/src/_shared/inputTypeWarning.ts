import { getProjectConfig, getLogger } from '@luckystack/core';

//? Dev-only one-shot warning when a route has no generated `inputType`
//? (runtime Zod input validation is effectively disabled for it). Shared by
//? both API transports so the "warned once per route" set is process-wide
//? regardless of which transport hit the route first.

const warnedMissingInputType = new Set<string>();

export const warnIfInputTypeMissing = (resolvedName: string, inputType: string | undefined): void => {
  if (!getProjectConfig().dev.warnOnMissingInputType) return;
  if (inputType && inputType.trim().length > 0 && inputType.trim() !== 'any') return;
  if (warnedMissingInputType.has(resolvedName)) return;
  warnedMissingInputType.add(resolvedName);
  getLogger().warn(`api: route ${resolvedName} has no inputType — runtime input validation is disabled. Regenerate types or set the inputType on the handler.`);
};
