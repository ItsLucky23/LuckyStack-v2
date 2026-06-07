import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SERVER_IP: z.string().min(1).default('127.0.0.1'),
  SERVER_PORT: z.string().regex(/^\d+$/).default('80'),
  SECURE: z.enum(['true', 'false']).default('false'),
  REDIS_HOST: z.string().min(1).default('127.0.0.1'),
  REDIS_PORT: z.string().regex(/^\d+$/).default('6379'),
  PROJECT_NAME: z.string().min(1).default('luckystack'),
}).loose();

export type RuntimeEnv = z.infer<typeof EnvSchema>;

let cachedEnv: RuntimeEnv | null = null;

//? Single source of truth for which env files the framework loads, in order
//? ("later overrides earlier"). Default `['.env', '.env.local']`. Override at
//? runtime with the AMBIENT env var `LUCKYSTACK_ENV_FILES` (comma-separated) — it
//? must be a real environment variable, not a key inside one of the .env files
//? (those are only read AFTER this list is resolved).
export const DEFAULT_ENV_FILES = ['.env', '.env.local'];

export const getEnvFiles = (): string[] => {
  const override = process.env.LUCKYSTACK_ENV_FILES;
  if (override) {
    const list = override.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (list.length > 0) return list;
  }
  return DEFAULT_ENV_FILES;
};

export const loadEnvFiles = (): void => {
  //? First file is non-override (a real ambient env var wins); each later file
  //? overrides earlier ones, matching the historical `.env` -> `.env.local` order.
  for (const [index, file] of getEnvFiles().entries()) {
    loadDotenv({ path: file, override: index > 0 });
  }
};

const applyResolvedDefaultsToProcessEnv = (resolvedEnv: RuntimeEnv) => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? resolvedEnv.NODE_ENV;
  process.env.SERVER_IP = process.env.SERVER_IP ?? resolvedEnv.SERVER_IP;
  process.env.SERVER_PORT = process.env.SERVER_PORT ?? resolvedEnv.SERVER_PORT;
  process.env.SECURE = process.env.SECURE ?? resolvedEnv.SECURE;
  process.env.REDIS_HOST = process.env.REDIS_HOST ?? resolvedEnv.REDIS_HOST;
  process.env.REDIS_PORT = process.env.REDIS_PORT ?? resolvedEnv.REDIS_PORT;
  process.env.PROJECT_NAME = process.env.PROJECT_NAME ?? resolvedEnv.PROJECT_NAME;
};

export const bootstrapEnv = (): RuntimeEnv => {
  if (cachedEnv) {
    return cachedEnv;
  }

  loadEnvFiles();

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
