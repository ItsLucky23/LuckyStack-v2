# Runtime arguments

Explicit runtime arguments let deployment choose bundles and bind port without editing generated source. Validate them before boot rather than continuing with an ambiguous or partial map; fail loudly on invalid input. Source: `../src/argv.ts`, `../src/parseArgv.ts`, `../src/portResolution.ts`.

A selected bundle controls which generated routes load, not who may invoke them. Keep runtime map isolation and application authorization independent. See `./runtime-maps.md`, `../src/verifyBootstrap.ts`; consult source for current argument spelling and precedence.
