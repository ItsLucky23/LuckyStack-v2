# CLI (`luckystack-validate-deploy` + `validateDeploy`)

> Dev / build-time only. The CLI is the pre-deploy gate that runs against compiled `services.config.js` + `deploy.config.js` artifacts. The validator itself (`validateDeploy`) is a pure function — safe to call directly from a build script without going through the CLI.

`@luckystack/devkit` ships a single bin entry:

```json
{
  "bin": {
    "luckystack-validate-deploy": "./dist/cli/validateDeploy.js"
  }
}
```

The CLI is a thin wrapper around `validateDeploy()` from `src/validateDeploy.ts`. The validator runs nine rules against the project's `services.config` + `deploy.config` snapshots and returns a structured `ValidateDeployResult` with one finding per detected problem.

---

## CLI surface

```
USAGE
  luckystack-validate-deploy --deploy <file> --services <file> [options]

REQUIRED
  --deploy, -d <file>      Path to compiled deploy.config.js (registers DeployConfig).
  --services, -s <file>    Path to compiled services.config.js (registers ServicesConfig).

OPTIONS
  --strict                 Exit 1 on warnings as well as errors.
  --help, -h               Show this help.
```

Argument parsing (`parseArgs(argv)`):

```typescript
interface CliArgs {
  deploy: string | null;
  services: string | null;
  failOnWarning: boolean;
}
```

Both config paths are required. There is no implicit search of the working directory — the CLI demands an explicit path so build pipelines can't accidentally pick up a stale untracked file.

---

## Side-effect import order

```typescript
await importConfig(args.deploy, 'deploy config');
await importConfig(args.services, 'services config');

if (!isDeployConfigRegistered()) {
  // exit 2 with hint
}
if (!isServicesConfigRegistered()) {
  // exit 2 with hint
}
```

The compiled config files are expected to call `registerDeployConfig(...)` / `registerServicesConfig(...)` (re-exported from `@luckystack/core`) as a side effect of import. The CLI imports each file via `pathToFileURL(absolute).href` (Windows-safe), then probes the registry with `isDeployConfigRegistered()` / `isServicesConfigRegistered()`.

If a file imports cleanly but doesn't register, the CLI exits with code 2 and a message:

```
[luckystack-validate-deploy] deploy config file did not call registerDeployConfig — nothing to validate.
```

This is the most common authoring mistake: forgetting the registration call leaves a silent empty registry, which would otherwise pass validation with zero findings.

`importConfig` wraps the dynamic import in a try/catch and re-throws with a clearer message including the absolute path:

```typescript
const importConfig = async (file: string, label: string): Promise<void> => {
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  try {
    await import(pathToFileURL(abs).href);
  } catch (error) {
    throw new Error(`[luckystack-validate-deploy] failed to import ${label} at ${abs}: ${message}`);
  }
};
```

---

## `validateDeploy(input)` — pure validator

Defined in `packages/devkit/src/validateDeploy.ts`. Public types:

```typescript
export type ValidationSeverity = 'error' | 'warning';

export interface ValidationFinding {
  severity: ValidationSeverity;
  code: string;
  message: string;
  /** Human-readable location pointer (e.g. `services.config.ts > presets.api`). */
  location?: string;
}

export interface ValidateDeployInput {
  services: ServicesConfigShape;
  deploy: DeployConfigShape;
  env?: Record<string, string | undefined>; // defaults to process.env
}

export interface ValidateDeployResult {
  ok: boolean;
  findings: ValidationFinding[];
  errorCount: number;
  warningCount: number;
}

export const validateDeploy = ({ services, deploy, env = process.env }: ValidateDeployInput): ValidateDeployResult;
```

`ServicesConfigShape` / `DeployConfigShape` are re-exported from `@luckystack/core` and define the canonical shape of the two config files. The validator never reads from disk — it works exclusively from the in-memory snapshots passed in.

### Rules

| # | Rule | Code | Severity |
|---|---|---|---|
| 1 | Every service is assigned to exactly one preset | `service-unassigned`, `service-in-multiple-presets` | error |
| 2 | Every preset references services that exist | `preset-references-unknown-service` | error |
| 3 | Every environment binding's service matches an actual service | `binding-references-unknown-service` | error |
| 4 | Every environment's redis/mongo resource keys exist | `unknown-redis-resource`, `unknown-mongo-resource` | error |
| 5 | Fallback envs must share the same redis/mongo resource keys (shared-resource invariant) | `unknown-fallback-env`, `fallback-redis-mismatch`, `fallback-mongo-mismatch` | error |
| 6 | `urlEnvKey` values resolve at config time | `missing-resource-env-var` | warning |
| 7 | `synchronizedEnvKeys` values resolve at config time | `missing-synchronized-env-var` | warning |
| 8 | Services bound in no environment | `service-bound-in-no-environment` | warning |

