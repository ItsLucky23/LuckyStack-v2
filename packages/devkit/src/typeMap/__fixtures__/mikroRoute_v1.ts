//? A fixture "route" shaped exactly like a real `_api/<name>_v1.ts`: an
//? `ApiParams` interface + a `const main = async (...) => { ... return {...} }`
//? whose object-literal return statement is what `extractors.ts` reads via
//? `findMainFunction` + `collectReturnObjectTypeDetails`.
//?
//? The return leaks a decorator-based MikroORM entity into the API payload —
//? the exact consumer mistake DEVKIT-1 is about.
import { FixtureOwner } from './mikroEntities';

export interface ApiParams {
  data: {
    ownerId: string;
  };
}

//? `async` with no `await` is deliberate: it mirrors the real `_api/*_v1.ts`
//? signature that `findMainFunction` + `collectReturnObjectTypeDetails` parse.
//? The body is a stub — the fixture exists for its TYPE, not its behaviour.
// eslint-disable-next-line @typescript-eslint/require-await -- see above
export const main = async ({ data }: ApiParams): Promise<{ status: string; result: { owner: FixtureOwner } }> => {
  const owner = new FixtureOwner();
  owner.id = data.ownerId;

  return {
    status: 'success',
    result: { owner },
  };
};
