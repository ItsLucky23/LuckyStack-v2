//? Example `billing` service route. Makes the `billing` service declared in
//? services.config.ts a REAL backend bundle (its `source: 'billing'` folder now
//? exists), so the `finance-preset` resolves to actual routes instead of an empty
//? bundle. Replace with your real billing endpoints — or remove the billing service
//? from services.config.ts + deploy.config.ts if you don't need it.
//? @docs owner sample
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse, MaybePromise } from '../../_sockets/apiTypes.generated';

export const rateLimit: number | false = 60;

export const auth: AuthProps = {
  login: true,
};

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout;
  functions: Functions;
}

export const main = ({ user }: ApiParams): MaybePromise<ApiResponse> => {
  return {
    status: 'success',
    result: { invoices: [], ownerId: user.id },
  };
};
