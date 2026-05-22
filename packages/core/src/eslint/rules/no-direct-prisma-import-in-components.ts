//? Rule: warn on `import … from '@prisma/client'` outside of allowed
//? boundaries. Convention: app code re-exports Prisma model types through
//? `src/_types/<ModelName>.ts` so swapping providers / extending types
//? stays centralised. Direct imports leak Prisma details into UI code.
//?
//? Allowed paths: `src/_types/**`, `server/**`, and any file ending in
//? `Adapter.ts` (legitimate adapter implementations).

import type { EslintRule } from '../internal/ruleTypes.js';

const isAllowedPath = (filename: string): boolean => {
  const normalised = filename.replaceAll('\\', '/');
  if (normalised.includes('/src/_types/')) return true;
  if (normalised.includes('/server/')) return true;
  if (normalised.endsWith('Adapter.ts') || normalised.endsWith('Adapter.tsx')) return true;
  if (normalised.includes('/packages/')) return true;
  //? Project-root config files (the LuckyStack `config.ts` convention) and
  //? any `*.config.ts` are framework boundaries — Prisma types there are
  //? expected and not a "leaking into component code" concern.
  if (normalised.endsWith('/config.ts') || normalised.endsWith('.config.ts')) return true;
  if (normalised.includes('/prisma/')) return true;
  return false;
};

const rule: EslintRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Re-export Prisma model types through `src/_types/<Model>.ts` rather than importing `@prisma/client` directly in components.',
    },
    messages: {
      reExportThroughTypes:
        'Do not import from `@prisma/client` here. Re-export the type through `src/_types/<ModelName>.ts` and import that instead — keeps Prisma details out of component code.',
    },
    schema: [],
  },
  create(context) {
    if (isAllowedPath(context.filename)) return {};
    return {
      ImportDeclaration(node) {
        if (node.source.value === '@prisma/client') {
          context.report({ node, messageId: 'reExportThroughTypes' });
        }
      },
    };
  },
};

export default rule;
