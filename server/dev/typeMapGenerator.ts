import fs from 'fs';
import path from 'path';
import { inferHttpMethod } from '../utils/httpApiUtils';

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
  // Match both src/examples/_api/ (nested) and src/_api/ (root-level)
  const match = normalized.match(/src\/(?:(.+?)\/)_api\//);
  if (match) {
    return match[1] || 'root';
  }
  // Check for root-level _api directly under src/
  if (normalized.includes('/src/_api/')) {
    return 'root';
  }
  return '';
};

const extractApiName = (filePath: string): string => {
  // For nested APIs like _api/user/changeName.ts, extract the full sub-path
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/_api\/(.+)\.ts$/);
  return match ? match[1] : path.basename(filePath, '.ts');
};

/**
 * Extract httpMethod export from an API file.
 * Returns the declared method or uses inferHttpMethod as fallback.
 */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const extractHttpMethod = (filePath: string, apiName: string): HttpMethod => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Look for explicit export: export const httpMethod = 'GET';
    // or: export const httpMethod: 'GET' | 'POST' = 'GET';
    const methodMatch = content.match(/export\s+const\s+httpMethod\s*(?::[^=]+)?=\s*['"]([^'"]+)['"]/);
    if (methodMatch) {
      const method = methodMatch[1].toUpperCase() as HttpMethod;
      if (['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
        return method;
      }
    }

    // Use inferHttpMethod as fallback for consistent behavior
    return inferHttpMethod(apiName);
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting httpMethod from ${filePath}:`, error);
    return inferHttpMethod(apiName);
  }
};

/**
 * Extract rateLimit export from an API file.
 * Returns the declared limit value, false if explicitly disabled, or undefined if not set.
 */
const extractRateLimit = (filePath: string): number | false | undefined => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Look for: export const rateLimit: number | false = 20;
    // or: export const rateLimit = 20;
    // or: export const rateLimit = false;
    const rateLimitMatch = content.match(/export\s+const\s+rateLimit\s*(?::[^=]+)?=\s*([^;]+);/);
    if (rateLimitMatch) {
      const value = rateLimitMatch[1].trim();
      if (value === 'false') return false;
      const num = parseInt(value, 10);
      if (!isNaN(num)) return num;
    }

    return undefined;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting rateLimit from ${filePath}:`, error);
    return undefined;
  }
};

