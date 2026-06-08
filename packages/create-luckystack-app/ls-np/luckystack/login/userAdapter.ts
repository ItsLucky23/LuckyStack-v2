//? User adapter — how the auth flows look up / create User rows. The default
//? adapter targets the recommended Prisma User schema (see
//? `prisma/schema.prisma`). If your User model has different columns or you
//? want to back auth with a non-Prisma store, write your own UserAdapter and
//? register it here.

import { registerUserAdapter, defaultPrismaUserAdapter } from '@luckystack/login';

registerUserAdapter(defaultPrismaUserAdapter());
