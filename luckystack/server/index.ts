//? Entry-side bootstrap. Imported by `server/server.ts` (via
//? `bootstrapLuckyStack`) and pulls in every other overlay file in
//? topological order. Each side-effect import populates a registry the
//? framework reads through `getProjectConfig`, `getOAuthProviders`, etc.
//?
//? Most projects shouldn't need anything here beyond hook registrations
//? (e.g. `registerHook('postLogin', ...)`).

export {};
