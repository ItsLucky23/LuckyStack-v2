import type { Checker, Symbol as TsSymbol, Type } from 'typescript-7-api/sync';

//? Every checker call is a synchronous round trip to the compiler process. Type
//? map generation asks the same few questions over and over (a consumer with
//? ~390 routes made ~180k `typeToString` calls on ~6.5k distinct types), so the
//? IPC wait dominated the run. These three answers depend only on their
//? arguments within one snapshot, and the snapshot's object registry hands out
//? one `Type`/`Symbol` object per checker object, so object identity is a valid
//? key. The memo must live exactly as long as the checker it wraps: a new
//? Program (after `invalidateProgramCache()`) gets a new checker and an empty
//? memo, so edited sources are never answered from an old snapshot.
export const memoizeChecker = (checker: Checker): Checker => {
  const originalTypeToString = checker.typeToString;
  const originalGetPropertyOfType = checker.getPropertyOfType;
  const originalGetTypeOfSymbol = checker.getTypeOfSymbol;

  const typeTexts = new WeakMap<Type, string>();
  const properties = new WeakMap<Type, Map<string, TsSymbol | undefined>>();
  const symbolTypes = new WeakMap<TsSymbol, Type>();

  //? A location or format flags change the text, so only the bare form is cached.
  const typeToString: Checker['typeToString'] = Object.assign(
    (type: Type, enclosingDeclaration?: Parameters<Checker['typeToString']>[1], flags?: Parameters<Checker['typeToString']>[2]): string => {
      if (enclosingDeclaration !== undefined || flags !== undefined) {
        return originalTypeToString(type, enclosingDeclaration, flags);
      }
      let text = typeTexts.get(type);
      if (text === undefined) {
        text = originalTypeToString(type);
        typeTexts.set(type, text);
      }
      return text;
    },
    { gen: originalTypeToString.gen.bind(originalTypeToString) },
  );

  const getPropertyOfType: Checker['getPropertyOfType'] = Object.assign(
    (type: Type, name: string): TsSymbol | undefined => {
      let byName = properties.get(type);
      if (!byName) {
        byName = new Map();
        properties.set(type, byName);
      }
      //? `has`, not `get`: a missing property (undefined) is an answer too.
      if (byName.has(name)) return byName.get(name);
      const property = originalGetPropertyOfType(type, name);
      byName.set(name, property);
      return property;
    },
    { gen: originalGetPropertyOfType.gen.bind(originalGetPropertyOfType) },
  );

  function getTypeOfSymbolMemo(symbol: TsSymbol): Type;
  function getTypeOfSymbolMemo(symbols: readonly TsSymbol[]): Type[];
  function getTypeOfSymbolMemo(symbolOrSymbols: TsSymbol | readonly TsSymbol[]): Type | Type[] {
    //? The batch form is one request already; leave it as is.
    if (isSymbolArray(symbolOrSymbols)) return originalGetTypeOfSymbol(symbolOrSymbols);
    let type = symbolTypes.get(symbolOrSymbols);
    if (type === undefined) {
      type = originalGetTypeOfSymbol(symbolOrSymbols);
      symbolTypes.set(symbolOrSymbols, type);
    }
    return type;
  }
  const getTypeOfSymbol: Checker['getTypeOfSymbol'] = Object.assign(getTypeOfSymbolMemo, { gen: originalGetTypeOfSymbol.gen.bind(originalGetTypeOfSymbol) });

  const overrides: Partial<Record<PropertyKey, unknown>> = { typeToString, getPropertyOfType, getTypeOfSymbol };
  return new Proxy(checker, {
    //? The real checker as receiver: its methods are getters that read its own state.
    get: (target, property): unknown => (property in overrides ? overrides[property] : Reflect.get(target, property, target)),
  });
};

const isSymbolArray = (value: TsSymbol | readonly TsSymbol[]): value is readonly TsSymbol[] => Array.isArray(value);
