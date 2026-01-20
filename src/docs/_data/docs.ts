/**
 * Comprehensive Documentation with Real Code Examples
 */

export type Side = 'client' | 'server' | 'shared';

export interface DocItem {
  id: string;
  title: string;
  description: string;
  file?: string;
  side?: Side;
  toggleable?: string; // config key if toggleable
  examples?: { title: string; code: string; language?: string }[];
}

export interface DocCategory {
  id: string;
  title: string;
  icon: string;
  color: string;
  intro: string;
  videoPath?: string;
  items: DocItem[];
}

export const docsCategories: DocCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: '🚀',
    color: 'bg-blue-500',
    intro: 'Set up your LuckyStack project in minutes. Clone, install, configure, and start building.',
    videoPath: '/videos/getting-started.mp4',
    items: [
      {
        id: 'installation',
        title: 'Installation & Running',
        description: 'Clone the repository, install dependencies, and start both client and server. You need Redis running locally (on Windows, we recommend using WSL).',
        side: 'shared',
        examples: [
          {
            title: 'Initial Setup',
            code: `# Clone the repository
git clone https://github.com/ItsLucky23/LuckyStack-v2 <PROJECT_NAME>
cd <PROJECT_NAME>

# Install dependencies
npm install

# Copy and configure environment and config files
cp envTemplate.txt .env
cp configTemplate.txt config.ts
# Edit both .env and config.ts with your settings.

# Setup database
npx prisma generate    # Generate Prisma client types
npx prisma db push     # Push schema to database`,
            language: 'bash'
          },
          {
            title: 'Running the App (2 terminals needed)',
            code: `# Terminal 1 - Start the backend server
npm run server

# Terminal 2 - Start the frontend client  
npm run client

# Make sure Redis is running!
# On Windows: Use WSL and run 'redis-server'
# On Mac: brew services start redis
# On Linux: sudo systemctl start redis`,
            language: 'bash'
          }
        ]
      },
      {
        id: 'env-config',
        title: 'Environment Variables',
        description: 'Configure your .env file with database connection, OAuth secrets, and optional services.',
        file: '.env',
        side: 'shared',
        examples: [
          {
            title: '.env Configuration',
            code: `# Database (pick one)
DATABASE_URL="mysql://user:pass@localhost:3306/mydb"
DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"
DATABASE_URL="file:./dev.db"  # SQLite

# Session
SESSION_SECRET="your-random-secret-key-here"
VITE_SESSION_BASED_TOKEN=false  # true localStorage, false cookies

# OAuth (optional)
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GITHUB_CLIENT_ID="..."
GITHUB_CLIENT_SECRET="..."

# Error tracking (optional)
SENTRY_DSN="https://...@sentry.io/..."
VITE_SENTRY_DSN="https://...@sentry.io/..."`,
            language: 'bash'
          }
        ]
      },
      {
        id: 'folder-structure',
        title: 'Project Structure',
        description: 'Understand where to put your code. The /src folder contains both frontend React code AND backend API/sync handlers.',
        side: 'shared',
        examples: [
          {
            title: 'Folder Layout',
            code: `luckystack/
├── src/                    # Your code lives here
│   ├── page.tsx           # Homepage (/)
│   ├── login/page.tsx     # Login page (/login)
│   ├── dashboard/
│   │   ├── page.tsx       # Dashboard page (/dashboard)
│   │   ├── _api/          # APIs for this route
│   │   │   └── saveData.ts
│   │   └── _sync/         # Sync events for this route
│   │       └── updateCursor_client.ts
│   ├── _components/       # Shared React components
│   ├── _functions/        # Shared client utilities
│   ├── _providers/        # React context providers
│   └── _sockets/          # Socket utilities
├── server/                # Framework core (don't modify)
├── prisma/
│   └── schema.prisma      # Database models
└── config.ts              # Framework settings
└── .env                   # Framework settings`,
            language: 'text'
          }
        ]
      },
      {
        id: 'config-ts',
        title: 'config.ts Settings',
        description: 'The main configuration file. Toggle features, set session behavior, and define your session data structure.',
        file: 'config.ts',
        side: 'shared',
        examples: [
          {
            title: 'Configuration Options',
            code: `// config.ts
export default {
  // Kick previous sessions when user logs in again
  singleSessionPerUser: true,
  
  // How long sessions last in Redis (days)
  sessionExpiryDays: 7,
  
  // Auto-validate API requests with Zod schemas
  enableZodValidation: true,
  
  // Detect AFK users and broadcast to room
  socketActivityBroadcaster: true,
  
  // OAuth providers to enable
  providers: ['credentials', 'google', 'github'],
};

// Define what data is stored in the session
export interface SessionLayout {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  admin: boolean;
  // Add your custom fields here
  teamId?: string;
  subscription?: 'free' | 'pro';
}`,
            language: 'typescript'
          }
        ]
      }
    ]
  },
  {
    id: 'apis',
    title: 'API System',
    icon: '📡',
    color: 'bg-purple-500',
    intro: 'Create backend APIs that run over WebSocket. No REST endpoints needed - just export a function and call it from the frontend.',
    videoPath: '/videos/api-system.mp4',
    items: [
      {
        id: 'create-api',
        title: 'Creating an API',
        description: 'Create a file in any _api/ folder. Export auth requirements and a main function. The file name becomes the API name.',
        file: 'src/dashboard/_api/saveNote.ts',
        side: 'server',
        examples: [
          {
            title: 'Basic API Handler',
            code: `// src/dashboard/_api/saveNote.ts
import { AuthProps, SessionLayout } from '../../../config';
import { PrismaClient } from '@prisma/client';

// Require user to be logged in
export const auth: AuthProps = { 
  login: true 
};

// Main handler function
export const main = async ({ 
  data,      // Request data from client
  user,      // Current user's session
  functions  // Server utilities
}: {
  data: { title: string; content: string };
  user: SessionLayout;
  functions: { 
    prisma: PrismaClient;
    saveSession: (token: string, data: SessionLayout) => Promise<void>;
    tryCatch: <T>(fn: () => Promise<T>) => Promise<[Error | null, T | null]>;
  };
}) => {
  const { prisma } = functions;
  
  // Save to database
  const note = await prisma.note.create({
    data: {
      title: data.title,
      content: data.content,
      userId: user.id
    }
  });
  
  return { 
    status: 'success', 
    result: { noteId: note.id } 
  };
};`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'call-api',
        title: 'Calling APIs',
        description: 'Use apiRequest() from the frontend. It sends data over WebSocket and returns the result.',
        file: 'src/_sockets/apiRequest.ts',
        side: 'client',
        examples: [
          {
            title: 'Frontend API Call',
            code: `// In any React component
import { apiRequest } from '../_sockets/apiRequest';

async function saveNote() {
  const result = await apiRequest({
    name: 'saveNote',  // Matches file: _api/saveNote.ts
    data: {
      title: 'My Note',
      content: 'Hello world!'
    }
  });
  
  if (result.status === 'success') {
    console.log('Saved! ID:', result.result.noteId);
  } else {
    console.error('Failed:', result.message);
  }
}`,
            language: 'typescript'
          },
          {
            title: 'With Loading State',
            code: `const [loading, setLoading] = useState(false);

async function handleSubmit() {
  setLoading(true);
  
  const result = await apiRequest({
    name: 'saveNote',
    data: formData
  });
  
  setLoading(false);
  
  if (result.status === 'success') {
    notify.success({ key: 'note/saved' });
  }
  // Errors auto-show as toast notifications
}`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'auth-requirements',
        title: 'Auth Requirements',
        description: 'Control who can call your API. Require login, admin status, or custom conditions.',
        side: 'server',
        examples: [
          {
            title: 'Public API (no auth)',
            code: `export const auth: AuthProps = { 
  login: false 
};`,
            language: 'typescript'
          },
          {
            title: 'Require Login',
            code: `export const auth: AuthProps = { 
  login: true 
};`,
            language: 'typescript'
          },
          {
            title: 'Admin Only',
            code: `export const auth: AuthProps = { 
  login: true,
  additional: [
    { key: 'admin', value: true }
  ]
};`,
            language: 'typescript'
          },
          {
            title: 'Custom Conditions',
            code: `export const auth: AuthProps = { 
  login: true,
  additional: [
    // User must have a teamId
    { key: 'teamId', mustBeFalsy: false },
    // User must be on pro plan
    { key: 'subscription', value: 'pro' }
  ]
};`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'zod-validation',
        title: 'Zod Validation',
        description: 'Export a schema to auto-validate request data. Invalid requests are rejected before your code runs.',
        file: 'server/utils/zodValidation.ts',
        side: 'server',
        toggleable: 'enableZodValidation',
        examples: [
          {
            title: 'Add Schema to API',
            code: `import { z } from 'zod';
import { AuthProps } from '../../../config';

// Define validation schema
export const schema = z.object({
  title: z.string().min(1).max(100),
  content: z.string().min(1).max(10000),
  tags: z.array(z.string()).optional(),
  isPublic: z.boolean().default(false)
});

export const auth: AuthProps = { login: true };

// data is now typed and validated!
export const main = async ({ data, user, functions }) => {
  // TypeScript knows: data.title is string, data.tags is string[] | undefined
  const { prisma } = functions;
  
  const note = await prisma.note.create({
    data: {
      ...data,
      userId: user.id
    }
  });
  
  return { status: 'success', result: note };
};`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'error-handling',
        title: 'Error Handling',
        description: 'Return errors from your API. The client automatically shows error toasts.',
        side: 'server',
        examples: [
          {
            title: 'Return Errors',
            code: `export const main = async ({ data, user, functions }) => {
  const { prisma, tryCatch } = functions;
  
  // Check permissions
  const note = await prisma.note.findUnique({ 
    where: { id: data.noteId } 
  });
  
  if (!note) {
    return { 
      status: 'error', 
      message: 'Note not found' 
    };
  }
  
  if (note.userId !== user.id) {
    return { 
      status: 'error', 
      message: 'You do not own this note' 
    };
  }
  
  // Use tryCatch for database operations
  const [error, result] = await tryCatch(() => 
    prisma.note.update({
      where: { id: data.noteId },
      data: { content: data.content }
    })
  );
  
  if (error) {
    return { status: 'error', message: 'Database error' };
  }
  
  return { status: 'success', result };
};`,
            language: 'typescript'
          }
        ]
      }
    ]
  },
  {
    id: 'realtime',
    title: 'Real-time Sync',
    icon: '⚡',
    color: 'bg-orange-500',
    intro: 'Broadcast events to all users in a room. Perfect for multiplayer games, collaborative editing, live cursors, chat, and more.',
    videoPath: '/videos/realtime-sync.mp4',
    items: [
      {
        id: 'join-room',
        title: 'Joining a Room',
        description: 'Users must join a room to send/receive sync events. The room code is stored in their session.',
        file: 'src/_sockets/socketInitializer.ts',
        side: 'client',
        examples: [
          {
            title: 'Join Room on Page Load',
            code: `import { joinRoom } from '../_sockets/socketInitializer';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';

export default function GameLobby() {
  const { lobbyId } = useParams();
  
  useEffect(() => {
    // Join this lobby room
    joinRoom(lobbyId);
    
    // Cleanup: leave room handled automatically
  }, [lobbyId]);
  
  return <div>Welcome to lobby {lobbyId}</div>;
}`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'send-sync',
        title: 'Sending Sync Events',
        description: 'Broadcast data to everyone in a room. Use ignoreSelf to not receive your own event.',
        file: 'src/_sockets/syncRequest.ts',
        side: 'client',
        examples: [
          {
            title: 'Broadcast Cursor Position',
            code: `import { syncRequest } from '../_sockets/syncRequest';

function handleMouseMove(e: MouseEvent) {
  syncRequest({
    name: 'cursorMove',
    data: { 
      x: e.clientX, 
      y: e.clientY,
      color: '#ff0000'
    },
    receiver: currentRoomId,
    ignoreSelf: true  // Don't receive our own cursor
  });
}`,
            language: 'typescript'
          },
          {
            title: 'Send Chat Message',
            code: `async function sendMessage(text: string) {
  await syncRequest({
    name: 'chatMessage',
    data: { 
      text,
      timestamp: Date.now()
    },
    receiver: chatRoomId,
    ignoreSelf: false  // We want to see our own message
  });
}`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'receive-sync',
        title: 'Receiving Sync Events',
        description: 'Register callbacks to handle incoming events. The serverData contains the broadcasted data.',
        side: 'client',
        examples: [
          {
            title: 'Listen for Events',
            code: `import { useSyncEvents } from '../_sockets/syncRequest';
import { useEffect, useState } from 'react';

export default function CollaborativeCanvas() {
  const { upsertSyncEventCallback } = useSyncEvents();
  const [cursors, setCursors] = useState<Record<string, {x: number, y: number}>>({});
  
  useEffect(() => {
    // Register callback for cursor updates
    upsertSyncEventCallback('cursorMove', ({ serverData, clientData }) => {
      // serverData = data after server processing
      // clientData = original data sent
      setCursors(prev => ({
        ...prev,
        [serverData.senderId]: { 
          x: serverData.x, 
          y: serverData.y 
        }
      }));
    });
    
    // Register callback for chat messages
    upsertSyncEventCallback('chatMessage', ({ serverData }) => {
      addMessageToChat(serverData);
    });
  }, []);
  
  return (
    <div>
      {Object.entries(cursors).map(([id, pos]) => (
        <Cursor key={id} x={pos.x} y={pos.y} />
      ))}
    </div>
  );
}`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'sync-handlers',
        title: 'Server-Side Sync Handlers',
        description: 'Optionally process sync events on the server before broadcast, or filter which clients receive them.',
        file: 'src/game/_sync/',
        side: 'server',
        examples: [
          {
            title: 'Server Handler (_server.ts)',
            code: `// src/game/_sync/playerMove_server.ts
// Runs ONCE before broadcasting to all clients

export const auth = { login: true };

export const main = async ({ data, user, functions }) => {
  // Validate the move
  if (data.x < 0 || data.x > 1000 || data.y < 0 || data.y > 1000) {
    return { status: 'error', message: 'Invalid position' };
  }
  
  // Add server-side data (like who sent it)
  return { 
    status: 'success', 
    result: {
      ...data,
      playerId: user.id,
      playerName: user.name,
      timestamp: Date.now()
    }
  };
};`,
            language: 'typescript'
          },
          {
            title: 'Client Filter (_client.ts)',
            code: `// src/game/_sync/privateMessage_client.ts
// Runs for EACH client to decide if they receive the event

export const main = async ({ user, serverResult }) => {
  // Only send to the intended recipient
  if (serverResult.recipientId !== user.id) {
    return { status: 'skip' };  // Don't send to this client
  }
  
  return { status: 'success' };
};`,
            language: 'typescript'
          }
        ]
      }
    ]
  },
  {
    id: 'session',
    title: 'Session & Auth',
    icon: '🔐',
    color: 'bg-green-500',
    intro: 'Manage user authentication with credentials or OAuth. Sessions are stored in Redis and auto-sync to the client.',
    videoPath: '/videos/authentication.mp4',
    items: [
      {
        id: 'use-session',
        title: 'useSession() Hook',
        description: 'Access the current user session anywhere in your React app. Auto-updates when server saves session.',
        file: 'src/_providers/SessionProvider.tsx',
        side: 'client',
        examples: [
          {
            title: 'Get Current User',
            code: `import { useSession } from '../_providers/SessionProvider';

export default function Navbar() {
  const { session } = useSession();
  
  if (!session) {
    return <Link to="/login">Sign In</Link>;
  }
  
  return (
    <div>
      <span>Welcome, {session.name}</span>
      {session.admin && <span>⭐ Admin</span>}
      <img src={session.avatar} alt="Avatar" />
    </div>
  );
}`,
            language: 'typescript'
          },
          {
            title: 'Refresh Session',
            code: `const { session, refreshSession } = useSession();

// After an action that might update session
async function upgradeAccount() {
  await apiRequest({ name: 'upgradeToPro', data: {} });
  
  // Force refresh from server
  await refreshSession();
}`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'save-session',
        title: 'Saving Session (Server)',
        description: 'Update session data on the server. Changes automatically push to the client via WebSocket.',
        file: 'server/functions/session.ts',
        side: 'server',
        examples: [
          {
            title: 'Update Session in API',
            code: `export const main = async ({ data, user, functions }) => {
  const { prisma, saveSession, getToken } = functions;
  
  // Update user in database
  await prisma.user.update({
    where: { id: user.id },
    data: { subscription: 'pro' }
  });
  
  // Update session (auto-syncs to client!)
  await saveSession(getToken(), {
    ...user,
    subscription: 'pro'
  });
  
  return { status: 'success' };
};`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'oauth-setup',
        title: 'OAuth Configuration',
        description: 'Enable Google, GitHub, Discord, and other OAuth providers by configuring config.ts and loginConfig.ts.',
        file: 'server/auth/loginConfig.ts',
        side: 'server',
        examples: [
          {
            title: 'Enable Providers',
            code: `// config.ts
export default {
  providers: ['credentials', 'google', 'github', 'discord'],
};`,
            language: 'typescript'
          },
          {
            title: 'OAuth URLs (loginConfig.ts)',
            code: `// server/auth/loginConfig.ts
export const oauthConfigs = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: ['email', 'profile'],
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['user:email'],
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  }
};`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'login-form',
        title: 'LoginForm Component',
        description: 'Pre-built login/register form with credentials and OAuth buttons. Drop it into your login page.',
        file: 'src/_components/LoginForm.tsx',
        side: 'client',
        examples: [
          {
            title: 'Use LoginForm',
            code: `// src/login/page.tsx
import LoginForm from '../_components/LoginForm';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <LoginForm />
    </div>
  );
}`,
            language: 'typescript'
          }
        ]
      }
    ]
  },
  {
    id: 'multiplayer',
    title: 'Multiplayer',
    icon: '👥',
    color: 'bg-cyan-500',
    intro: 'Track user presence, detect AFK, and see where users are in your app. Build compelling multiplayer experiences.',
    videoPath: '/videos/multiplayer.mp4',
    items: [
      {
        id: 'location-tracking',
        title: 'Location Tracking',
        description: 'The server knows each user\'s current page. Use this to filter sync events or show who\'s where.',
        file: 'src/_components/LocationProvider.tsx',
        side: 'shared',
        examples: [
          {
            title: 'Access User Location (Server)',
            code: `// In any API or sync handler
export const main = async ({ data, user, functions }) => {
  // user.location is always available
  console.log(user.location.pathName);    // '/game/lobby'
  console.log(user.location.searchParams); // { id: '123' }
  
  // Filter by location in client handler
  if (user.location.pathName !== '/game/lobby') {
    return { status: 'skip' };
  }
  
  return { status: 'success' };
};`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'afk-detection',
        title: 'AFK Detection',
        description: 'Detect when users go idle or switch tabs. Other users in the room get notified.',
        file: 'server/sockets/utils/activityBroadcaster.ts',
        side: 'server',
        toggleable: 'socketActivityBroadcaster',
        examples: [
          {
            title: 'Listen for AFK Events',
            code: `upsertSyncEventCallback('userAfk', ({ serverData }) => {
  console.log(serverData.userId, 'went AFK');
  // Gray out their cursor, show "away" badge, etc
});

upsertSyncEventCallback('userBack', ({ serverData }) => {
  console.log(serverData.userId, 'is back');
});`,
            language: 'typescript'
          },
          {
            title: 'Enable in Config',
            code: `// config.ts
export default {
  socketActivityBroadcaster: true,
  // AFK after 2 min idle, disconnect grace period 20s
};`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'socket-status',
        title: 'Connection Status',
        description: 'Show online/offline indicators based on WebSocket connection state.',
        file: 'src/_providers/socketStatusProvider.tsx',
        side: 'client',
        examples: [
          {
            title: 'Show Connection Status',
            code: `import { useSocketStatus } from '../_providers/socketStatusProvider';

export default function ConnectionIndicator() {
  const { connected, connecting } = useSocketStatus();
  
  if (connecting) {
    return <span className="text-yellow-500">Connecting...</span>;
  }
  
  return connected 
    ? <span className="text-green-500">● Online</span>
    : <span className="text-red-500">● Offline</span>;
}`,
            language: 'typescript'
          }
        ]
      }
    ]
  },
  {
    id: 'ui-utils',
    title: 'UI Utilities',
    icon: '🎨',
    color: 'bg-pink-500',
    intro: 'Built-in components for toasts, modals, confirmations, and more. Everything you need for great UX.',
    videoPath: '/videos/ui-utils.mp4',
    items: [
      {
        id: 'notify',
        title: 'Toast Notifications',
        description: 'Show success, error, info, and warning toasts. Supports translation keys.',
        file: 'src/_functions/notify.ts',
        side: 'client',
        examples: [
          {
            title: 'Show Toasts',
            code: `import { notify } from '../_functions/notify';

// Simple string
notify.success({ key: 'Saved successfully!' });
notify.error({ key: 'Something went wrong' });
notify.info({ key: 'New message received' });
notify.warning({ key: 'Your session expires soon' });

// With translation key
notify.success({ 
  key: 'user/saved',  // Looks up in translations
  params: [
    { key: 'name', value: 'John' }
  ]
});`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'modals',
        title: 'Modal System',
        description: 'Open modals programmatically from anywhere. Supports stacking and custom sizes.',
        file: 'src/_components/MenuHandler.tsx',
        side: 'client',
        examples: [
          {
            title: 'Open Modal',
            code: `import { useMenuHandler } from '../_components/MenuHandler';

export default function MyComponent() {
  const menuRef = useMenuHandler();
  
  function openSettings() {
    menuRef.open(
      <SettingsPanel onClose={() => menuRef.close()} />,
      {
        dimBackground: true,
        size: 'lg',  // 'sm', 'md', 'lg', 'xl'
        background: 'bg-container'
      }
    );
  }
  
  return <button onClick={openSettings}>Settings</button>;
}`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'confirm',
        title: 'Confirmation Dialogs',
        description: 'Promise-based dialogs that wait for user response. Can require typed confirmation.',
        file: 'src/_components/ConfirmMenu.tsx',
        side: 'client',
        examples: [
          {
            title: 'Simple Confirm',
            code: `import { confirmDialog } from '../_components/ConfirmMenu';

async function deleteItem() {
  const confirmed = await confirmDialog({
    title: 'Delete item?',
    content: <p>This cannot be undone.</p>,
    confirmText: 'Delete',
    cancelText: 'Cancel'
  });
  
  if (confirmed) {
    await apiRequest({ name: 'deleteItem', data: { id } });
  }
}`,
            language: 'typescript'
          },
          {
            title: 'With Input Confirmation',
            code: `const result = await confirmDialog({
  title: 'Delete workspace?',
  content: <p>Type <strong>DELETE</strong> to confirm.</p>,
  input: 'DELETE',  // Must type exactly this
  confirmText: 'Delete Forever'
});

// result is the typed string or false if cancelled`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'trycatch',
        title: 'tryCatch Helper',
        description: 'Clean async error handling without try/catch blocks. Returns [error, result] tuple.',
        file: 'src/_functions/tryCatch.ts',
        side: 'client',
        examples: [
          {
            title: 'Usage',
            code: `import { tryCatch } from '../_functions/tryCatch';

async function fetchData() {
  const [error, data] = await tryCatch(() => 
    fetch('/api/data').then(r => r.json())
  );
  
  if (error) {
    console.error('Failed:', error.message);
    return null;
  }
  
  return data;
}`,
            language: 'typescript'
          }
        ]
      }
    ]
  },
  {
    id: 'routing',
    title: 'Routing & Layouts',
    icon: '🗺️',
    color: 'bg-indigo-500',
    intro: 'File-based routing with layouts, middleware protection, and templates. Just create a page.tsx file.',
    videoPath: '/videos/routing.mp4',
    items: [
      {
        id: 'file-routing',
        title: 'File-Based Routing',
        description: 'Create page.tsx files to add routes. Folder name becomes the URL path.',
        side: 'client',
        examples: [
          {
            title: 'Route Examples',
            code: `src/page.tsx              → /
src/login/page.tsx        → /login
src/dashboard/page.tsx    → /dashboard
src/settings/page.tsx     → /settings
src/game/[id]/page.tsx    → /game/:id  (dynamic)`,
            language: 'text'
          }
        ]
      },
      {
        id: 'templates',
        title: 'Page Templates',
        description: 'Export a template name to wrap your page in a layout. Define templates in TemplateProvider.',
        file: 'src/_components/TemplateProvider.tsx',
        side: 'client',
        examples: [
          {
            title: 'Use Template',
            code: `// src/dashboard/page.tsx
export const template = 'dashboard';  // Uses dashboard layout

export default function DashboardPage() {
  return <div>Dashboard content</div>;
}

// src/login/page.tsx
export const template = 'plain';  // No navbar, minimal layout

export default function LoginPage() {
  return <LoginForm />;
}`,
            language: 'typescript'
          }
        ]
      },
      {
        id: 'middleware',
        title: 'Route Protection',
        description: 'Use Middleware component to protect routes. Redirect unauthenticated users.',
        file: 'src/_components/Middleware.tsx',
        side: 'client',
        examples: [
          {
            title: 'Protect Route',
            code: `import Middleware from '../_components/Middleware';

export default function AdminPage() {
  return (
    <Middleware 
      require={{ login: true, admin: true }}
      redirectTo="/login"
    >
      <AdminDashboard />
    </Middleware>
  );
}`,
            language: 'typescript'
          }
        ]
      }
    ]
  }
];

// Search
export const searchDocs = (query: string): (DocItem & { category: string; categoryColor: string })[] => {
  if (!query.trim()) return [];
  const q = query.toLowerCase();

  const results: (DocItem & { category: string; categoryColor: string })[] = [];

  for (const cat of docsCategories) {
    for (const item of cat.items) {
      const matches =
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.file?.toLowerCase().includes(q) ||
        item.examples?.some(ex =>
          ex.title.toLowerCase().includes(q) ||
          ex.code.toLowerCase().includes(q)
        );

      if (matches) {
        results.push({ ...item, category: cat.title, categoryColor: cat.color });
      }
    }
  }

  return results;
};
