import { describe, it, expect, beforeAll } from 'vitest';
import * as ts from 'typescript';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandTypeDetailed } from './tsProgram';

//? DEVKIT-1 characterization suite. `tsProgram.ts` shipped with NO test file at
//? all; this locks in what `expandTypeDetailed` ACTUALLY does to a real,
//? decorator-based MikroORM entity so that any future fix produces a visible,
//? intentional diff.
//?
//? These tests deliberately assert the CURRENT (broken) behaviour. Where a test
//? pins a bug, it says so and names the fix that should flip it.
//?
//? The fixture program is built from `__fixtures__/tsconfig.json` — NOT from
//? `getServerProgram()`. MikroORM's decorators are legacy-style and need
//? `experimentalDecorators`, which the repo-wide tsconfigs do not set.

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const SKIP_EXPANSION_MIRROR = new Set([
  'Promise', 'Map', 'WeakMap', 'Set', 'WeakSet',
  'Error', 'Date', 'RegExp', 'Buffer', 'ArrayBuffer', 'ReadonlyArray',
]);

let program: ts.Program;
let checker: ts.TypeChecker;

const buildFixtureProgram = (): ts.Program => {
  const cfgPath = path.join(FIXTURE_DIR, 'tsconfig.json');
  const { config } = ts.readConfigFile(cfgPath, ts.sys.readFile.bind(ts.sys));
  const { options, fileNames } = ts.parseJsonConfigFileContent(config, ts.sys, FIXTURE_DIR);
  return ts.createProgram(fileNames, options);
};

// Returns the type of the object literal that `main` returns in the fixture
// route — the exact node `extractors.ts#collectReturnObjectTypeDetails` reads.
const getRouteReturnType = (): ts.Type => {
  const sourceFile = program.getSourceFile(path.join(FIXTURE_DIR, 'mikroRoute_v1.ts'));
  if (!sourceFile) throw new Error('fixture route not in program');

  let objectLiteral: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
      objectLiteral = node.expression;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!objectLiteral) throw new Error('no return object literal in fixture route');
  return checker.getTypeAtLocation(objectLiteral);
};

const getTypeAliasType = (name: string): ts.Type => {
  const sourceFile = program.getSourceFile(path.join(FIXTURE_DIR, 'markerProbe.ts'));
  if (!sourceFile) throw new Error('markerProbe fixture not in program');
  for (const stmt of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) {
      return checker.getTypeFromTypeNode(stmt.type);
    }
  }
  throw new Error(`type alias ${name} not found`);
};

// Finds a reachable type by its rendered name, breadth-limited.
const findTypeByRendering = (root: ts.Type, want: string): ts.Type | undefined => {
  const seen = new Set<number>();
  const walk = (type: ts.Type, depth: number): ts.Type | undefined => {
    if (depth > 8) return undefined;
    const id = (type as ts.Type & { id?: number }).id;
    if (id !== undefined) {
      if (seen.has(id)) return undefined;
      seen.add(id);
    }
    try {
      if (checker.typeToString(type) === want) return type;
      if (type.isUnion() || type.isIntersection()) {
        for (const inner of (type as ts.UnionOrIntersectionType).types) {
          const hit = walk(inner, depth + 1);
          if (hit) return hit;
        }
        return undefined;
      }
      if (type.flags & ts.TypeFlags.Object && (type as ts.Type & { symbol?: ts.Symbol }).symbol !== undefined) {
        for (const prop of checker.getPropertiesOfType(type)) {
          const hit = walk(checker.getTypeOfSymbol(prop), depth + 1);
          if (hit) return hit;
        }
      }
      return undefined;
    } finally {
      if (id !== undefined) seen.delete(id);
    }
  };
  return walk(root, 0);
};

//? A faithful MODEL of `expandTypeDetailed`'s traversal, with (a) an injectable
//? depth limit and (b) a guard at the site where the real function crashes.
//? DEPTH_LIMIT is a module-local const in tsProgram.ts (:29) with no injection
//? seam, and editing that file is out of scope for this task — so the depth
//? MEASUREMENT runs on this model. Its fidelity to the real traversal is pinned
//? by `it('the model agrees with the real expander about the crash site')`.
interface Bailout { kind: 'cycle' | 'depth' | 'crash'; depth: number; path: string; rendered: string }
interface ProbeResult { bailouts: Bailout[]; maxDepth: number; nodes: number }

