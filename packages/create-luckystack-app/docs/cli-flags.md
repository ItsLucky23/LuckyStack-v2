# CLI choices

The wizard exists to make optional integration decisions explicit before source files are copied. Run `npx create-luckystack-app --help` for authoritative flag names, legal values and defaults; `src/` owns validation and cross-field rules. Do not reproduce that matrix in a hand-maintained table.

For unattended scaffolds, choose options deliberately rather than relying on interactive prompts. A data-layer choice can constrain database choices; an OAuth choice needs compatible authentication. A flag you pass explicitly is never dropped silently: when it contradicts another flag, a default or a wizard answer, the scaffolder exits with code 2 before anything is written. Only values left to their default are normalised quietly. Piped answers that run out before every question is asked also fail instead of exiting 0 with nothing written. Use `--no-install` when dependency installation must be done separately; follow generated next steps before starting the app.