// Sync-specific extractors
const extractSyncPagePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  // Match both src/examples/_sync/ (nested) and src/_sync/ (root-level)
  const match = normalized.match(/src\/(?:(.+?)\/)_sync\//);
  if (match) {
    return match[1] || 'root';
  }
  // Check for root-level _sync directly under src/
  if (normalized.includes('/src/_sync/')) {
    return 'root';
  }
  return '';
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
    // Strip comments from entire content FIRST to avoid matching commented return statements
    const strippedContent = stripComments(content);

    const returnRegex = /return\s*\{/g;
    let match;
    const returnTypes = new Set<string>();

    while ((match = returnRegex.exec(strippedContent)) !== null) {
      const returnStart = strippedContent.indexOf('{', match.index!);
      const returnBodyRaw = extractBalancedBraces(strippedContent, returnStart);

      if (returnBodyRaw) {
        const returnBody = returnBodyRaw;
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

    // Look for interface SyncParams with clientInput/clientData property
    const syncParamsMatch = content.match(/interface\s+SyncParams\s*\{/);
    if (syncParamsMatch) {
      const paramsStart = syncParamsMatch.index!;
      const paramsBody = extractBalancedBraces(content, content.indexOf('{', paramsStart));
      if (paramsBody) {
        // Look for clientInput property first (new naming), then clientData (backward compat)
        let clientDataMatch = paramsBody.match(/clientInput\s*:\s*/);
        if (!clientDataMatch) {
          clientDataMatch = paramsBody.match(/clientData\s*:\s*/);
        }
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

    // Fallback: Look for clientInput usage to infer type (also check clientData for backward compat)
    // Pattern: clientInput.increase, clientInput.value, etc.
    const clientInputUsages = content.matchAll(/clientInput\.(\\w+)/g);
    const properties: string[] = [];
    for (const match of clientInputUsages) {
      if (!properties.includes(match[1])) {
        properties.push(`${match[1]}: any`);
      }
    }
    // Also check clientData for backward compatibility
    const clientDataUsages = content.matchAll(/clientData\.(\\w+)/g);
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
 * Extract serverOutput type from sync server file's return statement
 */
const getSyncServerOutputType = (filePath: string): string => {
  const DEFAULT_TYPE = '{ status: string }';

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract context for type inference - use SyncParams extraction for sync files
    const { typeMap: dataTypes, fullType: fullDataType } = extractSyncDataTypeInfo(content);
    const localVars = extractLocalVariables(content);

    // Strip comments from entire content FIRST to avoid matching commented return statements
    const strippedContent = stripComments(content);

    // Scan for ALL return statements to build a union type
    const returnRegex = /return\s*\{/g;
    let match;
    const returnTypes = new Set<string>();

    while ((match = returnRegex.exec(strippedContent)) !== null) {
      const returnStart = strippedContent.indexOf('{', match.index!);
      const returnBodyRaw = extractBalancedBraces(strippedContent, returnStart);

      if (returnBodyRaw) {
        const returnBody = returnBodyRaw;
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
    console.error(`[TypeMapGenerator] Error extracting sync serverOutput type from ${filePath}:`, error);
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

    // Strip comments from entire content FIRST to avoid matching commented return statements
    const strippedContent = stripComments(content);

    // Scan for ALL return statements, but only include success ones
    const returnRegex = /return\s*\{/g;
    let match;
    const returnTypes = new Set<string>();

    while ((match = returnRegex.exec(strippedContent)) !== null) {
      const returnStart = strippedContent.indexOf('{', match.index!);
      const returnBodyRaw = extractBalancedBraces(strippedContent, returnStart);

      if (returnBodyRaw) {
        const returnBody = returnBodyRaw;
        // Only include success returns (skip error returns as they don't reach clients)
        // Handle both single and double quotes: 'success' or "success"
        const isSuccess = returnBody.includes("'success'") || returnBody.includes('"success"');
        if (returnBody && returnBody.includes("status:") && isSuccess) {
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

// Helper to extract balanced parentheses (for function args)
const extractBalancedParentheses = (content: string, startIndex: number): string | null => {
  let depth = 0;
  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === '(') {
        depth++;
    } else if (content[i] === ')') {
      depth--;
      if (depth === 0) return content.substring(startIndex, i + 1);
    }
  }
  return null;
}

const cleanArgs = (args: string): string => {
  // Remove default values: 'arg: string = "value"' -> 'arg: string'
  // Strategy: match = followed by value until comma or end bracket
  // CRITICAL: Do NOT match '=>' arrow function return type indicator!
  // Regex: 
  // \s* matches optional whitespace before =
  // =(?!>) matches = ONLY if NOT followed by >
  // [^,{})]+ matches the value (anything except comma or closing brackets)
  
  let cleaned = args.replace(/\n/g, ' ');
  
  // Remove string literals first to avoid matching = inside strings
  const strings: string[] = [];
  cleaned = cleaned.replace(/(['"])(?:(?=(\\?))\2.)*?\1/g, (m) => {
      strings.push(m);
      return `__STR_${strings.length-1}__`;
  });

  // Remove suspicious env var usage defaults entirely
  if (cleaned.includes('process.env')) {
      return '...args: any[]';
  }
  
  // Remove default assignment, but preserve =>
  cleaned = cleaned.replace(/\s*=(?![>])[^,{})]+/g, '');

  return cleaned;
}

// Global set to collect required imports across all files
const namedImports = new Map<string, Set<string>>();
const defaultImports = new Map<string, string>();

interface FileImport {
    source: string;
    isDefault: boolean;
    originalName?: string;
}

const sanitizeTypAndCollectImports = (type: string, filePath: string, availableExports: Set<string>, fileImports: Map<string, FileImport>, knownGenerics: Set<string> = new Set()): string => {
   // Detect potential types: Words starting with Uppercase
   return type.replace(/\b([A-Z][a-zA-Z0-9_]*)(<[^>]+>)?(\[\])?\b/g, (match, typeName, generics, isArray) => {
       const builtins = ['Promise', 'Date', 'Function', 'Array', 'Record', 'Partial', 'Pick', 'Omit', 'Error', 'Map', 'Set', 'Buffer', 'Uint8Array', 'Object'];
       const existingImports = ['PrismaClient', 'SessionLayout']; // Already imported in header
       
       if (builtins.includes(typeName) || existingImports.includes(typeName) || knownGenerics.has(typeName)) return match;
       
       // Priority 1: Check if it's imported in the source file
       if (fileImports.has(typeName)) {
           const imp = fileImports.get(typeName)!;
           if (imp.isDefault) {
               // Default import (e.g. Redis from 'ioredis')
               // Check if we already have a default import for this source
               if (defaultImports.has(imp.source) && defaultImports.get(imp.source) !== typeName) {
                   // Conflict! Two default imports from same source with different names? Rare.
                   // Ignore for now.
               } else {
                   defaultImports.set(imp.source, typeName);
                   return match;
               }
           } else {
               // Named import
               if (!namedImports.has(imp.source)) namedImports.set(imp.source, new Set());
               namedImports.get(imp.source)!.add(imp.originalName || typeName);
               return match;
           }
       }

       // Priority 2: Check if this type is exported in the current file (Relative import)
       if (availableExports.has(typeName)) {
           const outputDir = path.join(process.cwd(), 'src', '_sockets');
           let relPath = path.relative(outputDir, filePath).replace(/\\/g, '/').replace('.ts', '');
           if (!relPath.startsWith('.')) relPath = './' + relPath;
           
           if (!namedImports.has(relPath)) namedImports.set(relPath, new Set());
           namedImports.get(relPath)!.add(typeName);
           return match;
       }
       
       return `any${isArray || ''}`; 
   });
}

const findDefinitionSignature = (name: string, content: string, filePath: string, availableExports: Set<string>, fileImports: Map<string, FileImport>): string => {
  const varRegex = new RegExp(`const\\s+${name}\\s*=\\s*(?:async\\s*)?`);
  const funcRegex = new RegExp(`function\\s+${name}\\s*`);
  
  let match = content.match(varRegex);
  let isAsync = false;
  let defStart = -1;
  let genericsStr = '';
  let knownGenerics = new Set<string>();

  if (match) {
    defStart = match.index! + match[0].length;
    isAsync = match[0].includes('async');
    const lookAhead = content.substring(defStart, defStart + 50);
    const genMatch = lookAhead.match(/^\s*(<[^>]+>)/);
    if (genMatch) {
        genericsStr = genMatch[1];
        defStart += genMatch[0].length;
    }
  } else {
    match = content.match(funcRegex);
    if (match) {
        defStart = match.index! + match[0].length;
        const prefix = content.substring(Math.max(0, match.index! - 6), match.index!);
        if (prefix.includes('async')) isAsync = true;
        const lookAhead = content.substring(match.index! + match[0].length, match.index! + match[0].length + 50);
         const genMatch = lookAhead.match(/^\s*(<[^>]+>)/);
         if (genMatch) {
             genericsStr = genMatch[1];
             defStart += genMatch[0].length;
         }
    }
  }
  
  if (genericsStr) {
      const inner = genericsStr.slice(1, -1);
      inner.split(',').forEach(g => {
          const part = g.trim().split(/\s*=/)[0].trim().split(/\s+/)[0]; 
          if (part) knownGenerics.add(part);
      });
  }

  if (defStart !== -1) {
    const openParen = content.indexOf('(', defStart - 5); 
    if (openParen !== -1 && openParen < defStart + 50) { 
       const between = content.substring(defStart, openParen);
       const newMatch = between.match(/new\s+([a-zA-Z0-9_]+)/);
       if (newMatch) {
           const className = newMatch[1];
           // Try to find import for this class
           const sanitized = sanitizeTypAndCollectImports(className, filePath, availableExports, fileImports);
           if (sanitized !== 'any') return sanitized;
           return 'any';
       }

       if (!/^\s*$/.test(between)) return 'any';

       const rawArgs = extractBalancedParentheses(content, openParen);
       if (rawArgs) {
         let returnType = isAsync ? 'Promise<any>' : 'any';
         const afterArgs = content.substring(openParen + rawArgs.length);
         const returnMatch = afterArgs.match(/^\s*:\s*([^{=]+)(?:=>|\{)/);
         if (returnMatch) {
             let rawType = returnMatch[1].trim();
             if (rawType.endsWith('=>')) rawType = rawType.slice(0, -2).trim();
             returnType = sanitizeTypAndCollectImports(rawType, filePath, availableExports, fileImports, knownGenerics);
             if (isAsync && !returnType.startsWith('Promise')) returnType = `Promise<${returnType}>`;
         }

         const cleanedArgs = cleanArgs(rawArgs);
         const sanitizedArgs = sanitizeTypAndCollectImports(cleanedArgs, filePath, availableExports, fileImports, knownGenerics);
         return `${genericsStr}${sanitizedArgs} => ${returnType}`;
       }
    }
  }
  
  return 'any'; 
}

const generateFunctionsForDir = (dir: string, indent: string = '  '): string => {
  if (!fs.existsSync(dir)) return '';
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let output = '';

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const subOutput = generateFunctionsForDir(fullPath, indent + '  ');
      if (subOutput.trim()) {
        output += `${indent}${entry.name}: {\n${subOutput}${indent}};\n`;
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const fileName = entry.name.replace('.ts', '');
      let fileOutput = '';
      
      try {
        const rawContent = fs.readFileSync(fullPath, 'utf-8');
        const content = stripComments(rawContent);
        const exports = new Map<string, string>(); 
        
        const availableExports = new Set<string>();
        const typeExportRegex = /export\s+(?:interface|type|class|enum)\s+(\w+)/g;
        let tMatch;
        while ((tMatch = typeExportRegex.exec(content)) !== null) availableExports.add(tMatch[1]);
        
        // Parse Imports
        const fileImports = new Map<string, FileImport>();
        // import ... from '...'
        const importRegex = /import\s+(?:(\w+)|(?:\*\s+as\s+(\w+))|\{([^}]+)\})\s+from\s+['"]([^'"]+)['"]/g;
        let iMatch;
        while ((iMatch = importRegex.exec(content)) !== null) {
            const source = iMatch[4];
            const defaultImp = iMatch[1]; // import Default from '...'
            const namespaceImp = iMatch[2]; // import * as Namespace from '...'
            const namedImpBlock = iMatch[3]; // import { Named } from '...'
            
            if (defaultImp) {
                fileImports.set(defaultImp, { source, isDefault: true });
            } else if (namespaceImp) {
                // Namespace imports are treated as default for now, though less common for types
                fileImports.set(namespaceImp, { source, isDefault: true });
            }
            if (namedImpBlock) {
                namedImpBlock.split(',').forEach(part => {
                    const [orig, alias] = part.split(/\s+as\s+/).map(s => s.trim());
                    if (orig) {
                        fileImports.set(alias || orig, { source, isDefault: false, originalName: orig });
                    }
                });
            }
        }


        // 1. export const/function name ...
        const simpleExportRegex = /export\s+(?:const|function|async\s+function)\s+(\w+)/g;
        let match;
        while ((match = simpleExportRegex.exec(content)) !== null) {
            exports.set(match[1], findDefinitionSignature(match[1], content, fullPath, availableExports, fileImports));
        }

        // 2. export default ...
        const exportDefaultMatch = content.match(/export\s+default\s+(.*)/);
        if (exportDefaultMatch) {
            const decl = exportDefaultMatch[1].trim();
            // Check for 'as Type'
            const asMatch = decl.match(/(.*)\s+as\s+([a-zA-Z0-9_]+);?$/);
            if (asMatch) {
                 // export default x as Type
                 const typeName = asMatch[2];
                 // Sanitize and import expectation
                 const sanitizedType = sanitizeTypAndCollectImports(typeName, fullPath, availableExports, fileImports);
                 exports.set('default', sanitizedType !== 'any' ? sanitizedType : 'any');
            } else {
                 const defFunc = decl.match(/(?:async\s+)?function\s+(\w+)/);
                 if (defFunc) {
                     exports.set('default', findDefinitionSignature(defFunc[1], content, fullPath, availableExports, fileImports));
                 } else {
                      const defVal = decl.match(/^(\w+)/);
                      if (defVal && !decl.startsWith('class')) {
                          exports.set('default', findDefinitionSignature(defVal[1], content, fullPath, availableExports, fileImports));
                      } else {
                          const isAsync = decl.includes('async');
                          exports.set('default', `(...args: any[]) => ${isAsync ? 'Promise<any>' : 'any'}`);
                      }
                 }
            }
        }

        // 3. export { ... }
        const exportBlockRegex = /export\s*\{([^}]+)\}/g;
        while ((match = exportBlockRegex.exec(content)) !== null) {
            match[1].split(',').forEach(part => {
                const parts = part.trim().split(/\s+as\s+/);
                const name = parts[0];
                const alias = parts[1] || name;
                if (name) exports.set(alias, findDefinitionSignature(name, content, fullPath, availableExports, fileImports));
            });
        }

        // Output all found exports
        for (const [name, sig] of exports) {
             fileOutput += `${indent}  ${name}: ${sig};\n`;
        }
        
        if (fileOutput) {
            output += `${indent}${fileName}: {\n${fileOutput}${indent}};\n`;
        }
      } catch (err) {
        console.error(`[TypeMapGenerator] Error parsing functions file ${fullPath}:`, err);
      }
    }
  }
  return output;
};

const generateServerFunctions = (): string => {
  namedImports.clear(); 
  defaultImports.clear();
  const functionsDir = path.join(process.cwd(), 'server', 'functions');
  return generateFunctionsForDir(functionsDir, '  ');
};


// Helper to extract auth config
const extractAuth = (filePath: string): any => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const authMatch = content.match(/export\s+const\s+auth\s*:\s*AuthProps\s*=\s*(\{[\s\S]*?\});/);
    if (authMatch) {
      // Very basic parsing for login: true/false
      const loginMatch = authMatch[1].match(/login\s*:\s*(true|false)/);
      return {
        login: loginMatch ? loginMatch[1] === 'true' : true // Default to true if not specified? Or false? Config usually defaults to true.
      };
    }
  } catch (e) {}
  return { login: true }; // Default safe
};

export const generateTypeMapFile = (): void => {
  // ═══════════════════════════════════════════════════════════════════════════
  // Collect API Types
  // ═══════════════════════════════════════════════════════════════════════════
  const apiFiles = findAllApiFiles();
  const typesByPage = new Map<string, Map<string, { input: string; output: string; method: HttpMethod; rateLimit: number | false | undefined; auth: any; description?: string }>>();

  console.log(`[TypeMapGenerator] Found ${apiFiles.length} API files`);

  for (const filePath of apiFiles) {
    const pagePath = extractPagePath(filePath);
    const apiName = extractApiName(filePath);

    if (!pagePath || !apiName) continue;

    const inputType = getInputTypeFromFile(filePath);
    const outputType = getOutputTypeFromFile(filePath);
    const httpMethod = extractHttpMethod(filePath, apiName);
    const rateLimit = extractRateLimit(filePath);
    const auth = extractAuth(filePath);

    console.log(`[TypeMapGenerator] API: ${pagePath}/${apiName} (${httpMethod}${rateLimit !== undefined ? `, rateLimit: ${rateLimit}` : ''})`);

    if (!typesByPage.has(pagePath)) {
      typesByPage.set(pagePath, new Map());
    }
    typesByPage.get(pagePath)!.set(apiName, { input: inputType, output: outputType, method: httpMethod, rateLimit, auth });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Collect Sync Types
  // ═══════════════════════════════════════════════════════════════════════════
  const syncServerFiles = findAllSyncFiles();
  const syncClientFiles = findAllSyncClientFiles();
  const syncTypesByPage = new Map<string, Map<string, { clientInput: string; serverOutput: string; clientOutput: string }>>();

  console.log(`[TypeMapGenerator] Found ${syncServerFiles.length} Sync server files, ${syncClientFiles.length} Sync client files`);

  const allSyncs = new Map<string, {
    pagePath: string;
    syncName: string;
    serverFile?: string;
    clientFile?: string;
  }>();

  for (const serverFile of syncServerFiles) {
    const pagePath = extractSyncPagePath(serverFile);
    const syncName = extractSyncName(serverFile);
    if (!pagePath || !syncName) continue;

    const key = `${pagePath}/${syncName}`;
    const existing = allSyncs.get(key) || { pagePath, syncName };
    existing.serverFile = serverFile;
    allSyncs.set(key, existing);
  }

  for (const clientFile of syncClientFiles) {
    const pagePath = extractSyncPagePath(clientFile);
    const syncName = extractSyncName(clientFile);
    if (!pagePath || !syncName) continue;

    const key = `${pagePath}/${syncName}`;
    const existing = allSyncs.get(key) || { pagePath, syncName };
    existing.clientFile = clientFile;
    allSyncs.set(key, existing);
  }

  for (const [key, { pagePath, syncName, serverFile, clientFile }] of allSyncs) {
    let clientInputType = '{ }';
    if (serverFile) {
      clientInputType = getSyncClientDataType(serverFile);
    } else if (clientFile) {
      clientInputType = getSyncClientDataType(clientFile);
    }

    let serverOutputType = '{ }';
    if (serverFile) {
      serverOutputType = getSyncServerOutputType(serverFile);
    }

    let clientOutputType = '{ }';
    if (clientFile) {
      clientOutputType = getSyncClientOutputType(clientFile);
    }

    console.log(`[TypeMapGenerator] Sync: ${pagePath}/${syncName} (server: ${!!serverFile}, client: ${!!clientFile})`);

    if (!syncTypesByPage.has(pagePath)) {
      syncTypesByPage.set(pagePath, new Map());
    }
    syncTypesByPage.get(pagePath)!.set(syncName, { clientInput: clientInputType, serverOutput: serverOutputType, clientOutput: clientOutputType });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Generate Output File
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Generate functions first to populate requiredImports
  const functionsInterface = generateServerFunctions();
  
  let importStatements = '';
  // Named imports
  for (const [path, types] of namedImports) {
      importStatements += `import { ${Array.from(types).join(', ')} } from "${path}";\n`;
  }
  // Default imports
  for (const [path, defaultName] of defaultImports) {
      importStatements += `import ${defaultName} from "${path}";\n`;
  }

  let content = `/**
 * Auto-generated type map for all API and Sync endpoints.
 * Enables type-safe apiRequest and syncRequest calls.
 */

import { PrismaClient } from "@prisma/client";
import { SessionLayout } from "config";
${importStatements}
export interface Functions {
  prisma: PrismaClient;

${functionsInterface}
  [key: string]: any; // allows for other functions that are not defined as a type but do exist in the functions folder
};

// ═══════════════════════════════════════════════════════════════════════════════
// API Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════

export type ApiResponse<T = any> =
  | { status: 'success'; result: T }
  | { status: 'error'; errorCode?: string; errorParams?: { key: string; value: string | number | boolean; }[] }
  | { status: 'error'; message?: string; };

// ═══════════════════════════════════════════════════════════════════════════════
// API Type Map
// ═══════════════════════════════════════════════════════════════════════════════

export interface ApiTypeMap {
`;

  const sortedPages = Array.from(typesByPage.keys()).sort();
  const sortedSyncPages = Array.from(syncTypesByPage.keys()).sort();

  // Prepare JSON Data for Docs
  const docsData: any = { apis: {}, syncs: {} };

  for (const pagePath of sortedPages) {
    const apis = typesByPage.get(pagePath)!;
    const sortedApis = Array.from(apis.keys()).sort();

    docsData.apis[pagePath] = [];

    content += `  '${pagePath}': {\n`;
    for (const apiName of sortedApis) {
      const { input, output, method, rateLimit, auth } = apis.get(apiName)!;
      
      // Add to docs json
      docsData.apis[pagePath].push({
          page: pagePath,
          name: apiName,
          method,
          input,
          output,
          rateLimit,
          auth,
          path: `api/${pagePath}/${apiName}`
      });

      content += `    '${apiName}': {\n`;
      content += `      input: ${input};\n`;
      content += `      output: ${output};\n`;
      content += `      method: '${method}';\n`;
      if (rateLimit !== undefined) {
        content += `      rateLimit: ${rateLimit};\n`;
      }
      content += `    };\n`;
    }
    content += `  };\n`;
  }

  content += `}

// HTTP Method type
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

// API Type helpers
export type PagePath = keyof ApiTypeMap;
export type ApiName<P extends PagePath> = keyof ApiTypeMap[P];
export type ApiInput<P extends PagePath, N extends ApiName<P>> = ApiTypeMap[P][N] extends { input: infer I } ? I : never;
export type ApiOutput<P extends PagePath, N extends ApiName<P>> = ApiTypeMap[P][N] extends { output: infer O } ? O : never;
export type ApiMethod<P extends PagePath, N extends ApiName<P>> = ApiTypeMap[P][N] extends { method: infer M } ? M : never;

// Full API path helper (can be used for debugging)
export type FullApiPath<P extends PagePath, N extends ApiName<P>> = \`api/\${P}/\${N & string}\`;

// ═══════════════════════════════════════════════════════════════════════════════
// Runtime API Method Map (for abort controller logic)
// ═══════════════════════════════════════════════════════════════════════════════

export const apiMethodMap: Record<string, Record<string, HttpMethod>> = {
`;

  // Add runtime method map
  for (const pagePath of sortedPages) {
    const apis = typesByPage.get(pagePath)!;
    const sortedApis = Array.from(apis.keys()).sort();

    content += `  '${pagePath}': {\n`;
    for (const apiName of sortedApis) {
      const { method } = apis.get(apiName)!;
      content += `    '${apiName}': '${method}',\n`;
    }
    content += `  },\n`;
  }

  content += `};

/**
 * Get the HTTP method for an API. Used by apiRequest for abort controller logic.
 */
export const getApiMethod = (pagePath: string, apiName: string): HttpMethod | undefined => {
  return apiMethodMap[pagePath]?.[apiName];
};


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

  for (const pagePath of sortedSyncPages) {
    const syncs = syncTypesByPage.get(pagePath)!;
    const sortedSyncs = Array.from(syncs.keys()).sort();

    docsData.syncs[pagePath] = [];

    content += `  '${pagePath}': {\n`;

    for (const syncName of sortedSyncs) {
      const { clientInput, serverOutput, clientOutput } = syncs.get(syncName)!;
      
      docsData.syncs[pagePath].push({
          page: pagePath,
          name: syncName,
          clientInput,
          serverOutput,
          clientOutput,
          path: `sync/${pagePath}/${syncName}`
      });

      content += `    '${syncName}': {\n`;
      content += `      clientInput: ${clientInput};\n`;
      content += `      serverOutput: ${serverOutput};\n`;
      content += `      clientOutput: ${clientOutput};\n`;
      content += `    };\n`;
    }

    content += `  };\n`;
  }

  content += `}

// Sync Type helpers
export type SyncPagePath = keyof SyncTypeMap;
export type SyncName<P extends SyncPagePath> = keyof SyncTypeMap[P];
export type SyncClientInput<P extends SyncPagePath, N extends SyncName<P>> = SyncTypeMap[P][N] extends { clientInput: infer C } ? C : never;
export type SyncServerOutput<P extends SyncPagePath, N extends SyncName<P>> = SyncTypeMap[P][N] extends { serverOutput: infer S } ? S : never;
export type SyncClientOutput<P extends SyncPagePath, N extends SyncName<P>> = SyncTypeMap[P][N] extends { clientOutput: infer O } ? O : never;

// Full Sync path helper (can be used for debugging)
export type FullSyncPath<P extends SyncPagePath, N extends SyncName<P>> = \`sync/\${P}/\${N & string}\`;
`;

  try {
    const outputPath = path.join(process.cwd(), 'src', '_sockets', 'apiTypes.generated.ts');
    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log('[TypeMapGenerator] Generated apiTypes.generated.ts');
    
    // Write Documentation JSON
    const docsPath = path.join(process.cwd(), 'src', 'docs', '_api', 'apiDocs.generated.json');
    // Ensure directory exists
    const docsDir = path.dirname(docsPath);
    if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
    }
    fs.writeFileSync(docsPath, JSON.stringify(docsData, null, 2), 'utf-8');
    console.log('[TypeMapGenerator] Generated apiDocs.generated.json');
  } catch (error) {
    console.error('[TypeMapGenerator] Error writing type map or docs:', error);
  }
};