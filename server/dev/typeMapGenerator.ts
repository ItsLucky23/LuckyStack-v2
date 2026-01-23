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

const extractPagePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/src\/(.+?)\/_api\//);
  return match ? match[1] : '';
};

const extractApiName = (filePath: string): string => {
  return path.basename(filePath, '.ts');
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
  const DEFAULT_TYPE = 'Record<string, any>';

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
 * Infer type from an object literal with context
 */
const inferTypeFromObjectLiteralWithContext = (
  objLiteral: string,
  dataTypes: Map<string, string>,
  localVars: Map<string, string>,
  fullDataType: string = 'any'
): string => {
  const inner = objLiteral.slice(1, -1).trim();
  if (!inner) return '{}';

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
    // Skip comments
    if (prop.trim().startsWith('//') || prop.trim().startsWith('/*')) continue;

    const colonIndex = prop.indexOf(':');

    if (colonIndex === -1) {
      // Shorthand property: just "varName" means "varName: varName"
      const key = prop.trim();
      if (/^[a-z_]\w*$/i.test(key)) {
        let inferredType = 'any';

        // Special case: 'data' is the entire data parameter from ApiParams
        if (key === 'data' && fullDataType !== 'any') {
          inferredType = fullDataType;
        } else if (localVars.has(key)) {
          inferredType = localVars.get(key)!;
        } else if (dataTypes.has(key)) {
          inferredType = dataTypes.get(key)!;
        }
        typeProperties.push(`${key}: ${inferredType}`);
      }
    } else {
      const key = prop.substring(0, colonIndex).trim();
      const value = prop.substring(colonIndex + 1).trim();

      if (key.includes('//') || key.includes('/*') || !key) continue;

      const inferredType = inferTypeFromValueWithContext(value, dataTypes, localVars, fullDataType);
      typeProperties.push(`${key}: ${inferredType}`);
    }
  }

  if (typeProperties.length === 0) return '{}';
  return `{ ${typeProperties.join('; ')} }`;
};

const getOutputTypeFromFile = (filePath: string): string => {
  const DEFAULT_TYPE = '{ status: string; result: any }';

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract context for type inference
    const { typeMap: dataTypes, fullType: fullDataType } = extractDataTypeInfo(content);
    const localVars = extractLocalVariables(content);

    // NOTE: We skip checking for explicit ApiResult interface because it contains
    // unresolved types like 'data: any'. We always infer from the return statement
    // so we can properly resolve data references to their actual types.

    // Try to infer from return statement
    const returnMatch = content.match(/return\s*\{[\s\S]*?status\s*:\s*['"]success['"]/);
    if (returnMatch) {
      const returnStart = content.indexOf('{', returnMatch.index!);
      const returnBody = extractBalancedBraces(content, returnStart);

      if (returnBody) {
        const hasStatus = returnBody.includes('status:');
        const hasResult = returnBody.includes('result:');

        if (hasStatus && hasResult) {
          const resultPropMatch = returnBody.match(/result\s*:\s*\{/);
          if (resultPropMatch) {
            const resultStart = returnBody.indexOf('{', resultPropMatch.index! + 7);
            const resultObj = extractBalancedBraces(returnBody, resultStart);

            if (resultObj) {
              const resultType = inferTypeFromObjectLiteralWithContext(resultObj, dataTypes, localVars, fullDataType);
              return `{ status: string; result: ${resultType} }`;
            }
          }
        }
      }
    }

    return DEFAULT_TYPE;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting output type from ${filePath}:`, error);
    return DEFAULT_TYPE;
  }
};

export const generateTypeMapFile = (): void => {
  const apiFiles = findAllApiFiles();
  const typesByPage = new Map<string, Map<string, { input: string; output: string }>>();

  console.log(`[TypeMapGenerator] Found ${apiFiles.length} API files`);

  for (const filePath of apiFiles) {
    const pagePath = extractPagePath(filePath);
    const apiName = extractApiName(filePath);

    if (!pagePath || !apiName) continue;

    const inputType = getInputTypeFromFile(filePath);
    const outputType = getOutputTypeFromFile(filePath);

    console.log(`[TypeMapGenerator] ${pagePath}/${apiName}`);

    if (!typesByPage.has(pagePath)) {
      typesByPage.set(pagePath, new Map());
    }
    typesByPage.get(pagePath)!.set(apiName, { input: inputType, output: outputType });
  }

  let content = `/**
 * Auto-generated type map for all API endpoints.
 * Enables type-safe apiRequest calls.
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

// Type helpers
export type PagePath = keyof ApiTypeMap;
export type ApiName<P extends PagePath> = keyof ApiTypeMap[P];
export type ApiInput<P extends PagePath, N extends ApiName<P>> = ApiTypeMap[P][N] extends { input: infer I } ? I : never;
export type ApiOutput<P extends PagePath, N extends ApiName<P>> = ApiTypeMap[P][N] extends { output: infer O } ? O : never;

// Full API path helper (can be used for debugging)
export type FullApiPath<P extends PagePath, N extends ApiName<P>> = \`api/\${P}/\${N & string}\`;
`;

  try {
    fs.writeFileSync(OUTPUT_FILE, content, 'utf-8');
    console.log(`[TypeMapGenerator] Generated: ${OUTPUT_FILE}`);
  } catch (error) {
    console.error(`[TypeMapGenerator] Error writing type map:`, error);
  }
};