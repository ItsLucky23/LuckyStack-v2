import { defineConfig } from 'tsup';

//? @luckystack/presence ships two entries:
//?   - `./` (index.ts): server-side surface (activity broadcaster, room
//?     lifecycle, postLogout cleanup hook). Pulls socket.io.
//?   - `./client` (client/index.tsx): browser-safe React component(s) like
//?     `<SocketStatusIndicator />`. Stays out of the server barrel so the
//?     server bundle never drags React in.
export default defineConfig({
  entry: ['src/index.ts', 'src/client/index.ts', 'src/register.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  //? splitting MUST stay on for multi-entry packages: with it off, tsup inlines
  //? a private COPY of every shared module into each entry, so registry state
  //? written via one entry (e.g. ./register) is invisible through the other.
  splitting: true,
  skipNodeModulesBundle: true,
  external: [/^@luckystack\//, 'react', 'react/jsx-runtime'],
  target: 'es2022',
});
