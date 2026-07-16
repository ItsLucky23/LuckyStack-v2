//? Deep MikroORM DTO graph using Ref<T> for back-references, the ORM-native
//? contract that keeps populated forward collections as objects while serializing
//? unpopulated back-references as primary keys.
// @ts-nocheck
import {
  BaseEntity,
  Collection,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
  type Ref,
} from '@mikro-orm/core';

@Entity()
export class DtoCompany extends BaseEntity {
  @PrimaryKey()
  id!: string;

  @Property()
  name!: string;

  @Property()
  createdAt: Date = new Date();

  @OneToMany(() => DtoDepartment, (department) => department.company)
  departments = new Collection<DtoDepartment>(this);
}

@Entity()
export class DtoDepartment extends BaseEntity {
  @PrimaryKey()
  id!: string;

  @Property()
  title!: string;

  @Property()
  createdAt: Date = new Date();

  @ManyToOne(() => DtoCompany, { ref: true })
  company!: Ref<DtoCompany>;

  @OneToMany(() => DtoEmployee, (employee) => employee.department)
  employees = new Collection<DtoEmployee>(this);
}

@Entity()
export class DtoEmployee extends BaseEntity {
  @PrimaryKey()
  id!: string;

  @Property()
  fullName!: string;

  @Property()
  createdAt: Date = new Date();

  @ManyToOne(() => DtoDepartment, { ref: true })
  department!: Ref<DtoDepartment>;

  @ManyToOne(() => DtoEmployee, { nullable: true, ref: true })
  manager?: Ref<DtoEmployee> | null;
}
