//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { SessionLayout } from '{{REL_PATH}}config';
//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { Functions, SyncClientResponse, SyncClientInput, SyncServerOutput } from '{{REL_PATH}}src/_sockets/apiTypes.generated';

// Types are imported from the generated file based on the _server.ts definition
type PagePath = '{{PAGE_PATH}}';
type SyncName = '{{SYNC_NAME}}';

export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;
  serverOutput: SyncServerOutput<PagePath, SyncName>;
  user: SessionLayout; // session data from any user that is in the room
  functions: Functions; // contains all functions that are available on the server in the functions folder
  roomCode: string; // room code
}

export const main = async ({  }: SyncParams): Promise<SyncClientResponse> => {
  // PAIRED SYNC: Types are shared with the _server.ts file
  // clientInput type comes from _server.ts SyncParams
  // serverOutput type is inferred from _server.ts return value
  // Returning error here only affects the current target client and does not stop other clients.

  // Example: Only allow users on set page to receive the event
  // if (user?.location?.pathName === '/your-page') {
  //   return { status: 'success' };
  // }

  return {
    status: 'success',
    // Add any additional data to pass to the client
  };
};
