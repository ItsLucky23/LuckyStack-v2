//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { SessionLayout } from '{{REL_PATH}}config';
//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { Functions, SyncClientResponse } from '{{REL_PATH}}src/_sockets/apiTypes.generated';


export interface SyncParams {
  clientInput: {
    // Define the data shape sent from the client e.g.
    // message: string;
  };
  serverData: {
    // Define the data shape returned from the server e.g.
    // message: string;
  };
  user: SessionLayout; // session data from any user that is in the room
  functions: Functions; // contains all functions that are available on the server in the functions folder
  roomCode: string; // room code
}

export const main = async ({ user, clientInput, serverData, functions, roomCode }: SyncParams): Promise<SyncClientResponse> => {
  // THIS FILE RUNS ON THE SERVER AND IT EXECUTES FOR EVERY CLIENT THAT IS IN THE GIVEN ROOM

  // Example: Only allow users on set page to receive the event
  // if (user?.location?.pathName === '/your-page') {
  //   return { status: 'success' };
  // }

  return {
    status: 'success',
    // Add any additional data to pass to the client
  };
};