//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { AuthProps, ServerSyncProps } from '{{REL_PATH}}config';

export const auth: AuthProps = {
  login: true,
  additional: []
};

export interface SyncParams {
  clientData: {
    // Define the data shape sent from the client e.g.
    // message: string;
    // targetUserId: string;
  };
}

export const main = async ({ clientData, user }: ServerSyncProps) => {
  // Please validate client data here and dont just send the client data back to the other clients
  // optional: database action or something else

  return {
    status: 'success',
    // Add any data you want to broadcast to clients
  };
};