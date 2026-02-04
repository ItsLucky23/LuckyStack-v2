//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { SessionLayout } from '{{REL_PATH}}config';
//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { Functions, SyncClientResponse, SyncClientInput, SyncServerData } from '{{REL_PATH}}src/_sockets/apiTypes.generated';

// Types are imported from the generated file based on the _server.ts definition
type PagePath = '{{PAGE_PATH}}';
type SyncName = '{{SYNC_NAME}}';

export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;
  serverData: SyncServerData<PagePath, SyncName>;
  user: SessionLayout; // session data from any user that is in the room
  functions: Functions; // contains all functions that are available on the server in the functions folder
  roomCode: string; // room code
}

export const main = async ({ user, clientInput, serverData, functions, roomCode }: SyncParams): Promise<SyncClientResponse> => {
  // PAIRED SYNC: Types are shared with the _server.ts file
  // clientInput type comes from _server.ts SyncParams
  // serverData type is inferred from _server.ts return value

  // Example: Only allow users on set page to receive the event
  // if (user?.location?.pathName === '/your-page') {
  //   return { status: 'success' };
  // }

  return {
    status: 'success',
    // Add any additional data to pass to the client
  };
};
