//? Pluggable database readiness probe (ADR 0020, the ORM-choice decision).
//? `/readyz` used to hard-wire a Prisma ping, which made a deliberately
//? Prisma-less project (orm: 'none', or a custom ORM behind
//? `registerPrismaClient`) permanently report 503. Now:
//?
//?   - a consumer with a custom data layer registers its own probe from a
//?     `luckystack/core/*.ts` overlay file:
//?       registerDbHealthCheck(async () => { await db.execute('select 1'); return true; });
//?   - with no registration, `/readyz` falls back to the built-in Prisma ping
//?     when `@prisma/client` is resolvable, and reports the check as
//?     'skipped' when it is not (a DB-less project must be able to go ready).

export type DbHealthResult = boolean | 'skipped';
export type DbHealthCheck = () => Promise<DbHealthResult> | DbHealthResult;

let activeCheck: DbHealthCheck | null = null;

export const registerDbHealthCheck = (check: DbHealthCheck): void => {
  activeCheck = check;
};

export const getDbHealthCheck = (): DbHealthCheck | null => activeCheck;

export const isDbHealthCheckRegistered = (): boolean => activeCheck !== null;

export const resetDbHealthCheckForTests = (): void => {
  activeCheck = null;
};
