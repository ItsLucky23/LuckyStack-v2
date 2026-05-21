# Custom Skills

Framework- and project-specific skills authored in this repository.

## Convention

- One folder per skill: `skills/custom/<skill-name>/`
- Each folder MUST contain a `SKILL.md` file with the workflow definition.
- Optional: additional files (templates, code snippets, examples) live in the same skill folder and are referenced from `SKILL.md`.
- Folder names use `lower-kebab-case`.

## Available Skills

| Skill | Purpose |
| --- | --- |
| [`add-new-api/`](./add-new-api/SKILL.md) | Add a new API endpoint under `src/{page}/_api/`. |
| [`add-new-package/`](./add-new-package/SKILL.md) | Scaffold a new `@luckystack/*` package in the monorepo. |
| [`daily-handoff/`](./daily-handoff/SKILL.md) | Produce a structured handoff document when closing a session (slash-command alternative: `/save_handoff`). |

## Authoring Guide

When adding a new skill:

1. Pick a clear, verb-first name: `add-new-<thing>`, `migrate-<x>-to-<y>`, `audit-<area>`.
2. Create the folder and write `SKILL.md` with numbered steps, code-fenced templates, and links to the relevant files in `docs/`.
3. Add a row to the index above.
4. Keep the skill focused on one workflow. If you find yourself adding "alternative paths", split into multiple skills.
