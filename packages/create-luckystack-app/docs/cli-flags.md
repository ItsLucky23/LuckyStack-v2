# CLI choices

The wizard exists to make optional integration decisions explicit before source files are copied. Run `npx create-luckystack-app --help` for authoritative flag names, legal values and defaults; `src/` owns validation and cross-field rules. Do not reproduce that matrix in a hand-maintained table.

For unattended scaffolds, choose options deliberately rather than relying on interactive prompts. A data-layer choice can constrain database choices; an OAuth choice needs compatible authentication. Invalid combinations should fail before a partial project is written. Use `--no-install` when dependency installation must be done separately; follow generated next steps before starting the app.
