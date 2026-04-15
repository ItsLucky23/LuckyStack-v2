# Packaging Architecture

> Goal: split framework capabilities into npm packages while keeping existing runtime behavior stable during migration.

---

## Core Direction

The framework should become configurable for most use cases without requiring direct edits to core runtime files.

Primary targets:

- Config-first defaults instead of hardcoded literals.
- Explicit extension points via pre/post lifecycle hooks.
- Stable typed contracts for package modules.
- Backward compatibility during migration.

---

## Branch Strategy

- Keep package-split refactors on a dedicated branch (`chore/package-split-prep` or feature branches off it).
- Keep `master`/`main` behavior unchanged until migration milestones are validated.
- Prefer mechanical, non-breaking extractions first (constants/config/docs), then introduce hook runners.

---

## Configuration-First Contract

Move assumptions into config modules before package extraction.

Examples already centralized:

- Route naming conventions (`server/dev/routeConventions.ts`)
- Server runtime defaults (`server/config/runtimeConfig.ts`)

Target categories to centralize next:

- Socket event names and transport-level conventions
- Auth/session cookie/header names and policy toggles
- Feature module defaults (enabled flags, execution order, optional capabilities)

---

## Hook Model for Package Flexibility

Introduce lifecycle events around core actions to support package-based customization.

### Hook Stages

- `pre:*` hooks: validate/transform/abort before core action.
- `post:*` hooks: augment side effects after successful action.

### Candidate Actions

- Authentication: login/register/oauth callback/session refresh/logout
- API request lifecycle: validate/auth/execute/respond
- Sync lifecycle: validate/authorize/emit/per-target handling
- Client UI lifecycle: route change/session update/socket reconnect

### Hook Semantics

- Deterministic ordering
- Typed payload contracts
- Optional short-circuit in `pre:*` hooks
- Isolated error handling per hook

---

## Migration Phases

1. Centralize constants and defaults into config modules.
2. Define typed hook contracts with no-op runner.
3. Wrap one vertical flow (login) with pre/post hooks behind defaults.
4. Extract first module package using hook contract.
5. Expand to API/sync flows and stabilize package boundaries.

---

## Non-Breaking Rule

During prep phase, changes must preserve current runtime behavior:

- No route shape changes
- No payload contract changes
- No required config additions for existing apps
- No mandatory package installation for current functionality

New capabilities should default to disabled or no-op behavior.
