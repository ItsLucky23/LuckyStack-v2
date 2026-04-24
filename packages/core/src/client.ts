// Client-side core surface. Kept separate from `./index.ts` because
// `apiRequest` imports React-coupled project code (notify →
// TranslationProvider.tsx) and would break the server tsconfig build if
// re-exported from the main barrel.
export { apiRequest } from './apiRequest';
export type { ApiStreamEvent } from './apiRequest';
