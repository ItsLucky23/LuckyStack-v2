import { SyntaxKind, type TypeNode } from 'typescript-7-api/ast';
import {
  isArrayTypeNode,
  isIdentifier,
  isIndexSignatureDeclaration,
  isIntersectionTypeNode,
  isLiteralTypeNode,
  isNumericLiteral,
  isParenthesizedTypeNode,
  isPropertySignatureDeclaration,
  isStringLiteral,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  isTypeReferenceNode,
  isUnionTypeNode,
} from 'typescript-7-api/ast/is';

import { parseSourceText } from './tsApi';

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
//?
//? Strict-vs-loose policy (DD-DEVKIT-D2 decision):
//?   Object literals → `.strict()` (rejects unknown keys, fail-closed posture).
//?   Routes that need to accept extra keys can declare `export const validation
//?   = 'relaxed'` (stripped by the Zod layer, future opt-out hook). All other
//?   fallback paths (`z.any()`, `z.record(...)`) remain loose because we have
//?   no structural shape to enforce. The `z.any()` fallback count is surfaced
//?   in `apiTypeDiagnostics.generated.json` so degraded routes are visible.

const wrapOptional = (inner: string): string => `${inner}.optional()`;
const anyFallback = (reason: string): string => `z.any() /* ${reason} */`;

