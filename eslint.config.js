//? Entry point for `eslint`. Spreads the two tiers — official plugins +
//? LuckyStack framework rules — so they can be edited and overridden
//? independently. See `eslint.official.config.js` and
//? `eslint.luckystack.config.js`.

import official from './eslint.official.config.js'
import luckystack from './eslint.luckystack.config.js'

export default [
  ...official,
  ...luckystack,
  //? `workspaces-handoff/**` is a self-contained drop-in handoff package for the separate
  //? Workspaces project (portable TSX prototype + docs + the ui-builder reference). It is
  //? NOT part of this repo's build/lint surface and is slated for removal — ignore it wholesale.
  { ignores: ['workspaces-handoff/**'] },
  //? @luckystack/mcp imports the official MCP SDK via its `.js` subpaths
  //? (`@modelcontextprotocol/sdk/server/mcp.js`). The SDK's `exports` types
  //? wildcard is `./dist/esm/*.d.ts`, so a `*.js` import maps types to a
  //? non-existent `*.js.d.ts` — tsc (bundler resolution) and Node both resolve
  //? it fine (the package builds + the server runs), but eslint-import-resolver
  //? -typescript can't follow that one mapping. Scope the no-unresolved
  //? exception to this dependency only; everything else stays strictly checked.
  {
    files: ['packages/mcp/src/**/*.ts'],
    rules: {
      'import-x/no-unresolved': ['error', { ignore: ['^@modelcontextprotocol/sdk/'] }],
    },
  },
]
//npx eslint src/**/*.tsx

