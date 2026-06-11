# LuckyStack — AI Development Contract

> Canonical AI rules-of-engagement. Read on every prompt by Claude Code. Last updated: 2026-05-20.

---

## Quick Links

| Topic | Framework dev path | Consumer (post-install) path |
|---|---|---|
| Per-package function INDEX | `packages/<name>/CLAUDE.md` | `node_modules/@luckystack/<name>/CLAUDE.md` |
| Per-feature deep dives | `packages/<name>/docs/<topic>.md` | `node_modules/@luckystack/<name>/docs/<topic>.md` |
| Architecture deep dives | `docs/ARCHITECTURE_*.md` | `docs/luckystack/ARCHITECTURE_*.md` |
| Package overview (use-case + peer-deps) | `docs/PACKAGE_OVERVIEW.md` | `docs/luckystack/PACKAGE_OVERVIEW.md` |
| Multi-agent workflow | `docs/AGENT_TEAM_PLAYBOOK.md` | `docs/luckystack/AGENT_TEAM_PLAYBOOK.md` |
| AI quick index (auto-generated) | `docs/AI_QUICK_INDEX.md` | `docs/luckystack/AI_QUICK_INDEX.md` |
| Branch progress logs | `branch-logs/<sanitized-branch>.md` | (same) |
| Slash commands | `.claude/commands/` | (same) |
| Custom skills | `skills/custom/` | (same) |
| Branch log protocol | `docs/BRANCH_LOG_PROTOCOL.md` | `docs/luckystack/BRANCH_LOG_PROTOCOL.md` |

> **For not-yet-installed `@luckystack/*` packages**: check `docs/PACKAGE_OVERVIEW.md` (use-case + peer-deps table) before suggesting an install. Detailed per-package surfaces only become available once the package lands in `node_modules/`.

---

## Project Snapshot

LuckyStack is a socket-first fullstack framework: React 19 frontend on a raw Node.js + Socket.io backend (no Express), with file-based routing for pages, APIs, and real-time sync events. Tech stack: React 19, React Router 7, TailwindCSS 4, Socket.io, Prisma 6.5 (MongoDB / MySQL / PostgreSQL / SQLite), TypeScript 5.7, Vite, Redis. The repo publishes as 14 `@luckystack/*` packages — see `docs/PACKAGE_OVERVIEW.md` for the use-case matrix and peer-dependency map.

---

## Core Rules (28)

### Workflow & Communication (1-7)

1. **Plan first for medium/high difficulty work.** Use tables or bullets, not wall-of-text. Skip planning only for trivial single-file changes.
   - **1a. Transform tasks into verifiable goals.** "Add validation" → "tests for invalid inputs exist + pass". "Fix the bug" → "regression test exists + passes". Plans for multi-step work list verification steps per item, not just steps.
2. **Keep responses short.** No giant recap summaries. A TL;DR is always acceptable as the entire reply.
3. **Ask focused questions when unsure.** Inline in plans when the user is away (use `OPEN VRAAG` sections instead of popups).
   - **3a. When multiple valid interpretations exist, present them — don't pick silently.** Use `AskUserQuestion` when the user is present, or inline `OPEN VRAAG` sections in plans when the user is away. Silently picking one path is the most common AI failure mode.
   - **3b. Flag conflicts between what the user asks and what the docs say — never silently comply, never silently refuse.** When a user's stated preference or request contradicts this `CLAUDE.md`, an `ARCHITECTURE_*.md` doc, or an established convention, surface it: (1) name the contradiction, (2) explain BOTH sides — what the docs say + why, and what the user wants + the tradeoff, (3) state whether YOU would endorse the deviation and your reasoning, (4) ask how to proceed (or, if the user is away, state your default and proceed, logging it as an `OPEN VRAAG`). The user's docs are a contract: deviating is allowed, but only as a conscious decision, never by accident. The same applies in reverse — if the docs themselves look wrong or outdated, say so rather than blindly following them. Related: when the user describes a problem an **uninstalled `@luckystack/*` package** would solve in whole or part, proactively flag that the package exists and why installing it beats hand-rolling (Rule 12 + `docs/PACKAGE_OVERVIEW.md`).
