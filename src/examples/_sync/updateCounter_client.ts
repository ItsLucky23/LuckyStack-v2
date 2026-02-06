import { SessionLayout } from '../../../config';
import { Functions, SyncClientResponse , SyncClientInput, SyncServerOutput } from '../../../src/_sockets/apiTypes.generated';



// Types are imported from the generated file based on the _server.ts definition
type PagePath = 'examples';
type SyncName = 'updateCounter';
export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;

  serverOutput: SyncServerOutput<PagePath, SyncName>;
user: SessionLayout; // session data from any user that is in the room
  functions: Functions; // contains all functions that are available on the server in the functions folder
  roomCode: string; // room code
}

export const main = async ({ user, clientInput, serverOutput, functions, roomCode  }: SyncParams): Promise<SyncClientResponse> => {
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
