import * as ts from 'typescript';

//? Converts a TypeScript type expression into Zod schema source text.
//?
//? Scope today — handles the shapes used by LuckyStack API/sync inputs:
//?   - Primitives: string, number, boolean, null, undefined, any, unknown
//?   - String/number literal types
//?   - Union types (including `| undefined` for optional fields)
//?   - Array types: `T[]` and `Array<T>`
//?   - Object types with property signatures and optional modifier
//?   - Index signatures: `Record<string, T>` and `{ [key: string]: T }`
//?   - `Partial`, `Required`, `Pick`, `Omit`, `Record` as best-effort (TypeRef)
//?
//? Out of scope — falls back to `z.any()` with a TODO comment:
//?   - Intersections (A & B) — needs shape merging
//?   - Generic parameters beyond Record/Partial/etc.
//?   - Mapped types, conditional types
//?   - Interface references (A from another file) — resolve at call site
//?
//? Why write our own instead of `ts-to-zod`: the input here is a bare type
//? expression string, not a file with declarations. ts-to-zod expects the
//? latter. Also: no codegen tool handles `{ [key: string]: never }` — the
//? LuckyStack "no input" convention — without special-casing.

const wrapOptional = (inner: string): string => `${inner}.optional()`;
const anyFallback = (reason: string): string => `z.any() /* ${reason} */`;