4. **Suggest `/compact`, new chat, or a recap at appropriate moments** when context is getting heavy.
5. **After an update, spell out the developer actions required** (what to run, what to restart, what to verify).
6. **Tell the user what to test and what observable differences to expect** after a change.
7. **Code style depends on which side of the framework boundary you're on:**
   - **7a. In `packages/*` framework code: generic, SOLID, future-proof.** Framework code is reused by every consumer; abstractions earn their keep.
   - **7b. In consumer `src/`, `server/`, `config.ts`: minimum code, nothing speculative.** No features beyond what was asked. No abstractions for single-use code. No "flexibility" or "configurability" that wasn't requested. No error handling for impossible scenarios. If you wrote 200 lines and it could be 50, rewrite it. Senior-engineer sanity check: "would they say this is overcomplicated?"

### Autonomy & Commands (8-10) — HYBRID

8. **Autonomous (no permission needed)**: `npm run lint`, `npm run build`, `npm run ai:index`, `npm run ai:capabilities`, `npm run ai:project-index`, `npm run scaffold:test`, all git read-commands (`status`, `diff`, `log`, `branch`), `git add` + `git commit`, all Grep / Glob / Read.
   **NOT autonomous (always ask)**: `npm install`, `prisma migrate`, server start, `rm`, force-pushes, branch-deletes. Server start is always a developer action.
9. **No ad-hoc string-replacement scripts or regex mutations** outside the Edit / Write tools. Use the proper file-editing tools.
10. **No loose `.md` / `.txt` in repo root.** Documentation lives in `docs/` (which ships via `create-luckystack-app`).

### Code Quality & Framework Rules (11-21)