const probeExpansion = (root: ts.Type, limit: number): ProbeResult => {
  const bailouts: Bailout[] = [];
  let maxDepth = 0;
  let nodes = 0;

  const walk = (type: ts.Type, depth: number, stack: Set<number>, p: string): void => {
    nodes += 1;
    if (depth > maxDepth) maxDepth = depth;

    const id = (type as ts.Type & { id?: number }).id;
    if (id !== undefined) {
      // mirrors tsProgram.ts:211-219
      if (stack.has(id)) {
        bailouts.push({ kind: 'cycle', depth, path: p, rendered: checker.typeToString(type) });
        return;
      }
      stack.add(id);
    }
    try {
      // mirrors tsProgram.ts:222-227
      if (depth > limit) {
        bailouts.push({ kind: 'depth', depth, path: p, rendered: checker.typeToString(type) });
        return;
      }
      if (type.isStringLiteral() || type.isNumberLiteral()) return;
      if (
        type.flags & (
          ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral
          | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Any | ts.TypeFlags.Unknown
          | ts.TypeFlags.Never | ts.TypeFlags.Void
        )
      ) return;

      if (type.isUnion() || type.isIntersection()) {
        for (const inner of (type as ts.UnionOrIntersectionType).types) walk(inner, depth + 1, stack, p);
        return;
      }

      if (type.flags & ts.TypeFlags.Object) {
        const objectType = type as ts.ObjectType;
        if (objectType.objectFlags & ts.ObjectFlags.Reference) {
          const targetName = (objectType as ts.TypeReference).target.symbol?.name ?? '';
          if (targetName === 'Array' || targetName === 'ReadonlyArray') {
            const arg = checker.getTypeArguments(objectType as ts.TypeReference)[0];
            if (arg) walk(arg, depth + 1, stack, `${p}[]`);
            return;
          }
          if (SKIP_EXPANSION_MIRROR.has(targetName)) return;
        }
        // tsProgram.ts:322 reads `type.symbol.name` with NO optional chaining.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ts.Type.symbol is typed non-nullable but IS undefined at runtime for tuple references; that mismatch is the bug under test
        if ((type as ts.Type & { symbol?: ts.Symbol }).symbol === undefined) {
          bailouts.push({ kind: 'crash', depth, path: p, rendered: checker.typeToString(type) });
          return;
        }
        if (SKIP_EXPANSION_MIRROR.has(type.symbol.name || (type.aliasSymbol?.name ?? ''))) return;

        for (const prop of checker.getPropertiesOfType(type)) {
          // mirrors tsProgram.ts:341
          if (prop.getName().startsWith('__@')) continue;
          walk(checker.getTypeOfSymbol(prop), depth + 1, stack, `${p}.${prop.getName()}`);
        }
      }
    } finally {
      if (id !== undefined) stack.delete(id);
    }
  };

  walk(root, 0, new Set<number>(), 'root');
  return { bailouts, maxDepth, nodes };
};

beforeAll(() => {
  program = buildFixtureProgram();
  checker = program.getTypeChecker();
});

describe('fixture integrity', () => {
  it('the decorator-based MikroORM fixture type-checks under experimentalDecorators', () => {
    const diagnostics = ts.getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName.includes('__fixtures__'))
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    expect(diagnostics).toEqual([]);
  });

  it('models the REAL consumer shape: BaseEntity + Collection + a ManyToOne cycle', () => {
    const owner = getRouteReturnType();
    const items = findTypeByRendering(owner, 'Collection<FixtureItem, object>');
    expect(items, 'the @OneToMany Collection relation must be reachable from the route payload').toBeDefined();

    //? The scaffold starter's `EntitySchema<Item>` shape CANNOT reproduce this:
    //? its type argument is a phantom generic, so expansion stops at depth 1.
    const props = checker.getPropertiesOfType(items!).map((p) => p.getName());
    expect(props).toContain('property');
    expect(props).toContain('snapshot');
  });
});

