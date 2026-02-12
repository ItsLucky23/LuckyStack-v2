import { tryCatch } from '../functions/tryCatch';
import { apis, functions } from '../prod/generatedApis'
import { devApis, devFunctions } from "../dev/loader"
import { apiMessage } from './socket';
import { getSession } from '../functions/session';
import config, { SessionLayout } from '../../config';
import { Socket } from 'socket.io';
import { logout } from './utils/logout';
import { validateRequest } from '../utils/validateRequest';
import { captureException } from '../utils/sentry';
import { checkRateLimit } from '../utils/rateLimiter';

type handleApiRequestType = {
  msg: apiMessage,
  socket: Socket,
  token: string | null,
}

export default async function handleApiRequest({ msg, socket, token }: handleApiRequestType) {
  //? This event gets triggered when the client uses the apiRequest function
  //? We validate the message, check auth then execute

  if (typeof msg != 'object') {
    console.log('socket message was not a json object!!!!', 'red')
    return;
  }

  const { name, data, responseIndex } = msg;
  const user = await getSession(token)

  if (!responseIndex && typeof responseIndex !== 'number') {
    console.log('no response index given!!!!', 'red')
    return;
  }

  //? 'logout' needs special handling since it requires socket access
  if (name == 'logout') {
    await logout({ token, socket, userId: user?.id || null });
    return socket.emit(`apiResponse-${responseIndex}`, { result: true });
  }

  //? Built-in API handlers

  if (!name || !data || typeof name != 'string' || typeof data != 'object') {
    return socket.emit(`apiResponse-${responseIndex}`, {
      status: "error",
      message: `Invalid request: name=${name}, data=${JSON.stringify(data)}`
    });
  }

  console.log(`api: ${name} called`, 'blue');

  const apisObject = process.env.NODE_ENV == 'development' ? devApis : apis;

  //? Check if API exists
  if (!apisObject[name]) {
    return socket.emit(`apiResponse-${responseIndex}`, {
      status: "error",
      message: `API not found: ${name}`
    });
  }

  const { auth, main, schema } = apisObject[name];

  //? Auth validation: check login requirement
  if (auth.login) {
    if (!user?.id) {
      console.log(`ERROR: API ${name} requires login`, 'red');
      return socket.emit(`apiResponse-${responseIndex}`, {
        status: "error",
        message: 'Authentication required'
      });
    }
  }

  //? Auth validation: check additional requirements
  const authResult = validateRequest({ auth, user: user as SessionLayout });
  if (authResult.status === "error") {
    console.log(`ERROR: Auth failed for ${name}: ${authResult.message}`, 'red');
    return socket.emit(`apiResponse-${responseIndex}`, authResult);
  }

  //? Rate limiting check
  const apiRateLimit = apisObject[name].rateLimit;
  const effectiveLimit = apiRateLimit !== undefined
    ? apiRateLimit
    : config.rateLimiting.defaultApiLimit;

  if (effectiveLimit !== false && effectiveLimit > 0) {
    const rateLimitKey = user?.id
      ? `user:${user.id}:api:${name}`
      : `ip:${socket.handshake.address}:api:${name}`;

    const { allowed, remaining, resetIn } = checkRateLimit({
      key: rateLimitKey,
      limit: effectiveLimit,
      windowMs: config.rateLimiting.windowMs
    });

    if (!allowed) {
      console.log(`Rate limit exceeded for ${name}`, 'yellow');
      return socket.emit(`apiResponse-${responseIndex}`, {
        status: 'error',
        message: `Rate limit exceeded. Try again in ${resetIn} seconds.`,
        rateLimitRemaining: remaining,
        rateLimitResetIn: resetIn
      });
    }
  }

  //? Execute the API handler
  const functionsObject = process.env.NODE_ENV == 'development' ? devFunctions : functions;
  const [error, result] = await tryCatch(
    async () => await main({ data, user, functions: functionsObject })
  );

  if (error) {
    console.log(`ERROR in ${name}:`, error, 'red');
    captureException(error, { api: name, userId: user?.id });
    socket.emit(`apiResponse-${responseIndex}`, {
      status: "error",
      message: error.message || 'Internal server error'
    });
  } else if (result) {
    console.log(`api: ${name} completed`, 'blue');

    // Check if result is already formatted as ApiResponse (has status='success' or 'error')
    // This allows users to return strict ApiResponse objects without double-wrapping
    if (result && typeof result === 'object' && (result.status === 'success' || result.status === 'error')) {
      socket.emit(`apiResponse-${responseIndex}`, result);
    } else {
      // Legacy/Convenience: Wrap raw data in success response
      socket.emit(`apiResponse-${responseIndex}`, { status: "success", result });
    }
  } else {
    console.log(`WARNING: ${name} returned nothing`, 'yellow');
    socket.emit(`apiResponse-${responseIndex}`, {
      status: "error",
      message: 'API returned no result'
    });
  }
}