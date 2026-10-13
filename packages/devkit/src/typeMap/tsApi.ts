import fs from 'node:fs';
import path from 'node:path';
import { API, type Project, type Snapshot, type TranspileOutput } from 'typescript-7-api/sync';
import type { ScriptKind, SourceFile } from 'typescript-7-api/ast';
import { ROOT_DIR } from '@luckystack/core';

//? The TypeScript 7 API runs the compiler as a separate Go process and talks to
//? it over a pipe. This module is the ONE owner of that process: everything in
//? devkit that parses or type-checks goes through it, so a generation run starts
//? at most one compiler process and `disposeTsApi()` can stop it again. The
//? library also kills its child when Node exits, but a long-lived dev server or
//? test worker should not keep a compiler (and the Program's memory) around
//? after the run that needed it.
let api: API | null = null;
let serverSnapshot: Snapshot | null = null;
let serverProject: Project | null = null;

const getTsApi = (): API => {
  api ??= new API({ cwd: ROOT_DIR });
  return api;
};

export interface TsconfigProject {
  project: Project;
  //? Owns the Program's memory in the compiler process; dispose it (or the
  //? whole API) when the Program is no longer needed.
  snapshot: Snapshot;
}

//? A Program plus checker over every file one tsconfig includes.
export const openTsconfigProject = (tsconfigPath: string): TsconfigProject => {
  const tsApi = getTsApi();
  const { fileNames, options } = tsApi.parseConfigFile(tsconfigPath);
  const snapshot = tsApi.createSnapshot({ createPrograms: [{ rootFiles: fileNames, compilerOptions: options }] });
  const [program] = snapshot.operation.createdPrograms;
  return { project: program.getProject(), snapshot };
};

//? The server Program: every file `tsconfig.server.json` includes, plus the
//? checker over it. Cached until `invalidateProgramCache()` — the generator and
//? the hot-reload loader invalidate it whenever source files may have changed.
export const getServerProgram = (): Project => {
  if (serverProject) return serverProject;

  const tsconfigPath = path.join(ROOT_DIR, 'tsconfig.server.json');
  if (!fs.existsSync(tsconfigPath)) throw new Error('[TypeProgram] tsconfig.server.json not found');

  const { project, snapshot } = openTsconfigProject(tsconfigPath);
  serverSnapshot = snapshot;
  serverProject = project;
  return project;
};

export const invalidateProgramCache = (): void => {
  serverSnapshot?.dispose();
  serverSnapshot = null;
  serverProject = null;
};

//? Stops the compiler process. Safe to call when none is running; the next
//? parse or Program request simply starts a new one.
export const disposeTsApi = (): void => {
  invalidateProgramCache();
  api?.close();
  api = null;
};

//? Syntax-only parse; the script kind follows the file extension unless given.
//? The returned tree lives in this process, so the lease that keeps the
//? compiler's copy alive (needed only for checker queries on the file) is
//? released at once.
export const parseSourceText = (fileName: string, text: string, scriptKind?: ScriptKind): SourceFile => {
  const retained = getTsApi().createSourceFile(fileName, text, scriptKind === undefined ? undefined : { scriptKind });
  retained.dispose();
  return retained.sourceFile;
};

//? Transpile one file in isolation; with `reportDiagnostics` the result carries
//? its syntax errors, which is how callers check that rewritten source is valid.
export const transpileSourceText = (fileName: string, text: string): TranspileOutput => {
  return getTsApi().transpileModule(text, { fileName, reportDiagnostics: true });
};
