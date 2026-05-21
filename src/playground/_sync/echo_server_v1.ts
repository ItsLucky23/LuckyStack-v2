//? Playground: simple sync echo. Whatever the originator sends fan-outs to
//? every member of the receiver room. No streaming — just confirms
//? room-based fan-out works across multiple browsers.

import { AuthProps, SessionLayout } from '../../../config';
import {
  Functions,
  SyncServerResponse,
  MaybePromise,
  SyncServerStreamEmitter,
  SyncBroadcastStreamEmitter,
  SyncStreamToEmitter,
} from '../../_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: false,
};

export interface SyncParams {
  clientInput: { message: string };
  user: SessionLayout | null;
  functions: Functions;
  roomCode: string;
  stream: SyncServerStreamEmitter;
  broadcastStream: SyncBroadcastStreamEmitter;
  streamTo: SyncStreamToEmitter;
}

export const main = ({ clientInput, user }: SyncParams): MaybePromise<SyncServerResponse> => {
  return {
    status: 'success',
    message: clientInput.message,
    senderId: user?.id ?? 'anonymous',
    receivedAt: new Date().toISOString(),
  };
};