describe('expandTypeDetailed — the DEVKIT-1 failure mechanism', () => {
  //? THE HEADLINE BUG. This is not corruption — it is a hard TypeError. The
  //? expander never even reaches the depth limit on a MikroORM entity.
  it('THROWS a TypeError on a route returning a decorator-based MikroORM entity', () => {
    const routeType = getRouteReturnType();
    expect(() => expandTypeDetailed(routeType, checker))
      .toThrowError(/Cannot read properties of undefined \(reading 'name'\)/);
  });

  it('throws for ANY Collection-typed value, not just the route payload', () => {
    for (const alias of ['NamedCollection', 'MappedCollection', 'IntersectedCollection']) {
      expect(() => expandTypeDetailed(getTypeAliasType(alias), checker), alias)
        .toThrowError(/Cannot read properties of undefined \(reading 'name'\)/);
    }
  });

  //? Root cause, pinned to the exact guards that miss.
  it('root cause: a TUPLE type reference falls through every guard into tsProgram.ts:322', () => {
    const tuple = findTypeByRendering(getRouteReturnType(), '[string, string]');
    expect(tuple, 'MikroORM EntityProperty.embedded?: [string, string] must be reachable').toBeDefined();
    const objectType = tuple as ts.ObjectType;

    // tsProgram.ts:283 — the tuple branch tests the INSTANCE for ObjectFlags.Tuple...
    expect(objectType.objectFlags & ts.ObjectFlags.Tuple, 'instance is NOT flagged Tuple -> :283 misses').toBe(0);
    // ...but only the TARGET carries that flag, so the branch is dead for real tuples.
    expect(((objectType as ts.TypeReference).target as ts.ObjectType).objectFlags & ts.ObjectFlags.Tuple).toBeTruthy();

    // tsProgram.ts:294 — it is a Reference, so we enter the Reference branch...
    expect(objectType.objectFlags & ts.ObjectFlags.Reference).toBeTruthy();
    // ...where the tuple target has NO symbol, so targetName === '' -> not Array, not SKIP_EXPANSION.
    expect((objectType as ts.TypeReference).target.symbol).toBeUndefined();

    // tsProgram.ts:322 — `type.symbol.name` with no optional chaining. BOOM.
    expect((tuple as ts.Type & { symbol?: ts.Symbol }).symbol).toBeUndefined();
  });

  it('the crash is reachable at depth 6 via Collection.property.embedded', () => {
    const { bailouts } = probeExpansion(getRouteReturnType(), 12);
    const crashes = bailouts.filter((b) => b.kind === 'crash');
    expect(crashes).toHaveLength(1);
    expect(crashes[0]!.depth).toBe(6);
    expect(crashes[0]!.path).toBe('root.result.owner.items.property.embedded');
    expect(crashes[0]!.rendered).toBe('[string, string]');
  });

  //? Fidelity check: the model above is only trustworthy if it agrees with the
  //? real function about where things go wrong.
  it('the model agrees with the real expander about the crash site', () => {
    const routeType = getRouteReturnType();
    let realMessage = '';
    try {
      expandTypeDetailed(routeType, checker);
    } catch (error) {
      realMessage = (error as Error).message;
    }
    const modelled = probeExpansion(routeType, 12).bailouts.filter((b) => b.kind === 'crash');
    expect(realMessage).toContain("reading 'name'");
    expect(modelled).toHaveLength(1);
  });
});

describe('expandTypeDetailed — which bailouts actually fire', () => {
  it('hits BOTH the cycle guard and the depth bailout', () => {
    const { bailouts } = probeExpansion(getRouteReturnType(), 12);
    const cycles = bailouts.filter((b) => b.kind === 'cycle');
    const depths = bailouts.filter((b) => b.kind === 'depth');

    expect(cycles.length).toBeGreaterThan(0);
    expect(depths.length).toBeGreaterThan(0);
    // Real numbers at DEPTH_LIMIT = 12, locked in.
    expect(cycles).toHaveLength(43);
    expect(depths).toHaveLength(491);
  });

  it('the genuine entity cycle (Owner -> items -> Item -> owner) trips the cycle guard at depth 7', () => {
    const { bailouts } = probeExpansion(getRouteReturnType(), 12);
    const entityCycle = bailouts.find((b) => b.kind === 'cycle' && b.rendered === 'FixtureOwner');
    expect(entityCycle).toBeDefined();
    expect(entityCycle!.depth).toBe(7);
    expect(entityCycle!.path).toBe('root.result.owner.items.snapshot[].owner');
  });

  //? REFUTES the standing inference that the depth blowout runs through
  //? `Collection._em -> EntityManager -> Configuration -> MikroORMOptions -> driver`.
  it('REFUTED: Collection has no `_em` property; the deep chain runs through `property`', () => {
    const items = findTypeByRendering(getRouteReturnType(), 'Collection<FixtureItem, object>');
    const props = checker.getPropertiesOfType(items!).map((p) => p.getName());
    expect(props).not.toContain('_em');

    const { bailouts } = probeExpansion(getRouteReturnType(), 12);
    const deepest = bailouts.filter((b) => b.kind === 'depth').map((b) => b.path);
    expect(deepest.every((p) => !p.includes('._em.'))).toBe(true);
    // The actual chain: Collection.property -> EntityProperty.customType -> Type.meta -> EntityMetadata...
    expect(deepest.some((p) => p.startsWith('root.result.owner.items.property.customType.meta.'))).toBe(true);
  });
});

