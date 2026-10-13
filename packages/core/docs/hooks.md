# Hooks

Hooks allow feature packages to observe or veto framework operations without importing each other directly. A stop signal belongs only at documented pre-operation gates; observers must not retroactively cancel completed effects. Hook exceptions are isolated so observability does not take down request processing. See `../src/hooks/registry.ts`, `../src/hooks/types.ts`.

Synchronous mutators exist for hot paths such as response normalization; never register asynchronous work where a result must be available before continuing. Payload augmentation belongs in feature packages and must be included by TypeScript. Upload encoding stays consumer-owned so core need not pull storage/native encoders into every installation; core brackets that work with the upload lifecycle (`../src/processUpload.ts`).
