/**
 * Framework Files Documentation
 * 
 * Comprehensive list of all server files and src/_* files
 * with descriptions and server/client indicators.
 */

export type FileSide = 'client' | 'server';

export interface FrameworkFile {
  name: string;
  path: string;
  description: string;
  side: FileSide;
  category: string;
  details?: string;
}

export const frameworkFiles: FrameworkFile[] = [
  // ============================================
  // SERVER - Core
  // ============================================
  {
    name: 'server.ts',
    path: 'server/server.ts',
    description: 'Main entry point. HTTP server, CORS, static file serving, Socket.io initialization.',
    side: 'server',
    category: 'Server Core'
  },

  // ============================================
  // SERVER - Auth
  // ============================================
  {
    name: 'login.ts',
    path: 'server/auth/login.ts',
    description: 'Handles login/register with credentials and OAuth callback processing.',
    side: 'server',
    category: 'Server Auth'
  },
  {
    name: 'loginConfig.ts',
    path: 'server/auth/loginConfig.ts',
    description: 'OAuth provider configuration (URLs, scopes, client IDs).',
    side: 'server',
    category: 'Server Auth'
  },
  {
    name: 'checkOrigin.ts',
    path: 'server/auth/checkOrigin.ts',
    description: 'CORS origin validation for security.',
    side: 'server',
    category: 'Server Auth'
  },

  // ============================================
  // SERVER - Functions
  // ============================================
  {
    name: 'session.ts',
    path: 'server/functions/session.ts',
    description: 'Redis session management: saveSession, getSession, deleteSession.',
    side: 'server',
    category: 'Server Functions'
  },
  {
    name: 'redis.ts',
    path: 'server/functions/redis.ts',
    description: 'Redis client initialization and connection.',
    side: 'server',
    category: 'Server Functions'
  },
  {
    name: 'db.ts',
    path: 'server/functions/db.ts',
    description: 'Prisma client initialization.',
    side: 'server',
    category: 'Server Functions'
  },
  {
    name: 'tryCatch.ts',
    path: 'server/functions/tryCatch.ts',
    description: 'Async error wrapper with optional Sentry capture.',
    side: 'server',
    category: 'Server Functions'
  },
  {
    name: 'sleep.ts',
    path: 'server/functions/sleep.ts',
    description: 'Promise-based delay utility.',
    side: 'server',
    category: 'Server Functions'
  },
  {
    name: 'broadcaster.ts',
    path: 'server/functions/boardcaster.ts',
    description: 'Utility for broadcasting messages to socket rooms.',
    side: 'server',
    category: 'Server Functions'
  },
  {
    name: 'game.ts',
    path: 'server/functions/game.ts',
    description: 'Game-related server utilities.',
    side: 'server',
    category: 'Server Functions'
  },

  // ============================================
  // SERVER - Sockets
  // ============================================
  {
    name: 'socket.ts',
    path: 'server/sockets/socket.ts',
    description: 'Socket.io server setup, connection handlers, room management.',
    side: 'server',
    category: 'Server Sockets'
  },
  {
    name: 'handleApiRequest.ts',
    path: 'server/sockets/handleApiRequest.ts',
    description: 'Processes apiRequest calls from client. Loads handlers, validates auth, runs main().',
    side: 'server',
    category: 'Server Sockets'
  },
  {
    name: 'handleSyncRequest.ts',
    path: 'server/sockets/handleSyncRequest.ts',
    description: 'Processes syncRequest calls. Runs server/client handlers, broadcasts to room.',
    side: 'server',
    category: 'Server Sockets'
  },
  {
    name: 'activityBroadcaster.ts',
    path: 'server/sockets/utils/activityBroadcaster.ts',
    description: 'AFK detection and presence broadcasting. Tracks idle, tab switches, disconnects.',
    side: 'server',
    category: 'Server Sockets'
  },
  {
    name: 'logout.ts',
    path: 'server/sockets/utils/logout.ts',
    description: 'Handles user logout, session cleanup.',
    side: 'server',
    category: 'Server Sockets'
  },
  {
    name: 'onLocationChange.ts',
    path: 'server/sockets/utils/onLocationChange.ts',
    description: 'Handles location updates from LocationProvider.',
    side: 'server',
    category: 'Server Sockets'
  },

  // ============================================
  // SERVER - Utils
  // ============================================
  {
    name: 'validateRequest.ts',
    path: 'server/utils/validateRequest.ts',
    description: 'Validates auth.additional requirements against user session.',
    side: 'server',
    category: 'Server Utils'
  },
  {
    name: 'zodValidation.ts',
    path: 'server/utils/zodValidation.ts',
    description: 'Zod schema validation for API requests.',
    side: 'server',
    category: 'Server Utils'
  },
  {
    name: 'extractToken.ts',
    path: 'server/utils/extractToken.ts',
    description: 'Extracts session token from socket handshake (cookie or header).',
    side: 'server',
    category: 'Server Utils'
  },
  {
    name: 'sentry.ts',
    path: 'server/utils/sentry.ts',
    description: 'Sentry error tracking initialization and capture.',
    side: 'server',
    category: 'Server Utils'
  },
  {
    name: 'getParams.ts',
    path: 'server/utils/getParams.ts',
    description: 'URL parameter parsing utility.',
    side: 'server',
    category: 'Server Utils'
  },
  {
    name: 'serveAvatars.ts',
    path: 'server/utils/serveAvatars.ts',
    description: 'Serves user avatar images.',
    side: 'server',
    category: 'Server Utils'
  },
  {
    name: 'console.log.ts',
    path: 'server/utils/console.log.ts',
    description: 'Custom console logging with colors/formatting.',
    side: 'server',
    category: 'Server Utils'
  },
  {
    name: 'repl.ts',
    path: 'server/utils/repl.ts',
    description: 'REPL interface for debugging.',
    side: 'server',
    category: 'Server Utils'
  },

  // ============================================
  // SERVER - Dev
  // ============================================
  {
    name: 'hotReload.ts',
    path: 'server/dev/hotReload.ts',
    description: 'Hot module reloading for development.',
    side: 'server',
    category: 'Server Dev'
  },
  {
    name: 'loader.ts',
    path: 'server/dev/loader.ts',
    description: 'Dynamic file loading for APIs and sync handlers.',
    side: 'server',
    category: 'Server Dev'
  },

  // ============================================
  // SERVER - Prod
  // ============================================
  {
    name: 'generatedApis.ts',
    path: 'server/prod/generatedApis.ts',
    description: 'Pre-bundled API handlers for production.',
    side: 'server',
    category: 'Server Prod'
  },
  {
    name: 'serveFile.ts',
    path: 'server/prod/serveFile.ts',
    description: 'Static file serving for production build.',
    side: 'server',
    category: 'Server Prod'
  },

  // ============================================
  // CLIENT - _components
  // ============================================
  {
    name: 'Avatar.tsx',
    path: 'src/_components/Avatar.tsx',
    description: 'User avatar display component.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'AvatarProvider.tsx',
    path: 'src/_components/AvatarProvider.tsx',
    description: 'Context provider for avatar state.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'ConfirmMenu.tsx',
    path: 'src/_components/ConfirmMenu.tsx',
    description: 'Promise-based confirmation dialogs with optional input.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'ErrorPage.tsx',
    path: 'src/_components/ErrorPage.tsx',
    description: 'React Router error boundary fallback page.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'Icon.tsx',
    path: 'src/_components/Icon.tsx',
    description: 'Lucide icon wrapper component.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'LocationProvider.tsx',
    path: 'src/_components/LocationProvider.tsx',
    description: 'Tracks user navigation and syncs location to server.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'LoginForm.tsx',
    path: 'src/_components/LoginForm.tsx',
    description: 'Complete login/register form with credentials and OAuth.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'MenuHandler.tsx',
    path: 'src/_components/MenuHandler.tsx',
    description: 'Global modal/overlay system. Supports stacking and sizes.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'Middleware.tsx',
    path: 'src/_components/Middleware.tsx',
    description: 'Route protection component. Redirects unauthenticated users.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'Navbar.tsx',
    path: 'src/_components/Navbar.tsx',
    description: 'Navigation bar component.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'Router.tsx',
    path: 'src/_components/Router.tsx',
    description: 'React Router configuration and route definitions.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'TemplateProvider.tsx',
    path: 'src/_components/TemplateProvider.tsx',
    description: 'Layout wrapper system. Pages export template name.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'ThemeToggler.tsx',
    path: 'src/_components/ThemeToggler.tsx',
    description: 'Dark/light mode toggle with localStorage persistence.',
    side: 'client',
    category: 'Client Components'
  },
  {
    name: 'TranslationProvider.tsx',
    path: 'src/_components/TranslationProvider.tsx',
    description: 'i18n context provider for translations.',
    side: 'client',
    category: 'Client Components'
  },

  // ============================================
  // CLIENT - _functions
  // ============================================
  {
    name: 'notify.ts',
    path: 'src/_functions/notify.ts',
    description: 'Toast notifications with translation support (Sonner).',
    side: 'client',
    category: 'Client Functions'
  },
  {
    name: 'tryCatch.ts',
    path: 'src/_functions/tryCatch.ts',
    description: 'Async error wrapper returning [error, result] tuple.',
    side: 'client',
    category: 'Client Functions'
  },
  {
    name: 'menuHandler.ts',
    path: 'src/_functions/menuHandler.ts',
    description: 'Programmatic modal control from non-React code.',
    side: 'client',
    category: 'Client Functions'
  },
  {
    name: 'middlewareHandler.ts',
    path: 'src/_functions/middlewareHandler.ts',
    description: 'Route protection utility functions.',
    side: 'client',
    category: 'Client Functions'
  },
  {
    name: 'translator.ts',
    path: 'src/_functions/translator.ts',
    description: 'Translation function for i18n.',
    side: 'client',
    category: 'Client Functions'
  },
  {
    name: 'confetti.ts',
    path: 'src/_functions/confetti.ts',
    description: 'Celebration animations using canvas-confetti.',
    side: 'client',
    category: 'Client Functions'
  },
  {
    name: 'icon.ts',
    path: 'src/_functions/icon.ts',
    description: 'Icon helper utilities.',
    side: 'client',
    category: 'Client Functions'
  },
  {
    name: 'sleep.ts',
    path: 'src/_functions/sleep.ts',
    description: 'Promise-based delay: await sleep(1000).',
    side: 'client',
    category: 'Client Functions'
  },
  {
    name: 'sentry.ts',
    path: 'src/_functions/sentry.ts',
    description: 'Client-side Sentry error tracking initialization.',
    side: 'client',
    category: 'Client Functions'
  },

  // ============================================
  // CLIENT - _providers
  // ============================================
  {
    name: 'SessionProvider.tsx',
    path: 'src/_providers/SessionProvider.tsx',
    description: 'User session context. useSession() hook. Auto-updates via WebSocket.',
    side: 'client',
    category: 'Client Providers'
  },
  {
    name: 'socketStatusProvider.tsx',
    path: 'src/_providers/socketStatusProvider.tsx',
    description: 'WebSocket connection status. useSocketStatus() for online/offline.',
    side: 'client',
    category: 'Client Providers'
  },

  // ============================================
  // CLIENT - _sockets
  // ============================================
  {
    name: 'apiRequest.ts',
    path: 'src/_sockets/apiRequest.ts',
    description: 'Call backend APIs over WebSocket. Returns typed responses.',
    side: 'client',
    category: 'Client Sockets'
  },
  {
    name: 'syncRequest.ts',
    path: 'src/_sockets/syncRequest.ts',
    description: 'Broadcast sync events to room. useSyncEvents() for receiving.',
    side: 'client',
    category: 'Client Sockets'
  },
  {
    name: 'socketInitializer.ts',
    path: 'src/_sockets/socketInitializer.ts',
    description: 'Socket.io client setup, joinRoom(), connection management.',
    side: 'client',
    category: 'Client Sockets'
  }
];

// Group files by category
export const getFilesByCategory = (): Record<string, FrameworkFile[]> => {
  const grouped: Record<string, FrameworkFile[]> = {};

  for (const file of frameworkFiles) {
    if (!grouped[file.category]) {
      grouped[file.category] = [];
    }
    grouped[file.category].push(file);
  }

  return grouped;
};

// Search files
export const searchFiles = (query: string): FrameworkFile[] => {
  if (!query.trim()) return [];
  const q = query.toLowerCase();

  return frameworkFiles.filter(file =>
    file.name.toLowerCase().includes(q) ||
    file.description.toLowerCase().includes(q) ||
    file.path.toLowerCase().includes(q)
  );
};
