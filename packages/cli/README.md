# @luckystack/cli

Add optional features to an **existing** LuckyStack app:

```bash
npx luckystack add <feature>
```

Run `npx luckystack --help` for current features and flags. To audit environment or translation references, run `npx luckystack check-env` or `npx luckystack check-i18n`; review the generated reports before changing secrets or translations. For an existing project's framework-owned copied files, run `npx luckystack update` and inspect `.new` sidecars rather than replacing customizations.

## Why use `add` instead of only installing a dependency?

Backend-only features can register at boot after installation. Presence also needs client mounts that Vite cannot import before a dependency is installed; login needs editable pages inside the project's own file-routed `src/` tree. `add` supplies these source changes without overwriting existing files. For a new project, use `create-luckystack-app` instead.
