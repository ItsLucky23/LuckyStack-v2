//? `luckystack` CLI entry. Commands:
//?
//?   npx luckystack add <feature> [--no-install]   add ONE optional package
//?   npx luckystack add | remove | manage          interactive add/remove wizard
//?   npx luckystack list                           inventory installed vs available
//?   npx luckystack check-env | check-i18n         codebase audits
//?
//? `add` is the INVERSE of create-luckystack-app's optional-package pruner: it
//? installs an optional `@luckystack/*` package AND injects whatever consumer-
//? `src/` assets a plain `npm i` can't (Vite can't statically import an
//? uninstalled package; file-based routing only scans `src/`). Backend-only
//? features just get the dependency + install — they self-wire at boot. `remove`
//? is the inverse of `add` (drop dep + reverse JSX; login removal is guarded).

import { createRequire } from 'node:module';
import { parsePackageVersion, validateProject, type ConsumerProject, type Result } from './lib/project';
import { addPresence, type AddOptions } from './commands/addPresence';
import { addLogin } from './commands/addLogin';
import { addBackendOnly } from './commands/addBackendOnly';
import { checkEnv } from './commands/checkEnv';
import { checkI18n } from './commands/checkI18n';
import { listFeatures, installedRegistryIds } from './commands/list';
import { applyManagePlan, computeManagePlan } from './commands/manage';
import { REGISTRY, findRegistryEntry } from './registry';
import { isInteractive, runCheckbox, type CheckboxItem } from './lib/wizard';

const HELP = `luckystack — LuckyStack project CLI

Usage:
  npx luckystack list
  npx luckystack manage [--no-install]
  npx luckystack add [<feature>] [--no-install]
  npx luckystack remove [<feature>] [--no-install]
  npx luckystack check-env
  npx luckystack check-i18n

Optional packages (add/remove/manage):
${REGISTRY.map((entry) => `  ${entry.id.padEnd(16)}${entry.description}`).join('\n')}

list              Show which optional packages are installed vs available.
manage            Interactive checkbox wizard to add/remove packages at once.
                  Bare \`add\` / \`remove\` (no feature) opens the same wizard.
add <feature>     Install one optional package + inject its consumer-src assets.
remove <feature>  Drop one optional package (reverses add; login removal is guarded).

check-env         Scan for .env keys unused in code + env vars used but undefined.
check-i18n        Scan for translation keys unused in code + used but missing from locales.
                  Both write structured logs to dump/<KIND>_<hash>.log for an LLM to resolve.

Flags:
  --no-install    (add/remove/manage) Patch files + package.json but skip npm install
  -h, --help      Show this help

Run inside a LuckyStack project directory.`;

//? The non-TTY guidance message for the interactive wizard. Printed (and exit 1)
//? rather than hanging in raw-mode when stdin/stdout isn't a terminal.
const printNonTtyGuidance = (): void => {
  console.error('`luckystack manage` needs an interactive terminal (TTY).');
  console.error('In a non-interactive shell, use the explicit commands instead:');
  console.error('  npx luckystack list');
  console.error('  npx luckystack add <feature>');
  console.error('  npx luckystack remove <feature>');
};

