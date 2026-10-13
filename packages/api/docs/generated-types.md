# Generated types

Typed route maps bridge consumer route files and client calls. Keep generation as the source of type inference and runtime input schemas; a cast at the call site hides a broken map or unsupported payload and forfeits validation. When inference fails, regenerate the artifacts first, then fix the generator or declaration rather than wrapping calls in `any`/`unknown`. See repository `AGENTS.md`, `../src/_shared/inputTypeWarning.ts`, and generator code in `../../devkit/`.

Runtime validation is a security boundary independent of TypeScript. An intentional skip for a dynamic payload must be explicit and reviewed; it should not become a blanket response to missing generated schemas. Inspect the route declaration, generated schema and `../src/_shared/socketValidationStage.ts` / `httpValidationStage.ts` together.
