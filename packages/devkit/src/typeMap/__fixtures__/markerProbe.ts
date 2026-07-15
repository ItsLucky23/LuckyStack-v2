// @ts-nocheck
//? Probe types used to locate WHERE the invalid `__@<name>@<id>` markers that
//? `stripSymbolKeyedMembers` exists to remove actually come from.
import { Collection } from '@mikro-orm/core';
import type { FixtureItem } from './mikroEntities';

//? A NAMED generic instance — typeToString renders it as its NAME.
export type NamedCollection = Collection<FixtureItem>;

//? An anonymous mapped type over a symbol-carrying type.
export type MappedCollection = { [K in keyof Collection<FixtureItem>]: Collection<FixtureItem>[K] };

//? An anonymous intersection.
export type IntersectedCollection = Collection<FixtureItem> & { extra: string };

//? A hand-rolled anonymous literal carrying a well-known symbol key.
//? MUST stay a `type` alias, not an `interface`: the tests read these via
//? `ts.isTypeAliasDeclaration` and assert on `TypeFormatFlags.InTypeAlias`,
//? which only has meaning for an alias.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- see above
export type LiteralWithSymbolKey = { id: string; [Symbol.iterator]: () => Iterator<string> };

//? A Pick over a symbol-carrying type.
export type PickedCollection = Pick<Collection<FixtureItem>, 'length'>;

//? Date — the SKIP_EXPANSION claim.
export type PlainDate = Date;
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- must stay an alias; see LiteralWithSymbolKey
export type DateInObject = { createdAt: Date; maybe: Date | null };
