//? Rule: forbid raw `try { … } catch` inside src/server/shared code.
//? The framework provides `tryCatch` from @luckystack/core (and the API/sync
//? handler `functions.tryCatch` injection) that handles Sentry capture +
//? normalised tuple returns. Raw try/catch bypasses that.

import type { EslintRule } from '../internal/ruleTypes.js';

const rule: EslintRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw `try { … } catch` blocks — use the framework `tryCatch` helper instead.',
    },
    messages: {
      useTryCatch:
        'Do not use raw try/catch. Import `tryCatch` from `@luckystack/core` (client) or `server/functions/tryCatch` (server), or use the injected `functions.tryCatch` in API / sync handlers.',
    },
    schema: [],
  },
  create(context) {
    return {
      TryStatement(node) {
        //? Only fire when an actual catch clause is present. `try { } finally { }`
        //? is a different construct (cleanup, not error handling) and the
        //? `tryCatch` helper is not a substitute.
        if (node.handler) {
          context.report({ node, messageId: 'useTryCatch' });
        }
      },
    };
  },
};

export default rule;
