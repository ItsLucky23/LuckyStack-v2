//? Project-level config. Registered into `@luckystack/core` at module load
//? (side-effect import) so framework packages read your overrides via
//? `getProjectConfig()`. Edit values here to tune the framework's behavior.

import { registerProjectConfig } from '@luckystack/core';

const dev = process.env.NODE_ENV !== 'production';
const backendUrl = process.env.DNS || `http://${process.env.SERVER_IP ?? '127.0.0.1'}:${process.env.SERVER_PORT ?? '80'}`;

const config = {
  pageTitle: '{{PROJECT_TITLE}}',
  loginPageUrl: '/login',
  loginRedirectUrl: '/dashboard',
  defaultLanguage: 'en' as const,
  defaultTheme: 'light' as const,
  /** false = HttpOnly cookie, true = sessionStorage. */
  sessionBasedToken: false,
  sessionExpiryDays: 7,
  allowMultipleSessions: false,
};

registerProjectConfig({
  logging: {
    devLogs: dev,
    devNotifications: dev,
    socketStatus: dev,
    socketStartup: true,
    stream: dev,
  },
  session: {
    basedToken: config.sessionBasedToken,
    expiryDays: config.sessionExpiryDays,
    allowMultiple: config.allowMultipleSessions,
  },
  http: {
    cors: {
      allowedOrigins: [backendUrl, ...(process.env.EXTERNAL_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)],
    },
  },
  defaultLanguage: config.defaultLanguage,
  loginRedirectUrl: config.loginRedirectUrl,
});

export default config;
export const { pageTitle, loginPageUrl, loginRedirectUrl, defaultLanguage, defaultTheme } = config;

// Project-specific session shape. Extend the framework's BaseSessionLayout
// with whatever extra fields your User model has. Keep it structurally
// compatible with BaseSessionLayout (the type-check below enforces it).
import type { BaseSessionLayout } from '@luckystack/login';
import type { User } from '@prisma/client';

export interface SessionLayout extends Omit<User, 'password'> {
  avatarFallback: string;
  token: string;
  roomCodes?: string[];
}

export type _SessionLayoutCheck = SessionLayout extends BaseSessionLayout ? true : never;
