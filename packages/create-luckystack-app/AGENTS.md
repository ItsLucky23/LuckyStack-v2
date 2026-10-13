# create-luckystack-app — agent guidance

Use this package to create a new LuckyStack project in a fresh directory, not to overwrite an existing project. For existing projects use `luckystack update` and inspect `.new` sidecars before changing customizations. `README.md` gives the short start and `--help` gives current choices.

Scaffold output is owned by the consumer except for framework-owned copies tracked by the scaffold manifest. Preserve user edits during upgrades. Optional integration choices must not leave imports of uninstalled packages in the generated app. Test both interactive and noninteractive scaffolds when changing selection logic; do not infer behavior from this document instead of the source.

AI instructions in new projects belong in `AGENTS.md`, never `CLAUDE.md`; keep the framework copy and consumer instructions aligned with the project's actual ownership boundary. Sensitive values belong in local secret configuration, not committed templates. Docker documentation copied from CLI assets into the template must remain identical. See `docs/framework-docs-copy.md` for the reason these copies exist.
