//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { ClientSyncProps } from '{{REL_PATH}}config';

export interface SyncParams {
  // Define the data shape that will be received e.g.
  // message: string;
  // senderId: string;
}

export const main = ({ user, clientData }: ClientSyncProps) => {
  // This is a client sided file and will be executed on the client.

  // Example: Only allow users on this page to receive the event
  // if (user?.location?.pathName === '/your-page') {
  //   return { status: 'success' };
  // }

  return {
    status: 'success',
    // Add any additional data to pass to the client
  };
};