//? The step-based `manage` wizard (ADR 0014). Mirrors the create-luckystack-app
//? wizard, but on an EXISTING project: detect current state → open a step → choose
//? a value (incl. OAuth-provider multi-select) → see a per-change consequence
//? preview → confirm → apply, then ONE npm install. The pure diff/preview lives in
//? transitions.ts; this file is the TTY loop + rendering only.

import { runNpmInstall, type ConsumerProject, type Result } from '../lib/project';
import { isInteractive, runSingleSelect, runCheckbox, confirmPrompt } from '../lib/wizard';
import { detectProjectState } from '../lib/state';
import { syncScaffoldManifestChoices } from '../lib/manifestSync';
import { readDeclaredEnvKeys } from '../lib/envKeys';
import { planChanges, configFromState, TOGGLE_IDS, type DesiredConfig, type ToggleId, type ApplyContext, type Change } from '../transitions';
import { AUTH_MODES, EMAIL_PROVIDERS, MONITORING_PROVIDERS, OAUTH_PROVIDERS } from '../featureOptions';

export interface ReconfigureOptions {
  install: boolean;
  cliVersion: string;
}

//? Current-value label for the step menu (so each row shows what's set NOW).
const authLabel = (c: DesiredConfig): string =>
  c.authMode === 'credentials+oauth'
    ? `credentials+oauth (${c.oauthProviders.length > 0 ? c.oauthProviders.join(', ') : 'no providers'})`
    : c.authMode;

const toggleLabel = (on: boolean): string => (on ? 'on' : 'off');

//? Display title + one-liner for each toggle row (data-driven over TOGGLE_IDS).
const TOGGLE_META: Record<ToggleId, { title: string; description: string }> = {
  presence: { title: 'Presence', description: 'live presence + socket status' },
  sync: { title: 'Sync', description: 'real-time sync events' },
  cron: { title: 'Cron', description: 'leader-elected recurring jobs' },
  'docs-ui': { title: 'Docs UI', description: 'API explorer at /docs + /_docs' },
  'secret-manager': { title: 'Secret manager', description: 'off-host secret resolution' },
  router: { title: 'Router', description: 'multi-instance load-balancer' },
  mcp: { title: 'AI graph MCP', description: '@luckystack/mcp dependency-graph server' },
};

//? ORM step (ADR 0020): pick the data layer; the actual switch is planned by
//? `planOrm` and applied via `switchOrm` (fresh-render based). Drizzle is
//? SQL-only, so a mongodb project picks its SQL dialect here too.
const ORM_OPTIONS = ['prisma', 'drizzle', 'mikro-orm', 'none'] as const;
const SQL_DB_OPTIONS = ['postgresql', 'mysql', 'sqlite'] as const;

const editOrm = async (desired: DesiredConfig): Promise<void> => {
  desired.orm = await editChoice('ORM / data layer:', ORM_OPTIONS, desired.orm);
  if (desired.orm === 'drizzle' && desired.dbProvider === 'mongodb') {
    console.log('drizzle has no MongoDB support — pick the SQL database to switch to:');
    desired.dbProvider = await editChoice('Database:', SQL_DB_OPTIONS, 'postgresql');
  }
};

//? Open the Auth step: pick the mode, then (for oauth) the providers.
const editAuth = async (desired: DesiredConfig): Promise<void> => {
  const res = await runSingleSelect(
    'Authentication mode:',
    AUTH_MODES.map((m) => ({ label: m })),
    AUTH_MODES.indexOf(desired.authMode),
  );
  if (res.aborted) return;
  const picked = AUTH_MODES[res.index] ?? desired.authMode;
  if (picked === 'credentials+oauth') {
    const provRes = await runCheckbox(
      'OAuth providers — space toggles a row, go to Confirm to apply:',
      OAUTH_PROVIDERS.map((p) => ({ id: p, label: p, checked: desired.oauthProviders.includes(p) })),
    );
    //? Aborting the provider screen cancels the WHOLE oauth change — leave authMode
    //? untouched so we don't end up with credentials+oauth and zero providers.
    if (provRes.aborted) return;
    const selected = OAUTH_PROVIDERS.filter((p) => provRes.selected.includes(p));
    //? credentials+oauth with zero providers is meaningless (no buttons) — treat an
    //? empty confirmed selection as plain credentials.
    if (selected.length === 0) {
      console.log('⚠ No OAuth providers selected — staying on plain credentials.');
      desired.authMode = 'credentials';
      desired.oauthProviders = [];
    } else {
      desired.authMode = 'credentials+oauth';
      desired.oauthProviders = selected;
    }
  } else {
    //? Leaving oauth clears stale providers so a later re-entry starts clean.
    desired.authMode = picked;
    desired.oauthProviders = [];
  }
};

const editChoice = async <T extends string>(
  title: string,
  options: readonly T[],
  current: T,
): Promise<T> => {
  const res = await runSingleSelect(title, options.map((o) => ({ label: o })), options.indexOf(current));
  return res.aborted ? current : (options[res.index] ?? current);
};

//? Render the consequence preview — every change's headline + bullet effects.
//? This is the "make it explicit what happens at each change" requirement.
const renderPreview = (changes: readonly Change[]): void => {
  console.log('\nThe following changes will be applied:\n');
  for (const change of changes) {
    console.log(`  ${change.summary}`);
    for (const effect of change.effects) console.log(`      ${effect}`);
  }
  console.log('\n  Then: one `npm install`. Restart the server afterward.');
};

