//? `luckystack update` — refresh the FRAMEWORK-OWNED files a scaffold copied
//? into this project (docs/luckystack, CLAUDE.md, skills, .claude/commands,
//? generator scripts, shared eslint configs, route templates) from the current
//? framework version. Implements phase 1a of the scaffold-update decision
//? (ADR 0021); the scaffold-manifest (`.luckystack/scaffold.json`, written by
//? create-luckystack-app since 0.4.1) is the baseline it diffs against.
//?
//? Semantics (the whole point — NEVER destroy user edits):
//?   - file missing locally            -> ADD (new framework file)
//?   - local hash == manifest hash     -> PRISTINE -> overwrite with new render
//?   - local hash != manifest hash     -> USER-MODIFIED -> write `<file>.new`
//?     sidecar + list it in the report for an AI-assisted (or manual) merge
//?   - no manifest at all (pre-0.4.1 scaffold) -> sidecar-only mode for
//?     everything that differs; nothing is ever overwritten blind.
//?
//? Template source = the scaffolder itself: we run
//? `npx create-luckystack-app@<cli version> <name> --no-prompt --no-install`
//? with the RECORDED choices into a temp dir (files are {{VAR}}-rendered, so
//? only a same-choices re-render produces comparable bytes) and read the fresh
//? scaffold's own manifest for the new hashes. One source of truth, no
//? duplicated template logic. Only files INSIDE the safe surface below are
//? ever touched; user code (src/, functions/, config, prisma) is out of scope
//? by design — that is phase 2 (transitions-driven codemods).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ok, type ConsumerProject, type Result } from '../lib/project';
import { writeDumpLog } from '../lib/scan';
import { AUTH_MODES, EMAIL_PROVIDERS, MONITORING_PROVIDERS, OAUTH_PROVIDERS } from '../featureOptions';

//? Mirrors create-luckystack-app's scaffoldManifest.ts shape (schemaVersion 1).
export interface ScaffoldManifestFileEntry {
  path: string;
  sha256: string;
}
export interface ScaffoldManifest {
  schemaVersion: number;
  luckystackVersion: string;
  createdAt: string;
  updatedAt?: string;
  projectName: string;
  choices: Record<string, unknown>;
  files: ScaffoldManifestFileEntry[];
}

export const MANIFEST_RELATIVE_PATH = '.luckystack/scaffold.json';

//? The bucket-(a) surface: framework-owned, rarely user-edited. Everything else
//? (src/, functions/, shared/, config*, prisma/, package.json, docs/ outside
//? the luckystack snapshot) is deliberately untouchable by this command.
const SAFE_PREFIXES = [
  'docs/luckystack/',
  'skills/',
  '.claude/commands/',
  '.luckystack/templates/',
  'scripts/',
] as const;
const SAFE_FILES = new Set([
  'CLAUDE.md',
  'branch-logs/README.md',
  'eslint.luckystack.config.js',
  'eslint.official.config.js',
  'eval/README.md',
  'eval/scoreEval.mjs',
]);

export const isSafeSurfacePath = (relativePath: string): boolean =>
  SAFE_FILES.has(relativePath) || SAFE_PREFIXES.some((prefix) => relativePath.startsWith(prefix));

//? ADR 0025: `--app` scope also updates framework-AUTHORED files under the
//? app tree (src/ UI + routes, functions/, server/, luckystack/, config.ts,
//? tsconfig, …) — the files a plain `npm install` / bucket-B `update` can't
//? reach. Safety comes from two invariants, NOT from a narrow allow-list:
//?   1. Only files present in the FRESH RENDER are ever considered, so a
//?      consumer's own app code (never in the render) is never touched.
//?   2. A user-modified file is NEVER overwritten — it gets a `<file>.new`
//?      sidecar + an AI-merge instruction (same as bucket B).
//? A short deny-list still guards the few files that are too critical / too
//? personal to touch even as a sidecar: the DB schema, real env/secrets, the
//? dependency manifest, and the scaffold manifest itself.
export type UpdateScope = 'framework' | 'app';

