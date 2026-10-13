# LuckyStack — AI Development Contract

> Canonical project instructions for every AI agent. `AGENTS.md` is the source, not a generated copy.

## Purpose and boundaries

LuckyStack is a socket-first fullstack framework. Framework packages must remain reusable without assuming an application's database, routes or deployment.

<!-- framework-only -->
This repository also contains a reference app used to exercise the framework; it is not a consumer product.
<!-- /framework-only -->

- Consumer code should be minimal and specific to the requested feature.
- Framework code should preserve reusable contracts and explicit extension boundaries.
- Package `AGENTS.md` files explain design constraints. Types, exports, defaults and execution details are authoritative in source, not in hand-maintained documentation.
- Local, uncommitted project instructions belong in `AGENTS.local.md`. Never commit credentials or machine-specific setup. Keep tool-specific settings in the location that tool actually supports; a shared instruction filename does not change a tool's settings format.

## Core rules

### Workflow and communication (1–7)

1. Plan medium/high difficulty work as verifiable goals. A bug fix needs a regression test; a new feature needs observable acceptance criteria.
2. Be concise and reply in the language of the user's latest message. Code and literal identifiers keep their original language.
3. Ask focused questions when materially different interpretations exist. Surface conflicts with established contracts before deviating: explain the reason behind the existing choice, the proposed trade-off and your recommendation. Do not silently treat a proposal as an accepted decision.
4. Suggest a recap or fresh session when context is becoming unreliable. Preserve continuity before handing work over.
5. After a change, state required developer actions and restart requirements.
6. Tell the user what to test and what observable difference to expect.
7. In application code, implement only what was requested. In framework packages, protect generic contracts without speculative abstractions. Keep unrelated refactors out of the diff.

### Authority and commands (8–10)

8. Autonomous: read-only Git/file inspection, lint, build, unit tests, `ai:*` checks and artifact refresh, test scaffolding, `git add` and `git commit`. Ask before dependency installation, schema migration, server startup, file deletion, force-push or branch deletion, unless the user explicitly authorized that action. Follow local instructions for disposable development environments; shared/staging/production data requires its own authorization.
9. Mutate files with Edit/Write tools, not ad-hoc replacement scripts. Renames use normal file/Git operations.
10. Documentation belongs in `docs/` or beside the package/tool it governs. Do not add loose scratch reports in the repository root.

### Verification and reuse (11–14)

11. Verify at the feature boundary, not after every edit.
    - During implementation, run the narrowest test/typecheck that can expose the changed contract.
    - Before declaring a feature complete or committing it, run `npm run lint && npm run build && npm run test:unit`. Report actual failures and skipped stages; never label a skipped check successful.
    - Documentation-only changes need no compilation while iterating. Delivery/generator changes do need tests, including the consumer boundary.
    - `npm run ai:lint` is report-only unless opted into blocking. Fix a finding or explain a deliberate exception with the supported `luckystack-allow` comment; do not weaken tests to get green.
12. Before adding helpers, components, routes or cross-cutting capabilities, query the existing surfaces.
    - Use `get_capability` and `find_route`; use generated indexes as a searched fallback when tools are unavailable.
    - Check `docs/PACKAGE_OVERVIEW.md` before hand-rolling a capability an optional package could own. Propose an uninstalled package and wait for approval rather than implementing its job twice.
    - Run `npm run ai:refresh` at the feature boundary when routes, pages, helpers, exports or packages changed. Generated indexes are a local cache, not committed documentation. A changed installed-package set requires dependency installation before capability scans can be authoritative.
13. User-facing text uses the project's translator. Do not introduce untranslated JSX.
14. Tailwind colours come from the project's `src/index.css` theme, not arbitrary values. Consult that source for the vocabulary.

### Documentation and safety (15–21)

