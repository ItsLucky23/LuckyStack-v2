/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import {
  getInputTypeFromFile,
  getSyncClientDataType,
  API_VERSION_TOKEN_REGEX,
  SYNC_VERSION_TOKEN_REGEX,
  assertNoDuplicateNormalizedRouteKeys,
  assertValidRouteNaming,
} from '@luckystack/devkit';
import { ROOT_DIR, resolveFromRoot } from '@luckystack/core';
import { loadBuildConfig, validatePresetsAndServices, resolveRequestedPresets, getServicesForPreset } from '../server/config/presetLoader';

const normalizePath = (p: string) => p.split(path.sep).join("/");

const mapApiPagePath = (pagePath?: string): string => {
  return pagePath && pagePath.length > 0 ? pagePath : 'system';
};

const extractServiceFromPath = (workspaceRelativePath: string): string => {
  // path starts with src/
  // Either src/_api/... (system) or src/vehicles/_api/... (vehicles)
  const segments = workspaceRelativePath.split('/');
  if (segments.length > 1 && (segments[1] === '_api' || segments[1] === '_sync')) {
    return 'system';
  }
  return segments[1] || 'system';
};

// Recursively walk dirs to collect _api and _sync files
const walkSrcFiles = (dir: string, results: string[] = []) => {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      walkSrcFiles(fullPath, results);
    } else if (file.endsWith(".ts") && (fullPath.includes("_api") || fullPath.includes("_sync"))) {
      // if (file.endsWith("_client.ts")) continue; // skip client stubs
      results.push(fullPath);
    }
  }
  return results;
};

// Collect function files recursively
const walkFunctionFiles = (dir: string, results: string[] = []) => {
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      walkFunctionFiles(fullPath, results);
    } else if (entry.endsWith(".ts")) {
      results.push(normalizePath(fullPath));
    }
  }

  return results;
};

// --------------------
// Collect files
// --------------------
const buildConfig = loadBuildConfig();
validatePresetsAndServices(buildConfig);

const requestedArgs = process.argv.slice(2);
const targetPresets = resolveRequestedPresets(requestedArgs, buildConfig);

const srcDir = resolveFromRoot('src');
assertValidRouteNaming({
  srcDir,
  context: 'generating server request maps for build',
});
assertNoDuplicateNormalizedRouteKeys({
  srcDir,
  context: 'generating server request maps for build',
});

const rawSrcFiles = walkSrcFiles(srcDir).map(normalizePath).sort();

// Collect functions: project-level functions/ overrides server/functions/ by module name.
// This establishes the merge contract for Phase 1 (full registry, no pruning).
const serverFunctionFiles = walkFunctionFiles("./server/functions");
const projectFunctionFiles = walkFunctionFiles("./functions");

const functionFilesByName = new Map<string, string>();
for (const filePath of serverFunctionFiles) {
  functionFilesByName.set(path.basename(filePath, ".ts"), filePath);
}
// Project functions win on name collision — same key replaces the server default.
for (const filePath of projectFunctionFiles) {
  functionFilesByName.set(path.basename(filePath, ".ts"), filePath);
}
const functionFiles = Array.from(functionFilesByName.values()).sort();

