//? Actual Drizzle relational-query inference: three SQLite tables, declared
//? relations, and the same nested `with` shape a consumer passes to
//? `db.query.companies.findMany(...)`.
import { relations, type BuildQueryResult, type ExtractTablesWithRelations } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const drizzleCompanies = sqliteTable('fixture_companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const drizzleDepartments = sqliteTable('fixture_departments', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => drizzleCompanies.id),
  title: text('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const drizzleEmployees = sqliteTable('fixture_employees', {
  id: text('id').primaryKey(),
  departmentId: text('department_id').notNull().references(() => drizzleDepartments.id),
  fullName: text('full_name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const drizzleCompanyRelations = relations(drizzleCompanies, ({ many }) => ({
  departments: many(drizzleDepartments),
}));

export const drizzleDepartmentRelations = relations(drizzleDepartments, ({ many, one }) => ({
  company: one(drizzleCompanies, {
    fields: [drizzleDepartments.companyId],
    references: [drizzleCompanies.id],
  }),
  employees: many(drizzleEmployees),
}));

export const drizzleEmployeeRelations = relations(drizzleEmployees, ({ one }) => ({
  department: one(drizzleDepartments, {
    fields: [drizzleEmployees.departmentId],
    references: [drizzleDepartments.id],
  }),
}));

const _drizzleSchema = {
  drizzleCompanies,
  drizzleDepartments,
  drizzleEmployees,
  drizzleCompanyRelations,
  drizzleDepartmentRelations,
  drizzleEmployeeRelations,
};

type DrizzleSchema = ExtractTablesWithRelations<typeof _drizzleSchema>;
type DrizzleCompanyPayload = BuildQueryResult<
  DrizzleSchema,
  DrizzleSchema['drizzleCompanies'],
  { with: { departments: { with: { employees: true } } } }
>;

export interface ApiParams {
  data: { companyId: string };
}

export const main = async (_params: ApiParams): Promise<{
  status: 'success';
  result: { company: DrizzleCompanyPayload };
}> => {
  await Promise.resolve();
  let company!: DrizzleCompanyPayload;
  return { status: 'success', result: { company } };
};
