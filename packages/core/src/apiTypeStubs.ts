//? Stub definitions for types that the generator fills in at build time.
//?
//? Framework code (`apiRequest`, `syncRequest`) imports `ApiTypeMap` and
//? `SyncTypeMap` from here. The generator emits a `declare module
//? '@luckystack/core'` augmentation block at the top of the project's
//? `src/_sockets/apiTypes.generated.ts`. TypeScript interface merging lets
//? the generated content fill in these empty stubs whenever the generated
//? file is loaded — no deep relative imports needed in framework code.
//?
//? Consumers who want a concrete shape (project code, tests) can still
//? import `ApiTypeMap` / `SyncTypeMap` from the generated file directly.

//? Both stubs are intentionally empty — the generator fills them in via
//? `declare module` augmentation at build time. The lint rule normally
//? warns because empty interfaces accept anything; that's the point here.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merge stub
export interface ApiTypeMap {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merge stub
export interface SyncTypeMap {}

export type StreamPayload = Record<string, unknown>;
