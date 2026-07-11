//? `luckystack list` — read-only inventory of the consumer's @luckystack surface.
//? Prints every CLI-manageable optional package (the REGISTRY) as
//? `installed (vRANGE)` vs `available`, with its one-line description, then a
//? short "core / other installed" section listing any OTHER @luckystack/* deps
//? (core, server, api, …) so the user sees the full picture. No mutation, no
//? install — it only reads package.json.

import { dependencyRange, hasDependency, type ConsumerProject } from '../lib/project';
import { deriveOrm, readScaffoldOrm } from '../lib/state';
import { REGISTRY } from '../registry';

//? Format one manageable-package row: a fixed-width id + status + description.
const formatRow = (id: string, status: string, description: string): string =>
  `  ${id.padEnd(16)} ${status.padEnd(20)} ${description}`;

export const listFeatures = (project: ConsumerProject): void => {
  //? Data layer first — orm-sensitive features (auth) depend on it (ADR 0020).
  const orm = deriveOrm({
    hasPackage: (pkg) => hasDependency(project.pkg, pkg),
    scaffoldOrm: readScaffoldOrm(project.root),
  });
  console.log(`Data layer: ${orm}${orm === 'prisma' ? '' : ' (non-Prisma — built-in auth needs a custom UserAdapter)'}\n`);

  console.log('Manageable optional packages (npx luckystack manage):\n');
  console.log(formatRow('FEATURE', 'STATUS', 'DESCRIPTION'));
  for (const entry of REGISTRY) {
    const range = dependencyRange(project.pkg, entry.pkg);
    const status = range === null ? 'available' : `installed (${range})`;
    console.log(formatRow(entry.id, status, entry.description));
  }

  //? Surface every OTHER @luckystack/* dependency (core, server, api, sync bridge,
  //? devkit, test-runner, router, secret-manager, mcp, cli, …) that isn't in the
  //? manageable registry, so the user sees their whole framework footprint.
  const managed = new Set(REGISTRY.map((entry) => entry.pkg));
  const allDeps = { ...project.pkg.dependencies, ...project.pkg.devDependencies };
  const others = Object.keys(allDeps)
    .filter((name) => name.startsWith('@luckystack/') && !managed.has(name))
    .toSorted((a, b) => a.localeCompare(b));

  if (others.length > 0) {
    console.log('\nCore / other @luckystack packages installed:\n');
    for (const name of others) {
      const range = dependencyRange(project.pkg, name);
      console.log(`  ${name}${range === null ? '' : ` (${range})`}`);
    }
  }

  console.log('\nRun `npx luckystack manage` to add or remove optional packages interactively.');
};

//? Re-exported so callers can reason about the installed-set without re-reading
//? package.json (e.g. tests). Pure: derives the installed registry ids.
export const installedRegistryIds = (project: ConsumerProject): string[] =>
  REGISTRY.filter((entry) => hasDependency(project.pkg, entry.pkg)).map((entry) => entry.id);
