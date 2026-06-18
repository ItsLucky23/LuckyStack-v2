# Branch: main

> Append-only progress log. New entries to the bottom.

## 2026-06-18 — Branch consolidatie: `chore/package-split-prep` + `master` → `main` (nieuwe default)

**Context**: het echte werk van ~april–juni 2026 leefde niet op `master` maar op de feature-branch `chore/package-split-prep`. `master` was de GitHub-default maar liep fors achter. Er bestond daarnaast nog een oude `main` (weer 6 commits achter master). Dit is rechtgetrokken.

**Wat er gebeurd is**:
- **Alle 53 commits van `chore/package-split-prep` (author-dates 2026-04-15 t/m 2026-06-18)** zijn via fast-forward in `main` terechtgekomen — lineair, geen merge-commits, geen conflicten. `main` (`dd1a240`) bevat nu de volledige geschiedenis incl. de v0.2.0-release-voorbereiding.
- `main` is op GitHub als **default branch** gezet.
- `master` (was `2912280`) is verwijderd — lokaal + remote.
- `chore/package-split-prep` (was `dd1a240`) is verwijderd — lokaal + remote, na merge.
- Tag `v0.2.0` wijst naar `dd1a240`.

**Volledige per-prompt historie van dat werk**: zie `branch-logs/chore--package-split-prep.md` (132 entries, 2026-05-20 → 2026-06-18). Dat bestand blijft als archief staan; nieuwe entries komen vanaf nu hier in `main.md`.

**Highlights van wat er in die periode landde** (zie het archief voor details):
- Opsplitsing van de framework-monorepo in 16 `@luckystack/*` packages + `create-luckystack-app`.
- Volledige roadmap-sweep (MEDIUM/LOW/HIGH/refactors), security-hardening, AI-doc/indexing-laag.
- v0.2.0-release-prep: CI build-wave fix (`test-runner` na `login` → TS7016 in verse CI), CI-test-gate van live-server sweep (`npm run test`) naar zelfstandige `npm run test:unit`.

**Open**: v0.2.0 npm-publish via de `publish`-workflow op de tag — eerste run faalde op `ENEEDAUTH` (npm-token); `NPM_TOKEN`-secret toegevoegd, re-run loopt. Uitkomst nog te bevestigen (`npm view @luckystack/core version` → moet `0.2.0`).

**Files**: geen code-wijziging in deze entry — puur git branch-topologie (default-switch + branch-deletes) + dit log.
