//? Server overlay entry. `bootstrapLuckyStack` auto-imports every other
//? overlay file before this one, so by the time you see anything here every
//? registry is populated. Put framework-hook registrations
//? (`registerHook('postLogin', ...)`, `registerCustomRoute(...)`) here.

import { registerHook } from '@luckystack/core';

registerHook('postLogin', ({ userId, provider, isNewUser }) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[hooks] login: user=${userId}, provider=${provider}, new=${String(isNewUser)}`);
  }
  return undefined; // no stop signal — flow continues normally
});
