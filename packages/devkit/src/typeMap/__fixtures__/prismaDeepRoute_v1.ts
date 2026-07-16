//? Prisma's real generated-payload machinery, independent of whichever sample
//? schema happened to generate node_modules/.prisma/client. These descriptors use
//? the same `runtime.Types.Result.GetResult<Payload, Selection>` form emitted by
//? Prisma Client for a three-level include/select graph.
/* eslint-disable @typescript-eslint/consistent-type-definitions -- mirror Prisma's generated payload aliases exactly */
import type * as runtime from '@prisma/client/runtime/library.js';

type PrismaScalars = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  preferences: runtime.JsonValue;
};

type PrismaManagerPayload = {
  name: 'Manager';
  objects: Record<never, never>;
  scalars: PrismaScalars;
  composites: Record<never, never>;
};

type PrismaEmployeePayload = {
  name: 'Employee';
  objects: { manager: PrismaManagerPayload };
  scalars: PrismaScalars;
  composites: Record<never, never>;
};

type PrismaDepartmentPayload = {
  name: 'Department';
  objects: { employees: PrismaEmployeePayload[] };
  scalars: PrismaScalars;
  composites: Record<never, never>;
};

type PrismaCompanyPayload = {
  name: 'Company';
  objects: { departments: PrismaDepartmentPayload[] };
  scalars: PrismaScalars;
  composites: Record<never, never>;
};

type PrismaCompanyResult = runtime.Types.Result.GetResult<
  PrismaCompanyPayload,
  {
    select: {
      id: true;
      name: true;
      createdAt: true;
      updatedAt: true;
      preferences: true;
      departments: {
        select: {
          id: true;
          name: true;
          createdAt: true;
          updatedAt: true;
          preferences: true;
          employees: {
            select: {
              id: true;
              name: true;
              createdAt: true;
              updatedAt: true;
              preferences: true;
              manager: {
                select: {
                  id: true;
                  name: true;
                  createdAt: true;
                  updatedAt: true;
                  preferences: true;
                };
              };
            };
          };
        };
      };
    };
  }
>;

export interface ApiParams {
  data: { companyId: string };
}

export const main = async (_params: ApiParams): Promise<{
  status: 'success';
  result: { company: PrismaCompanyResult };
}> => {
  await Promise.resolve();
  let company!: PrismaCompanyResult;
  return { status: 'success', result: { company } };
};
