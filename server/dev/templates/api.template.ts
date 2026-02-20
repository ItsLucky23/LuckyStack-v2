//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { AuthProps, SessionLayout } from '{{REL_PATH}}config';
//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { Functions, ApiResponse } from '{{REL_PATH}}src/_sockets/apiTypes.generated';

// Set the request limit per minute. Set to false to use the default config value config.rateLimiting
export const rateLimit: number | false = 20;

// HTTP method for this API. If not set, inferred from name (get* = GET, delete* = DELETE, else POST)
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

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

export const main = async ({  }: ApiParams): Promise<ApiResponse> => {
  // Error responses must include errorCode
  // return { status: 'error', errorCode: 'api.someError', errorParams: [{ key: 'id', value: 1 }] };

  // Optional: set custom HTTP status on this response
  // return { status: 'success', httpStatus: 201 };

  return {
    status: 'success',
    // Your response data here
  };
};