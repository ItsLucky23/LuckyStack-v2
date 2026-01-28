import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: []
};

export interface SyncParams {
  clientInput: {
    increase: boolean;
  };
  user: SessionLayout; // session data of the user who called the sync event
  functions: Functions; // functions object
  roomCode: string; // room code
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  console.log(clientInput);
  // here you can maybe update a counter in your server memory with redis or update your database cause this file only runs once

  return {
    status: 'success',
    increase: clientInput.increase
  }
};