import fs from 'node:fs';
import path from 'node:path';
import { ScriptKind, type Node } from 'typescript-7-api/ast';
import {
	isIdentifier,
	isImportDeclaration,
	isInterfaceDeclaration,
	isNamedImports,
	isParenthesizedTypeNode,
	isStringLiteral,
	isTypeAliasDeclaration,
} from 'typescript-7-api/ast/is';
import { getGeneratedSocketTypesPath } from '@luckystack/core';

import { getOrInit } from '../internal/mapUtils';
import { buildTypeMapArtifacts } from './emitterArtifacts';
import type { ImportCollectors } from './typeContext';
import { invalidateProgramCache, parseSourceText } from './tsApi';

//? Route handlers import `Functions`, `ApiResponse`, `SyncServerResponse` and
//? the other shared types from `apiTypes.generated.ts`. Route extraction reads
//? those types through the server Program, so the route-independent part of
//? that file (imports, `Functions`, the shared types) must be current BEFORE
//? routes are extracted. Otherwise, on a clean checkout, every route output
//? that depends on them is extracted as `any` and a second run is needed.
export interface FixedTypeMapPart extends ImportCollectors {
	functionsInterface: string;
}

//? The only declarations whose body lists routes (see the template in
//? `buildTypeMapArtifacts`). Everything else in the bootstrap is fixed.
const ROUTE_MAP_TYPE_NAMES = new Set(['_ProjectApiTypeMap', '_ProjectSyncTypeMap']);

//? A Functions interface that itself reads the generated file can need a
//? second pass to settle; more than that means it never settles.
const MAX_BOOTSTRAP_WRITES = 2;

//? The full template with empty route maps: a valid file that declares every
//? fixed type, rendered by the same code as the final artifact.
const renderTypeMapBootstrap = (fixed: FixedTypeMapPart): string =>
	buildTypeMapArtifacts({ typesByPage: new Map(), syncTypesByPage: new Map(), ...fixed }).content;

//? Formatting-insensitive form of a declaration. Consumers format the generated
//? file (the scaffolded script runs prettier), so text comparison would fail on
//? every run. Separators, quotes and comments are not AST nodes; redundant type
//? parentheses are skipped because formatters add or drop them.
const canonicalNode = (node: Node): string => {
	if (isParenthesizedTypeNode(node)) return canonicalNode(node.type);
	const leafText = (node as { text?: unknown }).text;
	if (typeof leafText === 'string') return JSON.stringify(leafText);
	const children: string[] = [];
	node.forEachChild((child) => {
		children.push(canonicalNode(child));
	});
	return `${node.kind}(${children.join(',')})`;
};

interface FixedPartShape {
	declarations: Map<string, string>;
	namedImports: Map<string, Set<string>>;
	defaultImports: Map<string, string>;
}

const readFixedPartShape = (content: string): FixedPartShape => {
	const shape: FixedPartShape = { declarations: new Map(), namedImports: new Map(), defaultImports: new Map() };
	const sourceFile = parseSourceText('apiTypes.generated.ts', content, ScriptKind.TS);

	for (const statement of sourceFile.statements) {
		if (isInterfaceDeclaration(statement) || isTypeAliasDeclaration(statement)) {
			if (!ROUTE_MAP_TYPE_NAMES.has(statement.name.text)) {
				shape.declarations.set(statement.name.text, canonicalNode(statement));
			}
			continue;
		}
		if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue;
		const importPath = statement.moduleSpecifier.text;
		const clause = statement.importClause;
		if (clause?.name) shape.defaultImports.set(importPath, clause.name.text);
		if (clause?.namedBindings && isNamedImports(clause.namedBindings)) {
			for (const element of clause.namedBindings.elements) {
				const imported = element.propertyName ?? element.name;
				if (isIdentifier(imported)) getOrInit(shape.namedImports, importPath, () => new Set<string>()).add(imported.text);
			}
		}
	}

	return shape;
};

//? True when `existing` declares every fixed type exactly as `bootstrap` does
//? and has all of its imports. Route maps and route-only imports may differ.
const hasCurrentFixedPart = (existing: string, bootstrap: string): boolean => {
	if (existing === bootstrap) return true;
	const expected = readFixedPartShape(bootstrap);
	const actual = readFixedPartShape(existing);

	for (const [name, declaration] of expected.declarations) {
		if (actual.declarations.get(name) !== declaration) return false;
	}
	for (const [importPath, names] of expected.namedImports) {
		const actualNames = actual.namedImports.get(importPath);
		if (!actualNames || [...names].some((name) => !actualNames.has(name))) return false;
	}
	for (const [importPath, name] of expected.defaultImports) {
		if (actual.defaultImports.get(importPath) !== name) return false;
	}
	return true;
};

//? Makes the generated file's fixed part current before route extraction.
//? Steady state: one comparison, no write and no new Program. Otherwise it
//? writes the bootstrap file, drops the cached Program so the next one sees
//? the file, and renders the fixed part again on that Program.
export const prepareFixedTypeMapPart = (renderFixedPart: () => FixedTypeMapPart): FixedTypeMapPart => {
	const outputPath = getGeneratedSocketTypesPath();
	let fixed = renderFixedPart();

	for (let writes = 0; ; writes++) {
		const bootstrap = renderTypeMapBootstrap(fixed);
		const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
		if (existing !== null && hasCurrentFixedPart(existing, bootstrap)) return fixed;

		if (writes === MAX_BOOTSTRAP_WRITES) {
			console.warn(`[TypeMapGenerator] The Functions interface did not settle after ${MAX_BOOTSTRAP_WRITES} bootstrap writes; route types that depend on it may need another generation run.`);
			return fixed;
		}

		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, bootstrap, 'utf8');
		invalidateProgramCache();
		fixed = renderFixedPart();
	}
};
