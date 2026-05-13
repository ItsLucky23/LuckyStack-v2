/* eslint-disable */
//? Playground: deliberately throws inside a sync handler so the framework's
//? syncError hook fires and the originator receives a normalized error
//? envelope. Sister demo to playground/throwError_v1.

import { AuthProps, SessionLayout } from '../../../config';
import {
  Functions,
  SyncServerResponse,
  SyncServerStreamEmitter,
  SyncBroadcastStreamEmitter,
  SyncStreamToEmitter,
  MaybePromise,
} from '../../_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: false,
};

export interface SyncParams {
  clientInput: { reason?: string };
  user: SessionLayout | null;
  functions: Functions;
  roomCode: string;
  stream: SyncServerStreamEmitter;
  broadcastStream: SyncBroadcastStreamEmitter;
  streamTo: SyncStreamToEmitter;
}

export const main = ({ clientInput }: SyncParams): MaybePromise<SyncServerResponse> => {
  throw new Error(`Playground throwSync_v1: deliberate failure (${clientInput.reason ?? 'no reason given'}).`);
};