// --------------------
// --------------------
// Iterate over each preset and build maps
// --------------------
for (const presetName of targetPresets) {
  const allowedServices = getServicesForPreset(presetName, buildConfig);

  const apiImports: string[] = [];
  const syncImports: string[] = [];
  const functionImports: string[] = [];

  let apiMap = "export const apis: Record<string, { auth: any, main: any, rateLimit?: number | false, httpMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE', inputType?: string, inputTypeFilePath?: string }> = {\n";
  let syncMap = "export const syncs: Record<string, { main: any, auth: Record<string, any>, inputType?: string, inputTypeFilePath?: string }> | any = {\n";
  let functionsMap = "export const functions: Record<string, any> = {\n";

  let apiCount = 0;
  let syncCount = 0;
  let fnCount = 0;

  // Process API + Sync
  rawSrcFiles.forEach((normalized) => {
    const workspaceRelativePath = normalizePath(path.relative(ROOT_DIR, normalized));
    const serviceName = extractServiceFromPath(workspaceRelativePath);

    if (!allowedServices.includes(serviceName)) return;

    const importPath = "../../" + workspaceRelativePath.replace(/\.ts$/, "");

    // API
    if (normalized.includes("_api/")) {
      const varName = `api${apiCount++}`;
      apiImports.push(`import * as ${varName} from '${importPath}';`);

      const match = normalized.match(/src\/(?:(.+?)\/)?_api\/(.+)\.ts$/i);
      if (!match) return;
      const [_, pagePath, apiNameWithVersion] = match;
      const versionMatch = apiNameWithVersion.match(API_VERSION_TOKEN_REGEX);
      if (!versionMatch) return;

      const version = `v${versionMatch[1]}`;
      const apiName = apiNameWithVersion.replace(API_VERSION_TOKEN_REGEX, '');
      const routeKey = `api/${mapApiPagePath(pagePath)}/${apiName}/${version}`;

      apiMap += `  "${routeKey}": (() => {\n    const mod = ${varName} as Record<string, any>;\n    return {\n      auth: "auth" in mod ? mod.auth : {},\n      main: mod.main,\n      rateLimit: mod.rateLimit as number | false | undefined,\n      httpMethod: mod.httpMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined,\n      inputType: ${JSON.stringify(getInputTypeFromFile(normalized))},\n      inputTypeFilePath: ${JSON.stringify(workspaceRelativePath)},\n    };\n  })(),\n`;
    }

    // Sync
    if (normalized.includes("_sync/")) {
      const match = normalized.match(/src\/(?:(.+?)\/)?_sync\/(.+)\.ts$/i);
      if (!match) return;
      const [_, pagePath, syncNameWithVersion] = match;
      const syncMatch = syncNameWithVersion.match(SYNC_VERSION_TOKEN_REGEX);
      if (!syncMatch) return;

      const kind = syncMatch[1];
      const version = `v${syncMatch[2]}`;
      const syncName = syncNameWithVersion.replace(SYNC_VERSION_TOKEN_REGEX, '');
      const routeKey = pagePath ? `sync/${pagePath}/${syncName}/${version}` : `sync/${syncName}/${version}`;

      if (kind === 'client') {
        const varName = `syncClient${syncCount++}`;
        syncImports.push(`import * as ${varName} from '${importPath}';`);
        syncMap += `  "${routeKey}_client": ${varName}.main,\n`;
      }

      if (kind === 'server') {
        const varName = `syncServer${syncCount++}`;
        syncImports.push(`import * as ${varName} from '${importPath}';`);
        const inputType = getSyncClientDataType(normalized);
        syncMap += `  "${routeKey}_server": { auth: "auth" in ${varName} ? ${varName}.auth : {}, main: ${varName}.main, inputType: ${JSON.stringify(inputType)}, inputTypeFilePath: ${JSON.stringify(workspaceRelativePath)} },\n`;
      }
    }
  });

  // Process Functions (Phase 1: all functions are included regardless of service)
  functionFiles.forEach((filePath) => {
    const importPath = "../../" + filePath.replace(/\.ts$/, "");
    const varName = `fn${fnCount++}`;
    const fileName = path.basename(filePath, ".ts");
    functionImports.push(`import * as ${varName} from '${importPath}';`);
    functionsMap += `  ${JSON.stringify(fileName)}: (() => {\n`;
    functionsMap += `    const { default: _default, ...named } = ${varName} as Record<string, any>;\n`;
    functionsMap += `    const cleaned = Object.fromEntries(Object.entries(named).filter(([key]) => key !== '__esModule'));\n`;
    functionsMap += `    if (Object.keys(cleaned).length > 0) return cleaned;\n`;
    functionsMap += `    return _default !== undefined ? { ${JSON.stringify(fileName)}: _default } : {};\n`;
    functionsMap += `  })(),\n`;
  });

  apiMap += "};\n";
  syncMap += "};\n";
  functionsMap += "};";

  const importStatements = [
    ...apiImports,
    "",
    ...syncImports,
    "",
    ...functionImports,
  ].join("\n");

  const output = `${importStatements}\n\n${apiMap}\n${syncMap}\n${functionsMap}`;

  const outFileName = `generatedApis.${presetName}.ts`;
  fs.writeFileSync(resolveFromRoot('server', 'prod', outFileName), output);
  console.log(`✅ server/prod/${outFileName} created for preset '${presetName}'`);
}

// Explicit exit: loading `@luckystack/{core,devkit}` transitively connects to
// Redis on import. Without an explicit exit the dangling ioredis handle keeps
// the event loop alive and the script hangs.
process.exit(0);