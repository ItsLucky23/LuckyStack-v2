# Skill: add-new-page

Create a page for an agreed user purpose; do not guess routing or template behaviour from copied examples.

## Procedure

1. Query routes, reusable UI and a similar page. Confirm the new page's audience and URL intent when ambiguous.
2. Use current page scaffolding/routing validation and read the application's actual template union. A doc's old template list is not authority to invent a selection.
3. Add a short `//? intent:` explaining the page's purpose. Follow translator, theme and JSX rules in `AGENTS.md`.
4. Decide navigation guards deliberately. Page guards are a usability layer, not server authorization; protected operations still need independent server enforcement.
5. Test allowed and denied navigation and the relevant business flow. Use generated types for route calls; do not add unsafe casts while waiting for generation.
6. Refresh context at completion and run the feature-boundary gate. Report the actual route, acceptance checks and any required developer action.

Read `docs/ARCHITECTURE_ROUTING.md` for design constraints (consumer copy under `docs/luckystack/`); consult source/types for the current guard result contract.
