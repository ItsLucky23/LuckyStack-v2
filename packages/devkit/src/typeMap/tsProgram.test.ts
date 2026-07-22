import { describe, it, expect, beforeAll } from 'vitest';
import * as ts from 'typescript';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandTypeDetailed } from './tsProgram';

//? DEVKIT-1 suite. `tsProgram.ts` shipped with NO test file at all; this pins
//? what `expandTypeDetailed` does to a real, decorator-based MikroORM entity.
//?
//? It began life as a CHARACTERIZATION suite asserting the broken behaviour (a
//? hard TypeError from the unguarded `type.symbol.name` read, reached because
//? the tuple branch tested the instance instead of the target). That bug is now
//? FIXED, and these tests are its regression net: the crash assertions became
//? "does not throw" + "extracts a REAL shape". The TS-internal facts that
//? explain the root cause are still asserted, because they are what the fix
//? relies on.
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
        // mirrors the FIXED tuple branch — tests the TARGET's ObjectFlags.Tuple
        const tupleTarget = (objectType.objectFlags & ts.ObjectFlags.Reference)
          ? ((objectType as ts.TypeReference).target as ts.ObjectType)
          : objectType;
        if (tupleTarget.objectFlags & ts.ObjectFlags.Tuple) {
          for (const arg of checker.getTypeArguments(objectType as ts.TypeReference)) {
            walk(arg, depth + 1, stack, `${p}[tuple]`);
          }
          return;
        }
        if (objectType.objectFlags & ts.ObjectFlags.Reference) {
          const targetName = (objectType as ts.TypeReference).target.symbol?.name ?? '';
          if (targetName === 'Array' || targetName === 'ReadonlyArray') {
            const arg = checker.getTypeArguments(objectType as ts.TypeReference)[0];
            if (arg) walk(arg, depth + 1, stack, `${p}[]`);
            return;
          }
          if (SKIP_EXPANSION_MIRROR.has(targetName)) return;
        }
        //? The site that used to crash: a symbol-less type arriving at the
        //? `type.symbol.name` read. Retained as an ASSERTABLE probe — with the
        //? tuple branch fixed above, nothing should reach it any more, which is
        //? what the `crash: 0` expectations below pin.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ts.Type.symbol is typed non-nullable but IS undefined at runtime for tuple references
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

//? Building the real multi-ORM fixture Program is intentionally heavyweight.
//? It finishes in ~7.5s alone but exceeded Vitest's 10s default when 170+ test
//? files loaded TypeScript concurrently, skipping this entire 27-test suite.
//? Give only this known-heavy setup a deterministic CI budget.
beforeAll(() => {
  program = buildFixtureProgram();
  checker = program.getTypeChecker();
}, 30_000);

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

