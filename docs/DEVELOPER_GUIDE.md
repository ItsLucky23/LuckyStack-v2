# Developer Guide

## Choose the right starting point

For an application, use `npx create-luckystack-app my-app` and follow its generated README. Clone this monorepo only to contribute to the framework. The reference app is a test surface, not an application's starting architecture.

## Contributor setup

```sh
npm install
cp .env_template .env
cp .env.local_template .env.local
npm run build
```

Review the templates and configuration before starting. Public configuration and secret values have different ownership: real credentials stay outside Git.

Start the backend and frontend in separate terminals:

```sh
npm run server
npm run client
```

Use the actual startup URLs. Consult `config.ports.ts` and the server command's help when selecting a port or preset; do not add another port source in environment files.

## Work against the authoritative source

Use generated route types and the existing scaffolding tools instead of copying examples from prose. Consult `package.json`/command help for available scripts and source/types for exact contracts. Regenerate artifacts before diagnosing a type-map failure; bypassing generation with casts hides a broken contract.

Query existing helpers, routes and dependencies before creating a parallel implementation. Root `AGENTS.md` gives the context lookup and verification policy.

## Verify at the boundary

Run the narrow affected test during iteration. At completion:

```sh
npm run lint
npm run build
npm run test:unit
```

When delivery changes, also verify the actual packaged/scaffolded project. A workspace build can succeed while npm users receive missing files or stale instructions. Live tests must use an explicitly selected disposable environment, never shared data by assumption.

Architecture docs explain constraints and trade-offs; the code and tests describe execution. Record significant decisions at wrap-up, not every intermediate idea.