const NEVER_UPDATED_EXACT = new Set<string>([
  'package.json',
  'package-lock.json',
  '.env',
  '.env.local',
  '.secret-manager-token',
  MANIFEST_RELATIVE_PATH,
]);
const NEVER_UPDATED_PREFIXES = ['prisma/', 'node_modules/', '.git/'] as const;

const isNeverUpdatedPath = (relativePath: string): boolean =>
  NEVER_UPDATED_EXACT.has(relativePath) || NEVER_UPDATED_PREFIXES.some((prefix) => relativePath.startsWith(prefix));

//? Whether a fresh-render file is in scope for the given update mode.
export const isUpdatablePath = (relativePath: string, scope: UpdateScope): boolean => {
  if (isNeverUpdatedPath(relativePath)) return false;
  if (isSafeSurfacePath(relativePath)) return true; //? bucket B — both scopes
  return scope === 'app'; //? app scope — every other framework-authored file
};

//? Same text-extension heuristic + CRLF normalization as the scaffolder's
//? manifest writer (kept in sync by the update e2e — the hashes must agree or
//? every file would read as modified).
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.css', '.html', '.prisma',
]);
export const isTextFile = (filePath: string): boolean => {
  const base = path.basename(filePath);
  if (base.startsWith('.')) return true;
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
};

export const hashFileContent = (buffer: Buffer, isText: boolean): string => {
  const bytes = isText
    ? Buffer.from(buffer.toString('utf8').replaceAll('\r\n', '\n'), 'utf8')
    : buffer;
  return crypto.createHash('sha256').update(bytes).digest('hex');
};

const hashFileAt = (absolutePath: string): string =>
  hashFileContent(fs.readFileSync(absolutePath), isTextFile(absolutePath));

export const readScaffoldManifest = (root: string): ScaffoldManifest | null => {
  const manifestPath = path.join(root, MANIFEST_RELATIVE_PATH);
  if (!fs.existsSync(manifestPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ScaffoldManifest;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.files)) return null;
  return parsed;
};

//? Recorded choices -> the scaffolder's CLI flags, so the temp re-render uses
//? the exact configuration this project was created with. Unknown/missing KEYS
//? and unknown VALUES fall back to scaffolder defaults. Value validation is a
//? correctness + command-boundary invariant: on Windows these args eventually
//? enter a resolved npx.cmd shim, so a hand-edited manifest must never inject
//? whitespace or cmd metacharacters before the scaffolder can validate it.
const PACKAGE_MANAGER_CHOICES = ['npm', 'bun'] as const;
const ORM_CHOICES = ['prisma', 'drizzle', 'mikro-orm', 'none'] as const;
const DB_CHOICES = ['mongodb', 'postgresql', 'mysql', 'sqlite'] as const;
const AI_BROWSER_CHOICES = ['all', 'agent-browser', 'none'] as const;

const readChoice = <TChoice extends string>(
  choices: Record<string, unknown>,
  key: string,
  allowed: readonly TChoice[],
): TChoice | null => {
  const value = choices[key];
  if (typeof value !== 'string') return null;
  return allowed.find((option) => option === value) ?? null;
};

