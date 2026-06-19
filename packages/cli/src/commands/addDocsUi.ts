//? `luckystack add docs-ui` — installs @luckystack/docs-ui (which self-wires the
//? server-rendered docs page at `/_docs` via its `./register` subpath on restart)
//? AND copies the editable React API explorer into `src/docs/page.tsx`. The page
//? is file-routed (main.tsx auto-discovers `src/**/page.tsx`) and reads the
//? dev-generated `apiDocs.generated.json`, so no router edits are needed — only a
//? file copy. Copy is skip-if-exists so re-running never clobbers your edits.

import path from 'node:path';
import {
  addDependency,
  assetPath,
  copyDirIfAbsent,
  err,
  ok,
  resolveLuckyStackRange,
  runNpmInstall,
  type ConsumerProject,
  type Result,
} from '../lib/project';
import type { AddOptions } from './addPresence';

export const addDocsUi = (project: ConsumerProject, options: AddOptions, note: string): Result<void> => {
  //? Copy the React API-explorer page into the consumer's src/ (idempotent).
  let written: string[];
  try {
    written = copyDirIfAbsent(assetPath('docs-ui', 'src'), path.join(project.root, 'src'));
  } catch (error) {
    return err(error as Error);
  }
  if (written.length > 0) {
    console.log(`• copied the API explorer into src/ (${written.map((file) => path.relative(project.root, file)).join(', ')})`);
  } else {
    console.log('• docs explorer already present in src/docs/ — skipped copy (kept your edits).');
  }

  const range = resolveLuckyStackRange(project.pkg, options.cliVersion);
  try {
    if (addDependency(project, '@luckystack/docs-ui', range)) {
      console.log(`• added @luckystack/docs-ui@${range} to package.json`);
    } else {
      console.log('• @luckystack/docs-ui already in package.json');
    }
  } catch (error) {
    return err(error as Error);
  }

  if (options.install) {
    console.log('• running npm install …');
    if (!runNpmInstall(project.root, project.pkg)) {
      console.warn('  npm install failed — run it manually to finish.');
    }
  } else {
    console.log('• skipped npm install (--no-install) — run `npm install` to finish.');
  }

  console.log(`\n✓ docs-ui added. ${note}`);
  return ok();
};
