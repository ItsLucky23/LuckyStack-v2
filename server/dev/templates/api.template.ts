//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { AuthProps, SessionLayout } from '{{REL_PATH}}config';
//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { Functions, ApiResponse } from '{{REL_PATH}}src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: []
};

export interface ApiParams {
  data: {
    // Define your input data shape here e.g.
    // name: string;
    // email: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  return {
    status: 'success',
    result: {
      // Your response data here
    }
  };
};