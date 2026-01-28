import fs from 'fs';
import path from 'path';

/**
 * Frontend Type Map Generator
 * 
 * Generates a complete type map for all API endpoints, enabling
 * type-safe apiRequest calls on the frontend.
 */

const SRC_DIR = path.join(process.cwd(), 'src');
const OUTPUT_FILE = path.join(SRC_DIR, '_sockets', 'apiTypes.generated.ts');

/**
 * Find all API files in the src directory
 */
const findAllApiFiles = (dir: string = SRC_DIR, results: string[] = []): string[] => {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        findAllApiFiles(fullPath, results);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const relativePath = fullPath.replace(/\\/g, '/');
        if (relativePath.includes('/_api/')) {
          results.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`[TypeMapGenerator] Error scanning directory ${dir}:`, error);
  }

  return results;
};

/**
 * Find all Sync server files (_sync/*_server.ts) in the src directory
 */
const findAllSyncFiles = (dir: string = SRC_DIR, results: string[] = []): string[] => {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        findAllSyncFiles(fullPath, results);
      } else if (entry.isFile() && entry.name.endsWith('_server.ts')) {
        const relativePath = fullPath.replace(/\\/g, '/');
        if (relativePath.includes('/_sync/')) {
          results.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`[TypeMapGenerator] Error scanning directory ${dir}:`, error);
  }

  return results;
};

/**
 * Find all Sync client files (_sync/*_client.ts) in the src directory
 */
const findAllSyncClientFiles = (dir: string = SRC_DIR, results: string[] = []): string[] => {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        findAllSyncClientFiles(fullPath, results);
      } else if (entry.isFile() && entry.name.endsWith('_client.ts')) {
        const relativePath = fullPath.replace(/\\/g, '/');
        if (relativePath.includes('/_sync/')) {
          results.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`[TypeMapGenerator] Error scanning directory ${dir}:`, error);
  }

  return results;
};

const extractPagePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/src\/(.+?)\/_api\//);
  return match ? match[1] : '';
};

const extractApiName = (filePath: string): string => {
  return path.basename(filePath, '.ts');
};

// Sync-specific extractors
const extractSyncPagePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/src\/(.+?)\/_sync\//);
  return match ? match[1] : '';
};

const extractSyncName = (filePath: string): string => {
  // Remove _server.ts or _client.ts suffix to get sync name
  // e.g., updateCounter_server.ts -> updateCounter
  // e.g., updateCounter_client.ts -> updateCounter
  const basename = path.basename(filePath, '.ts');
  return basename.replace(/_server$/, '').replace(/_client$/, '');
};

const extractBalancedBraces = (content: string, startIndex: number): string | null => {
  if (content[startIndex] !== '{') return null;

  let depth = 0;
  let i = startIndex;

  while (i < content.length) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') depth--;

    if (depth === 0) {
      return content.substring(startIndex, i + 1);
    }
    i++;
  }

  return null;
};

const cleanTypeString = (typeStr: string): string => {
  return typeStr
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/{\s+/g, '{ ')
    .replace(/\s+}/g, ' }')
    .replace(/;\s+/g, '; ')
    .replace(/,\s+/g, ', ')
    .trim();
};

/**
 * Extract the data type info from ApiParams interface
 * Returns { typeMap: Map of property name -> type, fullType: the complete data type string }
 */
interface DataTypeInfo {
  typeMap: Map<string, string>;
  fullType: string;
}