//? Drive the interactive step wizard. Returns ok (possibly no-op) or the first
//? apply error. Caller has already validated the project + TTY.
export const runReconfigureWizard = async (
  project: ConsumerProject,
  options: ReconfigureOptions,
): Promise<Result<void>> => {
  if (!isInteractive()) {
    console.error('manage requires an interactive terminal (TTY). Use `add <feature>` / `remove <feature>` in non-interactive contexts.');
    return { ok: false, error: new Error('manage requires a TTY') };
  }

  const current = configFromState(detectProjectState(project));
  //? Deep-ish clone (providers array + toggles object) so edits don't mutate current.
  const desired: DesiredConfig = {
    authMode: current.authMode,
    oauthProviders: [...current.oauthProviders],
    email: current.email,
    monitoring: current.monitoring,
    toggles: { ...current.toggles },
    orm: current.orm,
    dbProvider: current.dbProvider,
  };

  //? Surface the detected data layer up front — orm-sensitive steps (auth)
  //? annotate themselves against the DESIRED value so the steps react to each
  //? other within one pass (switch orm → the auth row updates immediately).
  console.log(`Data layer: ${current.orm} (${current.dbProvider})\n`);

  for (;;) {
    const pending = planChanges(current, desired).length;
    //? Rows: 4 fixed dimension steps (orm/auth/email/monitoring) + one row per
    //? TOGGLE_ID, then Review + Cancel. Toggle rows are data-driven so a new
    //? toggle appears here automatically (index maps to TOGGLE_IDS[index - FIXED_STEPS]).
    const FIXED_STEPS = 4;
    const toggleRows = TOGGLE_IDS.map((id) => ({
      label: `${TOGGLE_META[id].title} — ${toggleLabel(desired.toggles[id])}`,
      description: TOGGLE_META[id].description,
    }));
    const rows = [
      {
        label: `ORM / data layer — ${desired.orm}${desired.orm === current.orm ? '' : ` (was ${current.orm})`}`,
        description: 'switch prisma / drizzle / mikro-orm / none — swaps deps, scripts, shims + starters (fresh-render based)',
      },
      {
        label: `Auth — ${authLabel(desired)}`,
        description: desired.orm === 'prisma'
          ? 'login / register / settings + OAuth providers'
          : `login / register / settings + OAuth providers — ⚠ data layer is '${desired.orm}': needs a custom UserAdapter (a starter is generated on enable)`,
      },
      { label: `Email — ${desired.email}`, description: 'transactional email adapter' },
      { label: `Monitoring — ${desired.monitoring}`, description: 'error tracking backend' },
      ...toggleRows,
      { label: `Review & apply (${String(pending)} change${pending === 1 ? '' : 's'})`, description: 'preview the consequences, then confirm' },
      { label: 'Cancel', description: 'exit without changing anything' },
    ];
    //? Derive the action-row indices from the array so inserting a setting row can't
    //? silently shift them out from under the index checks.
    const cancelIdx = rows.length - 1;
    const reviewIdx = rows.length - 2;
    const menu = await runSingleSelect('Configure your project — pick a setting to change:', rows);
    if (menu.aborted || menu.index === cancelIdx) {
      console.log('Cancelled — no changes made.');
      return { ok: true, value: undefined };
    }
    if (menu.index === reviewIdx) break; // Review & apply
    switch (menu.index) {
      case 0: { await editOrm(desired); break; }
      case 1: { await editAuth(desired); break; }
      case 2: { desired.email = await editChoice('Transactional email adapter:', EMAIL_PROVIDERS, desired.email); break; }
      case 3: { desired.monitoring = await editChoice('Observability backend:', MONITORING_PROVIDERS, desired.monitoring); break; }
      default: {
        //? A toggle row: flip the corresponding TOGGLE_ID. `.at()` always returns
        //? `ToggleId | undefined`, so the `if (id)` guard is honest under both tsc
        //? settings (defends against an out-of-range index if rows are reordered).
        const id = TOGGLE_IDS.at(menu.index - FIXED_STEPS);
        if (id) desired.toggles[id] = !desired.toggles[id];
        break;
      }
    }
  }

  const changes = planChanges(current, desired);
  if (changes.length === 0) {
    console.log('\nNo changes selected.');
    return { ok: true, value: undefined };
  }

  renderPreview(changes);
  const proceed = await confirmPrompt('\nApply these changes?');
  if (!proceed) {
    console.log('Cancelled — no changes made.');
    return { ok: true, value: undefined };
  }

  //? declaredKeys is read once before the apply loop. In most cases this is fine:
  //? upsertEnvBlock re-reads the live file for the sentinel check, which catches the
  //? common add→add scenario. Edge case: if a user previously hand-filled a key (no
  //? sentinel), switched away, then switches back in one wizard pass, the snapshot
  //? may still contain that key and upsertEnvBlock will skip re-adding the placeholder
  //? template. Net effect: the user must add the placeholder block manually for that
  //? provider. This is a known limitation — the value-safety contract (never overwrite
  //? an existing key with a placeholder) takes precedence over re-hydrating the template.
  const ctx: ApplyContext = {
    project,
    cliVersion: options.cliVersion,
    declaredKeys: readDeclaredEnvKeys(project.root),
  };
  for (const change of changes) {
    console.log(`\n• ${change.summary}`);
    const result = change.apply(ctx);
    if (!result.ok) return result;
  }

  //? Keep the scaffold manifest's recorded choices in step with what was just
  //? applied, so a later `luckystack update` re-renders with reality.
  syncScaffoldManifestChoices(project);

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
