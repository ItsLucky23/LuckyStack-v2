import * as api0 from '../../src/_api/logout_v1';
import * as api1 from '../../src/_api/session_v1';
import * as api2 from '../../src/examples/_api/adminOnly_v1';
import * as api3 from '../../src/examples/_api/publicApi_v1';
import * as api4 from '../../src/examples/_api/toggleAdmin_v1';
import * as api5 from '../../src/settings/_api/updateUser_v1';

import * as syncClient0 from '../../src/examples/_sync/updateCounter_client_v1';
import * as syncServer1 from '../../src/examples/_sync/updateCounter_server_v1';

import * as fn0 from '../../server/functions/boardcaster';
import * as fn1 from '../../server/functions/db';
import * as fn2 from '../../server/functions/game';
import * as fn3 from '../../server/functions/redis';
import * as fn4 from '../../server/functions/sentry';
import * as fn5 from '../../server/functions/session';
import * as fn6 from '../../server/functions/sleep';
import * as fn7 from '../../server/functions/tryCatch';

export const apis: Record<string, { auth: any, main: any, rateLimit?: number | false, httpMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE', inputType?: string }> = {
  "api/logout/v1": {
    auth: "auth" in api0 ? api0.auth : {},
    main: api0.main,
    rateLimit: "rateLimit" in api0 ? (api0.rateLimit as number | false | undefined) : undefined,
    httpMethod: "httpMethod" in api0 ? (api0.httpMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined) : undefined,
    inputType: "{ }",
  },
  "api/session/v1": {
    auth: "auth" in api1 ? api1.auth : {},
    main: api1.main,
    rateLimit: "rateLimit" in api1 ? (api1.rateLimit as number | false | undefined) : undefined,
    httpMethod: "httpMethod" in api1 ? (api1.httpMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined) : undefined,
    inputType: "{ }",
  },
  "api/examples/adminOnly/v1": {
    auth: "auth" in api2 ? api2.auth : {},
    main: api2.main,
    rateLimit: "rateLimit" in api2 ? (api2.rateLimit as number | false | undefined) : undefined,
    httpMethod: "httpMethod" in api2 ? (api2.httpMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined) : undefined,
    inputType: "{ }",
  },
  "api/examples/publicApi/v1": {
    auth: "auth" in api3 ? api3.auth : {},
    main: api3.main,
    rateLimit: "rateLimit" in api3 ? (api3.rateLimit as number | false | undefined) : undefined,
    httpMethod: "httpMethod" in api3 ? (api3.httpMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined) : undefined,
    inputType: "{ message: string; }",
  },
  "api/examples/toggleAdmin/v1": {
    auth: "auth" in api4 ? api4.auth : {},
    main: api4.main,
    rateLimit: "rateLimit" in api4 ? (api4.rateLimit as number | false | undefined) : undefined,
    httpMethod: "httpMethod" in api4 ? (api4.httpMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined) : undefined,
    inputType: "{ }",
  },
  "api/settings/updateUser/v1": {
    auth: "auth" in api5 ? api5.auth : {},
    main: api5.main,
    rateLimit: "rateLimit" in api5 ? (api5.rateLimit as number | false | undefined) : undefined,
    httpMethod: "httpMethod" in api5 ? (api5.httpMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined) : undefined,
    inputType: "{ name?: string; theme?: 'light' | 'dark'; language?: string; avatar?: string; }",
  },
};

export const syncs: Record<string, { main: any, auth: Record<string, any>, inputType?: string }> | any = {
  "sync/examples/updateCounter/v1_client": syncClient0.main,
  "sync/examples/updateCounter/v1_server": { auth: "auth" in syncServer1 ? syncServer1.auth : {}, main: syncServer1.main, inputType: "{ increase: boolean; }" },
};

export const functions: Record<string, any> = {
  "boardcaster": (() => {
    const { default: _default, ...named } = fn0 as Record<string, any>;
    const cleaned = Object.fromEntries(Object.entries(named).filter(([key]) => key !== '__esModule'));
    if (Object.keys(cleaned).length > 0) return cleaned;
    return _default !== undefined ? { "boardcaster": _default } : {};
  })(),
  "db": (() => {
    const { default: _default, ...named } = fn1 as Record<string, any>;
    const cleaned = Object.fromEntries(Object.entries(named).filter(([key]) => key !== '__esModule'));
    if (Object.keys(cleaned).length > 0) return cleaned;
    return _default !== undefined ? { "db": _default } : {};
  })(),
  "game": (() => {
    const { default: _default, ...named } = fn2 as Record<string, any>;
    const cleaned = Object.fromEntries(Object.entries(named).filter(([key]) => key !== '__esModule'));
    if (Object.keys(cleaned).length > 0) return cleaned;
    return _default !== undefined ? { "game": _default } : {};
  })(),
  "redis": (() => {
    const { default: _default, ...named } = fn3 as Record<string, any>;
    const cleaned = Object.fromEntries(Object.entries(named).filter(([key]) => key !== '__esModule'));
    if (Object.keys(cleaned).length > 0) return cleaned;
    return _default !== undefined ? { "redis": _default } : {};
  })(),
  "sentry": (() => {
    const { default: _default, ...named } = fn4 as Record<string, any>;
    const cleaned = Object.fromEntries(Object.entries(named).filter(([key]) => key !== '__esModule'));
    if (Object.keys(cleaned).length > 0) return cleaned;
    return _default !== undefined ? { "sentry": _default } : {};
  })(),
  "session": (() => {
    const { default: _default, ...named } = fn5 as Record<string, any>;
    const cleaned = Object.fromEntries(Object.entries(named).filter(([key]) => key !== '__esModule'));
    if (Object.keys(cleaned).length > 0) return cleaned;
    return _default !== undefined ? { "session": _default } : {};
  })(),
  "sleep": (() => {
    const { default: _default, ...named } = fn6 as Record<string, any>;
    const cleaned = Object.fromEntries(Object.entries(named).filter(([key]) => key !== '__esModule'));
    if (Object.keys(cleaned).length > 0) return cleaned;
    return _default !== undefined ? { "sleep": _default } : {};
  })(),
  "tryCatch": (() => {
    const { default: _default, ...named } = fn7 as Record<string, any>;
    const cleaned = Object.fromEntries(Object.entries(named).filter(([key]) => key !== '__esModule'));
    if (Object.keys(cleaned).length > 0) return cleaned;
    return _default !== undefined ? { "tryCatch": _default } : {};
  })(),
};