//? `luckystack` CLI entry. Commands:
//?
//?   npx luckystack add <feature> [--no-install]   add ONE optional package
//?   npx luckystack add | remove | manage          interactive add/remove wizard
//?   npx luckystack list                           inventory installed vs available
//?   npx luckystack upgrade [<target>]             write dump/UPGRADE_PLAN.md (read-only)
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
import { type AddOptions } from './commands/addPresence';
import { runAddByKind } from './commands/addDispatch';
import { checkEnv } from './commands/checkEnv';
import { checkI18n } from './commands/checkI18n';
import { listFeatures } from './commands/list';
import { applyManagePlan } from './commands/manage';
import { runReconfigureWizard } from './commands/reconfigure';
import { runUpdate } from './commands/update';
import { runUpgrade } from './commands/upgrade';
import { syncScaffoldManifestChoices } from './lib/manifestSync';
import { REGISTRY, findRegistryEntry } from './registry';

const HELP = `luckystack — LuckyStack project CLI

Usage:
  npx luckystack list
  npx luckystack manage [--no-install]
  npx luckystack add [<feature>] [--no-install]
  npx luckystack remove [<feature>] [--no-install]
  npx luckystack update [--app]
  npx luckystack upgrade [<target-version>]
  npx luckystack check-env
  npx luckystack check-i18n

Optional packages (add/remove/manage):
${REGISTRY.map((entry) => `  ${entry.id.padEnd(16)}${entry.description}`).join('\n')}

list              Show which optional packages are installed vs available.
manage            Step-based reconfiguration wizard: pick a setting (auth + OAuth
                  providers / email / monitoring / presence / sync / docs-ui), see a
                  consequence preview, confirm, then apply. Bare \`add\` / \`remove\`
                  (no feature) opens the same wizard.
add <feature>     Install one optional package + inject its consumer-src assets.
remove <feature>  Drop one optional package (reverses add; login removal is guarded).

update            Refresh the framework-owned files the scaffold copied into this
                  project (docs/luckystack, CLAUDE.md, skills, .claude/commands,
                  generator scripts, shared eslint configs, route templates) from
                  the current framework version. Pristine files (hash matches the
                  .luckystack/scaffold.json baseline) are replaced; files YOU edited
                  get a \`<file>.new\` sidecar + a merge report in dump/ — nothing you
                  changed is ever overwritten. Never touches src/, functions/,
                  config, prisma, or .env*.
update --app      Same, but ALSO refresh framework-authored files under the app tree
                  (src/ UI + routes, functions/, server/, luckystack/, config.ts,
                  tsconfig). New framework files (e.g. a feature's UI after an upgrade)
                  are delivered; files you edited get \`<file>.new\` + an AI-merge note.
                  Your own app code is never touched (only fresh-render files are).
                  Still never touches prisma/, package.json, or .env/.env.local.

upgrade           READ-ONLY. Gather everything needed to upgrade LuckyStack —
                  installed version, the CHANGELOGs to read (in node_modules), the
                  step sequence + gotchas — into dump/UPGRADE_PLAN.md so an AI (or you)
                  can execute it. Optional positional = target version. Full narrative
                  runbook: docs/luckystack/UPGRADING.md.

check-env         Scan for .env keys unused in code + env vars used but undefined.
check-i18n        Scan for translation keys unused in code + used but missing from locales.
                  Both write structured logs to dump/<KIND>_<hash>.log for an LLM to resolve.

Flags:
  --no-install    (add/remove/manage) Patch files + package.json but skip npm install
  -h, --help      Show this help

Run inside a LuckyStack project directory.`;

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
  const result = mode === 'remove'
    //? Remove batches no install of its own — reuse the manage apply path with a
    //? single-id plan so the install (and "nothing changed" semantics) match.
    ? applyManagePlan(project, { add: [], remove: [entry.id] }, options)
    : runAddByKind(project, entry, options);
  //? Keep the scaffold manifest's recorded choices in step (ADR 0021) so a
  //? later `luckystack update` re-renders with reality instead of stale choices.
  if (result.ok) syncScaffoldManifestChoices(project);
  return result;
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

  //? Read-only: gather the upgrade plan (installed version + CHANGELOGs to read +
  //? the step sequence) into dump/UPGRADE_PLAN.md. Optional positional = target
  //? version. Mutates nothing.
  if (command === 'upgrade') {
    const project = validateProject(process.cwd(), 'Run this inside your project directory.');
    if (!project) {
      process.exit(1);
    }
    const target = feature !== undefined && feature.length > 0 && !feature.startsWith('-') ? feature : null;
    runUpgrade(project, target, new Date());
    return;
  }

  //? Framework-owned-files refresh (ADR 0021 phase 1a). `--app` (ADR 0025) also
  //? refreshes the framework-authored src/ UI + routes + config.
  if (command === 'update') {
    const project = validateProject(process.cwd(), 'Run this inside your project directory.');
    if (!project) {
      process.exit(1);
    }
    const scope = argv.includes('--app') ? 'app' : 'framework';
    console.log(`luckystack update — ${project.root}`);
    finish(runUpdate(project, { cliVersion, scope }));
    return;
  }

  if (command !== 'add' && command !== 'remove' && command !== 'manage') {
    console.error(`Unknown command: "${command ?? ''}". Commands: list, manage, add, remove, update, upgrade, check-env, check-i18n.\n`);
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
    finish(await runReconfigureWizard(project, options));
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
