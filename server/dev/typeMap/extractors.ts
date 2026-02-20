import fs from 'fs';
import path from 'path';

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

interface DataTypeInfo {
  typeMap: Map<string, string>;
  fullType: string;
  contextTypes: Map<string, string>;
}

const extractBalancedValue = (content: string, startIndex: number, endChar: string): string | null => {
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;

  for (let i = startIndex; i < content.length; i += 1) {
    const char = content[i];
    if (char === '(') depthParen += 1;
    if (char === ')') depthParen -= 1;
    if (char === '{') depthBrace += 1;
    if (char === '}') depthBrace -= 1;
    if (char === '[') depthBracket += 1;
    if (char === ']') depthBracket -= 1;

    if (
      char === endChar
      && depthParen === 0
      && depthBrace === 0
      && depthBracket === 0
    ) {
      return content.slice(startIndex, i).trim();
    }
  }

  return null;
};

const splitTopLevelType = (value: string, splitter: '|' | ','): string[] => {
  const result: string[] = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let depthAngle = 0;
  let token = '';

  for (const char of value) {
    if (char === '(') depthParen += 1;
    if (char === ')') depthParen -= 1;
    if (char === '{') depthBrace += 1;
    if (char === '}') depthBrace -= 1;
    if (char === '[') depthBracket += 1;
    if (char === ']') depthBracket -= 1;
    if (char === '<') depthAngle += 1;
    if (char === '>') depthAngle -= 1;

    if (
      char === splitter
      && depthParen === 0
      && depthBrace === 0
      && depthBracket === 0
      && depthAngle === 0
    ) {
      const trimmed = token.trim();
      if (trimmed) result.push(trimmed);
      token = '';
      continue;
    }

    token += char;
  }

  const final = token.trim();
  if (final) result.push(final);
  return result;
};

const parseNamedImports = (fileContent: string): Map<string, { source: string; originalName: string }> => {
  const namedImports = new Map<string, { source: string; originalName: string }>();
  const importRegex = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(fileContent)) !== null) {
    const namedBlock = match[1];
    const source = match[2];

    namedBlock.split(',').forEach((chunk) => {
      const [left, alias] = chunk.split(/\s+as\s+/).map((value) => value.trim());
      if (!left) return;
      const localName = alias || left;
      namedImports.set(localName, { source, originalName: left });
    });
  }

  return namedImports;
};

const resolveImportFilePath = (source: string, currentFilePath: string): string | null => {
  if (!source.startsWith('.')) return null;
  const basePath = path.resolve(path.dirname(currentFilePath), source);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
};

const findExportedTypeDefinition = (fileContent: string, typeName: string): string | null => {
  const interfaceMatch = fileContent.match(new RegExp(`export\\s+interface\\s+${typeName}\\b`));
  if (interfaceMatch && typeof interfaceMatch.index === 'number') {
    const braceStart = fileContent.indexOf('{', interfaceMatch.index);
    if (braceStart >= 0) {
      const body = extractBalancedBraces(fileContent, braceStart);
      if (body) return cleanTypeString(body);
    }
  }

  const typeMatch = fileContent.match(new RegExp(`export\\s+type\\s+${typeName}\\b[^=]*=\\s*`));
  if (typeMatch && typeof typeMatch.index === 'number') {
    const valueStart = typeMatch.index + typeMatch[0].length;
    const typeValue = extractBalancedValue(fileContent, valueStart, ';');
    if (typeValue) return cleanTypeString(typeValue);
  }

  return null;
};