export const choicesToFlags = (choices: Record<string, unknown>): string[] => {
  const flags: string[] = [];
  //? A manifest written before the --pm axis existed has no `packageManager`
  //? key, so readChoice() returns null and the re-render correctly falls back to
  //? npm. Without this replay a bun project re-renders as npm and sidecar-spams.
  const pm = readChoice(choices, 'packageManager', PACKAGE_MANAGER_CHOICES);
  if (pm) flags.push(`--pm=${pm}`);
  const orm = readChoice(choices, 'orm', ORM_CHOICES);
  if (orm) flags.push(`--orm=${orm}`);
  const db = readChoice(choices, 'dbProvider', DB_CHOICES);
  if (db) flags.push(`--db=${db}`);
  const auth = readChoice(choices, 'authMode', AUTH_MODES);
  if (auth) flags.push(`--auth=${auth}`);
  const rawOauth = choices.oauthProviders;
  const oauth = Array.isArray(rawOauth)
    ? OAUTH_PROVIDERS.filter((provider) => rawOauth.includes(provider))
    : [];
  if (oauth.length > 0) flags.push(`--oauth=${oauth.join(',')}`);
  const email = readChoice(choices, 'emailProvider', EMAIL_PROVIDERS);
  if (email) flags.push(`--email=${email}`);
  const monitoring = readChoice(choices, 'monitoringProvider', MONITORING_PROVIDERS);
  if (monitoring) flags.push(`--monitoring=${monitoring}`);
  if (choices.presence === true) flags.push('--presence');
  if (choices.errorTracking === true) flags.push('--error-tracking');
  if (choices.docsUi === true) flags.push('--docs-ui');
  if (choices.secretManager === true) flags.push('--secret-manager');
  if (choices.router === true) flags.push('--router');
  if (choices.cron === true) flags.push('--cron');
  if (choices.aiInstructions === false) flags.push('--no-ai-docs');
  const aiBrowser = readChoice(choices, 'aiBrowserTooling', AI_BROWSER_CHOICES);
  if (aiBrowser) flags.push(`--ai-browser=${aiBrowser}`);
  return flags;
};

export type UpdateAction = 'add' | 'overwrite' | 'sidecar' | 'unchanged';

export interface UpdatePlanEntry {
  path: string;
  action: UpdateAction;
  freshSha256: string;
}

export interface UpdatePlan {
  entries: UpdatePlanEntry[];
  manifestPresent: boolean;
}

/**
 * Pure planner: compare the fresh render's safe-surface files against the
 * consumer's current files + the recorded manifest hashes. Never touches disk
 * beyond reads, so it is unit-testable and previewable.
 */
export const planUpdate = (
  consumerRoot: string,
  consumerManifest: ScaffoldManifest | null,
  freshManifest: ScaffoldManifest,
  scope: UpdateScope = 'framework',
): UpdatePlan => {
  const recordedHashes = new Map(
    (consumerManifest?.files ?? []).map((entry) => [entry.path, entry.sha256]),
  );
  const entries: UpdatePlanEntry[] = [];
  for (const fresh of freshManifest.files) {
    if (!isUpdatablePath(fresh.path, scope)) continue;
    const localAbsolute = path.join(consumerRoot, fresh.path);
    if (!fs.existsSync(localAbsolute)) {
      entries.push({ path: fresh.path, action: 'add', freshSha256: fresh.sha256 });
      continue;
    }
    const localHash = hashFileAt(localAbsolute);
    if (localHash === fresh.sha256) {
      entries.push({ path: fresh.path, action: 'unchanged', freshSha256: fresh.sha256 });
      continue;
    }
    const recorded = recordedHashes.get(fresh.path);
    entries.push({
      path: fresh.path,
      action: recorded !== undefined && localHash === recorded ? 'overwrite' : 'sidecar',
      freshSha256: fresh.sha256,
    });
  }
  return { entries, manifestPresent: consumerManifest !== null };
};

/**
 * Execute a plan: copy adds + pristine overwrites from the fresh render,
 * write `.new` sidecars for user-modified files, refresh the consumer
 * manifest (only the files we actually wrote get their new hash; sidecarred
 * files keep the old baseline), and drop a dump/ report.
 */
