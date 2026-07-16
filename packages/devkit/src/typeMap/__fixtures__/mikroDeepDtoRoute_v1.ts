//? MikroORM's explicit DTO contract for a loaded deep graph. Returning the live
//? entity itself intentionally serializes relation collections as primary keys;
//? `EntityDTO<T>` is the precise nested-object surface for handlers that return
//? an explicit serialized DTO instead.
import type { EntityDTO, Loaded } from '@mikro-orm/core';
import type { DtoCompany } from './mikroDeepDtoEntities';

export interface ApiParams {
  data: { companyId: string };
}

export const main = async (_params: ApiParams): Promise<{
  status: 'success';
  result: { company: EntityDTO<Loaded<DtoCompany, 'departments.employees'>> };
}> => {
  await Promise.resolve();
  let company!: EntityDTO<Loaded<DtoCompany, 'departments.employees'>>;
  return { status: 'success', result: { company } };
};
