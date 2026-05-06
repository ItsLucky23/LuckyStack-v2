//? Sample page. The framework's file-based router maps this to `/dashboard`.
//? Add APIs in `_api/` and sync events in `_sync/` next to this file.

const Dashboard = (): JSX.Element => (
  <main>
    <h2>Dashboard</h2>
    <p>This is the dashboard page. It maps to `/dashboard` via the framework's file-based router.</p>
  </main>
);

export const template = 'plain' as const;
export default Dashboard;
