import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import { getGeneratedApiDocsPath, getGeneratedApiSchemasPath, getGeneratedSocketTypesPath } from '@luckystack/core';

import { mustGet } from '../internal/mapUtils';
import { typeTextToZodSource } from './zodEmitter';
import { findExtractionFailure } from './extractionDiagnostics';

//? `auth` is consumer-defined opaque — each project exports its own
//? `AuthProps` shape from `config.ts`. The emitter passes the parsed value
//? through to the generated JSON.
//? Forward declaration mirrored from `apiMeta.ts:DocsMeta`. Kept local to
//? avoid a circular import between the type-map collectors and the emitter.
export interface DocsMetaSnapshot {
	owner?: string;
	tags?: string[];
	deprecated?: string | true;
}

export interface ApiTypeEntry {
	input: string;
	output: string;
	stream: string;
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	rateLimit: number | false | undefined;
	auth: unknown;
	version: string;
	//? Optional `@docs owner/tags/deprecated` metadata. Set when the route
	//? file declares any of these JSDoc sub-keys. Surfaced in
	//? `apiDocs.generated.json` so `@luckystack/docs-ui` can render it.
	meta?: DocsMetaSnapshot;
}

interface ApiDocsEntry {
	page: string;
	name: string;
	version: string;
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	input: string;
	output: string;
	stream: string;
	rateLimit: number | false | undefined;
	auth: unknown;
	path: string;
	meta?: DocsMetaSnapshot;
}

interface SyncDocsEntry {
	page: string;
	name: string;
	version: string;
	clientInput: string;
	serverOutput: string;
	clientOutput: string;
	serverStream: string;
	clientStream: string;
	path: string;
	meta?: DocsMetaSnapshot;
}

export interface GeneratedDocsData {
	apis: Record<string, ApiDocsEntry[]>;
	syncs: Record<string, SyncDocsEntry[]>;
}

export interface SyncTypeEntry {
	clientInput: string;
	serverOutput: string;
	clientOutput: string;
	serverStream: string;
	clientStream: string;
	version: string;
	meta?: DocsMetaSnapshot;
}

const buildImportStatements = ({
	namedImports,
	defaultImports,
}: {
	namedImports: Map<string, Set<string>>;
	defaultImports: Map<string, string>;
}): string => {
	let importStatements = '';
	for (const [importPath, types] of namedImports) {
		importStatements += `import { ${[...types].join(', ')} } from "${importPath}";\n`;
	}
	for (const [importPath, defaultName] of defaultImports) {
		importStatements += `import ${defaultName} from "${importPath}";\n`;
	}
	return importStatements;
};

const splitVersionedKey = (value: string): { name: string; version: string } => {
	const [name, version] = value.split('@');
	return { name: name ?? '', version: version ?? 'v1' };
};

const writeFileIfChanged = (filePath: string, content: string): boolean => {
	if (fs.existsSync(filePath)) {
		const currentContent = fs.readFileSync(filePath, 'utf8');
		if (currentContent === content) {
			return false;
		}
	}

	fs.writeFileSync(filePath, content, 'utf8');
	return true;
};

const indentStr = (str: string, indentText: string): string => {
	return str.split('\n').map((line, i) => i === 0 ? line : indentText + line).join('\n');
};

//? DEVKIT-1 safety net. `expandTypeDetailed` already skips symbol-keyed props
//? on the structural path, but its `checker.typeToString` FALLBACKS (cycle
//? detection + depth limit — both routinely hit by self-referential MikroORM
//? entities) re-serialize the whole entity, re-introducing the invalid
//? `__@<name>@<id>` markers. This removes any that slipped through, brace-aware
//? because a member's value can be a multi-line object literal.
export const stripSymbolKeyedMembers = (text: string): string => {
	if (!text.includes('__@')) return text;
	let result = text;
	for (;;) {
		const match = /__@\w+@\d+\??\s*:/.exec(result);
		if (!match) break;
		const symStart = match.index;
		const lineStart = result.lastIndexOf('\n', symStart) + 1;
		let i = symStart + match[0].length;
		let depth = 0;
		let end = result.length;
		while (i < result.length) {
			const ch = result[i];
			if (ch === '{' || ch === '[' || ch === '(') {
				depth++;
			} else if (ch === '}' || ch === ']' || ch === ')') {
				if (depth === 0) { end = i; break; } //? parent closer — member had no trailing ';'
				depth--;
			} else if (ch === ';' && depth === 0) { end = i + 1; break; }
			i++;
		}
		//? Swallow the newline left behind by a consumed ';' so no blank line remains.
		if (result[end] === '\n') end += 1;
		result = result.slice(0, lineStart) + result.slice(end);
	}
	return result;
};

