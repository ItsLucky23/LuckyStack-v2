/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getProjectConfig } from './projectConfig';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWorkspaceRoot = (candidate: string): boolean => {
	return (
		fs.existsSync(path.join(candidate, 'package.json'))
		&& (
			fs.existsSync(path.join(candidate, 'tsconfig.json'))
			|| fs.existsSync(path.join(candidate, 'tsconfig.server.json'))
		)
	);
};

const findWorkspaceRoot = (startDir: string): string | null => {
	let current = path.resolve(startDir);

	while (true) {
		if (isWorkspaceRoot(current)) {
			return current;
		}

		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
};

export const ROOT_DIR =
	findWorkspaceRoot(process.cwd())
	?? findWorkspaceRoot(__dirname)
	?? process.cwd();

const resolveAgainstRoot = (relative: string): string =>
	path.isAbsolute(relative) ? relative : path.join(ROOT_DIR, relative);

//? Lazy getters: read from the registered ProjectConfig at *call time* so a
//? consumer's `registerProjectConfig({ paths: { srcDir: 'app/src' } })` wins
//? even if it ran after this module was imported.
export const getSrcDir = (): string => resolveAgainstRoot(getProjectConfig().paths.srcDir);
export const getServerDir = (): string => resolveAgainstRoot(getProjectConfig().paths.serverDir);
export const getSharedDir = (): string => resolveAgainstRoot(getProjectConfig().paths.sharedDir);
export const getUploadsDir = (): string => resolveAgainstRoot(getProjectConfig().paths.uploadsDir);
export const getPublicDir = (): string => resolveAgainstRoot(getProjectConfig().paths.publicDir);
export const getServerFunctionsDir = (): string =>
	resolveAgainstRoot(getProjectConfig().paths.serverFunctionsDir);

export const getGeneratedSocketTypesPath = (): string =>
	resolveAgainstRoot(getProjectConfig().paths.generatedSocketTypes);
export const getGeneratedApiSchemasPath = (): string =>
	resolveAgainstRoot(getProjectConfig().paths.generatedApiSchemas);
export const getGeneratedApiDocsPath = (): string =>
	resolveAgainstRoot(getProjectConfig().paths.generatedApiDocs);

//? Backwards-compatible constants resolved against the framework defaults at
//? module load. New code should use the getters above. These will continue to
//? work for projects that don't override `paths` in `registerProjectConfig`.
//? @deprecated use `getSrcDir()` etc. instead.
export const SRC_DIR = path.join(ROOT_DIR, 'src');
/** @deprecated use `getServerDir()` instead. */
export const SERVER_DIR = path.join(ROOT_DIR, 'server');
/** @deprecated use `getSharedDir()` instead. */
export const SHARED_DIR = path.join(ROOT_DIR, 'shared');

/** @deprecated use `getUploadsDir()` instead. */
export const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
/** @deprecated use `getPublicDir()` instead. */
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
/** @deprecated use `getServerFunctionsDir()` instead. */
export const SERVER_FUNCTIONS_DIR = path.join(SERVER_DIR, 'functions');

/** @deprecated use `getGeneratedSocketTypesPath()` instead. */
export const GENERATED_SOCKET_TYPES_PATH = path.join(SRC_DIR, '_sockets', 'apiTypes.generated.ts');
/** @deprecated use `getGeneratedApiSchemasPath()` instead. */
export const GENERATED_API_SCHEMAS_PATH = path.join(SRC_DIR, '_sockets', 'apiInputSchemas.generated.ts');
/** @deprecated use `getGeneratedApiDocsPath()` instead. */
export const GENERATED_API_DOCS_PATH = path.join(SRC_DIR, 'docs', 'apiDocs.generated.json');

export const TSCONFIG_ALIAS_FILES = ['tsconfig.server.json', 'tsconfig.client.json'];

export const resolveFromRoot = (...segments: string[]): string => path.join(ROOT_DIR, ...segments);