const resolveTypeReference = (
  currentFilePath: string,
  typeExpression: string,
  visited: Set<string> = new Set(),
): string | null => {
  const trimmed = cleanTypeString(typeExpression);
  if (!trimmed) return null;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  const unionParts = splitTopLevelType(trimmed, '|');
  if (unionParts.length > 1) {
    const resolvedUnion = unionParts.map((part) => resolveTypeReference(currentFilePath, part, visited) || part);
    return resolvedUnion.join(' | ');
  }

  if (trimmed.endsWith('[]')) {
    const inner = trimmed.slice(0, -2).trim();
    const resolvedInner = resolveTypeReference(currentFilePath, inner, visited) || inner;
    return `${resolvedInner}[]`;
  }

  const genericMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)<(.+)>$/);
  if (genericMatch) {
    const genericName = genericMatch[1];
    const genericBody = genericMatch[2];

    if (genericName === 'Array') {
      const resolvedInner = resolveTypeReference(currentFilePath, genericBody, visited) || genericBody;
      return `${resolvedInner}[]`;
    }

    const args = splitTopLevelType(genericBody, ',').map((arg) => resolveTypeReference(currentFilePath, arg, visited) || arg);
    return `${genericName}<${args.join(', ')}>`;
  }

  const identifierMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)$/);
  if (!identifierMatch) return null;
  const typeName = identifierMatch[1];

  const visitKey = `${currentFilePath}::${typeName}`;
  if (visited.has(visitKey)) return null;
  visited.add(visitKey);

  const content = fs.readFileSync(currentFilePath, 'utf-8');
  const localType = findExportedTypeDefinition(content, typeName);
  if (localType) {
    if (localType.startsWith('{')) return localType;
    return resolveTypeReference(currentFilePath, localType, visited);
  }

  const imports = parseNamedImports(content);
  const importMeta = imports.get(typeName);
  if (!importMeta) return null;

  const importedFile = resolveImportFilePath(importMeta.source, currentFilePath);
  if (!importedFile) return null;

  const importedContent = fs.readFileSync(importedFile, 'utf-8');
  const importedType = findExportedTypeDefinition(importedContent, importMeta.originalName);
  if (!importedType) return null;
  if (importedType.startsWith('{')) return importedType;

  return resolveTypeReference(importedFile, importedType, visited);
};

const resolveToObjectType = (filePath: string, typeExpression: string): string | null => {
  const resolved = resolveTypeReference(filePath, typeExpression);
  if (!resolved) return null;

  if (resolved.startsWith('{') && resolved.endsWith('}')) {
    return resolved;
  }

  const unionParts = splitTopLevelType(resolved, '|');
  if (unionParts.length > 1) {
    const objectParts: string[] = [];

    for (const part of unionParts) {
      const nested = resolveToObjectType(filePath, part) || part;
      objectParts.push(cleanTypeString(nested));
    }

    return objectParts.join(' | ');
  }

  return null;
};

const buildTypeMapFromObjectType = (objectType: string): Map<string, string> => {
  const typeMap = new Map<string, string>();
  const inner = objectType.slice(1, -1)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  const propRegex = /^\s*(\w+)\s*(\?)?\s*:\s*([^;]+);/gm;
  let match;
  while ((match = propRegex.exec(inner)) !== null) {
    const propName = match[1].trim();
    const propType = match[3].trim();
    if (propName && propType) {
      typeMap.set(propName, propType);
    }
  }

  return typeMap;
};

const extractTypedProperty = (source: string, key: string): string | null => {
  const propertyMatch = source.match(new RegExp(`${key}\\s*:\\s*`));
  if (!propertyMatch || typeof propertyMatch.index !== 'number') return null;

  const afterStart = propertyMatch.index + propertyMatch[0].length;
  const after = source.substring(afterStart).trimStart();

  if (after.startsWith('{')) {
    const objectType = extractBalancedBraces(after, 0);
    if (!objectType) return null;
    return cleanTypeString(objectType);
  }

  const refMatch = after.match(/^([^;]+);/);
  if (!refMatch) return null;
  return cleanTypeString(refMatch[1]);
};

