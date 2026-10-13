# Upgrading LuckyStack

## Why an upgrade needs separate steps

Dependencies, editable framework-authored app files, application schemas and real secrets have different owners. Treating an upgrade as a blanket overwrite would erase product changes or migrate data without approval.

Do not silently enable new features. Explain relevant security additions and breaking changes, then obtain the developer's choices.

## Upgrade procedure

1. Determine the installed and target versions from package metadata. Read the intervening package changelogs; if the installed copies do not include the target, obtain the target changelogs before claiming to know the gap. Keep the installed LuckyStack package set on a coherent release.
2. With approval, update dependency versions and install using the project's recorded package manager. Dependency installation delivers library code, not every framework-authored file in the application.
3. Read the target package `AGENTS.md` and relevant source/types for constraints. Older releases may still carry the previous instruction filename; do not discard local rules during that transition.
4. Refresh framework-authored files:

   ```sh
   npx luckystack update
   npx luckystack update --app
   ```

   Review the update report and proposed replacements. Use the broader app scope only when those changes are intended.
5. Merge replacement content while preserving consumer changes. A `.new` sidecar contains replacement content; a `.removed` marker is only a retirement notice, **never content to merge into a file**. Inspect all retired files and their references, propose removal in one batch, and wait for approval.
6. Adopt only the optional features the user selected. Use the CLI for new packages; separately review configuration, schema and secret prerequisites for features within an already-installed package. Never infer migration permission from an upgrade request.
7. Regenerate artifacts and run the project's lint, build and unit-test gates. Verify changed flows, including failure/denial behaviour, in an authorized test environment.

## Preserve ownership

- Keep real secrets and database schemas out of automated replacement decisions.
- A project with no trustworthy scaffold baseline requires manual review of proposed files, not guessed ownership.
- Use `.luckystackignore` for framework files the project deliberately refuses. Deleting a local copy alone is not a durable opt-out: the next update may propose it again.
- During the `AGENTS.md` transition, merge developer-specific rules from old instruction files into the canonical file before approving their removal. Do not automatically erase a customized legacy file.
- Changelog gaps are missing evidence. Consult target source/tests and established rationale; do not reconstruct defaults from stale config tables or promise an upgrade is non-breaking.

See [ARCHITECTURE_PACKAGING.md](ARCHITECTURE_PACKAGING.md) for the ownership rationale and the installed CLI's command help for current options.
