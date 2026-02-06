import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

// Set the request limit per minute. Set to false to use the default config value config.rateLimiting
export const rateLimit: number | false = 20;

// HTTP method for this API. If not set, inferred from name (get* = GET, delete* = DELETE, else POST)
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';

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