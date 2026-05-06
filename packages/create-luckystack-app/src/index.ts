//? CLI entry. Usage:
//?   npx create-luckystack-app <project-name> [--no-install]
//?
//? Behavior:
//?   1. Resolve target directory from <project-name> (must not exist).
//?   2. Recursively copy `template/` into it, substituting placeholders:
//?      - {{PROJECT_NAME}}   -> the project name (kebab-case).
//?      - {{PROJECT_TITLE}}  -> the project title (Title Case).
//?      - {{LUCKYSTACK_VERSION}} -> the version of the @luckystack/* packages
//?        to depend on. Reads our own version from this package's package.json.
//?   3. Optionally run `npm install` (skip with --no-install).
//?   4. Print next-step instructions.
//?
//? Special filename rule: files in the template named with a leading
//? underscore prefix `_dot_` are renamed to start with `.` — workaround for
//? npm publishing skipping `.gitignore` / `.env*` files.
//?   _dot_gitignore -> .gitignore
//?   _dot_env_template -> .env_template

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_DIR = path.resolve(__dirname, '..', 'template');

interface CliArgs {
  projectName: string;
  install: boolean;
  help: boolean;
}

const parseArgs = (argv: string[]): CliArgs => {
  let projectName = '';
  let install = true;
  let help = false;
  for (const arg of argv) {
    if (arg === '--no-install') install = false;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (!arg.startsWith('-')) projectName ||= arg;
  }
  return { projectName, install, help };
};

const printHelp = (): void => {
  console.log(`
create-luckystack-app — scaffold a new LuckyStack project

Usage:
  npx create-luckystack-app <project-name> [options]

Options:
  --no-install   Don't run \`npm install\` after copying files.
  --help, -h     Show this message.

Example:
  npx create-luckystack-app my-app
`);
};

const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const titleCase = (raw: string): string =>
  raw
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ') || 'My LuckyStack App';

const readSelfVersion = (): string => {
  //? Fail loudly if the scaffolder can't read its own version — silently
  //? falling back to '0.0.1' would lock every newly-scaffolded project to
  //? a stale dependency set, which is almost always worse than aborting.
  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const parsed = JSON.parse(raw) as { version?: string };
  if (!parsed.version || !/^\d+\.\d+\.\d+/.test(parsed.version)) {
    throw new Error(
      `create-luckystack-app: cannot determine own version from ${pkgPath}. ` +
      `Got: ${JSON.stringify(parsed.version)}`,
    );
  }
  return parsed.version;
};

//? Filename rule: any occurrence of `_dot_` is rewritten to `.`. Used because
//? npm publish skips files whose names start with `.` (so `.gitignore`,
//? `.env_template`, etc. would be dropped from the tarball if we shipped
//? them under their real names). Examples:
//?   _dot_gitignore               -> .gitignore
//?   _dot_env_template            -> .env_template
//?   _dot_env_dot_local_template  -> .env.local_template
const renameDotFile = (name: string): string => name.replaceAll('_dot_', '.');

const replacePlaceholders = (
  content: string,
  vars: Record<string, string>,
): string => {
  return content.replace(/{{(\w+)}}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
};

const isTextFile = (filePath: string): boolean => {
  const textExts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.css', '.html', '.prisma'];
  if (textExts.includes(path.extname(filePath))) return true;
  // Files without extensions but starting with a dot (e.g. .env_template) are text.
  const base = path.basename(filePath);
  if (base.startsWith('.')) return true;
  return false;
};

const copyTree = (src: string, dest: string, vars: Record<string, string>): void => {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, renameDotFile(entry.name));

    if (entry.isDirectory()) {
      copyTree(srcPath, destPath, vars);
      continue;
    }

    if (isTextFile(destPath)) {
      const content = fs.readFileSync(srcPath, 'utf8');
      fs.writeFileSync(destPath, replacePlaceholders(content, vars), 'utf8');
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

const runNpmInstall = (cwd: string): void => {
  console.log('\nInstalling dependencies (this may take a minute)...\n');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['install'], { cwd, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error('\n[create-luckystack-app] npm install failed. You can run it manually in the project directory.');
  }
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.projectName) {
    console.error('Missing project name.\n');
    printHelp();
    process.exit(1);
  }

  const slug = slugify(args.projectName);
  if (!slug) {
    console.error(`Invalid project name: "${args.projectName}". Use letters, numbers, and dashes.`);
    process.exit(1);
  }

  const targetDir = path.resolve(process.cwd(), args.projectName);
  if (fs.existsSync(targetDir)) {
    console.error(`Target directory already exists: ${targetDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(TEMPLATE_DIR)) {
    console.error(`Template directory missing: ${TEMPLATE_DIR}`);
    console.error('This is a packaging bug — the template/ folder should ship with the package.');
    process.exit(1);
  }

  const vars: Record<string, string> = {
    PROJECT_NAME: slug,
    PROJECT_TITLE: titleCase(args.projectName),
    LUCKYSTACK_VERSION: readSelfVersion(),
  };

  console.log(`\nScaffolding ${slug} into ${targetDir}\n`);
  copyTree(TEMPLATE_DIR, targetDir, vars);
  console.log('Files written.');

  if (args.install) {
    runNpmInstall(targetDir);
  } else {
    console.log('\nSkipped npm install (--no-install).');
  }

  console.log(`
Done.

Next steps:
  cd ${args.projectName}
  cp .env_template .env
  cp .env.local_template .env.local   # fill in DATABASE_URL, etc.
  npm run prisma:generate
  npm run prisma:migrate:dev          # creates the User table
  npm run server                       # starts the dev server

Docs:
  https://github.com/ItsLucky23/LuckyStack-v2#readme
`);
};

try {
  main();
} catch (error) {
  console.error('\n[create-luckystack-app] unexpected error:', error);
  process.exit(1);
}
