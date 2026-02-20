import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: []
};

export interface SyncParams {
  clientInput: { increase: boolean; };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput }: SyncParams): Promise<SyncServerResponse> => {
  console.log(clientInput);

  return {
    status: 'success',
    increase: clientInput.increase
  }
};
