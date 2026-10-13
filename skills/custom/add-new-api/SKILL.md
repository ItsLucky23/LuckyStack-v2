# Skill: add-new-api

Create an API for a requested business capability without maintaining a second route template in prose.

## Procedure

1. Query existing routes/helpers first. Extend an existing capability when appropriate; inspect relevant source and generated types before adding a route.
2. Confirm input, output, authorization/ownership and abuse limits with the user when ambiguous. Public access or unlimited writes need a deliberate reason, not a copied default.
3. Use the current scaffold/template and routing rules from the installed devkit. Read sibling handlers for the application's conventions; do not copy signatures, export names or defaults from old documentation.
4. Use generated route/version typing and injected functions. On inference failure regenerate artifacts, then fix generation instead of adding casts or unsafe wrappers.
5. Scaffold the route's business test and implement a happy path plus meaningful denial/failure assertions. Mechanical sweeping cannot prove business postconditions.
6. Run the narrow test while iterating. At the feature boundary refresh context and run the gate in `AGENTS.md`; report the route and observable acceptance checks.

Keep implementation details in code. Architecture context lives in `docs/ARCHITECTURE_API.md` and `docs/ARCHITECTURE_ROUTING.md` (consumer copies under `docs/luckystack/`).