11. **After every code change: `npm run lint && npm run build` autonomously.** Zero warnings, zero errors before delivery.
12. **Reuse existing helpers in `src/_functions` and components in `src/_components`.** Check `docs/AI_CAPABILITIES.md` (the auto-generated capability snapshot) BEFORE authoring any new helper, util, or cross-cutting module. Check `docs/AI_PROJECT_INDEX.md` (the consumer-project snapshot — routes, pages, helpers, components, cross-refs) BEFORE creating a new route or page, AND when you need to know which existing helpers/components a similar route already imports. If a capability already exists there — use it. If it lives in a not-yet-installed `@luckystack/*` package (see `docs/PACKAGE_OVERVIEW.md`), propose the install instead of reimplementing. After adding ANY new export to `functions/`, `shared/`, `src/_functions/`, `src/_components/`, or after installing/upgrading a `@luckystack/*` package, run `npm run ai:capabilities` autonomously to refresh the snapshot. After adding/removing/renaming a route (`_api/`, `_sync/`), page, helper, or component, also run `npm run ai:project-index` autonomously. The `.githooks/pre-commit` hook regenerates AND `git add`s all three snapshots (`ai:index`, `ai:capabilities`, `ai:project-index`) on every commit, so **the user never has to run these manually** — the AI refreshes in-session (so subsequent work in the same session sees the new state) and the hook is the commit-time backstop. **Exception:** `ai:capabilities` scans `node_modules/@luckystack/*`, so after adding/removing/renaming a `@luckystack/*` package the user must run `npm install` first — until the workspace symlinks are refreshed, both the in-session run and the pre-commit hook regenerate a stale snapshot.
   - **12a. Package-recommendation safety net.** Before you hand-roll any *cross-cutting* capability (auth/session, sockets/realtime, presence/AFK, transactional email, error-tracking, rate-limiting, secret rotation, multi-instance routing, a test harness, browser testing, …), STOP and check `docs/PACKAGE_OVERVIEW.md` for a `@luckystack/*` package that already solves it. If one exists and isn't installed, **propose installing it** — name the package, the one-line reason it beats hand-rolling, and the exact `npm i @luckystack/<pkg>` (+ any env) — and wait for the user before reimplementing. Reimplementing a framework package's job in consumer code is a primary failure mode; the package is battle-tested, typed, and maintained. (This is the proactive half of Rule 3b's uninstalled-package flag.)
13. **i18n is mandatory for user-facing text** via the `useTranslator` pattern from `src/_functions/translator`.
14. **Tailwind colors come ONLY from `src/index.css` `@theme` block.** Never arbitrary hex values.
15. **Update documentation immediately after code changes.** After significant doc updates (new doc file, slash command, skill, package), run `npm run ai:index` autonomously to regenerate `docs/AI_QUICK_INDEX.md`. For route/page/helper/component changes, rule 12 covers the in-session regen of `ai:capabilities` + `ai:project-index`. The `.githooks/pre-commit` hook re-runs all three at commit time as a safety net; refresh in-session anyway so the new state is visible to subsequent work.
16. **At session start: read `config.ts` and `.env`. NEVER read `.env.local`** (contains real secrets).
17. **Update `.env_template` and `.env.local_template` when new env vars are added.** The user updates their own `.env.local`.
18. **Suggest extracting repeating patterns** into a helper, component, or skill.
19. **Security is top priority** unless the user explicitly says otherwise for a given task.
20. **Critical self-review on larger implementations** — re-read your own diff before declaring done.
21. **Respect type generation and template injection.** NEVER write `{} as unknown as TYPE` or `{} as any`. No `unsafe*` wrappers around `apiRequest` / `syncRequest` / `upsertSyncEventCallback`. Treat `src/_sockets/apiTypes.generated.ts` as the source of truth. In API + sync handlers, prefer `functions.tryCatch.tryCatch(...)` and `functions.sleep.sleep(...)` (auto-injected from `shared/`) plus the consumer shims in `functions/` (db, redis, sentry, session, …) over direct package imports. Spec: `docs/ARCHITECTURE_FUNCTION_INJECTION.md`.
   - **NEVER-cast escalation**: when `apiRequest` / `syncRequest` / `upsertSyncEventCallback` typing fails, FIRST run `npm run generateArtifacts`. NEVER cast with `as unknown as TYPE` or `as any`. If the generator output is itself wrong, fix the generator — don't cast around it.

### Prompt Development (22)

22. **Solve edge cases generically inside prompts**, not per-case. Example: rather than patch a specific failure, encode the principle ("AI must always explain why something cannot be done") so the same class of issues is covered.

### Parallel Agents & Handoff (23-26)

23. **Aggressive parallelism is the default.** When two or more research/exploration paths are independent, spawn parallel Agent calls in waves (single message, multiple tool calls). Token cost is not a constraint. Sequential delegation when work is parallel-safe is the failure mode — not over-spawning. See `docs/AGENT_TEAM_PLAYBOOK.md` for orchestration patterns.
24. **Skills folder has two halves**: `skills/official/` (Anthropic-provided) and `skills/custom/` (framework-specific).
25. **Parallel agent playbook lives in `docs/AGENT_TEAM_PLAYBOOK.md`.** Activation happens via slash commands in `.claude/commands/`.
26. **Daily handoff uses `/save_handoff`** (see `.claude/commands/save_handoff.md`). Do not hand-write handoff files — invoke the slash command.

### Surgical Changes & Session Continuity (27-28)

27. **Surgical changes — every changed line traces to the user's request.** Don't "improve" adjacent code, comments, or formatting. Don't refactor things that aren't broken. Match existing style even if you'd do it differently. Mention unrelated dead code — don't delete it (Rule "Report Without Auto-Fixing" covers issues; this rule extends it to code-style drive-bys). Clean up imports/variables your changes orphaned, nothing more.
28. **Session start sequence.** Read in order:
    1. `CLAUDE.md` (this file).
    2. Current branch's `branch-logs/<sanitized>.md` if it exists.
    3. If (2) is empty: `branch-logs/INDEX.md` → most recent previous branch's log. Mark its contents as **"previous context, may not apply here"** and verify before acting on any assumption.
    4. Framework + project context: `docs/PROJECT_CONTEXT.md` (if exists), `docs/ROADMAP.md`, `docs/HOSTING.md`, `docs/PACKAGE_OVERVIEW.md`, `docs/AGENT_TEAM_PLAYBOOK.md`.
    5. `config.ts` + `.env` (NEVER `.env.local`).
    6. Auto-generated indexes: `docs/AI_QUICK_INDEX.md`, `docs/AI_CAPABILITIES.md`, `docs/AI_PROJECT_INDEX.md`.

---

## Branch Log Protocol

AI MUST append an entry to `branch-logs/<sanitized-branch>.md` after every prompt that produces **real code or architecture changes**. Skip for lint-only fixes, typo fixes, or translation-string-only edits. **When in doubt, log.**

**INDEX is mandatory**: every append to a `branch-logs/<branch>.md` file MUST be followed by an update to the corresponding row in `branch-logs/INDEX.md` (`Last updated` timestamp, `Entries` count, and `Status` if changed). Add a new row if none exists. See `docs/BRANCH_LOG_PROTOCOL.md` Section 6.5 for the full rule.

Format spec lives in `docs/BRANCH_LOG_PROTOCOL.md`. Logs are NOT gitignored — the `/review_branch` slash command reads them to compare AI-reported progress against the actual diff.

**Consumer first-session quick-start.** In a freshly-scaffolded project the `branch-logs/` folder ships with only `README.md`. On your first real change: create `branch-logs/<sanitized-current-branch>.md`, append an entry (heading `## YYYY-MM-DD HH:MM — <title>`, then *user prompt* / *what I did* / *files touched* / *notes*), and add the branch's row to `branch-logs/INDEX.md`. The `.githooks/pre-commit` hook does NOT write log entries for you — only the AI does — so make it a habit after every substantive prompt. This is what lets a future AI (or you) resume with full context.

---

## Inherited Patterns (from old `.claude/CLAUDE.md`, user-confirmed)

### Component Reference (`src/_components/`)

Before building any UI primitive, check this table. Extend the existing component or add a prop — never roll a parallel implementation.

| Component / API | Use when… |
|---|---|
| `Dropdown` (`./Dropdown.tsx`) | Single-select picker. Supports search, keyboard nav, sm/md/lg/xl sizes, controlled or uncontrolled. |
| `MultiSelectDropdown` (`./MultiSelectDropdown.tsx`) | Multi-select picker with checkboxes. Same shell + search as `Dropdown`. |
| `MenuHandlerProvider` + `useMenuHandler` (`./MenuHandler.tsx`) | Stack-based modal / sheet system with backdrop, animations, Escape/Enter handling. |
| `menuHandler` (`src/_functions/menuHandler.ts`) | Imperative API to open menus from non-React code. Includes `menuHandler.confirm({ title, content, input? })` returning `Promise<boolean>`. |
| `ConfirmMenu` (`./ConfirmMenu.tsx`) | Renderable confirm form (used inside `menuHandler.confirm`). Render directly only for non-modal confirm forms. |
| `Avatar` (`./Avatar.tsx`) | User avatar with image + first-letter fallback. Reads image-load status from `AvatarProvider`. |
| `Navbar` (`./Navbar.tsx`) | Dashboard sidebar. Pass `items` prop (`NavbarItem[]`, `icon` is a FontAwesome `IconDefinition`) — do not edit the file. |
| `ErrorPage` (`./ErrorPage.tsx`) | React Router error-boundary fallback. Already wired; extend rather than replace. |
| `Middleware` (`./Middleware.tsx`) | Wraps protected pages. Runs the per-page `export const middleware` (from `page.tsx`) first, then falls back to a globally registered handler from `registerMiddlewareHandler`. Per-page is canonical; no central `_functions/middlewareHandler.ts` file is required. Part of the `dashboard` template. |
| `TemplateProvider` (`./TemplateProvider.tsx`) | Selects a template (`'plain'` / `'dashboard'`) per page from its exported `template` const. Add new templates here and to the `Template` union. |

### Tailwind Color Tokens (from `src/index.css`)

- **Surfaces**: `background`, `container1`, `container2` (each with `-hover` and `-border` variants).
- **Text**: `title`, `common`, `muted`, `disabled`.
- **Accent**: `primary` (+ `-hover`, `-border`), `secondary` (+ `-hover`, `-border`).
- **On-accent text**: `title-primary` / `common-primary`, `title-secondary` / `common-secondary`.
- **Semantic**: `correct`, `correct-hover`, `warning`, `warning-hover`, `wrong`, `wrong-hover`.
- **Utility**: `overlay`, `focus-ring`, `divider`.

Each token gets `bg-`, `text-`, `border-` utility variants. Dark mode auto-switches via the `.dark` class on `<html>`.

### API Pattern (full details: `docs/ARCHITECTURE_API.md`)

```typescript
// src/{page}/_api/{name}_v1.ts
export const rateLimit: number | false = 60;
export const method: "GET" | "POST" | "PUT" | "DELETE" = "POST";
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { /* typed input */ };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  return { status: "success", result: { /* data */ } };
};
```

### Sync Pattern (full details: `docs/ARCHITECTURE_SYNC.md`)

- `{name}_server_v{N}.ts` runs ONCE on the server for validation.
- `{name}_client_v{N}.ts` runs on the server for EACH client in the room. Optional — only create it when per-client logic (filtering, per-client auth, custom `clientOutput`) is required. If it would only return `{ status: 'success' }`, do not create it.
- `_client` files do NOT receive `user`; they receive `token` and call `functions.session.getSession(token)` only if session data is actually needed.
- Client sends: `syncRequest({ name, data, receiver: roomCode, ignoreSelf? })`.
- Client receives: `upsertSyncEventCallback(name, ({ clientOutput, serverOutput }) => {})`.

### File-Based Routing (full details: `docs/ARCHITECTURE_ROUTING.md`)

- `src/{page}/page.tsx` → route `/{page}`.
- `src/{page}/_api/{name}_v{N}.ts` → endpoint `api/{page}/{name}/v{N}`.
- `src/{page}/_sync/{name}_server_v{N}.ts` (+ optional `_client_v{N}.ts`) → event `sync/{page}/{name}/v{N}`.
- Folders prefixed with `_` are private (never routed).

### Prisma Model Type Convention

When a Prisma model type is needed in app code, create `src/_types/{ModelName}.ts` that re-exports the Prisma type from `@prisma/client` and extends it when needed. Never import `@prisma/client` types directly into components.

### JSX Micro-Conventions

- Self-closing tags for component without children: `<MyComponent />`, never `<MyComponent></MyComponent>`.
- Use `<div>` for almost everything besides obvious cases (button, input, form). Avoid `<header>` / `<footer>` / `<section>` unless semantically required.
- Always use backticks in `className`: `` className={`...`} ``, never `''` or `""`.

### Error Handling

Always use the custom `tryCatch`:

- **In API / sync handlers**: use the injected `functions.tryCatch.tryCatch(...)` (sourced from `shared/tryCatch.ts` via the function-injection system — spec: `docs/ARCHITECTURE_FUNCTION_INJECTION.md`).
- **Elsewhere (client components, server utilities, scripts)**: `import { tryCatch } from '@luckystack/core'`. Same `[error, result]` tuple shape; the server-side path captures to Sentry via the registered error-tracker.
- Check the first value; if truthy, there's an error. Never use raw `try/catch`.

---

## Inherited Rules (user-confirmed)

### Report Without Auto-Fixing

When analysis surfaces potential mistakes, unhandled errors, or improvement opportunities OUTSIDE the current task scope, **report them — do not fix them**. The user decides what to act on.

### Verify Code Flow Against Docs

Before implementing, check that the code flow matches what `docs/ARCHITECTURE_*.md` describes. If they agree: implement. If they disagree after a careful second read: tell the user so the docs can be corrected — otherwise follow the docs.

### Testing

Two layers, both run by `npm run test` (which invokes the `@luckystack/test-runner` CLI):

- **Auto-sweep** — contract / auth-enforcement / rate-limit / fuzz checks against every endpoint. Walks `apiMethodMap` automatically; no per-route file required.
- **Per-route business-logic tests** — `src/<page>/_api/<name>_v<N>.tests.ts` (and `_sync/<name>_server_v<N>.tests.ts`). Created via `npm run scaffold:test <page>/<name>/<version>` — the stub lists common scenarios as TODO checklist comments. Use these when the sweep can't reach the assertion: post-conditions on hooks, integration with other features, edge-case business logic.

After creating any new API or sync route, run `npm run scaffold:test <route>` autonomously and fill in at least one happy-path test case before declaring done. The auto-sweep already covers basic crash-resistance; your per-route cases should target assertions the sweep can't infer.

Full spec: `docs/ARCHITECTURE_TESTING.md`.

---

## Type Generation & Template Injection Contract

Preferred direction: route literals + generated maps + inferred `serverOutput` / `clientOutput` typing.

```typescript
// Good — typed call with route/version literals
const response = await apiRequest({
  name: "examples/getUserData",
  version: "v1",
  data: { userId: "123" },
});

// Good — typed sync callback payload
upsertSyncEventCallback({
  name: "examples/updateCounter",
  version: "v1",
  callback: ({ serverOutput, clientOutput }) => {
    if (serverOutput.status !== "success") return;
    console.log(serverOutput, clientOutput);
  },
});

// Bad — local unsafe wrapper erases route/version typing
const unsafeApi = async (name: string, version: string, data: unknown): Promise<any> =>
  apiRequest({ name: name as any, version: version as any, data: data as any });
```

**Self-check before finalizing**:

- Did I rely on generated route/version types?
- Did I avoid adding new unsafe wrappers?
- If I used a temporary cast during generation lag, did I re-check and remove it after the type maps refreshed?

If inference fails, fix the typing source or regenerate the maps. Do not paper over with casts.

---

## Templates

Pages export a `template` constant: `'plain'`, `'dashboard'`, or a project-specific addition wired into `TemplateProvider`.

- `plain` — no UI chrome (login, register, docs pages).
- `dashboard` — sidebar navigation + main content area.

---

## Provider Hierarchy

```
SocketStatusProvider > SessionProvider > TranslationProvider > AvatarProvider > MenuHandlerProvider > Router
```

---

## AI Browser Testing

When verifying the frontend in a browser, follow the cheapest-first ladder + suggest→approve protocol — full detail in `docs/AI_BROWSER_TESTING.md` (consumer copy: `docs/luckystack/AI_BROWSER_TESTING.md`). Wired in via `--ai-browser=<all|agent-browser|none>`; dev-tools only.

- **Cheapest-first ladder:** `agent-browser` (CLI) is the default for ~90% — flows, console/errors/network, single-browser screenshot + visual-diff, Web Vitals. Escalate to **Playwright MCP** ONLY for cross-browser / mobile rendering or a vision styling judgement; to **Chrome DevTools MCP** ONLY for Lighthouse / performance traces / Core Web Vitals / deep diagnostics.
- **Never launch a browser tool without proposing it + getting explicit user approval.** Announce *"I want to verify X → cheapest fit = `<tool>` → approve?"*; for an escalation, name the exclusive capability that forces the higher rung. (The harness also hard-gates these via `.claude/settings.json` `permissions.ask`; first MCP use shows a one-time trust prompt.)
- **Server-start is a developer action (Rule 8):** the dev server (`npm run server` + `npm run client`) must be running before any browser test — ask the user to start it.
- **Auth:** use the tool's session/state persistence + a dedicated test account; **never read `.env.local`** (Rule 16).
- After agent-browser confirms a flow, offer to capture it as a deterministic `@playwright/test` spec (keep the LLM out of the permanent CI loop).
- **Complementary skills** GENERATE committed artifacts (vs the interactive tooling above): `/agent-browser` (E2E tests), `/lighthouse` (perf), `/a11y-audit` (axe). `/agent-browser-verify` drives the interactive login-matrix check.

---

## Documentation Reference

| Doc | Purpose |
|---|---|
| `docs/ARCHITECTURE_ROUTING.md` | File-based routing (pages, APIs, syncs) |
| `docs/ARCHITECTURE_API.md` | API request system |
| `docs/ARCHITECTURE_HTTP.md` | HTTP pipeline, custom-route phases, webhook + streaming-upload seam (origin-exempt paths) |
| `docs/ARCHITECTURE_SYNC.md` | Real-time sync events |
| `docs/ARCHITECTURE_AUTH.md` | Authentication flows |
| `docs/ARCHITECTURE_SESSION.md` | Session management |
| `docs/ARCHITECTURE_SOCKET.md` | Socket.io setup |
| `docs/ARCHITECTURE_EMAIL.md` | `@luckystack/email` + login forgot-password |
| `docs/ARCHITECTURE_SECRET_MANAGER.md` | `@luckystack/secret-manager` client + external server contract |
| `docs/ARCHITECTURE_MULTI_TENANCY.md` | Multi-tenant pattern (tenant = Workspace): Prisma `$extends` row isolation + keyed clients + Redis key formatter + per-workspace secrets |
| `docs/ARCHITECTURE_MULTI_INSTANCE.md` | Multi-instance/router model + pitfalls: WS pins to `system`, Redis-adapter cross-instance fan-out, regular `syncRequest` also crosses instances via `io.in(room).fetchSockets()` + `RemoteSocket.emit()` (streaming via `io.to().emit()`), shared-Redis footgun. Symptom→cause→fix table + local test recipe |
| `docs/ARCHITECTURE_PACKAGING.md` | Package split strategy |
| `docs/DEVELOPER_GUIDE.md` | Getting started |
| `docs/HOSTING.md` | Deployment |
| `docs/PACKAGE_OVERVIEW.md` | Per-package use-case + peer-deps table |
| `docs/LUCKYSTACK_ADD_GUIDE.md` | Adding an optional feature later (`npx luckystack add <feature>`): npm-i-vs-add matrix + per-feature checklists + troubleshooting |
| `docs/AGENT_TEAM_PLAYBOOK.md` | Multi-agent workflow |
| `docs/BRANCH_LOG_PROTOCOL.md` | Branch-log entry format |
| `docs/AI_QUICK_INDEX.md` | Auto-generated cross-repo index (framework surfaces) |
| `docs/AI_PROJECT_INDEX.md` | Auto-generated inventory of the consumer project's own code (routes, pages, helpers, components, cross-refs) |
| `docs/AI_BOOST_OVERVIEW.md` | One-page catalog of every AI-tooling surface in LuckyStack |
| `docs/AI_BROWSER_TESTING.md` | AI browser-testing tooling (agent-browser + Playwright/Chrome DevTools MCP): the cheapest-first ladder + suggest→approve protocol |
| `docs/GRAPHIFY_INTEGRATION.md` | Opt-in graphify integration — upgrade path beyond `AI_PROJECT_INDEX.md` for call-graph + community detection + MCP |

---

## User Project Rules

<!--
  This section is reserved for project-specific rules added by consumers of `@luckystack/create-luckystack-app`.
  The scaffold update flow will NOT overwrite content below this comment when pulling future framework updates.
  Add your team's conventions, custom slash-command notes, or per-project policy overrides here.
-->

(none yet — add project-specific rules below this line)
