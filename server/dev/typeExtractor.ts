import ts from 'typescript';
import fs from 'fs';

export interface TypeProperty {
  name: string;
  type: string;
  optional: boolean;
  properties?: TypeProperty[];
}

export interface ExtractedType {
  name: string;
  properties: TypeProperty[];
}

const parseFile = (filePath: string): ts.SourceFile | null => {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true
  );
};

/**
 * Convert a TypeScript type node to a string representation
 */
const typeNodeToString = (node: ts.TypeNode, sourceFile: ts.SourceFile): string => {
  return node.getText(sourceFile);
};

/**
 * Extract properties from an interface or type literal
 */
const extractPropertiesFromType = (
  typeNode: ts.TypeNode | ts.TypeElement[] | undefined,
  sourceFile: ts.SourceFile
): TypeProperty[] => {
  const properties: TypeProperty[] = [];

  if (!typeNode) return properties;

  // Handle TypeLiteralNode (inline object types)
  if (ts.isTypeLiteralNode(typeNode as ts.Node)) {
    const typeLiteral = typeNode as ts.TypeLiteralNode;
    for (const member of typeLiteral.members) {
      if (ts.isPropertySignature(member) && member.name) {
        const propName = member.name.getText(sourceFile);
        const propType = member.type ? typeNodeToString(member.type, sourceFile) : 'any';
        const isOptional = !!member.questionToken;

        const prop: TypeProperty = {
          name: propName,
          type: propType,
          optional: isOptional
        };

        // If the property type is an object literal, extract nested properties
        if (member.type && ts.isTypeLiteralNode(member.type)) {
          prop.properties = extractPropertiesFromType(member.type, sourceFile);
        }

        properties.push(prop);
      }
    }
  }

  // Handle array of type elements (from interface declaration)
  if (Array.isArray(typeNode)) {
    for (const member of typeNode) {
      if (ts.isPropertySignature(member) && member.name) {
        const propName = member.name.getText(sourceFile);
        const propType = member.type ? typeNodeToString(member.type, sourceFile) : 'any';
        const isOptional = !!member.questionToken;

        const prop: TypeProperty = {
          name: propName,
          type: propType,
          optional: isOptional
        };

        if (member.type && ts.isTypeLiteralNode(member.type)) {
          prop.properties = extractPropertiesFromType(member.type, sourceFile);
        }

        properties.push(prop);
      }
    }
  }

  return properties;
};

/**
 * Extract the ApiParams interface from an API file
 */
