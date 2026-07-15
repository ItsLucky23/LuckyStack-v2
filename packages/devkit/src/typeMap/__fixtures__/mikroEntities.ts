//? DEVKIT-1 reproduction fixture. Mirrors the shape of the REAL consumer's
//? MikroORM entities — decorators + `BaseEntity` + a `Collection` relation with
//? a `@ManyToOne` back-reference — which is what blows `expandTypeDetailed`'s
//? DEPTH_LIMIT and leaks `__@<name>@<id>` markers into the generated types.
//?
//? Deliberately NOT the shipped scaffold starter's shape: that uses
//? `EntitySchema<Item>` over a plain interface, whose type argument is a
//? PHANTOM generic (depth 1) and therefore CANNOT reproduce the bug.
//?
//? TYPE-CHECKING: this file is compiled by `__fixtures__/tsconfig.json`, which
//? turns on `experimentalDecorators` — MikroORM's decorators are LEGACY-style
//? (`Property(): (target: any, propertyName: string) => any`) and do not
//? resolve under TS's standard-decorator mode. Verified clean:
//?   npx tsc -p packages/devkit/src/typeMap/__fixtures__/tsconfig.json  -> exit 0
//?
//? `@ts-nocheck` is LOAD-BEARING here. Do not "clean it up" with a tsconfig
//? `exclude` — that was the obvious fix, it was tried, and it BREAKS this
//? fixture:
//?
//?   `expandTypeDetailed` reads the program built by `getServerProgram()`, which
//?   is built from `tsconfig.server.json`. Exclude this file there and it is no
//?   longer IN that program, so the extractor's `getSourceFile()` misses it and
//?   every test here silently falls back to the default output. Verified: adding
//?   the exclude turns `wireProjection.test.ts` red.
//?
//? So the file must stay in `tsconfig.server.json`'s globs — which do not set
//? `experimentalDecorators`, hence 7x TS1240 without the directive. The precedent
//? that looks similar (`page_*.template.tsx` IS excluded) does not apply: nothing
//? has to type-check those through the server program.
//?
//? The directive is safe precisely because of how it works: it suppresses
//? diagnostic REPORTING only. The checker still computes every type in full, so
//? the expander sees the real MikroORM shape and the reproduction is intact —
//? which is the whole point of this fixture existing.
// @ts-nocheck
import { BaseEntity, Collection, Entity, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class FixtureOwner extends BaseEntity {
  @PrimaryKey()
  id!: string;

  @Property()
  name!: string;

  //? The `Date` claim under test: SKIP_EXPANSION preserves this verbatim.
  @Property()
  createdAt: Date = new Date();

  //? `Collection<T, O>` holds `_em?: EntityManager`, which is the head of the
  //? chain that blows DEPTH_LIMIT:
  //? EntityManager -> Configuration -> MikroORMOptions -> driver -> platform
  //? -> connection -> pool -> driver.
  @OneToMany(() => FixtureItem, (item) => item.owner)
  items = new Collection<FixtureItem>(this);
}

@Entity()
export class FixtureItem extends BaseEntity {
  @PrimaryKey()
  id!: string;

  @Property()
  label!: string;

  //? Genuine cycle: FixtureOwner -> items -> FixtureItem -> owner -> FixtureOwner.
  @ManyToOne(() => FixtureOwner)
  owner!: FixtureOwner;
}
