//? ORM switcher (ADR 0020 — every dimension is switchable in EVERY direction,
//? like email/monitoring already are). File CONTENT comes from a fresh
//? scaffold render with the target orm (the `luckystack update` pattern:
//? create-luckystack-app stays the single source of truth for starters), so
//? nothing here duplicates template content. Only dependency/script NAME
//? tables live here — tiny, and parity-tested against the scaffolder's
//? exported tables (`updateParity.test.ts` guards the same class).
//?
//? Safety policy (value-safe, like the rest of the CLI):
//?   - the two ACTIVE shims (functions/db.ts, luckystack/core/clients.ts) are
//?     replaced, with the previous version backed up as `<file>.orm-<from>.bak`;
//?   - schema/config starters are copy-if-absent (never clobber user models);
//?   - the OLD orm's files are never deleted — they are listed as "no longer
//?     used" in the output;
//?   - deps/scripts ARE swapped (restorable via git / re-switch).

import fs from 'node:fs';
import path from 'node:path';
import { err, ok, toError, type ConsumerProject, type Result } from '../lib/project';
import type { DetectedDbProvider, DetectedOrm } from '../lib/state';
import { writeUserAdapterStarterFor, PRISMA_BOUND_SETTINGS_ROUTES } from './addLogin';
import { renderScaffoldToTemp, readScaffoldManifest, MANIFEST_RELATIVE_PATH } from './update';

//? Per-ORM surface (NAMES only; versions/content come from the fresh render).
//? Driver-dep lists are the UNION over db providers — removal drops whichever
//? is present, addition copies only what the fresh render actually declares.
interface OrmSurface {
  deps: string[];
  devDeps: string[];
  scripts: string[];
  /** Top-level package.json keys owned by this orm (e.g. mikro-orm CLI config). */
  pkgKeys: string[];
  /** Active shims: replaced on switch (with a .bak of the previous version). */
  replaceFiles: string[];
  /** Starters: copied from the fresh render only when absent (user-owned). */
  starterFiles: string[];
}

const SHARED_REPLACE_FILES = ['functions/db.ts', 'luckystack/core/clients.ts'];

export const ORM_SURFACES: Record<DetectedOrm, OrmSurface> = {
  prisma: {
    deps: ['@prisma/client'],
    devDeps: ['prisma'],
    scripts: ['prisma:generate', 'prisma:db:push', 'prisma:migrate:dev'],
    pkgKeys: [],
    replaceFiles: SHARED_REPLACE_FILES,
    starterFiles: ['prisma/schema.prisma', 'scripts/prismaWithSecrets.ts'],
  },
  drizzle: {
    deps: ['drizzle-orm', 'pg', 'mysql2', 'better-sqlite3'],
    devDeps: ['drizzle-kit', '@types/pg', '@types/better-sqlite3'],
    scripts: ['db:generate', 'db:migrate', 'db:push', 'db:studio'],
    pkgKeys: [],
    replaceFiles: SHARED_REPLACE_FILES,
    starterFiles: ['server/db/schema.ts', 'drizzle.config.ts'],
  },
  'mikro-orm': {
    deps: [
      '@mikro-orm/core',
      '@mikro-orm/postgresql',
      '@mikro-orm/mysql',
      '@mikro-orm/better-sqlite',
      '@mikro-orm/mongodb',
    ],
    devDeps: ['@mikro-orm/cli'],
    scripts: ['db:schema:update'],
    pkgKeys: ['mikro-orm'],
    replaceFiles: SHARED_REPLACE_FILES,
    starterFiles: ['server/db/entities.ts', 'server/db/mikro-orm.config.ts'],
  },
  none: {
    deps: [],
    devDeps: [],
    scripts: [],
    pkgKeys: [],
    replaceFiles: SHARED_REPLACE_FILES,
    starterFiles: [],
  },
};

