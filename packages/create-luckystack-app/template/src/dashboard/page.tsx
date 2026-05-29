//? Sample page. The framework's file-based router maps this to `/dashboard`.
//? Add APIs in `_api/` and sync events in `_sync/` next to this file.

import type { PageMiddleware } from '@luckystack/core/client';
import type { SessionLayout } from '../../config';

const Dashboard = (): JSX.Element => (
  <main>
    <h2>Dashboard</h2>
    <p>This is the dashboard page. It maps to `/dashboard` via the framework's file-based router.</p>
  </main>
);

export const template = 'plain' as const;

//? Per-page route guard. Logged-out visitors bounce to `/login`. Customize
//? the function body for role-checks (e.g. `if (!session.admin) return;`
//? returns `undefined` which sends the user back in browser history).
export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  return { success: true };
};

export default Dashboard;
