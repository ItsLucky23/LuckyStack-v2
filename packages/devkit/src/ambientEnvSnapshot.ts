//? Snapshot of the genuine shell environment, captured at module-eval time
//? BEFORE `@luckystack/core` runs `bootstrapEnv()` (which merges the `.env`
//? files into `process.env` as an import side-effect).
//?
//? This module MUST be imported before `@luckystack/core` in `supervisor.ts`
//? so the snapshot stays free of `.env`-derived values. The supervisor spawns
//? the server child with this snapshot as its `env`, so the child inherits only
//? the real shell vars and runs its own `loadEnvFiles()` fresh on EVERY restart
//? — instead of silently reusing the supervisor's frozen first-boot `.env`
//? snapshot (which made edited `.env` values get ignored until a full restart).
export const ambientEnv: NodeJS.ProcessEnv = { ...process.env };
