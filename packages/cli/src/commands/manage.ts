//? `luckystack manage` — interactive add/remove of optional @luckystack packages.
//? Shows the REGISTRY as a checkbox list PRE-CHECKED for what's installed; on
//? confirm it diffs the selection against the initial state and runs the add path
//? for newly-checked ids and the remove path for unchecked-but-installed ids, then
//? a SINGLE `npm install` at the end (unless --no-install).
//?
//? The diff is a PURE function (`computeManagePlan`) so it can be unit-tested
//? without the raw TTY loop; only `applyManagePlan` touches the filesystem.

import { runNpmInstall, type ConsumerProject, type Result } from '../lib/project';
import { REGISTRY, findRegistryEntry, type RegistryEntry } from '../registry';
import { addLogin } from './addLogin';
import { addPresence, type AddOptions } from './addPresence';
import { addBackendOnly } from './addBackendOnly';
import { removeFeature } from './remove';

//? A resolved plan: which registry ids to add and which to remove. Both lists are
//? in REGISTRY order so output is stable.
export interface ManagePlan {
  add: string[];
  remove: string[];
}

//? Pure diff: given the ids currently installed and the ids the user selected,
//? return what to add (selected ∧ ¬installed) and remove (installed ∧ ¬selected).
//? Unknown ids (not in REGISTRY) are ignored on both sides so a stale input can't
//? drive a handler with no entry. Output preserves REGISTRY order.
export const computeManagePlan = (installed: readonly string[], selected: readonly string[]): ManagePlan => {
  const installedSet = new Set(installed);
  const selectedSet = new Set(selected);
  const add: string[] = [];
  const remove: string[] = [];
  for (const entry of REGISTRY) {
    const isInstalled = installedSet.has(entry.id);
    const isSelected = selectedSet.has(entry.id);
    if (isSelected && !isInstalled) add.push(entry.id);
    else if (!isSelected && isInstalled) remove.push(entry.id);
  }
  return { add, remove };
};

//? Run a single add handler WITHOUT installing — `manage` batches one install at
//? the end. Passing `install: false` makes each handler skip its own npm install
//? (it prints a "--no-install" skip line); the batched install + summary at the
//? end of `applyManagePlan` is the real install.
const runAdd = (project: ConsumerProject, entry: RegistryEntry, cliVersion: string): Result<void> => {
  const options: AddOptions = { install: false, cliVersion };
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

export interface ApplyManageOptions {
  install: boolean;
  cliVersion: string;
}

//? Execute a resolved plan: run every add then every remove handler, aborting on
//? the first failure (returned Result). On success, optionally run ONE npm install
//? covering all dep changes at once. A no-op plan (nothing to add/remove) returns
//? ok without installing.
export const applyManagePlan = (
  project: ConsumerProject,
  plan: ManagePlan,
  options: ApplyManageOptions,
): Result<void> => {
  for (const id of plan.add) {
    const entry = findRegistryEntry(id);
    if (!entry) continue;
    console.log(`\n+ adding ${entry.id} …`);
    const result = runAdd(project, entry, options.cliVersion);
    if (!result.ok) return result;
  }
  for (const id of plan.remove) {
    const entry = findRegistryEntry(id);
    if (!entry) continue;
    console.log(`\n- removing ${entry.id} …`);
    const result = removeFeature(project, entry);
    if (!result.ok) return result;
  }

  if (plan.add.length === 0 && plan.remove.length === 0) {
    console.log('\nNo changes selected.');
    return { ok: true, value: undefined };
  }

  if (options.install) {
    console.log('\n• running npm install …');
    if (!runNpmInstall(project.root, project.pkg)) {
      console.warn('  npm install failed — run it manually to finish.');
    }
  } else {
    console.log('\n• skipped npm install (--no-install) — run `npm install` to finish.');
  }
  console.log('\n✓ done. Restart the server to pick up the changes.');
  return { ok: true, value: undefined };
};