//? config.ts tokens the switch edits both ways. MUST stay byte-identical to
//? the scaffolder's exported PRISMA_USER_TYPE_IMPORT / ORM_NONE_CONFIG_USER_TYPE
//? (parity-tested) — the CLI cannot import the scaffolder at runtime.
export const PRISMA_USER_TYPE_IMPORT = "import type { User } from '@prisma/client';";
export const NON_PRISMA_USER_TYPE_HEADER = "//? orm: 'none' — no Prisma-generated User type; shape your own session";

export interface SwitchOrmInput {
  from: DetectedOrm;
  to: DetectedOrm;
  /** Target db (drizzle re-renders need a SQL dialect). */
  dbProvider: DetectedDbProvider;
  cliVersion: string;
  /** Injectable for tests — defaults to the npx temp render. */
  renderFreshScaffold?: typeof renderScaffoldToTemp;
}

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

const readPackageJson = (filePath: string): PackageJsonShape | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageJsonShape;
  } catch {
    return null;
  }
};

//? Replace-with-backup: keeps the previous shim readable next to the new one
//? (.bak extension keeps it out of tsc/lint/vite).
const replaceWithBackup = (project: ConsumerProject, relative: string, freshAbsolute: string, from: DetectedOrm): void => {
  const localAbsolute = path.join(project.root, relative);
  if (fs.existsSync(localAbsolute)) {
    fs.copyFileSync(localAbsolute, `${localAbsolute}.orm-${from}.bak`);
  }
  fs.mkdirSync(path.dirname(localAbsolute), { recursive: true });
  fs.copyFileSync(freshAbsolute, localAbsolute);
  console.log(`• replaced ${relative} (previous version saved as ${relative}.orm-${from}.bak)`);
};

//? Best-effort token edit (CRLF-safe via lib editFile would throw; here a
//? miss is expected when the user reshaped the block — warn + continue).
const tryTokenEdit = (project: ConsumerProject, relative: string, find: string, replace: string): boolean => {
  const absolute = path.join(project.root, relative);
  if (!fs.existsSync(absolute)) return false;
  const raw = fs.readFileSync(absolute, 'utf8');
  const normalized = raw.replaceAll('\r\n', '\n');
  if (!normalized.includes(find)) return false;
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(absolute, normalized.replace(find, replace).replaceAll('\n', eol));
  return true;
};

//? The orm-none placeholder `type User = { ... }` block in config.ts: starts at
//? the header comment, ends at the first `};` line (the exact shape the
//? scaffolder's stripPrismaSurface writes — parity-tested).
const PLACEHOLDER_BLOCK_END = '\n};';
const extractPlaceholderBlock = (content: string): string | null => {
  const start = content.indexOf(NON_PRISMA_USER_TYPE_HEADER);
  if (start === -1) return null;
  const end = content.indexOf(PLACEHOLDER_BLOCK_END, start);
  return end === -1 ? null : content.slice(start, end + PLACEHOLDER_BLOCK_END.length);
};

const readNormalized = (absolute: string): string | null =>
  fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8').replaceAll('\r\n', '\n') : null;