describe('expandTypeDetailed — the DEVKIT-1 failure mechanism (FIXED)', () => {
  //? THE HEADLINE BUG, now the regression net. Before the tuple-branch fix this
  //? was a hard TypeError — `Cannot read properties of undefined (reading
  //? 'name')` at the `type.symbol.name` read — raised while expanding
  //? `EntityProperty.embedded?: [string, string]` at depth 6. `extractors.ts`
  //? swallowed it, so the route silently degraded to `{ status: string }`.
  it('does NOT throw on a route returning a decorator-based MikroORM entity', () => {
    const routeType = getRouteReturnType();
    expect(() => expandTypeDetailed(routeType, checker)).not.toThrow();
  });

  //? THE POINT OF THE WHOLE FIX: a real payload shape instead of a lost one.
  it('extracts a REAL result shape — the entity fields survive', () => {
    const { text } = expandTypeDetailed(getRouteReturnType(), checker);

    //? The `result` key and the entity's own scalar fields are what the crash
    //? destroyed. `{ status: string }` (the swallowed-crash DEFAULT) contains
    //? none of these.
    expect(text).not.toBe('{ status: string }');
    expect(text).toContain("status: 'success'");
    expect(text).toContain('result:');
    expect(text).toContain('id: string');
    expect(text).toContain('name: string');
    expect(text).toContain('createdAt: Date');

    //? The tuple that used to crash is now inlined as a real tuple type.
    expect(text).toContain('[string, string]');
    //? And the symbol-keyed MikroORM markers still never leak (tsProgram.ts:341).
    expect(text).not.toContain('__@');
  });

  it('does not throw for ANY Collection-typed value, not just the route payload', () => {
    for (const alias of ['NamedCollection', 'MappedCollection', 'IntersectedCollection']) {
      expect(() => expandTypeDetailed(getTypeAliasType(alias), checker), alias).not.toThrow();
    }
  });

  //? Root cause, pinned to the exact TS-internal facts the fix relies on. These
  //? are properties of the TypeScript checker, not of our code, so they stay
  //? true after the fix — they are WHY testing the instance was wrong.
  it('root cause: a tuple reference carries ObjectFlags.Tuple on its TARGET, not its instance', () => {
    const tuple = findTypeByRendering(getRouteReturnType(), '[string, string]');
    expect(tuple, 'MikroORM EntityProperty.embedded?: [string, string] must be reachable').toBeDefined();
    const objectType = tuple as ts.ObjectType;

    // The old tuple branch tested the INSTANCE for ObjectFlags.Tuple...
    expect(objectType.objectFlags & ts.ObjectFlags.Tuple, 'instance is NOT flagged Tuple').toBe(0);
    // ...but only the TARGET carries that flag — hence the fix tests the target.
    expect(((objectType as ts.TypeReference).target as ts.ObjectType).objectFlags & ts.ObjectFlags.Tuple).toBeTruthy();

    // It is a Reference, so the old code entered the Reference branch...
    expect(objectType.objectFlags & ts.ObjectFlags.Reference).toBeTruthy();
    // ...where the tuple target has NO symbol, so targetName === '' -> not Array, not SKIP_EXPANSION.
    expect((objectType as ts.TypeReference).target.symbol).toBeUndefined();

    // ...and fell into `type.symbol.name`, where the instance has no symbol either. BOOM.
    expect((tuple as ts.Type & { symbol?: ts.Symbol }).symbol).toBeUndefined();
  });

  //? The empty tuple is the ONE shape the original instance-check DID catch:
  //? `[]` has no type arguments to instantiate, so the reference is its own
  //? target and carries Tuple directly. This is why the branch was not 100%
  //? dead code — it fired for `[]` and nothing else.
  it('the empty tuple `[]` is flagged Tuple on the INSTANCE (why the old branch was not fully dead)', () => {
    const empty = getTypeAliasType('EmptyTuple') as ts.ObjectType;
    expect(empty.objectFlags & ts.ObjectFlags.Tuple).toBeTruthy();
    expect(expandTypeDetailed(empty, checker).text).toBe('[]');
  });

  it('the tuple that used to crash at depth 6 is now expanded as a tuple', () => {
    const { bailouts } = probeExpansion(getRouteReturnType(), 12);
    //? Zero crashes: the fixed tuple branch consumes it before the symbol read.
    expect(bailouts.filter((b) => b.kind === 'crash')).toHaveLength(0);

    //? The exact member that used to blow up, now inlined. (`undefined` is in
    //? the union because the property is optional under `strict`.)
    const tupleText = expandTypeDetailed(getRouteReturnType(), checker).text;
    expect(tupleText).toContain('embedded?: undefined | [string, string]');
  });

  //? Fidelity check: the model is only trustworthy if it agrees with the real
  //? function. Both must now complete without crashing.
  it('the model agrees with the real expander: neither crashes', () => {
    const routeType = getRouteReturnType();
    let realMessage = '';
    try {
      expandTypeDetailed(routeType, checker);
    } catch (error) {
      realMessage = (error as Error).message;
    }
    const modelled = probeExpansion(routeType, 12).bailouts.filter((b) => b.kind === 'crash');
    expect(realMessage).toBe('');
    expect(modelled).toHaveLength(0);
  });
});

