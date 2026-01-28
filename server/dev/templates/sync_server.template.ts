//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { AuthProps, SessionLayout } from '{{REL_PATH}}config';
//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { Functions, SyncServerResponse } from '{{REL_PATH}}src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: []
};

export interface SyncParams {
  clientInput: {
    // Define the data shape sent from the client e.g.
    // message: string;
    // targetUserId: string;
  };
  user: SessionLayout; // session data of the user who called the sync event
  functions: Functions; // functions object
  roomCode: string; // room code
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  // THIS FILE RUNS JUST ONCE ON THE SERVER

  // Please validate clientInput here and dont just send the data back to the other clients
  // optional: database action or something else

  return {
    status: 'success',
    // Add any data you want to broadcast to clients
  };
};