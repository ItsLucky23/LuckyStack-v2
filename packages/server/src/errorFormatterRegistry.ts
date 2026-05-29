//? Backward-compatibility re-export. The error-formatter registry moved
//? to @luckystack/core so transport handlers in @luckystack/api and
//? @luckystack/sync can dispatch per-route + global formatters without
//? depending on this server package (which would cycle). Consumers'
//? existing `import { registerErrorFormatter } from '@luckystack/server'`
//? continues to resolve through this shim.

export {
  registerErrorFormatter,
  getErrorFormatter,
  applyErrorFormatter,
} from '@luckystack/core';
export type { ErrorFormatter, ErrorFormatterContext } from '@luckystack/core';
