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
//? `@ts-nocheck` is a SCOPE WORKAROUND, not a cover-up. The repo-wide
//? `tsconfig.server.json` globs `packages/devkit/src/**/*` and does NOT set
//? `experimentalDecorators`, so without it `tsc -b` fails with 7x TS1240 on
//? this file. The correct fix is a one-line `exclude` entry for
//? `packages/devkit/src/typeMap/__fixtures__/**` in `tsconfig.server.json` and
//? `packages/devkit/tsconfig.json` (there is precedent — `tsconfig.server.json`
//? already excludes `packages/devkit/src/templates/page_*.template.tsx`). Those
//? files are out of this task's edit scope; once the exclude lands, DELETE the
//? `@ts-nocheck` below.
//?
//? `@ts-nocheck` suppresses only diagnostic REPORTING — the checker still
//? computes every type in full, so `expandTypeDetailed` sees the real MikroORM
//? shape and the reproduction is unaffected.
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
