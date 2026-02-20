import { ioInstance } from "../../server/sockets/socket"
import { getSession } from "./session";

export const boardcaster = async ({
  code,
  event,
  session,
  data,
  ignoreSelf
}: {
  code: string,
  event: string,
  session?: boolean,
  data?: any,
  ignoreSelf?: string
}): Promise<number> => {
  const io = ioInstance;
  if (!io) { return 0; }

  const sockets = io.sockets.adapter.rooms.get(code);
  if (!sockets) { return 0; }

  let emittedCount = 0;


  for (const socketId of sockets || []) {
    const tempSocket = io.sockets.sockets.get(socketId as string);
    if (!tempSocket) { continue; }

    if (ignoreSelf || session) {

      const tempCookie = tempSocket.handshake.headers.cookie; // get the cookie from the socket connection
      const tempSessionToken = tempSocket.handshake.auth?.token
      const tempToken = tempCookie && process.env.VITE_SESSION_BASED_TOKEN === 'false' ? tempCookie.split("=")[1]
        : tempSessionToken && process.env.VITE_SESSION_BASED_TOKEN === 'true' ? tempSessionToken
          : null;

      if (ignoreSelf == tempToken) {
        console.log(' skipping self emit ');
        continue;
      } //? we dont send the event to the client who called the event


      if (!tempToken) { continue; }
      const sessionData = await getSession(tempToken);

      tempSocket.emit(event, { ...data, session: sessionData });
      emittedCount++;

    } else {
      tempSocket.emit(event, { ...data });
      emittedCount++;
    }
  }

  return emittedCount;
}

export default boardcaster;