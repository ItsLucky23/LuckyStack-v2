//? Framework-default shim. Re-exports the Prisma singleton from @luckystack/core
//? so it shows up as `functions.db.prisma` inside every API + sync handler.
//?
//? Edit this file to wrap or tweak Prisma client behavior (logging, soft-delete
//? extensions, multi-tenant routing). Your edits affect calls that route through
//? `functions.db.prisma` — typically your own handlers via the injected `functions`
//? parameter. Framework-internal code (`@luckystack/login`, `@luckystack/sync`, etc.)
//? imports the prisma singleton directly from `@luckystack/core` and is NOT affected.
//?
//? For framework-wide DB override: there is no native hook — Prisma's own
//? `$extends` API in `luckystack/core/clients.ts` is the canonical path.
export { prisma } from '@luckystack/core';
