import { SessionLayout } from '../../../config';
import { Functions, SyncClientResponse } from '../../_sockets/apiTypes.generated';


export interface SyncParams {
  clientInput: {
    increase: boolean;
  };
  serverData: {
    status: string;
    increase: boolean;
  };
  user: SessionLayout; // session data from any user that is in the room
  functions: Functions; // contains all functions that are available on the server in the functions folder
  roomCode: string; // room code
}

export const main = async ({ user, clientInput, serverData, functions, roomCode }: SyncParams): Promise<SyncClientResponse> => {
  console.log('Sync client check:', user?.location?.pathName);

  // Check if user is on the examples page
  if (user?.location?.pathName === '/examples') {
    return {
      status: 'success',
      randomKey: true,
    };
  }

  // Return error to skip other clients
  return { status: 'error' };
};