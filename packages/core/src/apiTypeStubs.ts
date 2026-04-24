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

export interface ApiTypeMap {}
export interface SyncTypeMap {}

export type StreamPayload = {
  [key: string]: unknown;
};