const extractDataTypeInfo = (content: string): DataTypeInfo => {
  const typeMap = new Map<string, string>();
  let fullType = 'any';

  // Find ApiParams interface
  const apiParamsMatch = content.match(/interface\s+ApiParams\s*\{/);
  if (!apiParamsMatch) return { typeMap, fullType };

  const apiParamsStart = apiParamsMatch.index!;
  const apiParamsBody = extractBalancedBraces(content, content.indexOf('{', apiParamsStart));
  if (!apiParamsBody) return { typeMap, fullType };

  // Find the data property
  const dataMatch = apiParamsBody.match(/data\s*:\s*\{/);
  if (!dataMatch) return { typeMap, fullType };

  const dataStart = apiParamsBody.indexOf('{', dataMatch.index!);
  const dataObj = extractBalancedBraces(apiParamsBody, dataStart);
  if (!dataObj) return { typeMap, fullType };

  // Store the full type (cleaned up)
  fullType = cleanTypeString(dataObj);

  // Remove comments before parsing properties
  const inner = dataObj.slice(1, -1)
    .replace(/\/\/[^\n]*/g, '')      // Remove line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .trim();

  // Match property definitions like "name: string;" or "email?: string;"
  const propRegex = /^\s*(\w+)\s*(\?)?\s*:\s*([^;]+);/gm;
  let match;

  while ((match = propRegex.exec(inner)) !== null) {
    const propName = match[1].trim();
    const propType = match[3].trim();
    if (propName && propType) {
      typeMap.set(propName, propType);
    }
  }

  return { typeMap, fullType };
};

/**
 * Extract type information from SyncParams interface's clientInput property
 * Similar to extractDataTypeInfo but for sync files
 */
const extractSyncDataTypeInfo = (content: string): DataTypeInfo => {
  const typeMap = new Map<string, string>();
  let fullType = 'any';

  // Find SyncParams interface
  const syncParamsMatch = content.match(/interface\s+SyncParams\s*\{/);
  if (!syncParamsMatch) return { typeMap, fullType };

  const syncParamsStart = syncParamsMatch.index!;
  const syncParamsBody = extractBalancedBraces(content, content.indexOf('{', syncParamsStart));
  if (!syncParamsBody) return { typeMap, fullType };

  // Find the clientInput property (try clientInput first, then fall back to clientData for backward compat)
  let clientDataMatch = syncParamsBody.match(/clientInput\s*:\s*\{/);
  if (!clientDataMatch) {
    clientDataMatch = syncParamsBody.match(/clientData\s*:\s*\{/);
  }
  if (!clientDataMatch) return { typeMap, fullType };

  const clientDataStart = syncParamsBody.indexOf('{', clientDataMatch.index!);
  const clientDataObj = extractBalancedBraces(syncParamsBody, clientDataStart);
  if (!clientDataObj) return { typeMap, fullType };

  // Store the full type (cleaned up)
  fullType = cleanTypeString(clientDataObj);

  // Remove comments before parsing properties
  const inner = clientDataObj.slice(1, -1)
    .replace(/\/\/[^\n]*/g, '')      // Remove line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .trim();

  // Match property definitions like "name: string;" or "email?: string;"
  const propRegex = /^\s*(\w+)\s*(\?)?\s*:\s*([^;]+);/gm;
  let match;

  while ((match = propRegex.exec(inner)) !== null) {
    const propName = match[1].trim();
    const propType = match[3].trim();
    if (propName && propType) {
      typeMap.set(propName, propType);
    }
  }

  return { typeMap, fullType };
};


/**
 * Extract local variable assignments before the return statement
 * Returns a map of variable name -> inferred type
 */
const extractLocalVariables = (content: string): Map<string, string> => {
  const varMap = new Map<string, string>();

  // Find the main function body - handle both "const main" and "export const main"
  // The regex ends with `=> {` so we can find the body brace at the end of the match
  const mainMatch = content.match(/(?:export\s+)?const\s+main\s*=\s*async\s*\([^)]*\)\s*(?::\s*[^=]+)?\s*=>\s*\{/);
  if (!mainMatch) {
    return varMap;
  }

  // The function body starts at the `{` at the END of our regex match
  const mainStart = mainMatch.index! + mainMatch[0].length - 1;
  const mainBody = extractBalancedBraces(content, mainStart);
  if (!mainBody) {
    return varMap;
  }



  // Look for const/let declarations - handle both \r\n and \n line endings
  const varRegex = /(?:const|let)\s+(\w+)\s*=\s*([^;\r\n]+)/g;
  let match;

  while ((match = varRegex.exec(mainBody)) !== null) {
    const varName = match[1].trim();
    const varValue = match[2].trim();

    // Infer type from the value
    const inferredType = inferTypeFromLiteralValue(varValue);

    varMap.set(varName, inferredType);
  }


  return varMap;
};

/**
 * Infer type from a literal value expression
 */
const inferTypeFromLiteralValue = (value: string): string => {
  const trimmed = value.trim();

  // String literal
  if (trimmed.startsWith("'") || trimmed.startsWith('"') || trimmed.startsWith('`')) {
    return 'string';
  }

  // String concatenation
  if (trimmed.includes('+') && (trimmed.includes("'") || trimmed.includes('"') || trimmed.includes('`'))) {
    return 'string';
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return 'number';
  }

  // Boolean
  if (trimmed === 'true' || trimmed === 'false') {
    return 'boolean';
  }

  // Array literal
  if (trimmed.startsWith('[')) {
    return 'any[]';
  }

  // Object literal
  if (trimmed.startsWith('{')) {
    return 'object';
  }

  // Date
  if (trimmed.includes('new Date') || trimmed.includes('.toISOString')) {
    return 'string';
  }

  return 'any';
};

const getInputTypeFromFile = (filePath: string): string => {
  const DEFAULT_TYPE = '{ }';

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    const apiParamsMatch = content.match(/interface\s+ApiParams\s*\{/);
    if (!apiParamsMatch) return DEFAULT_TYPE;

    const apiParamsStart = apiParamsMatch.index!;
    const apiParamsBody = extractBalancedBraces(content, content.indexOf('{', apiParamsStart));
    if (!apiParamsBody) return DEFAULT_TYPE;

    const dataMatch = apiParamsBody.match(/data\s*:\s*/);
    if (!dataMatch) return DEFAULT_TYPE;

    const dataStart = dataMatch.index! + dataMatch[0].length;
    const afterData = apiParamsBody.substring(dataStart);

    if (afterData.trimStart().startsWith('{')) {
      const braceStart = afterData.indexOf('{');
      const objectType = extractBalancedBraces(afterData, braceStart);
      if (objectType) {
        const cleaned = cleanTypeString(objectType);
        if (cleaned !== '{ }' && cleaned !== '{}') {
          return cleaned;
        }
        return DEFAULT_TYPE;
      }
    }

    const typeRefMatch = afterData.match(/^([A-Za-z][A-Za-z0-9]*(?:<[^>]+>)?)/);
    if (typeRefMatch) {
      const typeRef = typeRefMatch[1];
      if (typeRef.startsWith('Record<')) {
        return typeRef;
      }
      return DEFAULT_TYPE;
    }

    return DEFAULT_TYPE;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting input type from ${filePath}:`, error);
    return DEFAULT_TYPE;
  }
};

/**
 * Infer type for a result property value, using context from data types and local vars
 */
const inferTypeFromValueWithContext = (
  value: string,
  dataTypes: Map<string, string>,
  localVars: Map<string, string>,
  fullDataType: string = 'any'
): string => {
  const trimmed = value.trim();

  // String literal
  if (trimmed.startsWith("'") || trimmed.startsWith('"') || trimmed.startsWith('`')) {
    return 'string';
  }

  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return 'number';
  }

  // Boolean literal
  if (trimmed === 'true' || trimmed === 'false') {
    return 'boolean';
  }

  // Array literal
  if (trimmed.startsWith('[')) {
    return 'any[]';
  }

  // Object literal
  if (trimmed.startsWith('{')) {
    const nested = extractBalancedBraces(trimmed, 0);
    if (nested) {
      return inferTypeFromObjectLiteralWithContext(nested, dataTypes, localVars);
    }
    return 'object';
  }

  // data.X reference - look up from data types
  const dataRefMatch = trimmed.match(/^data\.(\w+)$/);
  if (dataRefMatch) {
    const propName = dataRefMatch[1];
    if (dataTypes.has(propName)) {
      return dataTypes.get(propName)!;
    }
    return 'any';
  }

  // user.X reference - common types
  const userRefMatch = trimmed.match(/^user\.(\w+)$/);
  if (userRefMatch) {
    const propName = userRefMatch[1];
    // Common user properties
    const userTypes: Record<string, string> = {
      id: 'string',
      name: 'string',
      email: 'string',
      admin: 'boolean',
      token: 'string',
    };
    return userTypes[propName] || 'any';
  }

  // Local variable reference - special case for 'data'
  if (trimmed === 'data' && fullDataType !== 'any') {
    return fullDataType;
  }

  // Local variable reference
  if (/^[a-z_]\w*$/i.test(trimmed) && localVars.has(trimmed)) {
    return localVars.get(trimmed)!;
  }

  // Date expression
  if (trimmed.includes('new Date') || trimmed.includes('toISOString') || trimmed.includes('Date.now')) {
    return 'string';
  }

  // Nullish coalescing or ternary - take the type of the fallback
  if (trimmed.includes('??')) {
    const parts = trimmed.split('??');
    if (parts.length >= 2) {
      const fallback = parts[parts.length - 1].trim();
      return inferTypeFromValueWithContext(fallback, dataTypes, localVars);
    }
  }

  return 'any';
};

/**
 * Helper to strip comments from code string
 */
const stripComments = (str: string): string => {
  return str.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
};

/**
 * Infer type from an object literal with context
 */
const inferTypeFromObjectLiteralWithContext = (
  objLiteral: string,
  dataTypes: Map<string, string>,
  localVars: Map<string, string>,
  fullDataType: string = 'any'
): string => {
  // Strip comments first to avoid parsing commented-out code
  const cleanLiteral = stripComments(objLiteral);
  const inner = cleanLiteral.slice(1, -1).trim();
  if (!inner) return '{ }';

  // Split by properties
  const properties: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === '{' || char === '[' || char === '(') depth++;
    else if (char === '}' || char === ']' || char === ')') depth--;

    if (char === ',' && depth === 0) {
      if (current.trim()) properties.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) properties.push(current.trim());

  const typeProperties: string[] = [];

  for (const prop of properties) {
    const colonIndex = prop.indexOf(':');

    if (colonIndex === -1) {
      // Shorthand property: just "varName" means "varName: varName"
      const key = prop.trim();
      if (/^[a-z_]\w*$/i.test(key)) {
        let inferredType = 'any';

        // Check if it matches a local variable
        if (localVars.has(key)) {
          inferredType = localVars.get(key)!;
        } else if (key === 'result') {
          // Special case for 'result' in API response
          inferredType = 'any';
        }

        typeProperties.push(`${key}: ${inferredType}`);
      }
      continue;
    }

    const key = prop.substring(0, colonIndex).trim();
    const value = prop.substring(colonIndex + 1).trim();

    // Recursively handle nested objects
    if (value.startsWith('{') && value.endsWith('}')) {
      const nested = value;
      // Pass the fullDataType context but we can't narrow it further easily without complex parsing
      // So we just recurse
      const inferredNested = inferTypeFromObjectLiteralWithContext(nested, dataTypes, localVars);
      typeProperties.push(`${key}: ${inferredNested}`);
      continue;
    }

    let inferredType = 'any';

    // Preserve status literal for tagged unions
    if (key === 'status') {
      const cleanVal = value.replace(/['"`]/g, '');
      if (cleanVal === 'success' || cleanVal === 'error') {
        typeProperties.push(`${key}: '${cleanVal}'`);
        continue;
      }
    }

    if (value.startsWith("'") || value.startsWith('"') || value.startsWith('`')) {
      inferredType = 'string';
    } else if (value.includes('+') && (value.includes("'") || value.includes('"') || value.includes('`'))) {
      // String concatenation detected
      inferredType = 'string';
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      inferredType = 'number';
    } else if (value === 'true' || value === 'false') {
      inferredType = 'boolean';
    } else if (value.startsWith('new Date') || value === 'Date.now()' || value.includes('.toISOString()') || value.includes('.toDateString()')) {
      // Date detection
      inferredType = 'Date';
    } else if (value.startsWith('[') && value.endsWith(']')) {
      // Array literal detection
      inferredType = 'any[]';
    } else if (value === 'null') {
      inferredType = 'null';
    } else if (value === 'undefined') {
      inferredType = 'undefined';
    } else if ((value.startsWith('data.') || value.startsWith('clientData.')) && fullDataType !== 'any') {
      // Handle both data. (API) and clientData. (Sync) prefixes
      // Only proceed if it looks like a clean property access (no spaces, operators)
      if (/^[a-zA-Z0-9_$.]+$/.test(value)) {
        // It's referencing a property of the input data
        // e.g. data.name => string, clientData.increase => boolean
        const propName = value.split('.')[1]; // basic support for 1 level
        // extract type from fullDataType string
        const propertyMatch = new RegExp(`${propName}\\??\\s*:\\s*([^;]+)`).exec(fullDataType);
        if (propertyMatch) {
          inferredType = propertyMatch[1].trim();
        }
      }
    } else if (localVars.has(value)) {
      inferredType = localVars.get(value)!;
    }

    typeProperties.push(`${key}: ${inferredType}`);
  }

  if (typeProperties.length > 0) {
    return `{ ${typeProperties.join('; ')} }`;
  }

  return '{ }';
};

const getOutputTypeFromFile = (filePath: string): string => {
  const DEFAULT_TYPE = '{ status: string }';

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract context for type inference
    const { typeMap: dataTypes, fullType: fullDataType } = extractDataTypeInfo(content);
    const localVars = extractLocalVariables(content);

    // Scan for ALL return statements to build a union type
    const returnRegex = /return\s*\{/g;
    let match;
    const returnTypes = new Set<string>();

    while ((match = returnRegex.exec(content)) !== null) {
      const returnStart = content.indexOf('{', match.index!);
      const returnBodyRaw = extractBalancedBraces(content, returnStart);

      if (returnBodyRaw) {
        const returnBody = stripComments(returnBodyRaw);
        if (returnBody && returnBody.includes('status:')) {
          const inferred = inferTypeFromObjectLiteralWithContext(returnBody, dataTypes, localVars, fullDataType);
          returnTypes.add(inferred);
        }
      }
    }

    if (returnTypes.size > 0) {
      return Array.from(returnTypes).join(' | ');
    }

    return DEFAULT_TYPE;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting output type from ${filePath}:`, error);
    return DEFAULT_TYPE;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Sync Type Extraction
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract clientData type from sync server file's SyncParams interface
 * Similar to how API files define data in ApiParams
 */
const getSyncClientDataType = (filePath: string): string => {
  const DEFAULT_TYPE = '{ }';

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Look for interface SyncParams with clientData property
    const syncParamsMatch = content.match(/interface\s+SyncParams\s*\{/);
    if (syncParamsMatch) {
      const paramsStart = syncParamsMatch.index!;
      const paramsBody = extractBalancedBraces(content, content.indexOf('{', paramsStart));
      if (paramsBody) {
        // Look for clientData property
        const clientDataMatch = paramsBody.match(/clientData\s*:\s*/);
        if (clientDataMatch) {
          const dataStart = paramsBody.indexOf(':', clientDataMatch.index!) + 1;
          const afterColon = paramsBody.substring(dataStart).trim();

          if (afterColon.startsWith('{')) {
            const typeBody = extractBalancedBraces(afterColon, 0);
            if (typeBody) {
              return cleanTypeString(typeBody);
            }
          }
        }
      }
    }

    // Fallback: Look for clientData usage to infer type
    // Pattern: clientData.increase, clientData.value, etc.
    const clientDataUsages = content.matchAll(/clientData\.(\w+)/g);
    const properties: string[] = [];
    for (const match of clientDataUsages) {
      if (!properties.includes(match[1])) {
        properties.push(`${match[1]}: any`);
      }
    }
    if (properties.length > 0) {
      return `{ ${properties.join('; ')} }`;
    }

    return DEFAULT_TYPE;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting sync clientData type from ${filePath}:`, error);
    return DEFAULT_TYPE;
  }
};

/**
 * Extract serverData type from sync server file's return statement
 */
const getSyncServerDataType = (filePath: string): string => {
  const DEFAULT_TYPE = '{ status: string }';

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract context for type inference - use SyncParams extraction for sync files
    const { typeMap: dataTypes, fullType: fullDataType } = extractSyncDataTypeInfo(content);
    const localVars = extractLocalVariables(content);

    // Scan for ALL return statements to build a union type
    const returnRegex = /return\s*\{/g;
    let match;
    const returnTypes = new Set<string>();

    while ((match = returnRegex.exec(content)) !== null) {
      const returnStart = content.indexOf('{', match.index!);
      const returnBodyRaw = extractBalancedBraces(content, returnStart);

      if (returnBodyRaw) {
        const returnBody = stripComments(returnBodyRaw);
        if (returnBody && returnBody.includes('status:')) {
          const inferred = inferTypeFromObjectLiteralWithContext(returnBody, dataTypes, localVars, fullDataType);
          returnTypes.add(inferred);
        }
      }
    }

    if (returnTypes.size > 0) {
      return Array.from(returnTypes).join(' | ');
    }

    return DEFAULT_TYPE;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting sync serverData type from ${filePath}:`, error);
    return DEFAULT_TYPE;
  }
};

/**
 * Extract clientOutput type from sync client file's return statement
 * Only extracts success returns (error returns are skipped at runtime)
 */
const getSyncClientOutputType = (filePath: string): string => {
  const DEFAULT_TYPE = '{ }';

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract context for type inference (clientData from SyncParams)
    const { typeMap: dataTypes, fullType: fullDataType } = extractSyncDataTypeInfo(content);
    const localVars = extractLocalVariables(content);

    // Scan for ALL return statements, but only include success ones
    const returnRegex = /return\s*\{/g;
    let match;
    const returnTypes = new Set<string>();

    while ((match = returnRegex.exec(content)) !== null) {
      const returnStart = content.indexOf('{', match.index!);
      const returnBodyRaw = extractBalancedBraces(content, returnStart);

      if (returnBodyRaw) {
        const returnBody = stripComments(returnBodyRaw);
        // Only include success returns (skip error returns as they don't reach clients)
        if (returnBody && returnBody.includes("status:") && returnBody.includes("'success'")) {
          const inferred = inferTypeFromObjectLiteralWithContext(returnBody, dataTypes, localVars, fullDataType);
          returnTypes.add(inferred);
        }
      }
    }

    if (returnTypes.size > 0) {
      return Array.from(returnTypes).join(' | ');
    }

    return DEFAULT_TYPE;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting sync clientOutput type from ${filePath}:`, error);
    return DEFAULT_TYPE;
  }
};

export const generateTypeMapFile = (): void => {
  // ═══════════════════════════════════════════════════════════════════════════
  // Collect API Types
  // ═══════════════════════════════════════════════════════════════════════════
  const apiFiles = findAllApiFiles();
  const typesByPage = new Map<string, Map<string, { input: string; output: string }>>();

  console.log(`[TypeMapGenerator] Found ${apiFiles.length} API files`);

  for (const filePath of apiFiles) {
    const pagePath = extractPagePath(filePath);
    const apiName = extractApiName(filePath);

    if (!pagePath || !apiName) continue;

    const inputType = getInputTypeFromFile(filePath);
    const outputType = getOutputTypeFromFile(filePath);

    console.log(`[TypeMapGenerator] API: ${pagePath}/${apiName}`);

    if (!typesByPage.has(pagePath)) {
      typesByPage.set(pagePath, new Map());
    }
    typesByPage.get(pagePath)!.set(apiName, { input: inputType, output: outputType });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Collect Sync Types
  // ═══════════════════════════════════════════════════════════════════════════
  const syncServerFiles = findAllSyncFiles();
  const syncClientFiles = findAllSyncClientFiles();
  const syncTypesByPage = new Map<string, Map<string, { clientInput: string; serverData: string; clientOutput: string }>>();

  console.log(`[TypeMapGenerator] Found ${syncServerFiles.length} Sync server files, ${syncClientFiles.length} Sync client files`);

  // Build a map of sync name -> client file path for lookup
  const clientFileMap = new Map<string, string>();
  for (const clientFile of syncClientFiles) {
    const syncName = extractSyncName(clientFile);
    if (syncName) {
      clientFileMap.set(syncName, clientFile);
    }
  }

  for (const filePath of syncServerFiles) {
    const pagePath = extractSyncPagePath(filePath);
    const syncName = extractSyncName(filePath);

    if (!pagePath || !syncName) continue;

    const clientInputType = getSyncClientDataType(filePath);  // From server file's SyncParams.clientData
    const serverDataType = getSyncServerDataType(filePath);   // From server file's return

    // Get clientOutput from corresponding _client file if it exists
    const clientFilePath = clientFileMap.get(syncName);
    const clientOutputType = clientFilePath ? getSyncClientOutputType(clientFilePath) : '{ }';

    console.log(`[TypeMapGenerator] Sync: ${pagePath}/${syncName}`);

    if (!syncTypesByPage.has(pagePath)) {
      syncTypesByPage.set(pagePath, new Map());
    }
    syncTypesByPage.get(pagePath)!.set(syncName, { clientInput: clientInputType, serverData: serverDataType, clientOutput: clientOutputType });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Generate Output File
  // ═══════════════════════════════════════════════════════════════════════════
  let content = `/**
 * Auto-generated type map for all API and Sync endpoints.
 * Enables type-safe apiRequest and syncRequest calls.
 */

import { PrismaClient } from "@prisma/client";
import { SessionLayout } from "config";

export interface Functions {
  prisma: PrismaClient;

  saveSession: (sessionId: string, data: SessionLayout) => Promise<boolean>;
  getSession: (sessionId: string) => Promise<SessionLayout | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;

  tryCatch: <T, P>(func: (values: P) => Promise<T> | T, params?: P) => Promise<[any, T | null]>;

  [key: string]: any; // allows for other functions that are not defined as a type but do exist in the functions folder
};

// ═══════════════════════════════════════════════════════════════════════════════
// API Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════

export type ApiResponse<T = any> =
  | { status: 'success'; result: T }
  | { status: 'error'; message?: string; errors?: any };

// ═══════════════════════════════════════════════════════════════════════════════
// API Type Map
// ═══════════════════════════════════════════════════════════════════════════════

export interface ApiTypeMap {
`;

  const sortedPages = Array.from(typesByPage.keys()).sort();

  for (const pagePath of sortedPages) {
    const apis = typesByPage.get(pagePath)!;
    const sortedApis = Array.from(apis.keys()).sort();

    content += `  '${pagePath}': {\n`;

    for (const apiName of sortedApis) {
      const { input, output } = apis.get(apiName)!;
      content += `    '${apiName}': {\n`;
      content += `      input: ${input};\n`;
      content += `      output: ${output};\n`;
      content += `    };\n`;
    }

    content += `  };\n`;
  }

  content += `}

// API Type helpers - fall back to permissive types when map is empty
type _PagePath = keyof ApiTypeMap;
export type PagePath = _PagePath extends never ? string : _PagePath;
export type ApiName<P extends PagePath> = P extends _PagePath ? keyof ApiTypeMap[P] : string;
export type ApiInput<P extends PagePath, N extends ApiName<P>> = P extends _PagePath ? (ApiTypeMap[P][N & keyof ApiTypeMap[P]] extends { input: infer I } ? I : any) : any;
export type ApiOutput<P extends PagePath, N extends ApiName<P>> = P extends _PagePath ? (ApiTypeMap[P][N & keyof ApiTypeMap[P]] extends { output: infer O } ? O : any) : any;

// Full API path helper (can be used for debugging)
export type FullApiPath<P extends PagePath, N extends ApiName<P>> = \`api/\${P}/\${N & string}\`;

// ═══════════════════════════════════════════════════════════════════════════════
// Sync Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════

export type SyncServerResponse<T = any> =
  | { status: 'success' } & T
  | { status: 'error'; message?: string };

export type SyncClientResponse<T = any> =
  | { status: 'success' } & T
  | { status: 'error'; message?: string };

// ═══════════════════════════════════════════════════════════════════════════════
// Sync Type Map
// ═══════════════════════════════════════════════════════════════════════════════

export interface SyncTypeMap {
`;

  const sortedSyncPages = Array.from(syncTypesByPage.keys()).sort();

  for (const pagePath of sortedSyncPages) {
    const syncs = syncTypesByPage.get(pagePath)!;
    const sortedSyncs = Array.from(syncs.keys()).sort();

    content += `  '${pagePath}': {\n`;

    for (const syncName of sortedSyncs) {
      const { clientInput, serverData, clientOutput } = syncs.get(syncName)!;
      content += `    '${syncName}': {\n`;
      content += `      clientInput: ${clientInput};\n`;
      content += `      serverData: ${serverData};\n`;
      content += `      clientOutput: ${clientOutput};\n`;
      content += `    };\n`;
    }

    content += `  };\n`;
  }

  content += `}

// Sync Type helpers - fall back to permissive types when map is empty
type _SyncPagePath = keyof SyncTypeMap;
export type SyncPagePath = _SyncPagePath extends never ? string : _SyncPagePath;
export type SyncName<P extends SyncPagePath> = P extends _SyncPagePath ? keyof SyncTypeMap[P] : string;
export type SyncClientInput<P extends SyncPagePath, N extends SyncName<P>> = P extends _SyncPagePath ? (SyncTypeMap[P][N & keyof SyncTypeMap[P]] extends { clientInput: infer C } ? C : any) : any;
export type SyncServerData<P extends SyncPagePath, N extends SyncName<P>> = P extends _SyncPagePath ? (SyncTypeMap[P][N & keyof SyncTypeMap[P]] extends { serverData: infer S } ? S : any) : any;
export type SyncClientOutput<P extends SyncPagePath, N extends SyncName<P>> = P extends _SyncPagePath ? (SyncTypeMap[P][N & keyof SyncTypeMap[P]] extends { clientOutput: infer O } ? O : any) : any;

// Full Sync path helper (can be used for debugging)
export type FullSyncPath<P extends SyncPagePath, N extends SyncName<P>> = \`sync/\${P}/\${N & string}\`;
`;

  try {
    fs.writeFileSync(OUTPUT_FILE, content, 'utf-8');
    console.log(`[TypeMapGenerator] Generated: ${OUTPUT_FILE}`);
  } catch (error) {
    console.error(`[TypeMapGenerator] Error writing type map:`, error);
  }
};