const extractDataTypeInfo = (content: string, filePath: string): DataTypeInfo => {
  const typeMap = new Map<string, string>();
  let fullType = 'any';
  const contextTypes = new Map<string, string>();
  contextTypes.set('user', 'SessionLayout');

  const apiParamsMatch = content.match(/interface\s+ApiParams\s*\{/);
  if (!apiParamsMatch) return { typeMap, fullType, contextTypes };

  const apiParamsStart = apiParamsMatch.index!;
  const apiParamsBody = extractBalancedBraces(content, content.indexOf('{', apiParamsStart));
  if (!apiParamsBody) return { typeMap, fullType, contextTypes };

  const userType = extractTypedProperty(apiParamsBody, 'user');
  if (userType) contextTypes.set('user', userType);
  const functionsType = extractTypedProperty(apiParamsBody, 'functions');
  if (functionsType) contextTypes.set('functions', functionsType);

  const dataTypeExpression = extractTypedProperty(apiParamsBody, 'data');
  if (!dataTypeExpression) return { typeMap, fullType, contextTypes };

  const resolvedDataType = resolveTypeReference(filePath, dataTypeExpression) || dataTypeExpression;
  if (!(resolvedDataType.startsWith('{') && resolvedDataType.endsWith('}'))) {
    return { typeMap, fullType, contextTypes };
  }

  fullType = cleanTypeString(resolvedDataType);
  contextTypes.set('data', fullType);
  const parsedMap = buildTypeMapFromObjectType(fullType);
  for (const [key, value] of parsedMap.entries()) typeMap.set(key, value);

  return { typeMap, fullType, contextTypes };
};

const extractSyncDataTypeInfo = (content: string, filePath: string): DataTypeInfo => {
  const typeMap = new Map<string, string>();
  let fullType = 'any';
  const contextTypes = new Map<string, string>();
  contextTypes.set('user', 'SessionLayout');
  contextTypes.set('roomCode', 'string');

  const syncParamsMatch = content.match(/interface\s+SyncParams\s*\{/);
  if (!syncParamsMatch) return { typeMap, fullType, contextTypes };

  const syncParamsStart = syncParamsMatch.index!;
  const syncParamsBody = extractBalancedBraces(content, content.indexOf('{', syncParamsStart));
  if (!syncParamsBody) return { typeMap, fullType, contextTypes };

  const userType = extractTypedProperty(syncParamsBody, 'user');
  if (userType) contextTypes.set('user', userType);
  const functionsType = extractTypedProperty(syncParamsBody, 'functions');
  if (functionsType) contextTypes.set('functions', functionsType);
  const roomCodeType = extractTypedProperty(syncParamsBody, 'roomCode');
  if (roomCodeType) contextTypes.set('roomCode', roomCodeType);
  const serverOutputType = extractTypedProperty(syncParamsBody, 'serverOutput');
  if (serverOutputType) contextTypes.set('serverOutput', serverOutputType);

  const clientTypeExpression = extractTypedProperty(syncParamsBody, 'clientInput') || extractTypedProperty(syncParamsBody, 'clientData');
  if (!clientTypeExpression) return { typeMap, fullType, contextTypes };

  const resolvedClientType = resolveTypeReference(filePath, clientTypeExpression) || clientTypeExpression;
  if (!(resolvedClientType.startsWith('{') && resolvedClientType.endsWith('}'))) {
    return { typeMap, fullType, contextTypes };
  }

  fullType = cleanTypeString(resolvedClientType);
  contextTypes.set('clientInput', fullType);
  contextTypes.set('clientData', fullType);
  const parsedMap = buildTypeMapFromObjectType(fullType);
  for (const [key, value] of parsedMap.entries()) typeMap.set(key, value);

  return { typeMap, fullType, contextTypes };
};

const inferTypeFromLiteralValue = (value: string): string => {
  const trimmed = value.trim();

  if (trimmed.startsWith("'") || trimmed.startsWith('"') || trimmed.startsWith('`')) return 'string';
  if (trimmed.includes('+') && (trimmed.includes("'") || trimmed.includes('"') || trimmed.includes('`'))) return 'string';
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return 'number';
  if (trimmed === 'true' || trimmed === 'false') return 'boolean';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return inferArrayLiteralType(trimmed);
  if (trimmed.startsWith('{')) return 'Record<string, unknown>';
  if (trimmed.includes('new Date') || trimmed.includes('.toISOString')) return 'string';

  return 'any';
};

const inferArrayLiteralType = (value: string): string => {
  const inner = value.slice(1, -1).trim();
  if (!inner) return 'any[]';

  const entries = inner.split(',').map(part => part.trim()).filter(Boolean);
  if (entries.length === 0) return 'any[]';

  const primitiveTypes = new Set<string>();
  for (const entry of entries) {
    const inferred = inferTypeFromLiteralValue(entry);
    if (inferred === 'string' || inferred === 'number' || inferred === 'boolean') {
      primitiveTypes.add(inferred);
      continue;
    }

    return 'any[]';
  }

  if (primitiveTypes.size === 1) {
    return `${Array.from(primitiveTypes)[0]}[]`;
  }

  return `(${Array.from(primitiveTypes).join(' | ')})[]`;
};

const resolvePathBasedType = (value: string, fullDataType: string): string | null => {
  const validPrefixes = ['data.', 'clientData.', 'clientInput.', 'serverOutput.'];
  if (!validPrefixes.some(prefix => value.startsWith(prefix))) return null;
  if (fullDataType === 'any') return null;
  if (!/^[a-zA-Z0-9_$.]+$/.test(value)) return null;

  const propName = value.split('.')[1];
  if (!propName) return null;
  const propertyMatch = new RegExp(`${propName}\\??\\s*:\\s*([^;]+)`).exec(fullDataType);
  if (!propertyMatch) return null;

  return propertyMatch[1].trim();
};

const inferTypeFromPropertyName = (propertyName: string): string => {
  const lowerName = propertyName.toLowerCase();

  if (/^(is|has|can|should)/.test(lowerName) || /(active|enabled|visible|admin|typing|online)/.test(lowerName)) {
    return 'boolean';
  }

  if (/(count|step|index|cursor|total|size|length|amount|score|age)/.test(lowerName)) {
    return 'number';
  }

  if (/(id|code|name|email|path|role|message|status|token|room|key)/.test(lowerName)) {
    return 'string';
  }

  if (/(date|time|at)$/.test(lowerName)) {
    return 'string';
  }

  return 'any';
};

const inferTypeFromPathAccess = (value: string, fullDataType: string): string | null => {
  const exactType = resolvePathBasedType(value, fullDataType);
  if (exactType) return exactType;

  if (!/^[a-zA-Z0-9_$.]+$/.test(value)) return null;
  const parts = value.split('.');
  if (parts.length < 2) return null;

  return inferTypeFromPropertyName(parts[1]);
};

const extractLocalVariables = (content: string): Map<string, string> => {
  const varMap = new Map<string, string>();

  const mainMatch = content.match(/(?:export\s+)?const\s+main\s*=\s*async\s*\([^)]*\)\s*(?::\s*[^=]+)?\s*=>\s*\{/);
  if (!mainMatch) {
    return varMap;
  }

  const mainStart = mainMatch.index! + mainMatch[0].length - 1;
  const mainBody = extractBalancedBraces(content, mainStart);
  if (!mainBody) {
    return varMap;
  }

  const varRegex = /(?:const|let)\s+(\w+)\s*=\s*([^;\r\n]+)/g;
  let match;

  while ((match = varRegex.exec(mainBody)) !== null) {
    const varName = match[1].trim();
    const varValue = match[2].trim();
    const inferredType = inferTypeFromLiteralValue(varValue);
    varMap.set(varName, inferredType);
  }

  return varMap;
};

const inferTypeFromValueWithContext = (
  value: string,
  dataTypes: Map<string, string>,
  localVars: Map<string, string>,
  fullDataType: string = 'any',
  contextTypes: Map<string, string> = new Map([['user', 'SessionLayout']])
): string => {
  let trimmed = value.trim();

  if (trimmed.startsWith('!!')) {
    return 'boolean';
  }

  if (trimmed.startsWith('!')) {
    trimmed = trimmed.slice(1).trim();
  }

  if (trimmed.startsWith("'") || trimmed.startsWith('"') || trimmed.startsWith('`')) return 'string';
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return 'number';
  if (trimmed === 'true' || trimmed === 'false') return 'boolean';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return inferArrayLiteralType(trimmed);

  if (trimmed.startsWith('{')) {
    const nested = extractBalancedBraces(trimmed, 0);
    if (nested) {
      return inferTypeFromObjectLiteralWithContext(nested, dataTypes, localVars);
    }
    return 'object';
  }

  const resolvedPathType = inferTypeFromPathAccess(trimmed, fullDataType);
  if (resolvedPathType) return resolvedPathType;

  const dataRefMatch = trimmed.match(/^data\.(\w+)$/);
  if (dataRefMatch) {
    const propName = dataRefMatch[1];
    if (dataTypes.has(propName)) {
      return dataTypes.get(propName)!;
    }
    return 'any';
  }

  const userRefMatch = trimmed.match(/^user\.(\w+)$/);
  if (userRefMatch) {
    const propName = userRefMatch[1];
    const userTypes: Record<string, string> = {
      id: 'string',
      name: 'string',
      email: 'string',
      admin: 'boolean',
      token: 'string',
    };
    return userTypes[propName] || 'any';
  }

  if (trimmed === 'data' && fullDataType !== 'any') return fullDataType;
  if (contextTypes.has(trimmed)) return contextTypes.get(trimmed)!;
  if (/^[a-z_]\w*$/i.test(trimmed) && localVars.has(trimmed)) return localVars.get(trimmed)!;
  if (/^[a-z_]\w*$/i.test(trimmed)) {
    const inferredByName = inferTypeFromPropertyName(trimmed);
    if (inferredByName !== 'any') return inferredByName;
  }
  if (trimmed.includes('new Date') || trimmed.includes('toISOString') || trimmed.includes('Date.now')) return 'string';

  if (trimmed.includes('??')) {
    const parts = trimmed.split('??');
    if (parts.length >= 2) {
      const fallback = parts[parts.length - 1].trim();
      return inferTypeFromValueWithContext(fallback, dataTypes, localVars, fullDataType, contextTypes);
    }
  }

  return 'any';
};

export const stripComments = (str: string): string => {
  return str.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
};

const inferTypeFromObjectLiteralWithContext = (
  objLiteral: string,
  dataTypes: Map<string, string>,
  localVars: Map<string, string>,
  fullDataType: string = 'any',
  contextTypes: Map<string, string> = new Map([['user', 'SessionLayout']])
): string => {
  const cleanLiteral = stripComments(objLiteral);
  const inner = cleanLiteral.slice(1, -1).trim();
  if (!inner) return '{ }';

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
      const key = prop.trim();
      if (/^[a-z_]\w*$/i.test(key)) {
        let inferredType = 'any';
        if (localVars.has(key)) inferredType = localVars.get(key)!;
        else if (contextTypes.has(key)) inferredType = contextTypes.get(key)!;
        else if (key === 'result') inferredType = 'any';
        typeProperties.push(`${key}: ${inferredType}`);
      }
      continue;
    }

    const key = prop.substring(0, colonIndex).trim();
    let value = prop.substring(colonIndex + 1).trim();

    if (value.startsWith('!!')) {
      typeProperties.push(`${key}: boolean`);
      continue;
    }

    if (value.startsWith('!')) {
      value = value.slice(1).trim();
    }

    if (value.startsWith('{') && value.endsWith('}')) {
      const inferredNested = inferTypeFromObjectLiteralWithContext(value, dataTypes, localVars, fullDataType, contextTypes);
      typeProperties.push(`${key}: ${inferredNested}`);
      continue;
    }

    let inferredType = 'any';

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
      inferredType = 'string';
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      inferredType = 'number';
    } else if (value === 'true' || value === 'false') {
      inferredType = 'boolean';
    } else if (value.startsWith('new Date') || value === 'Date.now()' || value.includes('.toISOString()') || value.includes('.toDateString()')) {
      inferredType = 'Date';
    } else if (value.startsWith('[') && value.endsWith(']')) {
      inferredType = inferArrayLiteralType(value);
    } else if (value === 'null') {
      inferredType = 'null';
    } else if (value === 'undefined') {
      inferredType = 'undefined';
    } else if (inferTypeFromPathAccess(value, fullDataType)) {
      inferredType = inferTypeFromPathAccess(value, fullDataType)!;
    } else if (contextTypes.has(value)) {
      inferredType = contextTypes.get(value)!;
    } else if (localVars.has(value)) {
      inferredType = localVars.get(value)!;
    } else if (/^[a-z_]\w*$/i.test(value)) {
      inferredType = inferTypeFromPropertyName(value);
    }

    if (inferredType === 'any') {
      const keyBasedType = inferTypeFromPropertyName(key);
      if (keyBasedType !== 'any') {
        inferredType = keyBasedType;
      }
    }

    typeProperties.push(`${key}: ${inferredType}`);
  }

  if (typeProperties.length > 0) {
    return `{ ${typeProperties.join('; ')} }`;
  }

  return '{ }';
};