export const applyUpdate = (
  project: ConsumerProject,
  plan: UpdatePlan,
  consumerManifest: ScaffoldManifest | null,
  freshRoot: string,
  freshManifest: ScaffoldManifest,
  scope: UpdateScope = 'framework',
): { reportPath: string; counts: Record<UpdateAction, number> } => {
  const counts: Record<UpdateAction, number> = { add: 0, overwrite: 0, sidecar: 0, unchanged: 0 };
  const sidecars: string[] = [];
  const added: string[] = [];
  const overwritten: string[] = [];
  const written: UpdatePlanEntry[] = [];

  for (const entry of plan.entries) {
    counts[entry.action] += 1;
    const freshAbsolute = path.join(freshRoot, entry.path);
    const localAbsolute = path.join(project.root, entry.path);
    if (entry.action === 'add' || entry.action === 'overwrite') {
      fs.mkdirSync(path.dirname(localAbsolute), { recursive: true });
      fs.copyFileSync(freshAbsolute, localAbsolute);
      written.push(entry);
      if (entry.action === 'add') added.push(entry.path);
      else overwritten.push(entry.path);
    } else if (entry.action === 'sidecar') {
      fs.copyFileSync(freshAbsolute, `${localAbsolute}.new`);
      sidecars.push(entry.path);
    }
  }

  //? Refresh the manifest baseline for what we wrote; never fabricate a
  //? manifest for a stamp-less project (we cannot attest files we didn't write).
  if (consumerManifest) {
    const byPath = new Map(consumerManifest.files.map((entry) => [entry.path, entry]));
    for (const entry of written) {
      byPath.set(entry.path, { path: entry.path, sha256: entry.freshSha256 });
    }
    const nextManifest: ScaffoldManifest = {
      ...consumerManifest,
      luckystackVersion: freshManifest.luckystackVersion,
      updatedAt: new Date().toISOString(),
      files: [...byPath.values()].toSorted((a, b) => a.path.localeCompare(b.path)),
    };
    fs.writeFileSync(
      path.join(project.root, MANIFEST_RELATIVE_PATH),
      `${JSON.stringify(nextManifest, null, 2)}\n`,
    );
  }

  //? Report-only: manifest-recorded safe-surface files the NEW framework
  //? version no longer ships. Deleting is the consumer's call — an update must
  //? never remove files — but silently leaving them reads as "still current".
  const freshPaths = new Set(freshManifest.files.map((entry) => entry.path));
  const noLongerShipped = (consumerManifest?.files ?? [])
    .filter(
      (entry) =>
        isUpdatablePath(entry.path, scope) &&
        !freshPaths.has(entry.path) &&
        fs.existsSync(path.join(project.root, entry.path)),
    )
    .map((entry) => entry.path);

  const lines: string[] = [
    `luckystack update (${scope} scope) — ${consumerManifest?.luckystackVersion ?? 'unknown (no manifest)'} -> ${freshManifest.luckystackVersion}`,
    '',
    `added:       ${String(counts.add)}`,
    `overwritten: ${String(counts.overwrite)} (pristine — hash matched the scaffold manifest)`,
    `sidecars:    ${String(counts.sidecar)} (user-modified — new version written as <file>.new)`,
    `unchanged:   ${String(counts.unchanged)}`,
    '',
  ];
  if (added.length > 0) {
    lines.push(
      'New framework files delivered (did not exist in your project):',
      ...added.map((p) => `  - ${p}`),
      '',
    );
  }
  //? In app scope the overwrites include src/ files — list them so a reviewer
  //? can eyeball what the framework refreshed (each was pristine = unedited).
  if (scope === 'app' && overwritten.length > 0) {
    lines.push(
      'Refreshed to the new framework version (you had not edited these):',
      ...overwritten.map((p) => `  - ${p}`),
      '',
    );
  }
  if (noLongerShipped.length > 0) {
    lines.push(
      'No longer shipped by this framework version (left in place — delete manually if unused):',
      ...noLongerShipped.map((p) => `  - ${p}`),
      '',
    );
  }
  if (!plan.manifestPresent) {
    lines.push(
      'NOTE: no .luckystack/scaffold.json manifest was found (project scaffolded',
      'before 0.4.1). Running in sidecar-only mode: nothing was overwritten.',
      '',
    );
  }
  if (sidecars.length > 0) {
    lines.push(
      'Files needing a merge (you edited these; the new framework version sits',
      'next to each as `<file>.new`):',
      ...sidecars.map((p) => `  - ${p}`),
      '',
      'AI merge instruction: for each file above, merge the changes from',
      '`<file>.new` into `<file>` preserving the user\'s local edits, then delete',
      'the `.new` sidecar. Review with `git diff` before committing.',
      '',
    );
  }
  lines.push('Review everything with `git diff` (or your editor) before committing.');
  const reportPath = writeDumpLog(project.root, 'UPDATE', `${lines.join('\n')}\n`);
  return { reportPath, counts };
};