15. Hand-written documentation explains **purpose, design rationale, rejected alternatives, invariants and consequences**. The code explains how the implementation works.
    - Remove function/export inventories, copied signatures/defaults/configuration, directory tours, step-by-step execution descriptions and conditional-behaviour tables. Do not replace them with another paraphrase.
    - A short source pointer is preferable to copying a code fact. A closed vocabulary may be listed only when needed to make a correct decision, with its authoritative source.
    - Keep minimal usable installation, upgrade and safety instructions. These are operator actions, not duplicate descriptions of implementation internals.
    - Keep non-obvious rationale beside the code in a short comment when local context is enough. Do not explain obvious statements or move whole manuals into comments.
    - Do not invent historical reasons. Preserve established rationale; flag a missing reason rather than fabricating it.
    - Update a hand-written doc when a change contradicts its rationale or contract, not after every code edit. Never maintain a hand-written Function Index; use source/types and generated capability queries.
    - Product intent belongs in `docs/PRODUCT.md` and a short `//? intent:` on pages. It describes who the app/page is for, not an implementation inventory. Offer a focused interview before backfilling unknown intent.
16. At session start read `config.ts` and `.env`. **Never read `.env.local` or other real-secret files** unless a local rule explicitly authorizes a narrower exception. Never print passwords or full connection URLs.
17. Add new environment keys to the public/secret templates; the developer supplies real secrets outside Git.
18. Suggest extraction for genuinely repeating patterns. Do not create a parallel abstraction when a helper already exists.
19. Security is the first priority. Page guards improve navigation but do not replace server-side authorization. A room address is not authorization. Preserve transport-equivalent auth, CSRF and proxy-trust boundaries.
20. Re-read your own diff on larger changes. Independently verify high-risk changes before declaring them complete. Report unrelated problems without silently fixing them.
21. Respect generated route types and function injection.
    - First regenerate artifacts when typed API/sync calls fail. If generation is wrong, fix the generator, not the call with an unsafe cast/wrapper.
    - No `as any`, double-cast type bypasses or `unsafe*` wrappers around typed API/sync calls.
    - In handlers use injected shared/consumer functions; consult `docs/ARCHITECTURE_FUNCTION_INJECTION.md` for the boundary rationale.
    - Use the project's `tryCatch` helper and inspect its error value. Do not add raw `try/catch` in application code.

### Prompts, delegation and continuity (22–28)

22. Encode generic principles in prompts rather than patching one anecdote.
23. Delegate independent, substantial lanes when that improves coverage or delivery. Direct work is the default for bounded/shared-contract tasks. Never let parallel writers share a working directory.
24. Load only the skill needed for the assigned task. Tool-specific skills and permissions are not replaced by `AGENTS.md`.
25. Before staffing multiple agents, read `docs/AGENT_TEAM_PLAYBOOK.md`. Define ownership, isolation, acceptance evidence and a stop condition. The parent owns integration and final judgment.
26. Use the repository's save-handoff command/skill for durable handoffs; do not invent a second handoff format.
27. Keep changes surgical. Every changed line must trace to the user's request. Clean up only imports/variables orphaned by your change; report unrelated dead code instead of deleting it.
28. Start with the current branch log, then `docs/PROJECT_CONTEXT.md` if present, `config.ts`, `.env` and the generated product overview. If the branch log is empty, label any previous branch context as unverified before using it. Read local rules if present, but not local secrets.

## Query context; do not read every index

Generated artifacts are a rebuildable, ignored cache. Query before opening large files:

| Question | Tool | Searched fallback |
| --- | --- | --- |
| Existing helper/component/export? | `get_capability` | `docs/AI_CAPABILITIES.md` |
| Existing route/page/test coverage? | `find_route` | `docs/AI_PROJECT_INDEX.md` |
| Why this choice? | `list_decisions`, `get_decision`, `decision_for_file` | `docs/AI_DECISIONS_INDEX.md` |
| Previous failed approach? | `find_lesson`, `get_lesson` | `docs/AI_LESSONS_INDEX.md` |
| Change impact? | `blast_radius`, `who_imports`, `who_calls`, `god_nodes` | Never read all of `docs/ai-graph.json` |