describe('INFERENCE #1 — "typeToString serializes symbol-keyed members verbatim"', () => {
  //? THE SINGLE MOST IMPORTANT DELIVERABLE. The inference is REFUTED.
  it('REFUTED: not one of the 534 bailouts leaks a `__@` marker', () => {
    const { bailouts } = probeExpansion(getRouteReturnType(), 12);
    const leaky = bailouts.filter((b) => b.rendered.includes('__@'));
    expect(bailouts).toHaveLength(535); // 43 cycle + 491 depth + 1 crash
    expect(leaky).toEqual([]);
  });

  it('REFUTED, root cause: typeToString renders a NAMED type as its name, never structurally', () => {
    const owner = findTypeByRendering(getRouteReturnType(), 'FixtureOwner');
    expect(checker.typeToString(owner!)).toBe('FixtureOwner');
    expect(
      checker.typeToString(owner!, undefined, ts.TypeFormatFlags.InTypeAlias | ts.TypeFormatFlags.NoTruncation),
    ).toBe('FixtureOwner');
  });

  it('REFUTED, root cause: typeToString renders a symbol key as VALID `[Symbol.iterator]` syntax', () => {
    const symbolKeyed = getTypeAliasType('LiteralWithSymbolKey');
    //? Without InTypeAlias, typeToString prints the ALIAS NAME — itself more
    //? evidence that it names rather than serializes. InTypeAlias forces the
    //? structural rendering, which is the only mode that could leak a marker.
    expect(checker.typeToString(symbolKeyed, undefined, ts.TypeFormatFlags.NoTruncation))
      .toBe('LiteralWithSymbolKey');

    const rendered = checker.typeToString(
      symbolKeyed,
      undefined,
      ts.TypeFormatFlags.InTypeAlias | ts.TypeFormatFlags.NoTruncation,
    );
    //? `__@iterator@N` is the INTERNAL escaped name (`symbol.getName()`).
    //? typeToString never emits it — it emits the real, parseable syntax.
    expect(rendered).not.toContain('__@');
    expect(rendered).toContain('[Symbol.iterator]');
  });

  //? So DEPTH_LIMIT is NOT the trigger for `__@` corruption. The only code that
  //? can emit a `__@` marker is the STRUCTURAL path, which prints
  //? `prop.getName()` raw at tsProgram.ts:353 — and :341 already skips those.
  it('the `__@` skip at tsProgram.ts:341 is what actually drops symbol members', () => {
    const symbolKeyed = getTypeAliasType('LiteralWithSymbolKey');
    const props = checker.getPropertiesOfType(symbolKeyed).map((p) => p.getName());
    expect(props).toContain('id');
    expect(props.some((p) => p.startsWith('__@'))).toBe(true); // the raw escaped name IS `__@iterator@N`

    const expanded = expandTypeDetailed(symbolKeyed, checker);
    expect(expanded.text).not.toContain('__@');
    expect(expanded.text).toContain('id: string');
    expect(expanded.text).not.toContain('Symbol.iterator'); // dropped entirely, not preserved
  });

  it('Collection carries the `__@` symbol members that motivated the strip helper', () => {
    const items = findTypeByRendering(getRouteReturnType(), 'Collection<FixtureItem, object>');
    const symbolProps = checker.getPropertiesOfType(items!)
      .map((p) => p.getName())
      .filter((n) => n.startsWith('__@'));
    expect(symbolProps.map((n) => n.replace(/@\d+$/, ''))).toEqual(['__@iterator', '__@custom']);
  });

  //? Consequence for `stripSymbolKeyedMembers` (emitterArtifacts.ts:114-146): its
  //? own comment blames the "typeToString FALLBACKS (cycle detection + depth
  //? limit)". That rationale is FACTUALLY WRONG per the tests above. The helper
  //? is a belt-and-braces net over a path that cannot currently produce markers.
  //? Keep it (cheap, harmless), but do not treat it as evidence that the
  //? fallbacks leak — and do not "fix" DEPTH_LIMIT expecting markers to appear.
  it('stripSymbolKeyedMembers is NOT exercised by the fixture — nothing reaches it', () => {
    const { bailouts } = probeExpansion(getRouteReturnType(), 12);
    expect(bailouts.some((b) => b.rendered.includes('__@'))).toBe(false);
  });
});