describe('expandTypeDetailed — which bailouts actually fire', () => {
  it('hits BOTH the cycle guard and the depth bailout at the OLD limit of 12', () => {
    const { bailouts } = probeExpansion(getRouteReturnType(), 12);
    const cycles = bailouts.filter((b) => b.kind === 'cycle');
    const depths = bailouts.filter((b) => b.kind === 'depth');

    expect(cycles.length).toBeGreaterThan(0);
    expect(depths.length).toBeGreaterThan(0);
    //? Real numbers at the PREVIOUS DEPTH_LIMIT of 12, kept as the contrast
    //? case: 491 truncation points is what raising the limit to 14 removes.
    expect(cycles).toHaveLength(43);
    expect(depths).toHaveLength(491);
  });

  //? The shipped limit. `DEPTH_LIMIT` is a module-local const with no injection
  //? seam, so this asserts the model at the value tsProgram.ts:29 now ships.
  it('at the SHIPPED limit of 14 the graph is fully exhausted — 0 depth bailouts', () => {
    const { bailouts, maxDepth } = probeExpansion(getRouteReturnType(), 14);
    expect(bailouts.filter((b) => b.kind === 'depth')).toHaveLength(0);
    expect(bailouts.filter((b) => b.kind === 'crash')).toHaveLength(0);
    expect(maxDepth).toBe(14);
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
    expect(bailouts).toHaveLength(534); // 43 cycle + 491 depth + 0 crash (the tuple no longer crashes)
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
  //? DEPTH_LIMIT (tsProgram.ts) is a module-local const with no injection seam,
  //? so this measures on the model. These measurements are the EVIDENCE behind
  //? the shipped value of 14 — see the comment above the const.
  it('REFUTED: "12 is off by an order of magnitude" — the real requirement is 14', () => {
    const routeType = getRouteReturnType();

    // At the shipped limit the traversal is truncated in 491 places.
    expect(probeExpansion(routeType, 12).bailouts.filter((b) => b.kind === 'depth')).toHaveLength(491);
    // 13 is still short...
    expect(probeExpansion(routeType, 13).bailouts.filter((b) => b.kind === 'depth').length).toBeGreaterThan(0);
    // ...and 14 fully exhausts the type graph. Off by TWO, not by 10x.
    expect(probeExpansion(routeType, 14).bailouts.filter((b) => b.kind === 'depth')).toHaveLength(0);
  });

  //? BINDS TO THE SHIPPED CONST — the tests above all pass an explicit limit to
  //? the model, so every one of them would still pass if DEPTH_LIMIT were
  //? reverted to 12. That is exactly the "fix that never fired" trap (lesson
  //? 0007). `expandTypeDetailed`'s public `depth` START-OFFSET is the injection
  //? seam the const itself lacks: starting the walk 2 levels down under a limit
  //? of 14 is equivalent to starting at the root under a limit of 12.
  it('the SHIPPED DEPTH_LIMIT is 14 — starting 2 levels down reproduces the OLD truncation', () => {
    const root = getRouteReturnType();
    const uniqueSymbols = (startDepth: number): string[] =>
      [...new Set(expandTypeDetailed(root, checker, startDepth).unresolvedSymbols.map((s) => s.name))].sort();

    //? At the shipped limit the graph is exhausted, so the only names left are
    //? the 43 cycle bailouts collapsing to 5 distinct types.
    expect(uniqueSymbols(0)).toEqual(['EntityMetadata', 'EntityProperty', 'FixtureOwner', 'Function', 'QueryOrderMap']);

    //? Two levels down == the old limit of 12, where 491 depth bailouts drag in
    //? 30 distinct names (MikroORM lifecycle hooks, Dictionary, CheckCallback…).
    //? Revert DEPTH_LIMIT to 12 and uniqueSymbols(0) becomes this set — which is
    //? what makes this assertion, and not the model ones, the real guard.
    expect(uniqueSymbols(2)).toHaveLength(30);
    expect(uniqueSymbols(2)).toContain('CheckCallback');
    expect(uniqueSymbols(0)).not.toContain('CheckCallback');
  }, 120_000);

  //? Counter-intuitive but load-bearing: a HIGHER limit makes the emitted text
  //? SMALLER. A depth bailout renders the truncated node via
  //? `checker.typeToString`, which prints it structurally and verbosely; letting
  //? the walk continue instead lets the cycle guard collapse it to a short name.
  it('raising the limit SHRINKS the emitted text rather than growing it', () => {
    const root = getRouteReturnType();
    const atShipped = expandTypeDetailed(root, checker, 0).text.length;
    const atOldLimit = expandTypeDetailed(root, checker, 2).text.length;
    expect(atShipped).toBeLessThan(atOldLimit);
  }, 120_000);

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
