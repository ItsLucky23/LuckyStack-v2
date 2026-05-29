# AI Boost — One-page Overview

> Last reviewed: 2026-05-27

Catalog of every AI-tooling surface LuckyStack ships, organized so consumers, contributors, and AI agents can find the right artifact for the right question without piecing it together from scratch. Each row points to the canonical file or pattern; the per-category paragraphs below explain when each one fires and what command (if any) refreshes it.

This is a *map*, not the docs themselves. Follow the links to the artifact you actually need.

---

## Quick lookup

| Category | Where to look | What it gives AI |
|---|---|---|
| Auto-generated framework index | `docs/AI_QUICK_INDEX.md` | Framework surfaces, packages, slash commands, skills |
| Auto-generated capabilities | `docs/AI_CAPABILITIES.md` | Installed `@luckystack/*` packages + flat local exports with signatures |
| Auto-generated project index | `docs/AI_PROJECT_INDEX.md` | Routes, pages, helpers, components, cross-refs in the consumer project |
| Per-package contracts | `node_modules/@luckystack/*/CLAUDE.md` | Function INDEX + when-to-use per framework package (14 packages) |
| Architecture deep-dives | `docs/ARCHITECTURE_*.md` | 12 per-topic specs (API, AUTH, SESSION, SOCKET, SYNC, ROUTING, LOGGING, EMAIL, PACKAGING, FUNCTION_INJECTION, EXTENSION_POINTS, TESTING) |
| AI behavior contract | `CLAUDE.md` (repo root) | 26 rules + inherited patterns (component table, color tokens, provider hierarchy, JSX micro-conventions) |
| Branch logs | `branch-logs/*.md` + `branch-logs/INDEX.md` | Cross-session work history; AI-readable progress per branch |
| Slash commands | `.claude/commands/*.md` | Workflow shortcuts (`/save_handoff`, `/review_branch`, `/parallel_review`, etc.) |
| Custom audit skills | `skills/custom/audit-*/SKILL.md` | Codebase consistency checks (page middleware coverage, invalid placements, rate limits, error codes, sync pairing) |
| Template injection | (automatic) `_api/`, `_sync/`, `page.tsx` | Empty files get starter content + framework conventions auto-injected on save |
| JSDoc `@docs` tags | (in route files, parsed by devkit) | `owner` / `tags` / `deprecated` metadata surfaced in apiDocs UI + `AI_PROJECT_INDEX.md` |
| Type generation | `src/_sockets/apiTypes.generated.ts`, `apiInputSchemas.generated.ts`, `apiDocs.generated.json` | Exact input/output typing per route, Zod schemas, docs JSON |
| Optional upgrade path | `docs/GRAPHIFY_INTEGRATION.md` | Graphify (Python tool) for call-graph + community detection + MCP server mode |

---

## The three regen commands every AI session should know

```sh
npm run ai:index           # framework surfaces        → docs/AI_QUICK_INDEX.md
npm run ai:capabilities    # installed packages + exports → docs/AI_CAPABILITIES.md
npm run ai:project-index   # consumer project structure   → docs/AI_PROJECT_INDEX.md
```

All three are autonomous per root `CLAUDE.md` rule 8 (no permission prompt). `.githooks/pre-commit` re-runs them on every commit as a safety net, but AI agents should refresh in-session after relevant changes (per rules 12 and 15) so subsequent work in the same session sees the new state. The hook is the safety net, not the primary path.

---

## Per-category detail

### Auto-generated indexes (three files, deterministic, all committed)

`AI_QUICK_INDEX.md` covers the framework itself: root CLAUDE.md H2 sections, every `@luckystack/*` package's `CLAUDE.md` function INDEX, every `ARCHITECTURE_*.md`'s first-line summary, slash commands, and skills. Regen via `npm run ai:index`.

`AI_CAPABILITIES.md` covers the consumer's **flat** export universe: installed `@luckystack/*` packages (with one-liner + INDEX link) plus every export from `src/_functions/`, `src/_components/`, `shared/`, `functions/`, and the generated `Functions` injection map. Signatures are regex-extracted (lossy on generics — see the script header). Regen via `npm run ai:capabilities`.

`AI_PROJECT_INDEX.md` covers the consumer's **structural** view: every route (API + sync) with `httpMethod` / `rateLimit` / `auth` / JSDoc `@docs` tags / summary; every page with `template` + `middleware` export presence; helpers + components with summaries; cross-references showing which helper/component is used by which routes/pages, plus unused-export and high-usage lists. Static import analysis only (dynamic imports are NOT counted — explicitly stated in the file's frontmatter). Regen via `npm run ai:project-index`.

### Per-package `CLAUDE.md` (14 packages)

Each `@luckystack/*` package ships a `CLAUDE.md` at its root with: 1-paragraph product description, "When to USE" / "When to NOT" bullets, Function Index table, config keys, peer dependencies, hooks consumed, and related links. Auto-loaded by Claude Code when you `cd` into `node_modules/@luckystack/<pkg>/`. Per-package deep docs live next to it in `docs/<topic>.md`.

### Architecture deep-dives (`docs/ARCHITECTURE_*.md`)