//? config.ts User-type edit, both directions (best-effort — the block is
//? user-editable by design, so a miss warns instead of failing).
//? → prisma: replace the WHOLE placeholder block with the Prisma import (leaving
//?   both would be a duplicate-identifier compile error).
//? → non-prisma: replace the import with the placeholder block extracted from
//?   the fresh render's config.ts (single source of truth for its content).
const editConfigUserType = (project: ConsumerProject, from: DetectedOrm, to: DetectedOrm, freshDir: string): void => {
  //? Between two non-prisma orms the placeholder is already in place — nothing to edit.
  if (from !== 'prisma' && to !== 'prisma') return;

  if (to === 'prisma') {
    const consumerContent = readNormalized(path.join(project.root, 'config.ts'));
    const block = consumerContent ? extractPlaceholderBlock(consumerContent) : null;
    if (block && tryTokenEdit(project, 'config.ts', block, PRISMA_USER_TYPE_IMPORT)) {
      console.log('• config.ts: restored the Prisma User import (removed the local placeholder User type — it comes from @prisma/client again; see git diff)');
      return;
    }
  } else {
    const freshContent = readNormalized(path.join(freshDir, 'config.ts'));
    const block = freshContent ? extractPlaceholderBlock(freshContent) : null;
    if (block && tryTokenEdit(project, 'config.ts', PRISMA_USER_TYPE_IMPORT, block)) {
      console.log("• config.ts: swapped the Prisma User import for a local placeholder `type User` — adjust it to YOUR data layer's user shape");
      return;
    }
    if (tryTokenEdit(project, 'config.ts', PRISMA_USER_TYPE_IMPORT, '')) {
      console.log("• config.ts: removed the Prisma User import — define a local `type User = { ... }` for SessionLayout (see the scaffold's orm-none placeholder)");
      return;
    }
  }
  console.warn('⚠ config.ts: could not auto-edit the User type import — check the SessionLayout source type manually.');
};

