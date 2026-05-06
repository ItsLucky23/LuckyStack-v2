import React from 'react';
import ReactDOM from 'react-dom/client';

const App = (): React.ReactElement => (
  <div style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
    <h1>{{PROJECT_TITLE}}</h1>
    <p>Welcome to your new LuckyStack app.</p>
    <ul>
      <li>Edit <code>src/dashboard/page.tsx</code> to add your first page.</li>
      <li>Add API routes under <code>src/&lt;page&gt;/_api/&lt;name&gt;_v1.ts</code>.</li>
      <li>Add real-time sync events under <code>src/&lt;page&gt;/_sync/</code>.</li>
      <li>Tune behavior in <code>config.ts</code> and the <code>luckystack/</code> overlay folder.</li>
    </ul>
  </div>
);

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