const convertTypeNode = (node: TypeNode): string => {
  // Primitives
  if (node.kind === SyntaxKind.StringKeyword) return 'z.string()';
  if (node.kind === SyntaxKind.NumberKeyword) return 'z.number()';
  if (node.kind === SyntaxKind.BooleanKeyword) return 'z.boolean()';
  if (node.kind === SyntaxKind.NullKeyword) return 'z.null()';
  if (node.kind === SyntaxKind.UndefinedKeyword) return 'z.undefined()';
  if (node.kind === SyntaxKind.AnyKeyword) return 'z.any()';
  if (node.kind === SyntaxKind.UnknownKeyword) return 'z.unknown()';
  if (node.kind === SyntaxKind.NeverKeyword) return 'z.never()';

  // Literal types: 'foo', 42, true, false
  if (isLiteralTypeNode(node)) {
    const literal = node.literal;
    if (isStringLiteral(literal)) return `z.literal(${JSON.stringify(literal.text)})`;
    if (isNumericLiteral(literal)) return `z.literal(${literal.text})`;
    if (literal.kind === SyntaxKind.TrueKeyword) return 'z.literal(true)';
    if (literal.kind === SyntaxKind.FalseKeyword) return 'z.literal(false)';
    if (literal.kind === SyntaxKind.NullKeyword) return 'z.null()';
    return anyFallback('unknown literal');
  }

  // Array: T[]
  if (isArrayTypeNode(node)) {
    return `z.array(${convertTypeNode(node.elementType)})`;
  }

  // Union: A | B | undefined
  if (isUnionTypeNode(node)) {
    const members = node.types;
    //? If `undefined` appears, treat as `.optional()` on the remaining union.
    const hasUndefined = members.some(m => m.kind === SyntaxKind.UndefinedKeyword);
    const nonUndef = members.filter(m => m.kind !== SyntaxKind.UndefinedKeyword);

    if (nonUndef.length === 0) return 'z.undefined()';

    const firstNonUndef = nonUndef[0];
    const innerSchema =
      nonUndef.length === 1 && firstNonUndef
        ? convertTypeNode(firstNonUndef)
        : `z.union([${nonUndef.map((m) => convertTypeNode(m)).join(', ')}])`;

    return hasUndefined ? wrapOptional(innerSchema) : innerSchema;
  }

  // Type reference: Record<K, V>, Partial<T>, etc.
  if (isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    const args = node.typeArguments ?? [];

    switch (name) {
      case 'Record': {
        //? Record<string, T> → z.record(z.string(), convert(T))
        const arg0 = args[0];
        const arg1 = args[1];
        if (args.length === 2 && arg0 && arg1) {
          return `z.record(${convertTypeNode(arg0)}, ${convertTypeNode(arg1)})`;
        }
        return anyFallback('Record with unexpected arity');
      }
      case 'Partial': {
        //? Partial<{...}> flattens into making each property optional. Without
        //? resolving the referenced type we emit a best-effort record — the
        //? runtime validator on the server still enforces full correctness.
        const arg0 = args[0];
        return args.length === 1 && arg0
          ? `${convertTypeNode(arg0)}.partial()`
          : anyFallback('Partial without type arg');
      }
      case 'Array': {
        const arg0 = args[0];
        return args.length === 1 && arg0
          ? `z.array(${convertTypeNode(arg0)})`
          : anyFallback('Array without element type');
      }
      case 'Date': {
        //? The standalone converter describes the wire (`string`), never an
        //? impossible Date instance. Normal route generation rejects Date input
        //? annotations earlier in extractors.ts because the handler would still
        //? be typed as Date while receiving this string; authors must declare an
        //? ISO string and convert explicitly. Keep this mapping truthful for
        //? direct converter consumers and diagnostics.
        return 'z.iso.datetime()';
      }
      default: {
        return anyFallback(`unresolved TypeReference '${name}'`);
      }
    }
  }

  // Object literal type: { key: T; key2?: T2; [k: string]: T3 }
  if (isTypeLiteralNode(node)) {
    const indexSignatures = node.members.filter((m) => isIndexSignatureDeclaration(m));
    const propertySignatures = node.members.filter((m) => isPropertySignatureDeclaration(m));

    //? LuckyStack's "no input" convention: `{ [key: string]: never }` → empty
    //? object schema. Zod's `.passthrough()` isn't right because we actually
    //? want to reject extra fields.
    if (
      indexSignatures.length === 1
      && propertySignatures.length === 0
      && indexSignatures[0]?.type.kind === SyntaxKind.NeverKeyword
    ) {
      return 'z.object({}).strict()';
    }

    if (indexSignatures.length > 0 && propertySignatures.length === 0) {
      //? Pure index signature → z.record(keyType, valueType).
      const sig = indexSignatures[0];
      const keyType = sig?.parameters[0]?.type;
      const valueType = sig?.type;
      if (sig && keyType && valueType) {
        return `z.record(${convertTypeNode(keyType)}, ${convertTypeNode(valueType)})`;
      }
    }

    //? Regular object with property signatures.
    const entries = propertySignatures.map((prop) => {
      if (!isIdentifier(prop.name)) return null;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TS 7.1 declares PropertySignature.type required, but it is undefined for `{ a; }`
      if (!prop.type) return null;

      const name = prop.name.text;
      let schema = convertTypeNode(prop.type);

      //? `?` on the property makes it optional, regardless of whether the
      //? type itself includes `| undefined`.
      if (prop.postfixToken?.kind === SyntaxKind.QuestionToken && !schema.endsWith('.optional()')) {
        schema = wrapOptional(schema);
      }

      return `${JSON.stringify(name)}: ${schema}`;
    }).filter((entry): entry is string => entry !== null);

    //? `.strict()` rejects unknown keys, matching the framework's fail-closed
    //? input validation posture. Consumers can opt out per-route via
    //? `export const validation = 'relaxed'`.
    return `z.object({ ${entries.join(', ')} }).strict()`;
  }

  // Parenthesized: (T)
  if (isParenthesizedTypeNode(node)) {
    return convertTypeNode(node.type);
  }

  // Intersection: A & B — best-effort merge via z.object().extend() isn't
  // possible without both sides being objects. Fall back for now.
  if (isIntersectionTypeNode(node)) {
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

  //? Parse as a top-level `type __ = <expr>;` so the parser gives us
  //? back a TypeAliasDeclaration whose `type` property is the TypeNode we
  //? want. No module/file loader involved.
  const synthetic = `type __X = ${trimmed};`;
  const source = parseSourceText('__zod.ts', synthetic);

  const statement = source.statements[0];
  if (!statement || !isTypeAliasDeclaration(statement)) return null;

  return convertTypeNode(statement.type);
};