//? Resolve a command to an absolute path via PATH only (never the CWD) —
//? same defensive pattern as lib/project.ts runNpmInstall.
const resolveCommandPath = (command: string): string | null => {
  const rawPath = process.env.PATH ?? process.env.Path ?? '';
  const dirs = rawPath.split(path.delimiter).filter((d) => d.length > 0);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => e.length > 0)
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${command}${ext.toLowerCase()}`);
      if (fs.existsSync(candidate)) return candidate;
      const upper = path.join(dir, `${command}${ext}`);
      if (fs.existsSync(upper)) return upper;
    }
  }
  return null;
};

//? Run the scaffolder into `cwd` with inherited stdio. Windows `.cmd` shims
//? need the cmd.exe `/s /c ""<path>" args"` double-quote pattern (see
//? runNpmInstall in lib/project.ts for the full Bug-H rationale). Every dynamic
//? arg is allowlisted by choicesToFlags + normalizeScaffoldProjectName; keep a
//? final character guard here so future args cannot silently reopen cmd parsing.
const SAFE_WINDOWS_SCAFFOLD_ARG = /^[A-Za-z0-9@./,=+_-]+$/;
export const isSafeWindowsScaffoldArg = (value: string): boolean =>
  SAFE_WINDOWS_SCAFFOLD_ARG.test(value);

const runScaffolderCli = (cwd: string, args: string[]): boolean => {
  const resolved = resolveCommandPath('npx');
  if (!resolved) return false;
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
  if (needsShell) {
    if (!args.every((argument) => isSafeWindowsScaffoldArg(argument))) {
      console.error('[luckystack update] refusing an unsafe scaffold argument before invoking npx.cmd');
      return false;
    }
    const comspec = process.env.ComSpec ?? 'cmd.exe';
    const shellResult = spawnSync(comspec, ['/d', '/s', '/c', `""${resolved}" ${args.join(' ')}"`], {
      cwd,
      stdio: 'inherit',
      windowsVerbatimArguments: true,
    });
    return shellResult.status === 0;
  }
  const result = spawnSync(resolved, args, { cwd, stdio: 'inherit' });
  return result.status === 0;
};

//? Must stay byte-equivalent to create-luckystack-app's slugify(): the
//? scaffolder writes into `<temp>/<slug>`, never `<temp>/<raw name>`. Besides
//? fixing old projects whose directory contains spaces, this makes the only
//? positional dynamic shell argument a strict `[a-z0-9-]+` token.
export const normalizeScaffoldProjectName = (raw: string): string =>
  raw
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');

export interface UpdateOptions {
  cliVersion: string;
  /** `'framework'` (default) = docs/scripts/CLAUDE.md only; `'app'` (--app) also
   *  refreshes framework-authored src/ UI + routes + config (ADR 0025). */
  scope?: UpdateScope;
  /** Injectable for tests/e2e: produce a fresh render dir for the given choices. */
  renderFreshScaffold?: (input: {
    cliVersion: string;
    projectName: string;
    choices: Record<string, unknown>;
  }) => { projectDir: string; cleanup: () => void } | null;
}

//? Exported for reuse by the ORM switcher (`switchOrm.ts`) — same pattern:
//? a fresh scaffold render is the single source of truth for file content.
export const renderScaffoldToTemp: NonNullable<UpdateOptions['renderFreshScaffold']> = ({
  cliVersion,
  projectName,
  choices,
}) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-update-'));
  const projectSlug = normalizeScaffoldProjectName(projectName);
  if (!projectSlug) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return null;
  }
  const args = [
    '-y',
    `create-luckystack-app@${cliVersion}`,
    projectSlug,
    '--no-prompt',
    '--no-install',
    ...choicesToFlags(choices),
  ];
  console.log(`\nRendering a fresh scaffold (${args.join(' ')})…`);
  const ok = runScaffolderCli(tempRoot, args);
  const projectDir = path.join(tempRoot, projectSlug);
  if (!ok || !fs.existsSync(projectDir)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return null;
  }
  return {
    projectDir,
    cleanup: () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    },
  };
};

//? Version coherence: `update` re-renders at the CLI's own version, so a cli
//? that lags (or leads) the installed @luckystack/* packages silently refreshes
//? docs/scripts of a DIFFERENT framework version. Read-only check, warn-only.
const readInstalledCoreVersion = (root: string): string | null => {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules', '@luckystack', 'core', 'package.json'), 'utf8'),
    ) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
};

export const runUpdate = (project: ConsumerProject, options: UpdateOptions): Result<void> => {
  const scope: UpdateScope = options.scope ?? 'framework';
  const consumerManifest = readScaffoldManifest(project.root);

  const installedCoreVersion = readInstalledCoreVersion(project.root);
  if (installedCoreVersion !== null && installedCoreVersion !== options.cliVersion) {
    console.warn(
      `⚠ version mismatch: @luckystack/cli is ${options.cliVersion} but the installed @luckystack/core is ` +
        `${installedCoreVersion}. \`update\` refreshes files at the CLI's version — bump your @luckystack/* ` +
        'dependencies (including the @luckystack/cli devDependency) to the same version first, run ' +
        '`npm install`, then re-run `npx luckystack update`.',
    );
  }
  if (!consumerManifest) {
    console.log(
      'No .luckystack/scaffold.json found (scaffolded before 0.4.1) — running in\n' +
        'sidecar-only mode: differing files get a `.new` twin, nothing is overwritten.',
    );
  }

  //? Without a manifest we have no recorded choices — render with defaults;
  //? the sidecar-only mode above keeps that safe (worst case: a `.new` twin
  //? renders for a surface the project never had).
  const projectName = consumerManifest?.projectName ?? path.basename(project.root);
  const choices = consumerManifest?.choices ?? {};

  const render = (options.renderFreshScaffold ?? renderScaffoldToTemp)({
    cliVersion: options.cliVersion,
    projectName,
    choices,
  });
  if (!render) {
    return {
      ok: false,
      error: new Error(
        `could not render a fresh scaffold via npx create-luckystack-app@${options.cliVersion} — check network/registry access.`,
      ),
    };
  }
  const freshManifest = readScaffoldManifest(render.projectDir);
  if (!freshManifest) {
    render.cleanup();
    return {
      ok: false,
      error: new Error('the fresh scaffold produced no manifest — scaffolder version too old?'),
    };
  }

  if (scope === 'app') {
    console.log(
      'Running in APP scope (--app): framework-authored src/ UI + routes + config are\n' +
        'refreshed too. Your own app files (never in the fresh render) are untouched, and\n' +
        'any file you edited gets a `.new` sidecar — nothing you changed is overwritten.',
    );
  }

  const plan = planUpdate(project.root, consumerManifest, freshManifest, scope);
  const { reportPath, counts } = applyUpdate(
    project,
    plan,
    consumerManifest,
    render.projectDir,
    freshManifest,
    scope,
  );
  render.cleanup();

  console.log(
    `\nUpdate complete (${scope} scope): +${String(counts.add)} added, ${String(counts.overwrite)} refreshed, ` +
      `${String(counts.sidecar)} need a merge (\`.new\` sidecars), ${String(counts.unchanged)} already current.`,
  );
  console.log(`Report: ${reportPath}`);
  if (counts.sidecar > 0) {
    console.log('Merge the listed `.new` sidecars (an AI agent can apply the report), then review with git diff.');
  }
  if (scope === 'framework' && counts.add + counts.overwrite + counts.sidecar === 0) {
    console.log('Tip: framework-owned docs/scripts are current. Run `npx luckystack update --app` to also refresh the scaffolded src/ UI + routes (e.g. after a feature release).');
  }
  return ok();
};