export const switchOrm = (project: ConsumerProject, input: SwitchOrmInput): Result<void> => {
  const { from, to } = input;
  if (from === to) return ok();

  const fromSurface = ORM_SURFACES[from];
  const toSurface = ORM_SURFACES[to];

  //? 1. Fresh render with the CURRENT choices but the TARGET orm/db — the
  //?    single source of truth for file content + dependency versions.
  const manifest = readScaffoldManifest(project.root);
  const choices: Record<string, unknown> = {
    ...manifest?.choices,
    orm: to,
    dbProvider: input.dbProvider,
    //? The auth surface is not part of the switch (we only take db files +
    //?    deps from the render; the starter UserAdapter is written in step 6),
    //?    so render non-prisma targets lean with auth off. The project's real
    //?    auth stays untouched either way.
    ...(to === 'prisma' ? {} : { authMode: 'none', oauthProviders: [] }),
  };
  const render = (input.renderFreshScaffold ?? renderScaffoldToTemp)({
    cliVersion: input.cliVersion,
    projectName: manifest?.projectName ?? path.basename(project.root),
    choices,
  });
  if (!render) {
    return err(toError(new Error(
      `could not render a fresh scaffold via npx create-luckystack-app@${input.cliVersion} — check network/registry access.`,
    )));
  }

  try {
    const freshPkg = readPackageJson(path.join(render.projectDir, 'package.json'));
    if (!freshPkg) return err(toError(new Error('fresh render has no readable package.json')));

    //? 2. package.json: drop the OLD orm's deps/scripts/keys, add the NEW
    //?    orm's — names from the tables, versions/values from the render.
    let pkg = readPackageJson(project.pkgPath);
    if (!pkg) return err(toError(new Error('project package.json is not readable')));

    for (const dep of fromSurface.deps) delete pkg.dependencies?.[dep];
    for (const dep of fromSurface.devDeps) delete pkg.devDependencies?.[dep];
    for (const script of fromSurface.scripts) delete pkg.scripts?.[script];
    for (const key of fromSurface.pkgKeys) {
      if (!(key in pkg)) continue;
      const { [key]: _dropped, ...rest } = pkg;
      pkg = rest;
    }

    pkg.dependencies ??= {};
    pkg.devDependencies ??= {};
    pkg.scripts ??= {};
    for (const dep of toSurface.deps) {
      const version = freshPkg.dependencies?.[dep];
      if (version) pkg.dependencies[dep] = version;
    }
    for (const dep of toSurface.devDeps) {
      const version = freshPkg.devDependencies?.[dep];
      if (version) pkg.devDependencies[dep] = version;
    }
    for (const script of toSurface.scripts) {
      const command = freshPkg.scripts?.[script];
      if (command) pkg.scripts[script] = command;
    }
    for (const key of toSurface.pkgKeys) {
      if (freshPkg[key] !== undefined) pkg[key] = freshPkg[key];
    }
    fs.writeFileSync(project.pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`• swapped package.json deps/scripts: ${from} → ${to}`);

    //? 3. Active shims: replace (with backup). Starters: copy-if-absent.
    for (const relative of toSurface.replaceFiles) {
      const freshAbsolute = path.join(render.projectDir, relative);
      if (fs.existsSync(freshAbsolute)) replaceWithBackup(project, relative, freshAbsolute, from);
    }
    for (const relative of toSurface.starterFiles) {
      const freshAbsolute = path.join(render.projectDir, relative);
      const localAbsolute = path.join(project.root, relative);
      if (!fs.existsSync(freshAbsolute)) continue;
      if (fs.existsSync(localAbsolute)) {
        console.log(`• kept your existing ${relative} (starter not overwritten)`);
        continue;
      }
      fs.mkdirSync(path.dirname(localAbsolute), { recursive: true });
      fs.copyFileSync(freshAbsolute, localAbsolute);
      console.log(`• added ${relative}`);
    }

    //? 4. config.ts User type (both directions — see editConfigUserType).
    editConfigUserType(project, from, to, render.projectDir);

    //? 5. Old orm leftovers: NEVER deleted — reported.
    const leftovers = fromSurface.starterFiles.filter((relative) => fs.existsSync(path.join(project.root, relative)));
    if (leftovers.length > 0) {
      console.log(`• no longer used by '${to}' (left in place — delete manually if unwanted):`);
      for (const relative of leftovers) console.log(`    - ${relative}`);
    }

    //? 6. Cross-dimension interplay: a login-enabled project switching away
    //?    from Prisma needs a custom UserAdapter — write the per-ORM starter.
    const loginInstalled = Boolean(pkg.dependencies['@luckystack/login']);
    if (loginInstalled && to !== 'prisma') {
      writeUserAdapterStarterFor(project, to);
      console.warn(`⚠ auth is installed: finish luckystack/login/userAdapter.ts for '${to}' — the built-in UserAdapter is Prisma-backed.`);
      //? Prisma-bound auth files that exist in THIS project will stop
      //? compiling on the new layer — name them concretely, never delete them.
      const prismaBound = [...PRISMA_BOUND_SETTINGS_ROUTES, 'server/hooks/notifications.ts']
        .filter((relative) => fs.existsSync(path.join(project.root, relative)));
      if (prismaBound.length > 0) {
        console.warn(
          '⚠ these files call functions.db.prisma / getPrismaClient() and will stop compiling — port them to your UserAdapter or remove them:\n' +
            prismaBound.map((relative) => `    - ${relative}`).join('\n'),
        );
      }
    }
    if (loginInstalled && to === 'prisma') {
      console.log('• auth is installed: the built-in Prisma UserAdapter applies again — remove luckystack/login/userAdapter.ts if you no longer need the custom one.');
    }

    //? 7. Record the new choice in the scaffold manifest (detection reads the
    //?    manifest FIRST, so this must be explicit — manifestSync cannot infer
    //?    orm without it).
    if (manifest) {
      manifest.choices = { ...manifest.choices, orm: to, dbProvider: input.dbProvider };
      fs.writeFileSync(
        path.join(project.root, MANIFEST_RELATIVE_PATH),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    }

    const schemaInitHint: Record<DetectedOrm, string> = {
      prisma: 'npm run prisma:generate + prisma:db:push/migrate',
      drizzle: 'npm run db:push',
      'mikro-orm': 'npm run db:schema:update',
      none: 'your own tooling',
    };
    console.log(
      `\n✓ data layer switched: ${from} → ${to}. Next: npm install, set DATABASE_URL in .env.local for ${input.dbProvider}, ` +
        `then initialize the schema (${schemaInitHint[to]}).`,
    );
    return ok();
  } finally {
    render.cleanup();
  }
};
