import { tryCatch } from "../functions/tryCatch";
import { devSyncs, devFunctions } from "../dev/loader"
import { syncs, functions } from '../prod/generatedApis'
import { ioInstance, syncMessage } from "./socket";
import { Socket } from "socket.io";
import { getSession } from "../functions/session";
import { SessionLayout } from "../../config";
import { validateRequest } from "../utils/validateRequest";
import { extractTokenFromSocket } from "../utils/extractToken";

const functionsObject = process.env.NODE_ENV == 'development' ? devFunctions : functions;


// export default async function handleSyncRequest({ name, clientData, user, serverOutput, roomCode }: syncMessage) {
export default async function handleSyncRequest({ msg, socket, token }: {
  msg: syncMessage,
  socket: Socket,
  token: string | null,
}) {

  if (!ioInstance) { return; }

  //? first we validate the data
  if (typeof msg != 'object') {
    console.log('message', 'socket message was not a json object', 'red')
    return socket.emit('sync', 'socket message was not a json object');
  }

  const { name, data, cb, receiver, responseIndex, ignoreSelf } = msg;

  if (!name || !data || typeof name != 'string' || typeof data != 'object') {
    return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: `socket message was incomplete, syncName: ${name}, syncData: ${JSON.stringify(data)}` })
  }

  if (!cb || typeof cb != 'string') {
    return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: `socket message was incomplete, cb: ${cb}` });
  }

  if (!receiver) {
    console.log('receiver / roomCode: ', receiver, 'red')
    return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: `socket message was incomplete, needs a receiver / roomCode: ${receiver}` });
  }

  console.log(' ', 'blue')
  console.log(' ', 'blue')
  console.log(`sync: ${name} called`, 'blue');

  const user = await getSession(token);
  const syncObject = process.env.NODE_ENV == 'development' ? devSyncs : syncs;

  console.log(syncObject)
  //? we check if there is a client file or/and a server file, if they both dont exist we abort
  if (!syncObject[`${name}_client`] && !syncObject[`${name}_server`]) {
    console.log("ERROR!!!, ", `you need ${name}_client or ${name}_server file to sync`, 'red');
    return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: `you need ${name}_client or ${name}_server file to sync` });
  }

  let serverOutput = {};
  if (syncObject[`${name}_server`]) {
    const { auth, main: serverMain } = syncObject[`${name}_server`];

    //? if the login key is true we check if the user has an id in the session object
    if (auth.login) {
      if (!user?.id) {
        console.log(`ERROR!!!, not logged in but sync requires login`, 'red');
        return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: 'not logged in but sync requires login' });
      }
    }

    const validationResult = validateRequest({ auth, user: user as SessionLayout });
    if (validationResult.status === 'error') {
      console.log('ERROR!!!, ', validationResult.message, 'red');
      return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, validationResult);
    }

    //? if the user has passed all the checks we call the preload sync function and return the result
    const [serverSyncError, serverSyncResult] = await tryCatch(async () => await serverMain({ clientInput: data, user, functions: functionsObject, roomCode: receiver }));
    if (serverSyncError) {
      console.log('ERROR!!!, ', serverSyncError.message, 'red');
      return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: serverSyncError.message });
    } else if (serverSyncResult?.status == 'error') {
      console.log('ERROR!!!, ', serverSyncResult.message, 'red');
      return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: serverSyncResult.message });
    } else if (serverSyncResult?.status !== 'success') {
      //? badReturn means it doesnt include a status key with the value 'success' || 'error'
      console.log('ERROR!!!, ', `sync ${name}_server function didnt return a status key with the value 'success' or 'error'`, 'red');
      return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: `sync ${name}_server function didnt return a status key with the value 'success' or 'error'` });
    } else if (serverSyncResult?.status == 'success') {
      serverOutput = serverSyncResult;
    }
  }

  //? from here on we can assume that we have either called a server sync and got a proper result of we didnt call a server sync

  //? get the desired sockets based on the receiver key
  const sockets = receiver === 'all'
    ? ioInstance.sockets.sockets //? all connected sockets (Map)
    : ioInstance.sockets.adapter.rooms.get(receiver) //? Set of socket IDs in room

  //? now we check if we found any sockets
  if (!sockets) {
    console.log('data: ', msg, 'red');
    console.log('receiver: ', receiver, 'red');
    console.log('no sockets found', 'red');
    return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: `no sockets found for receiver / roomCode: ${receiver}` });
  }

  //? here we loop over all the connected clients
  //? we keep track of an counter and await the loop every 100 iterations to avoid the server running out of memory and crashing
  let tempCount = 1;
  for (const socketEntry of sockets) {
    tempCount++;
    if (tempCount % 100 == 0) { await new Promise(resolve => setTimeout(resolve, 1)); }

    const tempSocket = receiver === 'all'
      ? (socketEntry as [string, Socket])[1] //? Map entry
      : ioInstance.sockets.sockets.get(socketEntry as string); //? socket ID from Set

    if (!tempSocket) { continue; }

    //? check if they have a token stored in their cookie or session based on the settings
    const tempToken = extractTokenFromSocket(tempSocket);

    //? here we get the users session of the client and run the sync function with the data and the users session data
    const user = await getSession(tempToken);

    if (ignoreSelf && typeof ignoreSelf == 'boolean') {
      if (token == tempToken) {
        continue;
      }
    }

    if (syncObject[`${name}_client`]) {
      const [clientSyncError, clientSyncResult] = await tryCatch(async () => await syncObject[`${name}_client`]({ clientInput: data, user, functions: functionsObject, serverOutput, roomCode: receiver }));
      // if (clientSyncError) { socket.emit(`sync-${responseIndex}`, { status: "error", message: clientSyncError }); }
      if (clientSyncError) { tempSocket.emit(`sync`, { status: "error", message: clientSyncError }) }
      //? if we return error we dont want this client to get the event
      else if (clientSyncResult?.status == 'error') { continue; }
      else if (clientSyncResult?.status == 'success') {
        const result = {
          cb,
          serverOutput,
          clientOutput: clientSyncResult,  // Return from _client file (success only)
          message: clientSyncResult.message || `${name} sync success`,
          status: 'success'
        };
        console.log(result, 'blue')
        tempSocket.emit(`sync`, result);
      }
    } else {
      //? if there is no client function we still want to send the server data to the clients
      const result = {
        cb,
        serverOutput,
        clientOutput: {},  // No client file, so empty output
        message: `${name} sync success`,
        status: 'success'
      };
      console.log(result, 'blue')
      tempSocket.emit(`sync`, result);
    }
  }

  return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: 'success', message: `sync ${name} success` });
}