export const extractApiParams = (filePath: string): ExtractedType | null => {
  const sourceFile = parseFile(filePath);
  if (!sourceFile) return null;

  let apiParams: ExtractedType | null = null;

  const visit = (node: ts.Node) => {
    // Look for interface named ApiParams
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'ApiParams') {
      const properties = extractPropertiesFromType(node.members as unknown as ts.TypeElement[], sourceFile);
      apiParams = {
        name: 'ApiParams',
        properties
      };
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return apiParams;
};

/**
 * Extract the 'data' property from ApiParams which defines the input shape
 */
export const extractInputDataType = (filePath: string): TypeProperty[] | null => {
  const apiParams = extractApiParams(filePath);
  if (!apiParams) return null;

  const dataProp = apiParams.properties.find(p => p.name === 'data');
  if (!dataProp) return null;

  return dataProp.properties || null;
};

/**
 * Infer the return type of the main() function
 */
export const inferMainReturnType = (filePath: string): string | null => {
  const sourceFile = parseFile(filePath);
  if (!sourceFile) return null;

  let returnType: string | null = null;

  const visit = (node: ts.Node) => {
    // Look for exported variable declaration named 'main' that is an arrow function
    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);

      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === 'main') {
          // Check if it's an arrow function with a return type annotation
          if (decl.initializer && ts.isArrowFunction(decl.initializer)) {
            const arrowFunc = decl.initializer;
            if (arrowFunc.type) {
              returnType = typeNodeToString(arrowFunc.type, sourceFile);
              return;
            }

            // If no explicit return type, try to infer from return statements
            returnType = inferReturnTypeFromBody(arrowFunc.body, sourceFile);
            return;
          }
        }
      }
    }

    // Also check for function declarations
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'main') {
      if (node.type) {
        returnType = typeNodeToString(node.type, sourceFile);
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return returnType;
};

/**
 * Try to infer the return type from the function body by analyzing return statements
 */
const inferReturnTypeFromBody = (body: ts.ConciseBody, sourceFile: ts.SourceFile): string | null => {
  if (ts.isBlock(body)) {
    // Find return statements in the block
    let returnObjectLiteral: ts.ObjectLiteralExpression | null = null;

    const visitReturn = (node: ts.Node) => {
      if (ts.isReturnStatement(node) && node.expression) {
        if (ts.isObjectLiteralExpression(node.expression)) {
          returnObjectLiteral = node.expression;
          return;
        }
      }
      ts.forEachChild(node, visitReturn);
    };

    visitReturn(body);

    if (returnObjectLiteral) {
      return objectLiteralToTypeString(returnObjectLiteral, sourceFile);
    }
  } else if (ts.isObjectLiteralExpression(body)) {
    // Arrow function with implicit return: () => ({ ... })
    return objectLiteralToTypeString(body, sourceFile);
  }

  return null;
};

/**
 * Convert an object literal expression to a TypeScript type string
 */
const objectLiteralToTypeString = (obj: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile): string => {
  const properties: string[] = [];

  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && prop.name) {
      const propName = prop.name.getText(sourceFile);
      let propType: string;

      // Infer type from the value
      if (ts.isStringLiteral(prop.initializer)) {
        propType = 'string';
      } else if (ts.isNumericLiteral(prop.initializer)) {
        propType = 'number';
      } else if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword || prop.initializer.kind === ts.SyntaxKind.FalseKeyword) {
        propType = 'boolean';
      } else if (ts.isObjectLiteralExpression(prop.initializer)) {
        propType = objectLiteralToTypeString(prop.initializer, sourceFile);
      } else if (ts.isArrayLiteralExpression(prop.initializer)) {
        propType = 'any[]';
      } else if (ts.isIdentifier(prop.initializer)) {
        // Identifier reference like 'data' - we can't resolve at compile time, use 'any'
        propType = 'any';
      } else if (ts.isPropertyAccessExpression(prop.initializer)) {
        // Property access like 'data.name' - infer as 'any' since we can't resolve
        propType = 'any';
      } else {
        // For complex expressions, use simplified inference
        const text = prop.initializer.getText(sourceFile);
        if (text.includes('`') || text.includes('toISOString') || text.includes('new Date')) {
          propType = 'string';
        } else if (text.includes('??')) {
          // Nullish coalescing - try to infer from the left-hand side
          propType = 'any';
        } else {
          propType = 'any';
        }
      }

      properties.push(`${propName}: ${propType}`);
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      // Shorthand property like just 'data' - can't resolve type
      const propName = prop.name.getText(sourceFile);
      properties.push(`${propName}: any`);
    }
  }

  return `{ ${properties.join('; ')} }`;
};

/**
 * Extract existing Zod schema keys from a file
 */
export const extractExistingZodSchemaKeys = (filePath: string): Set<string> => {
  const sourceFile = parseFile(filePath);
  if (!sourceFile) return new Set();

  const keys = new Set<string>();
  const content = fs.readFileSync(filePath, 'utf-8');

  // Simple regex-based extraction of Zod object keys
  // This looks for patterns like: name: z.string() or email: z.string().email()
  const zodObjectRegex = /(\w+):\s*z\.\w+/g;
  let match;
  while ((match = zodObjectRegex.exec(content)) !== null) {
    keys.add(match[1]);
  }

  return keys;
};

/**
 * Check if the file has a @generated marker
 */
export const hasGeneratedMarker = (filePath: string): boolean => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.includes('@generated');
  } catch {
    return false;
  }
};

/**
 * Get content before the @generated marker
 */
export const getContentBeforeMarker = (filePath: string): string | null => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const markerIndex = content.indexOf('// ═══════════════════════════════════════════════════════════════════════════════');
    if (markerIndex === -1) return null;
    return content.substring(0, markerIndex);
  } catch {
    return null;
  }
};

/**
 * Get content after the @generated marker (the generated section)
 */
export const getGeneratedSection = (filePath: string): string | null => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const markerIndex = content.indexOf('// ═══════════════════════════════════════════════════════════════════════════════');
    if (markerIndex === -1) return null;
    return content.substring(markerIndex);
  } catch {
    return null;
  }
};