describe('DEPTH_LIMIT measurement', () => {
  //? DEPTH_LIMIT (tsProgram.ts:29) is a module-local const with no injection
  //? seam and tsProgram.ts is out of scope, so this measures on the model.
  it('REFUTED: "12 is off by an order of magnitude" — the real requirement is 14', () => {
    const routeType = getRouteReturnType();

    // At the shipped limit the traversal is truncated in 491 places.
    expect(probeExpansion(routeType, 12).bailouts.filter((b) => b.kind === 'depth')).toHaveLength(491);
    // 13 is still short...
    expect(probeExpansion(routeType, 13).bailouts.filter((b) => b.kind === 'depth').length).toBeGreaterThan(0);
    // ...and 14 fully exhausts the type graph. Off by TWO, not by 10x.
    expect(probeExpansion(routeType, 14).bailouts.filter((b) => b.kind === 'depth')).toHaveLength(0);
  });

  it('the type graph is FINITE — the cycle guard, not the depth limit, is what bounds it', () => {
    const deep = probeExpansion(getRouteReturnType(), 30);
    expect(deep.bailouts.filter((b) => b.kind === 'depth')).toHaveLength(0);
    expect(deep.maxDepth).toBe(14);
    // Cost is trivial once the depth limit stops truncating: ~2.9k nodes.
    expect(deep.nodes).toBeLessThan(5000);
    // The 43 cycle bailouts are what keep it finite.
    expect(deep.bailouts.filter((b) => b.kind === 'cycle')).toHaveLength(43);
  });

  it('raising the limit does NOT explode the traversal (no combinatorial blowup)', () => {
    const at12 = probeExpansion(getRouteReturnType(), 12).nodes;
    const at30 = probeExpansion(getRouteReturnType(), 30).nodes;
    expect(at30 / at12).toBeLessThan(2);
  });
});

describe('SKIP_EXPANSION and the `Date` claim', () => {
  //? `src/_sockets/apiTypes.generated.ts:780-782` emits `createdAt: Date` for
  //? `system/session@v1`. Confirmed: deliberate, via SKIP_EXPANSION (:53-56),
  //? matched at tsProgram.ts:322-325 (Date is non-generic, so it is NOT a
  //? Reference and never hits the :316 branch).
  it('Date is preserved verbatim rather than expanded into its 40+ methods', () => {
    expect(expandTypeDetailed(getTypeAliasType('PlainDate'), checker).text).toBe('Date');
  });

  it('CURRENT (wire-incorrect) behaviour: Date survives inside an object payload', () => {
    const expanded = expandTypeDetailed(getTypeAliasType('DateInObject'), checker).text;
    //? This is the baseline a future fix must visibly change. Over the socket a
    //? Date is JSON-serialized to a STRING, so a client typed `createdAt: Date`
    //? is lying — `new Date(res.createdAt)` is required at runtime but the type
    //? says it is unnecessary. Asserting it here means the fix (emitting
    //? `string`, or a `DateLike` alias) produces an intentional, reviewable diff.
    expect(expanded).toContain('createdAt: Date');
    expect(expanded).toContain('maybe: null | Date');
    expect(expanded).not.toContain('toISOString');
    expect(expanded).not.toContain('getTime');
  });

  it('Date reaches SKIP_EXPANSION by symbol name, not via the Reference branch', () => {
    const dateType = getTypeAliasType('PlainDate');
    expect(dateType.symbol.name).toBe('Date');
    expect(SKIP_EXPANSION_MIRROR.has(dateType.symbol.name)).toBe(true);
    //? Non-generic -> no type arguments -> the :294 Reference branch does not apply.
    expect((dateType as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference).toBe(0);
  });
});
