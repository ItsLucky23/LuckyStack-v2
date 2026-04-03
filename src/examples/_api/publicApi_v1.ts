import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse, MaybePromise } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: false,
  additional: [

  ]
};

export interface ApiParams {
  data: {
    message: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = ({ data }: ApiParams): MaybePromise<ApiResponse> => {
  console.log("received message: " + data.message);
  return {
    status: 'success',
    message: 'This API can be called without logging in!',
    serverTime: Date.now(),
    httpStatus: 200,
  };
};