Each rule pushes one or more `ValidationFinding` records into a single result array; the validator never throws. The CLI iterates findings and prints each one before deciding the exit code.

### Findings output

```typescript
const printFinding = (finding: ValidationFinding): void => {
  const tag = finding.severity === 'error'
    ? `<red bold>ERROR</red>`
    : `<yellow bold>WARN </yellow>`;
  const code = `<dim>[${finding.code}]</dim>`;
  const location = finding.location ? `\n  <dim>at ${finding.location}</dim>` : '';
  const sink = finding.severity === 'error' ? process.stderr : process.stdout;
  sink.write(`${tag} ${code} ${finding.message}${location}\n`);
};
```

- Errors go to stderr, warnings to stdout — so CI pipelines that only mirror stderr see failures cleanly.
- ANSI color is only applied when stdout is a TTY (`process.stdout.isTTY`). Piping the CLI through `tee`, redirecting to a file, or running under non-TTY CI yields plain text.
- The trailing summary line is the same as a single finding: `OK — 0 error(s), 2 warning(s)` (green) or `FAILED — 1 error(s), 0 warning(s)` (red).

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No errors. Warnings are allowed unless `--strict`. |
| `1` | At least one error finding, OR `--strict` with at least one warning. |
| `2` | Bad CLI usage: missing required flag, failed import, or config file didn't call its register function. |

Designed to be a pre-deploy gate — the recommended placement is the last step of `npm run build` or a dedicated CI job after `tsc -p tsconfig.build.json`.

---

## Calling from a build script

```typescript
import { validateDeploy } from '@luckystack/devkit';
import { getServicesConfig, getDeployConfig } from '@luckystack/core';

await import('./services.config');
await import('./deploy.config');

const result = validateDeploy({
  services: getServicesConfig(),
  deploy: getDeployConfig(),
});

if (!result.ok) {
  for (const finding of result.findings) {
    console.error(finding);
  }
  process.exit(1);
}
```

`validateDeploy` is pure and has no I/O. Pass a `env` fixture in tests:

```typescript
const result = validateDeploy({
  services: testServices,
  deploy: testDeploy,
  env: {
    REDIS_URL: 'redis://localhost:6379',
    // MONGO_URL deliberately absent to trigger the warning
  },
});

expect(result.findings.map(f => f.code)).toContain('missing-resource-env-var');
```

The CLI is sugar; library consumers should reach for `validateDeploy` directly and decide their own exit behavior.

---

## Failure modes

| Symptom | Cause | Exit code |
|---|---|---|
| `--deploy and --services are required.` | Missing required flag | 2 |
| `failed to import deploy config at <path>: ...` | The file path is wrong, throws on evaluation, or is missing | 2 |
| `... did not call registerDeployConfig — nothing to validate` | Import succeeded but the consumer forgot the registration call | 2 |
| `ERROR [service-unassigned] ...` | A service in `services.services` isn't in any preset | 1 |
| `ERROR [preset-references-unknown-service] ...` | A preset references a service that doesn't exist | 1 |
| `ERROR [fallback-redis-mismatch] ...` | Two envs in a fallback chain reference different redis resource keys | 1 |
| `WARN [missing-resource-env-var] ...` | A resource's `urlEnvKey` is unset at config time (boot may still succeed if env is set at runtime) | 0 (1 with `--strict`) |
| `FAILED — N error(s)` | Run had at least one error finding | 1 |
| `OK — 0 error(s), N warning(s)` | No errors; warnings tolerated | 0 |

---

## Public exports

Re-exported from `@luckystack/devkit`:

```typescript
export { validateDeploy } from './validateDeploy';
export type {
  ValidateDeployInput,
  ValidateDeployResult,
  ValidationFinding,
  ValidationSeverity,
} from './validateDeploy';
```

Core registry probes used by the CLI live in `@luckystack/core`:

- `getServicesConfig()` / `isServicesConfigRegistered()`
- `getDeployConfig()` / `isDeployConfigRegistered()`

These are not re-exported by devkit; consumers calling `validateDeploy` from build scripts should import them directly from core.
