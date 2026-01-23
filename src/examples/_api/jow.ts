import { AuthProps, SessionLayout } from '../../../config';
import { Functions } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: false,
};

export interface ApiParams {
  data: {
    // Define your input data shape here e.g.
    // name: string;
    // email: string;
    email: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams) => {
  return {
    status: 'success',
    result: {
      age: 12
      // Your response data here
    }
  };
};