//? Without auth there is no /login route and the session is always null, so a
//? new page generated with the default login guard could never be opened. The
//? scaffolder strips that guard for `--auth=none` (finding 098); `manage` →
//? Auth: none must leave the same generators behind, and `add login` puts the
//? guard back. These edits mirror
//? create-luckystack-app's `guardlessDashboardEdits`; guardlessGenerators.test.ts
//? applies both to the template and requires identical output.

import fs from 'node:fs';
import path from 'node:path';
import { editFile, type FileEdit } from './project';

//? The dev template injector's page template and scaffoldPage.mjs differ only
//? in their ts-ignore wording and in that the .mjs keeps the page inside a
//? template literal (escaped backticks).
const guardlessDashboardEdits = (tsIgnoreLine: string, backtick: string): FileEdit[] => [
  {
    find: `//? Includes a login-required middleware as a sane default — adjust the role
//? check or remove the middleware if this page is public.`,
    replace: `//? No auth in this project, so the page is public: add an
//? ${backtick}export const middleware${backtick} when it needs a guard.`,
  },
  {
    find: `import type { PageMiddleware } from '@luckystack/core/client';
${tsIgnoreLine}
import type { SessionLayout } from '{{REL_PATH}}config';

`,
    replace: '',
  },
  {
    find: `//? Default: require login. Customize for role checks
//? (e.g. ${backtick}if (!session.admin) return undefined;${backtick} to bounce non-admins back).
export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  return { success: true };
};

`,
    replace: '',
  },
];

//? The inverse for re-enabling auth. Two of the strip edits only delete text, so
//? they cannot be reversed one by one: one edit swaps the guardless comment and
//? the `template` line around it back to the comment, imports and middleware.
const guardedDashboardEdit = ([comment, imports, middleware]: readonly FileEdit[]): FileEdit => {
  const templateLine = "export const template = 'home';\n\n";
  return {
    find: `${comment.replace}\n\n${templateLine}`,
    replace: `${comment.find}\n\n${imports.find}${templateLine}${middleware.find}`,
  };
};

const generator = (rel: string, tsIgnoreLine: string, backtick: string): { rel: string; edits: readonly FileEdit[]; restore: FileEdit } => {
  const edits = guardlessDashboardEdits(tsIgnoreLine, backtick);
  return { rel, edits, restore: guardedDashboardEdit(edits) };
};

export const GUARDLESS_GENERATORS: readonly { rel: string; edits: readonly FileEdit[]; restore: FileEdit }[] = [
  generator(
    '.luckystack/templates/page_dashboard.template.tsx',
    '//@ts-ignore We replace {{REL_PATH}} with the relative path to the project root at scaffold time.',
    '`',
  ),
  generator('scripts/scaffoldPage.mjs', "//@ts-ignore Relative import: '{{REL_PATH}}' is replaced at scaffold time.", '\\`'),
];

//? A live (uncommented) guard line; scaffoldPage.mjs also carries a commented
//? example that is not a guard.
const LIVE_LOGIN_GUARD = /^\s*if \(!session\) return \{ success: false, redirect: '\/login' \};/m;

const readLf = (file: string): string => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');

const appliesCleanly = (content: string, edits: readonly FileEdit[]): boolean =>
  edits.every(({ find }) => content.split(find).length - 1 === 1);

/** Generators that still send new pages to /login but no longer match the shipped text. */
export const unmatchedGuardedGenerators = (root: string): string[] =>
  GUARDLESS_GENERATORS.filter(({ rel, edits }) => {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) return false;
    const content = readLf(file);
    return LIVE_LOGIN_GUARD.test(content) && !appliesCleanly(content, edits);
  }).map(({ rel }) => rel);

/**
 * Strip the login guard from every generator that still matches the shipped
 * text. Returns the generators that still guard new pages and had to be left
 * alone because the project edited them.
 */
export const stripGeneratorLoginGuards = (root: string): string[] => {
  const unmatched: string[] = [];
  for (const { rel, edits } of GUARDLESS_GENERATORS) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const content = readLf(file);
    if (!LIVE_LOGIN_GUARD.test(content)) continue;
    if (appliesCleanly(content, edits)) editFile(file, edits);
    else unmatched.push(rel);
  }
  return unmatched;
};

/**
 * Put the login guard back into every generator that still matches the
 * guardless text (`add login` after an `--auth=none` scaffold or `manage` →
 * Auth: none). Returns the generators without a guard that had to be left
 * alone because the project edited them.
 */
export const restoreGeneratorLoginGuards = (root: string): string[] => {
  const unmatched: string[] = [];
  for (const { rel, restore } of GUARDLESS_GENERATORS) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const content = readLf(file);
    if (LIVE_LOGIN_GUARD.test(content)) continue;
    if (appliesCleanly(content, [restore])) editFile(file, [restore]);
    else unmatched.push(rel);
  }
  return unmatched;
};