export const getInputTypeFromFile = (filePath: string): string => {
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

    const typeRefMatch = afterData.match(/^([A-Za-z][A-Za-z0-9_]*(?:<[^;]+>)?(?:\[\])?)/);
    if (typeRefMatch) {
      const typeRef = typeRefMatch[1];
      const resolvedObject = resolveToObjectType(filePath, typeRef);
      if (resolvedObject) return resolvedObject;
      const resolvedType = resolveTypeReference(filePath, typeRef);
      if (resolvedType) return cleanTypeString(resolvedType);
      return typeRef;
    }

    return DEFAULT_TYPE;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting input type from ${filePath}:`, error);
    return DEFAULT_TYPE;
  }
};

export const getOutputTypeFromFile = (filePath: string): string => {
  const DEFAULT_TYPE = '{ status: string }';

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { typeMap: dataTypes, fullType: fullDataType, contextTypes } = extractDataTypeInfo(content, filePath);
    const localVars = extractLocalVariables(content);
    const strippedContent = stripComments(content);

    const returnRegex = /return\s*\{/g;
    let match;
    const returnTypes = new Set<string>();

    while ((match = returnRegex.exec(strippedContent)) !== null) {
      const returnStart = strippedContent.indexOf('{', match.index!);
      const returnBodyRaw = extractBalancedBraces(strippedContent, returnStart);

      if (returnBodyRaw && returnBodyRaw.includes('status:')) {
        const inferred = inferTypeFromObjectLiteralWithContext(returnBodyRaw, dataTypes, localVars, fullDataType, contextTypes);
        returnTypes.add(inferred);
      }
    }

    if (returnTypes.size > 0) return Array.from(returnTypes).join(' | ');
    return DEFAULT_TYPE;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting output type from ${filePath}:`, error);
    return DEFAULT_TYPE;
  }
};

