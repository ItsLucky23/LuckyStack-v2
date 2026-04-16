import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SERVER_IP: z.string().min(1).default('127.0.0.1'),
  SERVER_PORT: z.string().regex(/^\d+$/).default('80'),
  SECURE: z.enum(['true', 'false']).default('false'),
  DNS: z.string().default(''),
  REDIS_HOST: z.string().min(1).default('127.0.0.1'),
  REDIS_PORT: z.string().regex(/^\d+$/).default('6379'),
  PROJECT_NAME: z.string().min(1).default('luckystack'),
}).passthrough();

export type RuntimeEnv = z.infer<typeof EnvSchema>;

let cachedEnv: RuntimeEnv | null = null;

const applyResolvedDefaultsToProcessEnv = (resolvedEnv: RuntimeEnv) => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? resolvedEnv.NODE_ENV;
  process.env.SERVER_IP = process.env.SERVER_IP ?? resolvedEnv.SERVER_IP;
  process.env.SERVER_PORT = process.env.SERVER_PORT ?? resolvedEnv.SERVER_PORT;
  process.env.SECURE = process.env.SECURE ?? resolvedEnv.SECURE;
  process.env.DNS = process.env.DNS ?? resolvedEnv.DNS;
  process.env.REDIS_HOST = process.env.REDIS_HOST ?? resolvedEnv.REDIS_HOST;
  process.env.REDIS_PORT = process.env.REDIS_PORT ?? resolvedEnv.REDIS_PORT;
  process.env.PROJECT_NAME = process.env.PROJECT_NAME ?? resolvedEnv.PROJECT_NAME;
};

export const bootstrapEnv = (): RuntimeEnv => {
  if (cachedEnv) {
    return cachedEnv;
  }

  loadDotenv({ path: '.env' });
  loadDotenv({ path: '.env.local', override: true });

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  cachedEnv = parsed.data;
  applyResolvedDefaultsToProcessEnv(cachedEnv);
  return cachedEnv;
};

export const env = bootstrapEnv();
export const isProduction = env.NODE_ENV === 'production';
