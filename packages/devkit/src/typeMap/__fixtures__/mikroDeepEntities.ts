//? DEEP-NESTING fixture battery for the wire projection. The original
//? `mikroEntities.ts` proves the two-level owner<->items cycle; this one pushes
//? the shapes that a real domain model actually has and that a shallow fixture
//? never exercises:
//?
//?   - THREE levels of relation (Company -> Department -> Employee), each a cycle
//?     back to its parent, so the expander meets the same entity at several depths
//?   - a Date at every level (createdAt) — the projection must turn EACH into a
//?     string, not just the top one
//?   - a nullable single relation (`manager?: Employee`) — the projection must not
//?     drop the `| null`
//?   - a Collection of a DIFFERENT entity than the back-reference, so the element
//?     type is not trivially the parent
//?   - a scalar array (`tags: string[]`) beside a relation array, since both
//?     render as `[]`-typed but must stay distinct
//?
//? Same `@ts-nocheck` contract as `mikroEntities.ts` — the directive is
//? LOAD-BEARING (suppresses REPORTING only; the checker still computes every
//? type, so the reproduction is intact). See that file's header for the full why.
// @ts-nocheck
import { BaseEntity, Collection, Entity, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class DeepCompany extends BaseEntity {
  @PrimaryKey()
  id!: string;

  @Property()
  name!: string;

  //? Level-0 Date — the one the original fixture already covers.
  @Property()
  createdAt: Date = new Date();

  //? A scalar array alongside the relation arrays below. Serializes to string[];
  //? must not be confused with a relation `[]`.
  @Property()
  tags: string[] = [];

  //? Level 0 -> 1 collection.
  @OneToMany(() => DeepDepartment, (d) => d.company)
  departments = new Collection<DeepDepartment>(this);
}

@Entity()
export class DeepDepartment extends BaseEntity {
  @PrimaryKey()
  id!: string;

  @Property()
  title!: string;

  //? Level-1 Date. If projection only fixes the TOP level, this stays a Date.
  @Property()
  createdAt: Date = new Date();

  //? Back-reference (the cycle Company -> departments -> company).
  @ManyToOne(() => DeepCompany)
  company!: DeepCompany;

  //? Level 1 -> 2 collection, a THIRD distinct entity.
  @OneToMany(() => DeepEmployee, (e) => e.department)
  employees = new Collection<DeepEmployee>(this);
}

@Entity()
export class DeepEmployee extends BaseEntity {
  @PrimaryKey()
  id!: string;

  @Property()
  fullName!: string;

  //? Level-2 Date.
  @Property()
  createdAt: Date = new Date();

  //? Back-reference (cycle Department -> employees -> department).
  @ManyToOne(() => DeepDepartment)
  department!: DeepDepartment;

  //? NULLABLE self-relation. The projection must keep `| null` — a manager is an
  //? Employee, so this is also a cycle at the same entity.
  @ManyToOne(() => DeepEmployee, { nullable: true })
  manager?: DeepEmployee | null;
}
