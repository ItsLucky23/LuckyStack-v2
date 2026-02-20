import { getAllGameDatas, getGameData, saveGameData } from "../functions/game"
import { deleteSession, getAllSessions, getSession } from "../functions/session"
import repl from 'repl';
import { devApis, devSyncs } from "../dev/loader";
import { apis, syncs } from "../prod/generatedApis";

const getActiveApiMap = (): Record<string, unknown> => {
  if (Object.keys(devApis).length > 0) {
    return devApis;
  }
  return apis;
};

const getActiveSyncMap = (): Record<string, unknown> => {
  if (Object.keys(devSyncs).length > 0) {
    return devSyncs;
  }
  return syncs as Record<string, unknown>;
};

const normalizeApiUrls = (): string[] => {
  const routeKeys = Object.keys(getActiveApiMap())
    .filter((key) => key.startsWith('api/'))
    .map((key) => `/${key}`)
    .sort((a, b) => a.localeCompare(b));

  return Array.from(new Set(routeKeys));
};

const normalizeSyncUrls = (): string[] => {
  const routeKeys = Object.keys(getActiveSyncMap())
    .filter((key) => key.startsWith('sync/'))
    .map((key) => key.replace(/_(client|server)$/, ''))
    .map((key) => `/${key}`)
    .sort((a, b) => a.localeCompare(b));

  return Array.from(new Set(routeKeys));
};

export const initRepl = () => {
  const replInstance = repl.start({
    prompt: 'server> ',
    useColors: true,
    useGlobal: true,
  })
  
  replInstance.context.getAllSessions = async () => {
    console.log(await getAllSessions())
  }

  replInstance.context.getSession = async (token: string) => {
  
    const session = await getSession(token)
    if (session && typeof session == 'object' && Object.keys(session).length > 0) {
      console.log(session) 
    } else {
      console.log('no session found')
    }
  }
  
  replInstance.context.deleteSession = async (token: string) => {
  
    const result = await deleteSession(token)
    console.log(result)
  }
  
  replInstance.context.getGame = async (code: string, keys?: string) => {
    if (!code) {
      console.log(await getAllGameDatas())
      return;
    }
  
    const gameData = await getGameData(code)
    if (typeof gameData == 'object' && gameData?.gameCode) {
      if (keys) {
        const parts = keys
        .replace(/\[(\w+)\]/g, ".$1")   // turn [0] into .0
        .replace(/^\./, "")             // remove leading dot
        .split(/(?:\?\.)|\./);          // split on ?. or .
        
        // @ts-ignore
        console.log(parts.reduce((acc, key) => acc?.[key], gameData));
      } else {
        console.log(gameData) 
      }
    } else {
      console.log('no session found')
    }
  }
  
  replInstance.context.updateGame = async (code: string, keys: string, value: any) => {
    if (!code || !keys) {
      console.log("Usage: updateGame(code, 'nested.path.like.this', value)");
      return;
    }
  
    let gameData = await getGameData(code);
    if (typeof gameData !== "object" || !gameData?.gameCode) {
      console.log("No session found");
      return;
    }
  
    // Parse the keys string into parts (supporting [0], ?. etc.)
    const parts = keys
      .replace(/\[(\w+)\]/g, ".$1") // turn [0] into .0
      .replace(/^\./, "")           // remove leading dot
      .split(/(?:\?\.)|\./);        // split on ?. or .
  
    // Walk into object and set the value
    let target = gameData;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!(key in target)) {
        // @ts-ignore
        target[key] = {}; // create missing objects
      }
      // @ts-ignore
      target = target[key];
    }
  
    const lastKey = parts[parts.length - 1];
    // @ts-ignore
    target[lastKey] = value;
  
    // Persist the change (assuming you already have a saveGameData function)
    await saveGameData(code, gameData);
  
    console.log(`Updated ${keys} to:`, value);
  };
  
  
  replInstance.context.commands = () => {
    console.log('commands:')
    console.log('getSession(token) -- if no token provided then it will return all sessions')
    console.log('deleteSession(token) -- if no token provided then it will delete all sessions')
    console.log('getGame(code) -- if no code provided then it will return all sessions')
    console.log('listApiUrls() -- prints all discovered API urls')
    console.log('listSyncUrls() -- prints all discovered sync urls')
  }

  replInstance.context.listApiUrls = () => {
    const urls = normalizeApiUrls();
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

  replInstance.context.listSyncUrls = () => {
    const urls = normalizeSyncUrls();
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