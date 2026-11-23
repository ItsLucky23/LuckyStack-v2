# Branch log — fix/cli-update-unchanged-template

## 2026-11-23 14:30 — `luckystack update` merges the framework's version jump (cli 0.18.0)

**User prompt (summary):** a colleague's complaint: `luckystack update` in Flexbuddy left 99 `.new` copies, because Flexbuddy edits ~100 framework files on purpose and every run writes a `.new` for each, also when the framework changed nothing. First approved: skip a `.new` when the template is unchanged (release 0.17.2). After the measurement the user chose to rethink the `.new` set-up: show only the change between the two versions, apply clean merges, conflicts to a patch file, one release 0.18.0.

**What I did:**
- `update` renders the framework at the version of the last update (base) and the new version, with the recorded choices. For an edited file: base equal to new → `kept`, nothing written; otherwise `git merge-file` (local, base, new): a clean merge is written into the file, a conflict leaves the file alone and only the framework's diff goes into `dump/UPDATE_<from>_to_<to>.patch`. No base render (old version not renderable, no git, no manifest) → the old full `.new` copy, with the reason in the report.
- A file equal to the base render counts as pristine (overwrite), also when the recorded hash is older. Kept, merged and conflicting files move their recorded hash to the new render.
- `resolveCommandPath` in `lib/project.ts` is exported for the new `lib/threeWayMerge.ts`. `update.ts` still has its own copy (pre-existing duplicate, not touched).
- ADR 0090; `UPGRADING.md`, cli `README.md`/`AGENTS.md` and the scaffold `README.md` describe the merge instead of `.new` copies.

**Files touched:** `packages/cli/src/commands/{update.ts,update.test.ts}`, `packages/cli/src/lib/{threeWayMerge.ts,project.ts}`, `packages/cli/{CHANGELOG.md,README.md,AGENTS.md}`, `packages/create-luckystack-app/{CHANGELOG.md,template/README.md}`, `docs/UPGRADING.md`, `docs/decisions/0090-update-merges-the-framework-version-jump.md`.

**Notes / decisions:**
- Measured on scratch copies of Flexbuddy (`git archive HEAD`, the checkout itself only read), `update --app`: the old code wrote 100 `.new` copies (the colleague saw 99). With only the first fix: 70 `.new` + 30 kept. The cause of the other 70: the recorded hash of an edited file never moved (e.g. `generateServerRequests.ts` still pinned to the 2026-07-14 version). With the version-jump merge, 0.16.0 → 0.17.1: 0 `.new`, 1 clean merge (`.mcp.json`, the `@luckystack/mcp` version), 99 kept, 1 added; 3 s with a warm npx cache.
- Tests: kept despite an old recorded hash, clean merge plus an idempotent second run, conflict → patch that `git apply` turns base into new, overwrite when equal to the base; the old sidecar tests now run the fallback (base not renderable).
- Not handled: a CRLF working copy against LF renders conflicts on every line, so the change goes to the patch (safe, not convenient).
