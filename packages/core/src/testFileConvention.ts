//? Which files are TEST files, for every framework surface that discovers
//? files on disk and then IMPORTS them.
//?
//? Route discovery never needed this: `_api/getUser_v1.tests.ts` fails the
//? `_v<N>.ts` filename regex, so it is excluded for free. The surfaces that
//? import "every `.ts` in this folder" have no such natural filter, and there
//? are three of them — the overlay loader, the overlay bundler, and server
//? function injection. A test file sitting in one of those folders is imported
//? at boot and baked into the production bundle; if it only performs side
//? effects (registering a stub adapter, say) it silently alters production
//? behaviour rather than failing loudly.
//?
//? Deliberately broader than devkit's route-only `isRouteTestFile` (`.tests.ts`):
//? consumers write `.test.ts` and `.spec.ts` too, and the point here is to
//? exclude anything a test runner would pick up.

/** Matches `<name>.test|tests|spec.<ts|tsx|js|jsx|mts|cts|mjs|cjs>`. */
export const TEST_FILE_PATTERN = /\.(?:tests?|spec)\.(?:[cm]?[jt]sx?)$/i;

/** Directory names that conventionally hold tests and never runtime modules. */
export const TEST_DIRECTORY_NAMES = new Set(['__tests__', '__mocks__']);

/**
 * True when the given file name (or path — only the last segment is examined)
 * is a test file by the conventions above.
 */
export const isTestFile = (fileNameOrPath: string): boolean => {
  const fileName = fileNameOrPath.split(/[/\\]/).pop() ?? fileNameOrPath;
  return TEST_FILE_PATTERN.test(fileName);
};

/** True when a directory name conventionally holds tests rather than runtime modules. */
export const isTestDirectory = (directoryName: string): boolean =>
  TEST_DIRECTORY_NAMES.has(directoryName);
