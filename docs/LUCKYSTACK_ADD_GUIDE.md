# Adding a capability to an existing project

## Why installation and adoption are different

Installing a library cannot create the app-owned pages, mounts or configuration that make a feature usable. These files belong to the consumer because they are expected to change with the product; they must not be silently replaced by dependency upgrades.

Prefer the LuckyStack CLI for adding a capability to an existing app:

```sh
npx luckystack list
npx luckystack add <feature>
```

Use `npx luckystack --help` for supported choices and reconfiguration commands. For package purpose, see [PACKAGE_OVERVIEW.md](PACKAGE_OVERVIEW.md). Exact dependencies and environment prerequisites live in installed manifests, templates and package source.

## Adoption checklist

- Review the command's proposed changes before applying them. Preserve consumer edits.
- Supply required credentials through the project's secret mechanism, not committed files.
- Decide your application's authorization policy explicitly. Installing login UI does not secure unrelated pages or server routes.
- Review schema changes yourself. A dependency installation is not authorization to migrate shared data.
- Restart the affected runtime and verify a real feature flow, including its denial/failure case.

Do not repeatedly reinstall a feature to repair an injection that cannot find its target. That can indicate consumer edits or template drift; inspect the reported conflict and source rather than guessing at replacements.

Removal is also an ownership decision. App-owned files may still be referenced or contain product changes; review them before deletion. See [UPGRADING.md](UPGRADING.md) for framework-owned file refreshes.
