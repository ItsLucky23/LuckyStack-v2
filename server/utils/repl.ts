/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { deleteSession, getAllSessions, getSession } from "../../functions/session"
import repl from 'node:repl';
import { sanitizeForLog } from '@luckystack/core';
import { getRuntimeReplMaps } from "../prod/runtimeMaps";

const getActiveApiMap = async (): Promise<Record<string, unknown>> => {
  const { apiMap } = await getRuntimeReplMaps();
  return apiMap;
};

const getActiveSyncMap = async (): Promise<Record<string, unknown>> => {
  const { syncMap } = await getRuntimeReplMaps();
  return syncMap;
};

const normalizeApiUrls = async (): Promise<string[]> => {
  const routeKeys = Object.keys(await getActiveApiMap())
    .filter((key) => key.startsWith('api/'))
    .map((key) => `/${key}`)
    .sort((a, b) => a.localeCompare(b));

  return [...new Set(routeKeys)];
};

const normalizeSyncUrls = async (): Promise<string[]> => {
  const routeKeys = Object.keys(await getActiveSyncMap())
    .filter((key) => key.startsWith('sync/'))
    .map((key) => key.replace(/_(client|server)$/, ''))
    .map((key) => `/${key}`)
    .sort((a, b) => a.localeCompare(b));

  return [...new Set(routeKeys)];
};

export const initRepl = () => {
  const replInstance = repl.start({
    prompt: 'server> ',
    useColors: true,
    useGlobal: true,
  })
  
  replInstance.context.getAllSessions = async () => {
    //? Sanitize before logging — sessions carry csrfToken, token, and
    //? other sensitive fields that must never appear in plaintext logs.
    console.log(sanitizeForLog(await getAllSessions()))
  }

  replInstance.context.getSession = async (token: string) => {
    const session = await getSession(token)
    if (session && typeof session == 'object' && Object.keys(session).length > 0) {
      console.log(sanitizeForLog(session))
    } else {
      console.log('no session found')
    }
  }
  
  replInstance.context.deleteSession = async (token: string) => {

    const result = await deleteSession(token)
    console.log(sanitizeForLog(result))
  }
  
  replInstance.context.commands = () => {
    console.log('commands:')
    console.log('getSession(token) -- if no token provided then it will return all sessions')
    console.log('deleteSession(token) -- deletes the session for the given token')
    console.log('listApiUrls() -- prints all discovered API urls')
    console.log('listSyncUrls() -- prints all discovered sync urls')
  }

  replInstance.context.listApiUrls = async () => {
    const urls = await normalizeApiUrls();
    if (urls.length === 0) {
      console.log('No API urls found.');
      return urls;
    }

    console.log('API urls:');
    for (const url of urls) {
      console.log(url);
    }
    return urls;
  }

  replInstance.context.listSyncUrls = async () => {
    const urls = await normalizeSyncUrls();
    if (urls.length === 0) {
      console.log('No sync urls found.');
      return urls;
    }

    console.log('Sync urls:');
    for (const url of urls) {
      console.log(url);
    }
    return urls;
  }
}