Twelve files covering the system-level patterns that span multiple packages: routing conventions, API/sync request lifecycle, auth flows, session management, socket bootstrap, packaging strategy, function injection, extension points, testing strategy, etc. Hand-curated; updated alongside framework changes.

### AI behavior contract — root `CLAUDE.md`

26 numbered rules covering workflow & communication, autonomy boundaries, code quality, prompt development, parallel agents. Plus inherited patterns (component reference table, Tailwind color tokens from `src/index.css`, provider hierarchy, JSX micro-conventions, Prisma model type convention, error handling via custom `tryCatch`). Auto-loaded by Claude Code at session start.

### Branch logs

`branch-logs/<sanitized-branch>.md` is an append-only progress log. AI logs an entry after every prompt that produces real code or architecture changes (per the protocol). `branch-logs/INDEX.md` indexes every branch's last-updated timestamp + entry count + status. NOT gitignored — the `/review_branch` slash command reads them to compare AI-reported progress against the actual diff. Format spec lives in `docs/BRANCH_LOG_PROTOCOL.md`.

### Slash commands

Live in `.claude/commands/*.md` and ship with the scaffold. Cover session lifecycle (`/save`, `/resume2`, `/save_handoff`, `/load_handoff`), code review (`/review_branch`, `/parallel_review`, `/code-review`), introspection (`/review_memory`, `/log_progress`). Invoked by typing `/<name>` in the prompt.

### Custom audit skills

Five `audit-*` skills in `skills/custom/` scan for framework-coherence violations: page middleware coverage on dashboard routes, invalid page placements, missing rate-limits, error-code coverage, sync server/client pairing. They REPORT + SUGGEST patches; final apply is user-confirmed (no auto-fix).

### Template injection

`@luckystack/devkit`'s template injector watches `src/` and auto-injects starter content into newly-created empty files: `_api/*_v<N>.ts`, `_sync/*_(server|client)_v<N>.ts`, and `page.tsx`. Page files get `dashboard` template when the path contains `admin|dashboard|settings|billing|account|profile`, else `plain`. Files placed inside reserved framework folders get a commented diagnostic block instead — so misplacement is visible at creation time.

### JSDoc `@docs *` tags

Three tags parsed from the top-of-file JSDoc block in route files: `@docs owner <name>`, `@docs tags <comma,list>`, `@docs deprecated [reason]`. Surface in both `apiDocs.generated.json` (rendered in the dev `/_docs` UI) and the `AI_PROJECT_INDEX.md` table. Optional — unknown sub-keys are silently ignored for forward-compat.

### Type generation

The devkit type-map emitter (`npm run generateArtifacts`) walks every `_api/` and `_sync/` file and produces three generated files: `apiTypes.generated.ts` (request/response types per route), `apiInputSchemas.generated.ts` (runtime Zod), and `apiDocs.generated.json` (UI + AI introspection). Files are gitignored — regenerated on dev server start and postinstall.

### Optional upgrade — graphify

`docs/GRAPHIFY_INTEGRATION.md` documents how to add graphify (Python CLI) to a consumer project as the upgrade path beyond `AI_PROJECT_INDEX.md`. Adds call-graph traversal, community detection ("god nodes"), interactive HTML visualization, and MCP-server query mode. Not part of LuckyStack; comparison table in the doc makes the trade-offs explicit.

---

## Where to start, by persona

**New consumer dev (first day on a LuckyStack project):**

1. Read root `CLAUDE.md` — the framework's behavior contract.
2. Skim `docs/DEVELOPER_GUIDE.md` for the getting-started flow.
3. Open `docs/AI_PROJECT_INDEX.md` to see what already exists in this project.

**New AI agent session:**

1. Root `CLAUDE.md` is auto-loaded; rules 1-26 apply.
2. Before creating a new route or page, check `docs/AI_PROJECT_INDEX.md` (rule 12).
3. Before writing a new helper/util, check `docs/AI_CAPABILITIES.md` (rule 12).
4. After adding/removing routes/pages/helpers, run `npm run ai:project-index` autonomously (rule 12).

**Onboarding a new contributor to the framework itself:**

1. `docs/AGENT_TEAM_PLAYBOOK.md` — multi-agent workflow conventions.
2. `docs/BRANCH_LOG_PROTOCOL.md` — how to log per-branch progress.
3. `docs/PACKAGE_OVERVIEW.md` — per-package use-cases + peer dependencies.

---

## Related

- Multi-agent workflow: [`docs/AGENT_TEAM_PLAYBOOK.md`](./AGENT_TEAM_PLAYBOOK.md)
- Branch-log protocol: [`docs/BRANCH_LOG_PROTOCOL.md`](./BRANCH_LOG_PROTOCOL.md)
- Per-package use-cases: [`docs/PACKAGE_OVERVIEW.md`](./PACKAGE_OVERVIEW.md)
- Framework contract: [`CLAUDE.md`](../CLAUDE.md)
- Optional graphify upgrade path: [`docs/GRAPHIFY_INTEGRATION.md`](./GRAPHIFY_INTEGRATION.md)
