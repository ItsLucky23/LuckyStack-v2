import { AuthProps, SessionLayout } from '../../../../config';
import { Functions } from '../../../_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: false,
};

export interface ApiParams {
  data: {
    // Define your input data shape here e.g.
    // name: string;
    // email: string;
    name: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams) => {
  console.log(data.name)
  return {
    status: 'success',
    result: {
      name: data.name + ' test',
      // Your response data here
    }
  };
};