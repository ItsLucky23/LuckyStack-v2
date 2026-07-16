//? Deep-nesting route fixture — returns a 3-level MikroORM entity graph so the
//? wire projection is exercised at every depth, not just the top. Shaped like a
//? real `_api/<name>_v1.ts` (see `mikroRoute_v1.ts` for the contract).
import { DeepCompany } from './mikroDeepEntities';

export interface ApiParams {
  data: {
    companyId: string;
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- fixture exists for its TYPE, not behaviour
export const main = async ({ data }: ApiParams): Promise<{ status: string; result: { company: DeepCompany } }> => {
  const company = new DeepCompany();
  company.id = data.companyId;

  return {
    status: 'success',
    result: { company },
  };
};