export const getSyncClientDataType = (filePath: string): string => {
  const DEFAULT_TYPE = '{ }';

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const syncParamsMatch = content.match(/interface\s+SyncParams\s*\{/);
    if (syncParamsMatch) {
      const paramsStart = syncParamsMatch.index!;
      const paramsBody = extractBalancedBraces(content, content.indexOf('{', paramsStart));
      if (paramsBody) {
        let clientDataMatch = paramsBody.match(/clientInput\s*:\s*/);
        if (!clientDataMatch) {
          clientDataMatch = paramsBody.match(/clientData\s*:\s*/);
        }
        if (clientDataMatch) {
          const dataStart = paramsBody.indexOf(':', clientDataMatch.index!) + 1;
          const afterColon = paramsBody.substring(dataStart).trim();

          if (afterColon.startsWith('{')) {
            const typeBody = extractBalancedBraces(afterColon, 0);
            if (typeBody) return cleanTypeString(typeBody);
          } else {
            const typeRefMatch = afterColon.match(/^([A-Za-z][A-Za-z0-9_]*(?:<[^;]+>)?(?:\[\])?)/);
            if (typeRefMatch) {
              const typeRef = typeRefMatch[1];
              const resolvedObject = resolveToObjectType(filePath, typeRef);
              if (resolvedObject) return resolvedObject;
              const resolvedType = resolveTypeReference(filePath, typeRef);
              if (resolvedType) return cleanTypeString(resolvedType);
              return typeRef;
            }
          }
        }
      }
    }

    const clientInputUsages = content.matchAll(/clientInput\.(\w+)/g);
    const properties: string[] = [];
    for (const match of clientInputUsages) {
      if (!properties.includes(match[1])) properties.push(`${match[1]}: any`);
    }

    const clientDataUsages = content.matchAll(/clientData\.(\w+)/g);
    for (const match of clientDataUsages) {
      if (!properties.includes(match[1])) properties.push(`${match[1]}: any`);
    }

    if (properties.length > 0) return `{ ${properties.join('; ')} }`;
    return DEFAULT_TYPE;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting sync clientData type from ${filePath}:`, error);
    return DEFAULT_TYPE;
  }
};

export const getSyncServerOutputType = (filePath: string): string => {
  const DEFAULT_TYPE = '{ status: string }';

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { typeMap: dataTypes, fullType: fullDataType, contextTypes } = extractSyncDataTypeInfo(content, filePath);
    const localVars = extractLocalVariables(content);
    const strippedContent = stripComments(content);

    const returnRegex = /return\s*\{/g;
    let match;
    const returnTypes = new Set<string>();

    while ((match = returnRegex.exec(strippedContent)) !== null) {
      const returnStart = strippedContent.indexOf('{', match.index!);
      const returnBodyRaw = extractBalancedBraces(strippedContent, returnStart);

      if (returnBodyRaw && returnBodyRaw.includes('status:')) {
        const inferred = inferTypeFromObjectLiteralWithContext(returnBodyRaw, dataTypes, localVars, fullDataType, contextTypes);
        returnTypes.add(inferred);
      }
    }

    if (returnTypes.size > 0) return Array.from(returnTypes).join(' | ');
    return DEFAULT_TYPE;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting sync serverOutput type from ${filePath}:`, error);
    return DEFAULT_TYPE;
  }
};

export const getSyncClientOutputType = (filePath: string): string => {
  const DEFAULT_TYPE = '{ }';

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { typeMap: dataTypes, fullType: fullDataType, contextTypes } = extractSyncDataTypeInfo(content, filePath);
    const localVars = extractLocalVariables(content);
    const strippedContent = stripComments(content);

    const returnRegex = /return\s*\{/g;
    let match;
    const returnTypes = new Set<string>();

    while ((match = returnRegex.exec(strippedContent)) !== null) {
      const returnStart = strippedContent.indexOf('{', match.index!);
      const returnBodyRaw = extractBalancedBraces(strippedContent, returnStart);

      if (returnBodyRaw) {
        const isSuccess = returnBodyRaw.includes("'success'") || returnBodyRaw.includes('"success"');
        if (returnBodyRaw.includes('status:') && isSuccess) {
          const inferred = inferTypeFromObjectLiteralWithContext(returnBodyRaw, dataTypes, localVars, fullDataType, contextTypes);
          returnTypes.add(inferred);
        }
      }
    }

    if (returnTypes.size > 0) return Array.from(returnTypes).join(' | ');
    return DEFAULT_TYPE;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting sync clientOutput type from ${filePath}:`, error);
    return DEFAULT_TYPE;
  }
};