- Say once when the query server is unavailable, then grep the appropriate cache. Whole-index reads are for actual whole-inventory questions.
- Rebuild missing caches with `npm run ai:refresh`; do not hand-edit generated output.
- Read architecture docs only for the affected topic. Use package `AGENTS.md` for design constraints: `packages/<name>/AGENTS.md` in this repository, `node_modules/@luckystack/<name>/AGENTS.md` after installation.
- Installed framework architecture/guides live under `docs/luckystack/`; this app's own records and generated caches remain under `docs/`.
- If a substantial existing project lacks decision/lesson memory, offer a one-time history review plus a focused, resumable interview. Act on approval; never fabricate rationale from code alone.

## Session capture

Sparring is write-free. During implementation keep a short in-session capture buffer. Write record layers **once at wrap-up**, before a commit, or when the user requests capture.

| Layer | Record only when | Protocol |
| --- | --- | --- |
| Branch log | Real code or architecture work happened; one entry for the session | `docs/BRANCH_LOG_PROTOCOL.md` |
| Decision (ADR) | A durable choice was implemented or explicitly confirmed, and a genuine alternative rejected | `docs/DECISION_MEMORY_PROTOCOL.md` |
| Lesson | Real effort was spent on a non-obvious, repeatable dead-end | `docs/LESSONS_PROTOCOL.md` |
| Findings | The user requested a scan/audit; track only actionable, triaged claims | `docs/FINDINGS_PROTOCOL.md` |

- Capture is autonomous once the bar is met, not a permission prompt. Discussed-but-unselected options are not separate artifacts.
- Existing changelogs, branch logs, accepted decisions and lessons are history, not current implementation references. Preserve their substance; supersede changed decisions instead of rewriting them.
- Record numbers are identities. Never shift published numbers or reuse them. Run `npm run ai:check-ids -- --backrefs` when records change.
- Do not remove an unresolved finding while cleaning docs. Update its status only with evidence and maintain its ledger/index.
- Every branch-log append requires the corresponding `branch-logs/INDEX.md` update.
- Report captured layers in one closing line.

## Application conventions

- Reuse existing UI primitives, including nested component families and framework exports. Extend rather than duplicating them.
- Page templates must belong to the actual provider's closed union. Do not invent a template name from a doc.
- Prefer generated literal route/version inference to hand-declared output types. Place consumer model aliases in `src/_types/` rather than importing ORM types into components.
- Use self-closing childless JSX, backticks for `className`, and existing project styling conventions.
- New API/sync routes need a scaffolded business-logic test with at least one happy-path assertion; generic contract/fuzz checks cannot prove business postconditions.
- A touched existing route without business-logic tests is a coverage gap to surface, not permission for an unsolicited bulk test rewrite.
- Run the live test sweep at the feature boundary when a healthy dev environment is available. See `docs/ARCHITECTURE_TESTING.md` for why both test layers matter.

## Browser verification

Obtain explicit approval before using a browser tool. Propose the smallest tool for the assertion: `agent-browser` for normal flows, Playwright for cross-browser/mobile or visual judgment, Chrome DevTools for traces/Lighthouse. Preserve test-session state, use a dedicated test account, and never fetch credentials from `.env.local`. See `docs/AI_BROWSER_TESTING.md` for approval and verification policy.

## Upgrades

Follow `docs/UPGRADING.md`. Explain security additions and breaking changes, obtain feature choices, keep dependency versions coherent, preserve consumer edits and manually owned schemas/secrets. Refresh installed code and framework-authored app files as separate actions. `.removed` markers are proposals, never automatic deletion instructions. Do not silently enable a newly available feature.

## User Project Rules

<!-- Consumer-owned rules below this marker are preserved by framework updates. -->

(none yet — add project-specific rules below this line)