const validateGeneratedTypeIdentifiers = (content: string): void => {
	const sourceFile = ts.createSourceFile('apiTypes.generated.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const knownSymbols = new Set<string>();
	const referencedSymbols = new Set<string>();

	const builtIns = new Set([
		'string', 'number', 'boolean', 'null', 'undefined', 'unknown', 'any', 'never', 'void', 'object', 'bigint', 'symbol',
		'Record', 'Partial', 'Required', 'Pick', 'Omit', 'Readonly', 'Exclude', 'Extract', 'NonNullable', 'ReturnType',
		'Awaited', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Array', 'ReadonlyArray', 'Date', 'Error', 'RegExp',
		'True', 'False', 'JsonPrimitive', 'JsonValue', 'JsonObject', 'JsonArray',
	]);

	const addDeclaredName = (name?: ts.Identifier): void => {
		if (!name?.text) return;
		knownSymbols.add(name.text);
	};

	const collectTypeParams = (node: ts.Node): void => {
		if (!('typeParameters' in node)) return;
		const maybeTypeParameters = (node as ts.Node & { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters;
		if (!maybeTypeParameters) return;
		for (const typeParameter of maybeTypeParameters) {
			knownSymbols.add(typeParameter.name.text);
		}
	};

	const collectKnownSymbols = (node: ts.Node): void => {
		if (ts.isInferTypeNode(node)) {
			knownSymbols.add(node.typeParameter.name.text);
		}

		if (ts.isMappedTypeNode(node)) {
			knownSymbols.add(node.typeParameter.name.text);
		}

		if (ts.isImportDeclaration(node)) {
			const importClause = node.importClause;
			if (importClause?.name) knownSymbols.add(importClause.name.text);
			if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
				for (const importElement of importClause.namedBindings.elements) {
					knownSymbols.add((importElement.propertyName ?? importElement.name).text);
				}
			}
			if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
				knownSymbols.add(importClause.namedBindings.name.text);
			}
		}

		if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node) || ts.isFunctionDeclaration(node)) {
			addDeclaredName(node.name);
			collectTypeParams(node);
		}

		if (ts.isTypeReferenceNode(node)) {
			const typeName = node.typeName;
			if (ts.isIdentifier(typeName)) {
				referencedSymbols.add(typeName.text);
			}
			if (ts.isQualifiedName(typeName) && ts.isIdentifier(typeName.left)) {
				referencedSymbols.add(typeName.left.text);
			}
		}

		ts.forEachChild(node, collectKnownSymbols);
	};

	collectKnownSymbols(sourceFile);

	const unknown = [...referencedSymbols]
		.filter((name) => !knownSymbols.has(name) && !builtIns.has(name))
		.toSorted();

	if (unknown.length > 0) {
		throw new Error(`[TypeMapGenerator] Generated type map has unresolved type identifiers: ${unknown.join(', ')}`);
	}
};

export interface DiagnosticsEntry {
	route: string;
	kind: 'api' | 'sync';
	field: string;
	fallback: string;
	reason: string;
	//? Present only for `reason: 'extraction-error'` — the thrown error's
	//? message. Without it the `console.error` at extraction time is the only
	//? record of WHY the shape was lost, and that is gone by the time anyone
	//? reads the artifact.
	detail?: string;
}

export interface GeneratedDiagnosticsData {
	generatedAt: string;
	totalRoutes: number;
	fallbackCount: number;
	fallbacks: DiagnosticsEntry[];
}

