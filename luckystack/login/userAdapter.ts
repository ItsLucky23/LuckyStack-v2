//? User adapter — implements the auth flows' data layer. The default adapter
//? targets the framework's recommended Prisma User schema. If your project's
//? User model has different columns, replace `defaultPrismaUserAdapter()`
//? with your own implementation of `UserAdapter`.

import { registerUserAdapter, defaultPrismaUserAdapter } from '@luckystack/login';

registerUserAdapter(defaultPrismaUserAdapter());
