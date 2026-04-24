// Entrypoint for `npm run server`. See `packages/devkit/src/supervisor.ts`
// for the implementation. Kept as an import side-effect shim so external
// tooling that still points here (docs, editor launch configs, etc.) keeps
// working.
import '../../packages/devkit/src/supervisor';