//? Detects type fields that fell back to a degraded default. Four signals:
//? 1. The extraction THREW — `expandTypeDetailed` raised and `extractors.ts`
//?    swallowed it into the DEFAULT. Checked FIRST, because it produces the same
//?    `{ }` / `{ status: string }` text as signal 2 but has a different cause and
//?    a different fix: signal 2 means "no shape was declared", this means "a
//?    shape WAS declared and we lost it". Conflating them is what let DEVKIT-1
//?    (every MikroORM-entity route silently degrading to `{ status: string }`)
//?    hide in plain sight.
//? 2. `{ }` on input/clientInput — getSourceFile miss or missing ApiParams.data.
//? 3. `{ status: string }` on output — main function has no typed return shape.
//? 4. `z.any()` in the Zod schema source — zodEmitter hit an unsupported TypeNode.
//? These are not hard errors but lose type safety on the affected routes.
const collectFallbacks = (
	typesByPage: Map<string, Map<string, ApiTypeEntry>>,
	syncTypesByPage: Map<string, Map<string, SyncTypeEntry>>,
): DiagnosticsEntry[] => {
	const entries: DiagnosticsEntry[] = [];

	const flagField = (
		route: string,
		kind: 'api' | 'sync',
		field: string,
		value: string,
		checkZod = false,
	): void => {
		const extractionError = findExtractionFailure(route, kind, field);
		if (extractionError !== undefined) {
			entries.push({ route, kind, field, fallback: value, reason: 'extraction-error', detail: extractionError });
			return;
		}
		if (value === '{ }' || value === '{ status: string }') {
			entries.push({ route, kind, field, fallback: value, reason: 'default-fallback' });
			return;
		}
		//? The generated Zod artifact contains API INPUT schemas only. Running
		//? this check on outputs/sync/streams produces false diagnostics for a
		//? converter that is never used on those fields.
		const zodSrc = checkZod ? typeTextToZodSource(value) : null;
		if (zodSrc?.includes('z.any()')) {
			entries.push({ route, kind, field, fallback: value.slice(0, 80), reason: 'zod-any-fallback' });
		}
	};

	for (const [pagePath, apis] of typesByPage) {
		for (const [apiKey, entry] of apis) {
			const { name, version } = splitVersionedKey(apiKey);
			const route = `${pagePath}/${name}@${version}`;
			flagField(route, 'api', 'input', entry.input, true);
			flagField(route, 'api', 'output', entry.output);
			flagField(route, 'api', 'stream', entry.stream);
		}
	}

	for (const [pagePath, syncs] of syncTypesByPage) {
		for (const [syncKey, entry] of syncs) {
			const { name, version } = splitVersionedKey(syncKey);
			const route = `${pagePath}/${name}@${version}`;
			flagField(route, 'sync', 'clientInput', entry.clientInput);
			flagField(route, 'sync', 'serverOutput', entry.serverOutput);
			flagField(route, 'sync', 'clientOutput', entry.clientOutput);
			flagField(route, 'sync', 'serverStream', entry.serverStream);
			flagField(route, 'sync', 'clientStream', entry.clientStream);
		}
	}

	return entries;
};

