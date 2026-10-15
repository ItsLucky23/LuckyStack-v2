---
name: eslint-10-keeps-the-adopted-unicorn-rule-set
title: Lint on ESLint 10 with the unicorn rules the project had already adopted; plugins that stopped at ESLint 9 are replaced, not pinned
status: accepted
date: 2026-10-15
deciders: [ItsLucky23]
tags: [tooling, lint, eslint, scaffold]
supersedes: []
relates: [0067]
---

## Context

`eslint-plugin-unicorn` 64 was the last release that supports ESLint 9; its
fixes and new rules (including `no-unsafe-string-replacement`) only ship for
ESLint 10. Moving to ESLint 10 also meant three plugins could not follow:
`eslint-plugin-react` and `eslint-plugin-jsx-a11y` stopped at ESLint 9, and
`eslint-plugin-eslint-comments` did nothing under flat config. ESLint 10 needs
Node 22.13, and Node 20 left security support in April 2026.

Between unicorn 64 and 78 its `recommended` preset grew from 137 to 338 rules.
Taken as-is it produced about 4,300 findings in the reference app, most of them
naming (`prevent-abbreviations`-style renames, boolean prefixes) and comment
style, and every upgraded app would inherit the same wall.

## Decision

Lint on ESLint 10 and require Node 22.13. `eslint.official.config.js` enables
only the unicorn rules the project had already adopted (`ADOPTED_UNICORN_RULES`)
plus `no-unsafe-string-replacement`, and turns every other recommended rule off,
so a rule unicorn adds later stays off until someone adopts it. Four earlier rules
that became much stricter (`prefer-ternary`, `prefer-simple-condition-first`,
`prefer-default-parameters`, `prefer-logical-operator-over-ternary`) are left out.
`eslint-plugin-jsx-a11y` is replaced by its maintained fork `eslint-plugin-jsx-a11y-x`;
the one rule taken from `eslint-plugin-react` (`jsx-no-literals`) becomes
`luckystack/no-untranslated-jsx-text` in `@luckystack/core/eslint`; ESLint's own
`reportUnusedDisableDirectives: 'error'` replaces `eslint-comments`.

## Rejected alternatives

- **Stay on ESLint 9 and unicorn 64** — rejected because unicorn's fixes and new
  rules no longer reach ESLint 9, and the toolchain would keep pinning a plugin
  line that is no longer maintained.
- **Adopt unicorn 78's full `recommended` preset** — rejected by the maintainer:
  thousands of renames and comment rewrites carry no defect value, and every
  consumer upgrade would have to repeat them.
- **Keep `eslint-plugin-react` for `jsx-no-literals` through a peer override** —
  rejected because it pins a plugin that declares no ESLint 10 support for one
  rule whose logic is small enough to own, and an override in the scaffold would
  move the same conflict into every consumer's install.

## Consequences

- Consumers update their lint devDependencies by hand and take the new
  `eslint.official.config.js` through `luckystack update`; suppressions for
  `react/jsx-no-literals` and `jsx-a11y/…` need renaming.
- Disables that no longer suppress anything now fail lint. The first run after
  the upgrade may report many; `--fix-type directive` removes them.
- Adopting a further unicorn rule is a deliberate edit to `ADOPTED_UNICORN_RULES`
  plus fixing its findings. Revisit the four left-out rules when someone wants
  them back.
- `@luckystack/core` keeps `eslint` as an optional peer of `^9 || ^10`, so a
  project that has not moved yet still installs.