//? Run the single-add/remove path for an explicit feature id. Shared by
//? `add <feature>` and `remove <feature>`.
const runSingle = (
  mode: 'add' | 'remove',
  project: ConsumerProject,
  feature: string,
  options: AddOptions,
): Result<void> => {
  const entry = findRegistryEntry(feature);
  if (!entry) {
    return { ok: false, error: new Error(`Unknown feature: "${feature}". Known: ${REGISTRY.map((e) => e.id).join(', ')}.`) };
  }
  if (mode === 'remove') {
    //? Remove batches no install of its own — reuse the manage apply path with a
    //? single-id plan so the install (and "nothing changed" semantics) match.
    return applyManagePlan(project, { add: [], remove: [entry.id] }, options);
  }
  switch (entry.kind) {
    case 'login': {
      return addLogin(project, options);
    }
    case 'presence': {
      return addPresence(project, options);
    }
    case 'backend': {
      return addBackendOnly(project, entry.pkg, options, entry.note ?? '');
    }
    default: {
      const _exhaustive: never = entry.kind;
      throw new Error(`Unhandled feature kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

//? Run the interactive manage wizard: build the pre-checked checkbox list, run it,
//? compute the plan, apply it. Async because the prompt awaits keypresses.
const runManageWizard = async (project: ConsumerProject, options: AddOptions): Promise<Result<void>> => {
  if (!isInteractive()) {
    printNonTtyGuidance();
    return { ok: false, error: new Error('manage requires a TTY') };
  }
  const installed = new Set(installedRegistryIds(project));
  const items: CheckboxItem[] = REGISTRY.map((entry) => ({
    id: entry.id,
    label: entry.id,
    description: entry.description,
    checked: installed.has(entry.id),
  }));
  const result = await runCheckbox('Select the optional packages you want installed:', items);
  if (result.aborted) {
    console.log('Cancelled — no changes made.');
    return { ok: true, value: undefined };
  }
  const plan = computeManagePlan([...installed], result.selected);
  return applyManagePlan(project, plan, options);
};

const finish = (result: Result<void>): void => {
  if (!result.ok) {
    console.error(`\n✗ ${result.error.message}`);
    process.exit(1);
  }
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  //? Read the CLI's own version INSIDE main() (not at module top-level) so a
  //? malformed own package.json surfaces on the clean exit-code path below rather
  //? than as an uncaught stack trace thrown before main() runs.
  const cliVersion = parsePackageVersion(createRequire(import.meta.url)('../package.json'));

  const [command, feature] = argv;
  const install = !argv.includes('--no-install');

  //? Scan commands — no feature arg, no install; they read the project + write
  //? structured logs to dump/.
  if (command === 'check-env' || command === 'check-i18n') {
    const project = validateProject(process.cwd());
    if (!project) {
      process.exit(1);
    }
    console.log(`luckystack ${command} — scanning ${project.root}`);
    if (command === 'check-env') checkEnv(project);
    else checkI18n(project);
    return;
  }

  //? Read-only inventory.
  if (command === 'list') {
    const project = validateProject(process.cwd(), 'Run this inside your project directory.');
    if (!project) {
      process.exit(1);
    }
    listFeatures(project);
    return;
  }

  if (command !== 'add' && command !== 'remove' && command !== 'manage') {
    console.error(`Unknown command: "${command ?? ''}". Commands: list, manage, add, remove, check-env, check-i18n.\n`);
    console.log(HELP);
    process.exit(2);
  }

  const project = validateProject(process.cwd(), 'Run this inside your project directory.');
  if (!project) {
    process.exit(1);
  }
  const options: AddOptions = { install, cliVersion };

  //? `manage`, or bare `add` / `remove` with no feature arg, opens the wizard.
  const featureGiven = feature !== undefined && feature.length > 0 && !feature.startsWith('-');
  if (command === 'manage' || !featureGiven) {
    console.log(`luckystack ${command} — ${project.root}\n`);
    finish(await runManageWizard(project, options));
    return;
  }

  //? `command` is narrowed to add/remove here: the `manage` branch returned above,
  //? and the unknown-command guard exited earlier.
  const mode = command === 'remove' ? 'remove' : 'add';
  console.log(`luckystack ${command} ${feature} — patching ${project.root}\n`);
  finish(runSingle(mode, project, feature, options));
};

//? Convert an unexpected top-level throw (e.g. a malformed own package.json in
//? parsePackageVersion) into the CLI's clean exit-code path — a one-line error +
//? exit 1 — instead of a raw stack trace. This package has no dependencies, so a
//? single guarded invocation here is used rather than the @luckystack/core tryCatch.
main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
