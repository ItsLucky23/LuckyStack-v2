# @luckystack/cli — agent guidance

Use this package when an existing LuckyStack project needs an optional feature added after scaffolding. For a new project, use `create-luckystack-app` instead. A plain dependency install cannot inject presence's client mounts or place editable login pages inside the consumer's file-routed source tree; `luckystack add` handles those project-owned changes without overwriting existing customization. See `README.md` for the starting command and the CLI's `--help` for current options.

When upgrading an existing project, use `luckystack update` and review any `.new` sidecars rather than overwriting user edits. Never treat a generated sidecar as authorization to replace a customized file. The source in this package and the scaffold manifest define update behavior; do not maintain a second inventory here.

The environment and translation audits produce reviewable reports; examine findings before modifying application secrets or locale data. Do not paste actual `.env.local` values into issues or reports.
