import { defineConfig } from 'tsup';

//? @luckystack/email ships a single server-side entry. Adapters reference
//? `resend` and `nodemailer` as optional peer deps, kept external so users
//? who only install one (or neither) get a smaller bundle.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  skipNodeModulesBundle: true,
  external: [/^@luckystack\//, 'resend', 'nodemailer'],
  target: 'es2022',
});
