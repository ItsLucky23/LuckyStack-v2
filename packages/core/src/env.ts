import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv, parse as parseDotenv } from 'dotenv';
import { z } from 'zod';

import tryCatchSync from './tryCatchSync';

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

//? Opt-in diagnostic (set `LUCKYSTACK_ENV_DEBUG=1`). The layered-env model is
//? `.env` (shared) -> `.env.local` (local overrides): a later file's value wins,
//? and a key REMOVED from the later file silently falls back to the earlier
//? file's value (it is never "unset"). That's correct dotenv precedence but a
//? common footgun — e.g. removing an OAuth key from `.env.local` while a copy
//? lingers in `.env` keeps the provider enabled. When the flag is on we parse
//? each file purely (`dotenv.parse`, no `process.env` mutation) and report every
//? key defined in more than one loaded file, naming the file whose value wins.
const reportDuplicateEnvKeys = (files: string[]): void => {
  const seenIn = new Map<string, string[]>();
  for (const file of files) {
    const filePath = path.resolve(process.cwd(), file);
    if (!existsSync(filePath)) continue;
    const parsed = parseDotenv(readFileSync(filePath, 'utf8'));
    for (const key of Object.keys(parsed)) {
      const list = seenIn.get(key) ?? [];
      list.push(file);
      seenIn.set(key, list);
    }
  }
  for (const [key, sources] of seenIn) {
    if (sources.length > 1) {
      const winner = sources.at(-1);
      // eslint-disable-next-line no-console -- runs before the logger registry is wired
      console.warn(`[env] "${key}" is defined in ${sources.join(' + ')}; "${winner}" wins. Removing it from only one file lets the other file's value resurface.`);
    }
  }
};

//? Bun auto-loads .env files BEFORE any user code runs; Node does not. That
//? silently breaks two guarantees of `loadEnvFiles` below:
//?   1. `LUCKYSTACK_ENV_FILES` is contractually an AMBIENT-only override (see
//?      `getEnvFiles`) — under Bun a key inside `.env` is already in
//?      `process.env` by the time we read it, so it hijacks the file list.
//?   2. Bun also loads `.env.<mode>` / `.env.<mode>.local`, which this framework
//?      never loads. Because the first file is `override: false`, those values
//?      silently outrank `.env`.
//? The cure is a `bunfig.toml` with `env = false` (Bun >= 1.3.3), shipped at the
//? repo root and in the scaffold template. Bun exposes NO way to read that
//? setting back at runtime (`Bun.config` / `Bun.bunfig` are undefined), so we
//? detect the SYMPTOM instead: a file we are about to load whose every key is
//? already in `process.env` with a byte-identical value can only mean the
//? runtime preloaded it.
const isBunRuntime = (): boolean => 'Bun' in globalThis;

//? Mirrors Bun's own mode selection (`BUN_ENV` -> `NODE_ENV`, exact-match
//? 'production'/'test', anything else -> development) so the warning can NAME
//? the extra files Bun loaded behind the framework's back.
const getBunModeEnvFiles = (): string[] => {
  const mode = process.env.BUN_ENV ?? process.env.NODE_ENV;
  const suffix = mode === 'production' || mode === 'test' ? mode : 'development';
  return [`.env.${suffix}`, `.env.${suffix}.local`];
};

const fileExists = (file: string): boolean => existsSync(path.resolve(process.cwd(), file));

//? True when every key the file defines is ALREADY in `process.env` with the
//? same value. Requires value equality (not mere presence) so a deployment that
//? legitimately sets a few ambient overrides is not mistaken for auto-load.
const isEnvFilePreloaded = (file: string): boolean => {
  const filePath = path.resolve(process.cwd(), file);
  if (!existsSync(filePath)) return false;
  const [error, parsed] = tryCatchSync(() => parseDotenv(readFileSync(filePath, 'utf8')));
  if (error || !parsed) return false;
  const keys = Object.keys(parsed);
  if (keys.length === 0) return false;
  return keys.every((key) => process.env[key] === parsed[key]);
};

//? Checked at most once, and only BEFORE the first load — after `loadEnvFiles`
//? has run, our own dotenv writes would make every file look "preloaded".
let hasCheckedBunEnvAutoload = false;

//? Warns rather than throws on purpose: `bun install` ignores `env = false`
//? (oven-sh/bun#31450, still open), so a postinstall boot on Bun would be
//? unfixably fatal. A wrong env value is a config bug, not a security boundary.
const warnOnBunEnvAutoload = (files: string[]): void => {
  if (hasCheckedBunEnvAutoload || !isBunRuntime()) return;
  hasCheckedBunEnvAutoload = true;

  //? Bun's mode files are the PUREST signal: the framework never loads them, so
  //? one already applied to `process.env` can only have come from Bun. They also
  //? cover the case that hides `.env` from this check — a mode file overriding a
  //? `.env` key means `.env` itself is no longer byte-identical to the env.
  const modeFiles = getBunModeEnvFiles();
  const preloaded = [...files, ...modeFiles].filter((file) => isEnvFilePreloaded(file));
  if (preloaded.length === 0) return;

  const shadowed = modeFiles.filter((file) => fileExists(file));
  const shadowNote = shadowed.length > 0
    ? ` Bun also loaded ${shadowed.join(' + ')}, which LuckyStack never loads — those values outrank ${files[0]}.`
    : '';

  // eslint-disable-next-line no-console -- runs before the logger registry is wired
  console.warn(`[env] Bun appears to have auto-loaded ${preloaded.join(' + ')} before LuckyStack did, so Bun's precedence wins over the framework's own layering.${shadowNote} LUCKYSTACK_ENV_FILES is also no longer ambient-only: a value set inside a .env file now hijacks the file list. Add \`env = false\` to bunfig.toml (Bun >= 1.3.3) to restore Node semantics.`);
};

export const loadEnvFiles = (): void => {
  const files = getEnvFiles();
  warnOnBunEnvAutoload(files);
  //? First file is non-override (a real ambient env var wins); each later file
  //? overrides earlier ones, matching the historical `.env` -> `.env.local` order.
  for (const [index, file] of files.entries()) {
    loadDotenv({ path: file, override: index > 0 });
  }
  if (process.env.LUCKYSTACK_ENV_DEBUG) {
    reportDuplicateEnvKeys(files);
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

//? DD-CORE-D2 — eager-load decision (back-compat, kept for 0.x):
//? `env` is evaluated at MODULE IMPORT time. This is intentional for the 0.x
//? public API: every file that does `import { env } from '@luckystack/core'`
//? gets the same frozen, Zod-validated snapshot, and the dotenv layering runs
//? exactly once at the package boundary regardless of import order.
//?
//? Migration path to lazy consumption (0.2+ recommendation):
//? Use `getEnv()` instead of `env` at call sites where you need to read env
//? values inside a function body rather than at module scope. `getEnv()` is
//? identical to `env` (it returns the same cached singleton after the first
//? call) but it avoids capturing a stale snapshot when `bootstrapEnv` is
//? called before dotenv files are fully loaded — a common footgun in test
//? runners that reset `process.env` between cases. New framework code and
//? consumer code should prefer `getEnv()` at call-time over the `env`
//? top-level binding.
export const env = bootstrapEnv();
export const isProduction = env.NODE_ENV === 'production';

//? Lazy accessor that returns the same cached singleton as `env` but defers
//? the bootstrap to first call. Prefer this over the top-level `env` binding
//? in functions, class constructors, and anywhere `bootstrapEnv` must not run
//? at module evaluation time (e.g. unit tests that reset `process.env`).
export const getEnv = (): RuntimeEnv => bootstrapEnv();