const convertTypeNode = (node: ts.TypeNode): string => {
  // Primitives
  if (node.kind === ts.SyntaxKind.StringKeyword) return 'z.string()';
  if (node.kind === ts.SyntaxKind.NumberKeyword) return 'z.number()';
  if (node.kind === ts.SyntaxKind.BooleanKeyword) return 'z.boolean()';
  if (node.kind === ts.SyntaxKind.NullKeyword) return 'z.null()';
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return 'z.undefined()';
  if (node.kind === ts.SyntaxKind.AnyKeyword) return 'z.any()';
  if (node.kind === ts.SyntaxKind.UnknownKeyword) return 'z.unknown()';
  if (node.kind === ts.SyntaxKind.NeverKeyword) return 'z.never()';

  // Literal types: 'foo', 42, true, false
  if (ts.isLiteralTypeNode(node)) {
    const literal = node.literal;
    if (ts.isStringLiteral(literal)) return `z.literal(${JSON.stringify(literal.text)})`;
    if (ts.isNumericLiteral(literal)) return `z.literal(${literal.text})`;
    if (literal.kind === ts.SyntaxKind.TrueKeyword) return 'z.literal(true)';
    if (literal.kind === ts.SyntaxKind.FalseKeyword) return 'z.literal(false)';
    if (literal.kind === ts.SyntaxKind.NullKeyword) return 'z.null()';
    return anyFallback('unknown literal');
  }

  // Array: T[]
  if (ts.isArrayTypeNode(node)) {
    return `z.array(${convertTypeNode(node.elementType)})`;
  }

  // Union: A | B | undefined
  if (ts.isUnionTypeNode(node)) {
    const members = node.types;
    //? If `undefined` appears, treat as `.optional()` on the remaining union.
    const hasUndefined = members.some(m => m.kind === ts.SyntaxKind.UndefinedKeyword);
    const nonUndef = members.filter(m => m.kind !== ts.SyntaxKind.UndefinedKeyword);

    if (nonUndef.length === 0) return 'z.undefined()';

    const innerSchema =
      nonUndef.length === 1
        ? convertTypeNode(nonUndef[0])
        : `z.union([${nonUndef.map(convertTypeNode).join(', ')}])`;

    return hasUndefined ? wrapOptional(innerSchema) : innerSchema;
  }

  // Type reference: Record<K, V>, Partial<T>, etc.
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    const args = node.typeArguments ?? [];

    switch (name) {
      case 'Record': {
        //? Record<string, T> → z.record(z.string(), convert(T))
        if (args.length === 2) {
          return `z.record(${convertTypeNode(args[0])}, ${convertTypeNode(args[1])})`;
        }
        return anyFallback('Record with unexpected arity');
      }
      case 'Partial': {
        //? Partial<{...}> flattens into making each property optional. Without
        //? resolving the referenced type we emit a best-effort record — the
        //? runtime validator on the server still enforces full correctness.
        return args.length === 1
          ? `${convertTypeNode(args[0])}.partial()`
          : anyFallback('Partial without type arg');
      }
      case 'Array':
        return args.length === 1
          ? `z.array(${convertTypeNode(args[0])})`
          : anyFallback('Array without element type');
      case 'Date':
        return 'z.date()';
      default:
        return anyFallback(`unresolved TypeReference '${name}'`);
    }
  }

  // Object literal type: { key: T; key2?: T2; [k: string]: T3 }
  if (ts.isTypeLiteralNode(node)) {
    const indexSignatures = node.members.filter(ts.isIndexSignatureDeclaration);
    const propertySignatures = node.members.filter(ts.isPropertySignature);

    //? LuckyStack's "no input" convention: `{ [key: string]: never }` → empty
    //? object schema. Zod's `.passthrough()` isn't right because we actually
    //? want to reject extra fields.
    if (
      indexSignatures.length === 1
      && propertySignatures.length === 0
      && indexSignatures[0].type?.kind === ts.SyntaxKind.NeverKeyword
    ) {
      return 'z.object({}).strict()';
    }

    if (indexSignatures.length > 0 && propertySignatures.length === 0) {
      //? Pure index signature → z.record(keyType, valueType).
      const sig = indexSignatures[0];
      const keyType = sig.parameters[0]?.type;
      const valueType = sig.type;
      if (keyType && valueType) {
        return `z.record(${convertTypeNode(keyType)}, ${convertTypeNode(valueType)})`;
      }
    }

    //? Regular object with property signatures.
    const entries = propertySignatures.map((prop) => {
      if (!prop.name || !ts.isIdentifier(prop.name)) return null;
      if (!prop.type) return null;

      const name = prop.name.text;
      let schema = convertTypeNode(prop.type);

      //? `?` on the property makes it optional, regardless of whether the
      //? type itself includes `| undefined`.
      if (prop.questionToken && !schema.endsWith('.optional()')) {
        schema = wrapOptional(schema);
      }

      return `${JSON.stringify(name)}: ${schema}`;
    }).filter((entry): entry is string => entry !== null);

    return `z.object({ ${entries.join(', ')} })`;
  }

  // Parenthesized: (T)
  if (ts.isParenthesizedTypeNode(node)) {
    return convertTypeNode(node.type);
  }

  // Intersection: A & B — best-effort merge via z.object().extend() isn't
  // possible without both sides being objects. Fall back for now.
  if (ts.isIntersectionTypeNode(node)) {
    return anyFallback('intersection not yet supported');
  }

  return anyFallback(`unsupported TypeNode kind=${String(node.kind)}`);
};

/**
 * Convert a TypeScript type expression string (as emitted into the generated
 * file) into a Zod schema source string.
 *
 * Returns `null` when the input can't be parsed as a type — callers should
 * fall back to `z.any()` in that case.
 */
export const typeTextToZodSource = (typeText: string): string | null => {
  const trimmed = typeText.trim();
  if (!trimmed) return null;

  //? Parse as a top-level `type __ = <expr>;` so ts.createSourceFile gives us
  //? back a TypeAliasDeclaration whose `type` property is the TypeNode we
  //? want. No module/file loader involved.
  const synthetic = `type __X = ${trimmed};`;
  const source = ts.createSourceFile('__zod.ts', synthetic, ts.ScriptTarget.Latest, true);

  const statement = source.statements[0];
  if (!statement || !ts.isTypeAliasDeclaration(statement)) return null;

  return convertTypeNode(statement.type);
};
