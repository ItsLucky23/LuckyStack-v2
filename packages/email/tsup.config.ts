import { defineConfig } from 'tsup';

//? @luckystack/email ships a single server-side entry. Adapters reference
//? `resend` and `nodemailer` as optional peer deps, kept external so users
//? who only install one (or neither) get a smaller bundle.
export default defineConfig({
  entry: ['src/index.ts', 'src/register.ts'],
  format: ['esm'],
  //? Declarations come from `tsc -b tsconfig.packages.json`; clean keeps them.
  dts: false,
  sourcemap: true,
  clean: ['!**/*.d.ts', '!**/*.d.ts.map'],
  //? splitting MUST stay on for multi-entry packages: with it off, tsup inlines
  //? a private COPY of every shared module into each entry, so registry state
  //? written via one entry (e.g. ./register) is invisible through the other.
  splitting: true,
  skipNodeModulesBundle: true,
  external: [/^@luckystack\//, 'resend', 'nodemailer'],
  target: 'es2022',
});
