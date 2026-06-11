//? LuckyStack-specific lint contract. Codifies the prose rules in
//? CLAUDE.md (no raw try/catch, no raw fetch, prefer framework
//? components, no arbitrary tailwind colors) into actual eslint rules so
//? `npm run lint` enforces them autonomously.
//?
//? Rule implementations live in `@luckystack/core/src/eslint/` and ship
//? via the `@luckystack/core/eslint` subpath. Package-gated rules (fetch,
//? api-wrappers, sync-wrappers) probe `process.cwd()/node_modules` at
//? config-load time and skip silently when the relevant peer is absent.

import luckystack from '@luckystack/core/eslint';

export default [
  ...luckystack,
  //? Framework-internal overlay. `packages/*/src/` is the IMPLEMENTATION of
  //? the framework primitives (tryCatch itself, raw HTTP parsers, hook
  //? dispatch hot paths) — applying the consumer-app safety rules to the
  //? framework's own source would force pointless workarounds. This override
  //? lives in the luckystack tier (not the official tier) so it's spread
  //? last and actually wins.
  {
    files: ['packages/*/src/**/*.ts'],
    rules: {
      //? `luckystack/no-raw-try-catch` exists to push consumer code toward
      //? the framework helper. Inside the framework the helper IS the code,
      //? and several hot paths (csrf parse, cookies parse, hook dispatch)
      //? deliberately bypass Sentry capture.
      'luckystack/no-raw-try-catch': 'off',
    },
  },
  //? CLI / supervisor tools legitimately call `process.exit()` — the unicorn
  //? rule's own message says "Only use `process.exit()` in CLI apps", so the
  //? rule needs to be turned off where the apps actually live.
  {
    files: [
      'packages/create-luckystack-app/src/**/*.ts',
      'packages/cli/src/**/*.ts',
      'packages/devkit/src/supervisor.ts',
    ],
    rules: {
      'unicorn/no-process-exit': 'off',
    },
  },
];

//? ─────────────────────────────────────────────────────────────────────
//? Customizing rules
//? ─────────────────────────────────────────────────────────────────────
//?
//? Three ways to mute or change a rule, in order of scope:
//?
//? 1) Project-wide — replace `export default luckystack` with the spread
//?    form and append an override block:
//?
//?      export default [
//?        ...luckystack,
//?        {
//?          rules: {
//?            'luckystack/no-arbitrary-tailwind-color': 'off',
//?            'luckystack/prefer-luckystack-dropdown': 'error', // promote
//?          },
//?        },
//?      ];
//?
//? 2) Per-directory — add a glob-scoped block in the top-level
//?    `eslint.config.js` (NOT this file):
//?
//?      { files: ['src/legacy/**'], rules: { 'luckystack/no-raw-try-catch': 'off' } }
//?
//? 3) Inline disable — for a single occurrence with a WHY:
//?
//?      // eslint-disable-next-line luckystack/no-raw-fetch-in-src -- external API probe
//?      const res = await fetch('/api/external/probe');
//?
//? `eslint-comments/no-unused-disable` is `error`, so any disable that
//? stops applying surfaces and gets cleaned up — disables can't rot silently.