export const buildTypeMapArtifacts = ({
	typesByPage,
	syncTypesByPage,
	namedImports,
	defaultImports,
	functionsInterface,
}: {
	typesByPage: Map<string, Map<string, ApiTypeEntry>>;
	syncTypesByPage: Map<string, Map<string, SyncTypeEntry>>;
	namedImports: Map<string, Set<string>>;
	defaultImports: Map<string, string>;
	functionsInterface: string;
}) => {
	const importStatements = buildImportStatements({ namedImports, defaultImports });

	let content = `/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/* eslint-disable @typescript-eslint/ban-types */

/**
 * Auto-generated type map for all API and Sync endpoints.
 * Enables type-safe apiRequest and syncRequest calls.
 */

${importStatements}
export interface Functions {
${functionsInterface}
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
	[key: string]: JsonValue | undefined;
}
export type JsonArray = JsonValue[];
export type MaybePromise<T> = T | Promise<T>;

export type StreamPayload = {
	[key: string]: unknown;
};

export type ApiStreamEmitter<T extends StreamPayload = StreamPayload> = (payload?: T) => void | Promise<void>;
export type SyncServerStreamEmitter<T extends StreamPayload = StreamPayload> = (payload?: T) => void | Promise<void>;
export type SyncClientStreamEmitter<T extends StreamPayload = StreamPayload> = (payload?: T) => void | Promise<void>;
//? Broadcast — fan-out to every socket in the receiver room (cross-instance via the Redis adapter).
export type SyncBroadcastStreamEmitter<T extends StreamPayload = StreamPayload> = (payload?: T) => void;
//? Targeted — emit only to the listed session tokens (each token is its own room).
export type SyncStreamToEmitter<T extends StreamPayload = StreamPayload> = (
	tokens: string | string[],
	payload?: T,
) => void;

// 
// API Type Definitions
// 

export type ApiResponse<T = unknown> =
	| ({ status: 'success'; httpStatus?: number; APINAME?: never; [key: string]: unknown } & T)
	| { status: 'error'; httpStatus?: number; errorCode: string; errorParams?: { key: string; value: string | number | boolean; }[]; APINAME?: never };

export type ApiNetworkResponse<T = unknown> =
	| ({ status: 'success'; httpStatus: number; APINAME?: never; [key: string]: unknown } & T)
	| { status: 'error'; httpStatus: number; message: string; errorCode: string; errorParams?: { key: string; value: string | number | boolean; }[]; APINAME?: never };

//
// API Type Map
//

type _ProjectApiTypeMap = {
`;

	const sortedPages = [...typesByPage.keys()].toSorted();
	const sortedSyncPages = [...syncTypesByPage.keys()].toSorted();
	const docsData: GeneratedDocsData = { apis: {}, syncs: {} };

	for (const pagePath of sortedPages) {
		const apis = mustGet(typesByPage, pagePath, 'typesByPage');
		const grouped = new Map<string, { version: string; entry: ApiTypeEntry }[]>();

		docsData.apis[pagePath] = [];

		for (const [apiKey, entry] of apis.entries()) {
			const { name, version } = splitVersionedKey(apiKey);
			if (!grouped.has(name)) grouped.set(name, []);
			mustGet(grouped, name, 'grouped').push({ version, entry });
		}

		content += `  '${pagePath}': {\n`;
		for (const apiName of [...grouped.keys()].toSorted()) {
			content += `    '${apiName}': {\n`;
			for (const { version, entry } of mustGet(grouped, apiName, 'grouped').toSorted((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))) {
				docsData.apis[pagePath].push({
					page: pagePath,
					name: apiName,
					version,
					method: entry.method,
					input: entry.input,
					output: entry.output,
					stream: entry.stream,
					rateLimit: entry.rateLimit,
					auth: entry.auth,
					//? extractPagePath never yields 'root' for the src-root (it yields 'system'),
					//? and a page folder literally named `root` must route as `api/root/...` — so
					//? the old `pagePath === 'root'` special-case emitted a non-matching docs path.
					//? Always use the full path (mirrors the already-fixed sync side).
					path: `api/${pagePath}/${apiName}/${version}`,
					...(entry.meta ? { meta: entry.meta } : {}),
				});

				content += `      '${version}': {\n`;
				content += `        input: ${indentStr(entry.input, '        ')};\n`;
				//? Union the framework error envelope so ApiOutput<P,N,V> covers the
				//? error branch without a Rule-21-forbidden cast at every call site.
				//? DEVKIT-3: the error arm lists its real fields EXPLICITLY (mirroring
				//? ApiResponse's error arm) so `errorCode`/`message`/`errorParams`/
				//? `httpStatus` narrow to their real types after a status check. The
				//? trailing `[key: string]: unknown` stays for forward-compat, but an
				//? explicit member always wins over the index signature, so it no
				//? longer poisons those fields to `unknown`.
				content += `        output: ${indentStr(entry.output, '        ')} | { status: 'error'; errorCode: string; message?: string; errorParams?: { key: string; value: string | number | boolean }[]; httpStatus?: number; [key: string]: unknown };\n`;
				content += `        stream: ${indentStr(entry.stream, '        ')};\n`;
				content += `        method: '${entry.method}';\n`;
				if (entry.rateLimit !== undefined) {
					content += `        rateLimit: ${entry.rateLimit};\n`;
				}
				content += `      };\n`;
			}
			content += `    };\n`;
		}
		content += `  };\n`;
	}

	content += `};

export interface ApiTypeMap extends _ProjectApiTypeMap {}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type PagePath = keyof ApiTypeMap;
export type ApiName<P extends PagePath> = keyof ApiTypeMap[P];
export type ApiVersion<P extends PagePath, N extends ApiName<P>> = keyof ApiTypeMap[P][N];
export type ApiInput<P extends PagePath, N extends ApiName<P>, V extends ApiVersion<P, N> = ApiVersion<P, N>> = ApiTypeMap[P][N][V] extends { input: infer I } ? I : never;
export type ApiOutput<P extends PagePath, N extends ApiName<P>, V extends ApiVersion<P, N> = ApiVersion<P, N>> = ApiTypeMap[P][N][V] extends { output: infer O } ? O : never;
export type ApiStream<P extends PagePath, N extends ApiName<P>, V extends ApiVersion<P, N> = ApiVersion<P, N>> = ApiTypeMap[P][N][V] extends { stream: infer S } ? S : never;
export type ApiMethod<P extends PagePath, N extends ApiName<P>, V extends ApiVersion<P, N> = ApiVersion<P, N>> = ApiTypeMap[P][N][V] extends { method: infer M } ? M : never;

export type FullApiPath<P extends PagePath, N extends ApiName<P>, V extends ApiVersion<P, N>> = \`api/\${P}/\${N & string}/\${V & string}\`;

export const apiMethodMap: Record<string, Record<string, Record<string, HttpMethod>>> = {
`;

	for (const pagePath of sortedPages) {
		const apis = mustGet(typesByPage, pagePath, 'typesByPage');
		const grouped = new Map<string, { version: string; method: string }[]>();

		for (const [apiKey, entry] of apis.entries()) {
			const { name, version } = splitVersionedKey(apiKey);
			if (!grouped.has(name)) grouped.set(name, []);
			mustGet(grouped, name, 'grouped').push({ version, method: entry.method });
		}

		content += `  '${pagePath}': {\n`;
		for (const apiName of [...grouped.keys()].toSorted()) {
			content += `    '${apiName}': {`;
			const methods = mustGet(grouped, apiName, 'grouped')
				.toSorted((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
				.map((item) => ` '${item.version}': '${item.method}'`)
				.join(',');
			content += `${methods} },\n`;
		}
		content += `  },\n`;
	}

	content += `};

export const getApiMethod = (pagePath: string, apiName: string, version: string): HttpMethod | undefined => {
	return apiMethodMap[pagePath]?.[apiName]?.[version];
};

export interface ApiMetaEntry {
	method: HttpMethod;
	auth: { login: boolean; additional?: Record<string, unknown>[]; hasAdditional?: boolean };
	rateLimit?: number | false;
}

export const apiMetaMap: Record<string, Record<string, Record<string, ApiMetaEntry>>> = {
`;

	for (const pagePath of sortedPages) {
		const apis = mustGet(typesByPage, pagePath, 'typesByPage');
		const grouped = new Map<string, { version: string; entry: ApiTypeEntry }[]>();

		for (const [apiKey, entry] of apis.entries()) {
			const { name, version } = splitVersionedKey(apiKey);
			if (!grouped.has(name)) grouped.set(name, []);
			mustGet(grouped, name, 'grouped').push({ version, entry });
		}

		content += `  '${pagePath}': {\n`;
		for (const apiName of [...grouped.keys()].toSorted()) {
			content += `    '${apiName}': {\n`;
			for (const { version, entry } of mustGet(grouped, apiName, 'grouped').toSorted((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))) {
				const auth = entry.auth && typeof entry.auth === 'object'
					? entry.auth as { login: boolean; additional?: Record<string, unknown>[]; hasAdditional?: boolean }
					: { login: false, hasAdditional: false };
				const rateLimitPart = entry.rateLimit === undefined
					? ''
					: `, rateLimit: ${entry.rateLimit === false ? 'false' : String(entry.rateLimit)}`;
				const additionalPart = auth.additional && auth.additional.length > 0
					? `, additional: ${JSON.stringify(auth.additional)}`
					: '';
				content += `      '${version}': { method: '${entry.method}', auth: { login: ${auth.login ? 'true' : 'false'}${additionalPart}${auth.hasAdditional ? ', hasAdditional: true' : ''} }${rateLimitPart} },\n`;
			}
			content += `    },\n`;
		}
		content += `  },\n`;
	}

	content += `};

export const getApiMeta = (pagePath: string, apiName: string, version: string): ApiMetaEntry | undefined => {
	return apiMetaMap[pagePath]?.[apiName]?.[version];
};

// Sync Type Definitions
// 

export type SyncServerResponse<T = unknown> =
	| ({ status: 'success'; [key: string]: unknown } & T)
	| { status: 'error'; errorCode: string; errorParams?: { key: string; value: string | number | boolean; }[] };

export type SyncClientResponse<T = unknown> =
	| ({ status: 'success'; [key: string]: unknown } & T)
	| { status: 'error'; errorCode: string; errorParams?: { key: string; value: string | number | boolean; }[] };

//
// Sync Type Map
//

type _ProjectSyncTypeMap = {
`;

	for (const pagePath of sortedSyncPages) {
		const syncs = mustGet(syncTypesByPage, pagePath, 'syncTypesByPage');
		const grouped = new Map<string, { version: string; entry: SyncTypeEntry }[]>();
		docsData.syncs[pagePath] = [];

		for (const [syncKey, entry] of syncs.entries()) {
			const { name, version } = splitVersionedKey(syncKey);
			if (!grouped.has(name)) grouped.set(name, []);
			mustGet(grouped, name, 'grouped').push({ version, entry });
		}

		content += `  '${pagePath}': {\n`;
		for (const syncName of [...grouped.keys()].toSorted()) {
			content += `    '${syncName}': {\n`;
			for (const { version, entry } of mustGet(grouped, syncName, 'grouped').toSorted((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))) {
				docsData.syncs[pagePath].push({
					page: pagePath,
					name: syncName,
					version,
					clientInput: entry.clientInput,
					serverOutput: entry.serverOutput,
					clientOutput: entry.clientOutput,
					serverStream: entry.serverStream,
					clientStream: entry.clientStream,
					//? `extractSyncPagePath` returns the `'system'` sentinel (NOT
					//? `'root'`) for a src-root sync, matching the loader's runtime key
					//? (`sync/system/<name>/<version>`) AND the wire name the typed
					//? `syncRequest` sends. The old `pagePath === 'root'` branch is now
					//? dead and would emit a non-matching path, so it is removed.
					path: `sync/${pagePath}/${syncName}/${version}`,
					...(entry.meta ? { meta: entry.meta } : {}),
				});

				content += `      '${version}': {\n`;
				content += `        clientInput: ${indentStr(entry.clientInput, '        ')};\n`;
				//? Same error-envelope union as API output (DEVKIT-3: explicit error
				//? fields so they narrow, index signature only for forward-compat).
				content += `        serverOutput: ${indentStr(entry.serverOutput, '        ')} | { status: 'error'; errorCode: string; message?: string; errorParams?: { key: string; value: string | number | boolean }[]; [key: string]: unknown };\n`;
				content += `        clientOutput: ${indentStr(entry.clientOutput, '        ')} | { status: 'error'; errorCode: string; message?: string; errorParams?: { key: string; value: string | number | boolean }[]; [key: string]: unknown };\n`;
				content += `        serverStream: ${indentStr(entry.serverStream, '        ')};\n`;
				content += `        clientStream: ${indentStr(entry.clientStream, '        ')};\n`;
				content += `      };\n`;
			}
			content += `    };\n`;
		}
		content += `  };\n`;
	}

	content += `};

export interface SyncTypeMap extends _ProjectSyncTypeMap {}

export type SyncPagePath = keyof SyncTypeMap;
export type SyncName<P extends SyncPagePath> = keyof SyncTypeMap[P];
export type SyncVersion<P extends SyncPagePath, N extends SyncName<P>> = keyof SyncTypeMap[P][N];
export type SyncClientInput<P extends SyncPagePath, N extends SyncName<P>, V extends SyncVersion<P, N> = SyncVersion<P, N>> = SyncTypeMap[P][N][V] extends { clientInput: infer C } ? C : never;
export type SyncServerOutput<P extends SyncPagePath, N extends SyncName<P>, V extends SyncVersion<P, N> = SyncVersion<P, N>> = SyncTypeMap[P][N][V] extends { serverOutput: infer S } ? S : never;
export type SyncClientOutput<P extends SyncPagePath, N extends SyncName<P>, V extends SyncVersion<P, N> = SyncVersion<P, N>> = SyncTypeMap[P][N][V] extends { clientOutput: infer O } ? O : never;
export type SyncServerStream<P extends SyncPagePath, N extends SyncName<P>, V extends SyncVersion<P, N> = SyncVersion<P, N>> = SyncTypeMap[P][N][V] extends { serverStream: infer S } ? S : never;
export type SyncClientStream<P extends SyncPagePath, N extends SyncName<P>, V extends SyncVersion<P, N> = SyncVersion<P, N>> = SyncTypeMap[P][N][V] extends { clientStream: infer O } ? O : never;

export type FullSyncPath<P extends SyncPagePath, N extends SyncName<P>, V extends SyncVersion<P, N>> = \`sync/\${P}/\${N & string}/\${V & string}\`;

//
// Type-level augmentation — merges the project's concrete ApiTypeMap / SyncTypeMap
// into the @luckystack/core/typemap stub-declaration module so framework code
// (apiRequest / syncRequest) sees the project routes without deep-relative
// imports. Augmenting the module that DECLARES the stubs (not the re-exporting
// barrel) is what makes the merge land for consumers installing the built dist.
//
declare module '@luckystack/core/typemap' {
	interface ApiTypeMap extends _ProjectApiTypeMap {}
	interface SyncTypeMap extends _ProjectSyncTypeMap {}
}
`;

	//? DEVKIT-1: final safety net against symbol-keyed markers that reached the
	//? emitted text through a typeToString fallback (see stripSymbolKeyedMembers).
	content = stripSymbolKeyedMembers(content);

	validateGeneratedTypeIdentifiers(content);

	//? Zod schemas for every API input. Runtime validators + test-runner fuzz
	//? use this file. Emitted alongside the type map so the two always track.
	const schemasContent = buildSchemasContent({ typesByPage });

	//? Diagnostics: collect routes with degraded type extraction so the
	//? generator exposes them in a machine-readable file rather than only
	//? logging to stderr. Consumers and CI can grep this file for fallbacks
	//? without parsing the generated TS source.
	const fallbacks = collectFallbacks(typesByPage, syncTypesByPage);
	const totalRoutes = [...typesByPage.values()].reduce((n, m) => n + m.size, 0)
		+ [...syncTypesByPage.values()].reduce((n, m) => n + m.size, 0);
	const diagnosticsData: GeneratedDiagnosticsData = {
		generatedAt: new Date().toISOString(),
		totalRoutes,
		fallbackCount: fallbacks.length,
		fallbacks,
	};

	return { content, docsData, schemasContent, diagnosticsData };
};

const buildSchemasContent = ({
	typesByPage,
}: {
	typesByPage: Map<string, Map<string, ApiTypeEntry>>;
}): string => {
	const sortedPages = [...typesByPage.keys()].toSorted();

	let body = `/* eslint-disable */
//? Auto-generated Zod schemas for every API input. Driven by the same walk
//? as apiTypes.generated.ts; see @luckystack/devkit/src/typeMap/zodEmitter.ts
//? for the TS-AST â†’ Zod converter. Types that fall outside the converter's
//? scope emit \`z.any()\` with a TODO comment.

import { z } from 'zod';

export const apiInputSchemas: Record<string, Record<string, Record<string, z.ZodTypeAny>>> = {
`;

	for (const pagePath of sortedPages) {
		const apis = mustGet(typesByPage, pagePath, 'typesByPage');
		const grouped = new Map<string, { version: string; entry: ApiTypeEntry }[]>();

		for (const [apiKey, entry] of apis.entries()) {
			const { name, version } = splitVersionedKey(apiKey);
			if (!grouped.has(name)) grouped.set(name, []);
			mustGet(grouped, name, 'grouped').push({ version, entry });
		}

		body += `  '${pagePath}': {\n`;
		for (const apiName of [...grouped.keys()].toSorted()) {
			body += `    '${apiName}': {\n`;
			for (const { version, entry } of mustGet(grouped, apiName, 'grouped').toSorted(
				(a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }),
			)) {
				const schemaSrc = typeTextToZodSource(entry.input) ?? 'z.any() /* unparseable input type */';
				body += `      '${version}': ${schemaSrc},\n`;
			}
			body += `    },\n`;
		}
		body += `  },\n`;
	}

	body += `};

export const getApiInputSchema = (
	pagePath: string,
	apiName: string,
	version: string,
): z.ZodTypeAny | undefined => {
	return apiInputSchemas[pagePath]?.[apiName]?.[version];
};
`;

	return body;
};

export const writeTypeMapArtifacts = ({
	content,
	docsData,
	schemasContent,
	diagnosticsData,
}: {
	content: string;
	docsData: GeneratedDocsData;
	schemasContent?: string;
	diagnosticsData?: GeneratedDiagnosticsData;
}) => {
	try {
		const outputPath = getGeneratedSocketTypesPath();
		const hasUpdatedTypeMap = writeFileIfChanged(outputPath, content);
		if (hasUpdatedTypeMap) {
			console.log('[TypeMapGenerator] Generated apiTypes.generated.ts');
		}

		if (schemasContent !== undefined) {
			const hasUpdatedSchemas = writeFileIfChanged(getGeneratedApiSchemasPath(), schemasContent);
			if (hasUpdatedSchemas) {
				console.log('[TypeMapGenerator] Generated apiInputSchemas.generated.ts');
			}
		}

		const docsPath = getGeneratedApiDocsPath();
		const docsDir = path.dirname(docsPath);
		if (!fs.existsSync(docsDir)) {
			fs.mkdirSync(docsDir, { recursive: true });
		}
		const docsContent = JSON.stringify(docsData, null, 2);
		const hasUpdatedDocs = writeFileIfChanged(docsPath, docsContent);
		if (hasUpdatedDocs) {
			console.log('[TypeMapGenerator] Generated apiDocs.generated.json');
		}

		if (diagnosticsData !== undefined) {
			//? Placed next to apiDocs.generated.json so the same docs dir is reused.
			//? Routes listed here have degraded type extraction (see DiagnosticsEntry.reason).
			const diagnosticsPath = path.join(path.dirname(docsPath), 'apiTypeDiagnostics.generated.json');
			const diagnosticsContent = JSON.stringify(diagnosticsData, null, 2);
			const hasUpdatedDiagnostics = writeFileIfChanged(diagnosticsPath, diagnosticsContent);
			if (hasUpdatedDiagnostics) {
				console.log('[TypeMapGenerator] Generated apiTypeDiagnostics.generated.json');
			}
			if (diagnosticsData.fallbackCount > 0) {
				console.warn(`[TypeMapGenerator] ${diagnosticsData.fallbackCount} route(s) have degraded type extraction (see apiTypeDiagnostics.generated.json)`);
			}
		}
	} catch (error) {
		console.error('[TypeMapGenerator] Error writing type map or docs:', error);
	}
};

