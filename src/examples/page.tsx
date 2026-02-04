import { joinRoom } from "src/_sockets/socketInitializer";
import { useEffect, useState } from 'react';
import notify from "src/_functions/notify";
import { syncRequest, useSyncEvents } from "src/_sockets/syncRequest";
import { apiRequest } from "src/_sockets/apiRequest";
import type { ApiName } from "src/_sockets/apiTypes.generated";
import { useSession } from "src/_providers/SessionProvider";
import { data, Link } from "react-router-dom";

export const template = 'home';

export default function ExamplesPage() {
  const { session } = useSession();
  const [counter, setCounter] = useState(0);
  const [apiResults, setApiResults] = useState<any[]>([]);

  useEffect(() => {
    joinRoom('examples-room');
  }, []);

  const { upsertSyncEventCallback } = useSyncEvents();

  upsertSyncEventCallback('updateCounter', ({ serverData, clientOutput }) => {
    console.log(clientOutput)
    setCounter(prev => serverData.increase ? prev + 1 : prev - 1);
  });

  const logResult = (name: string, result: any) => {
    setApiResults(prev => [{ name, result, ts: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)]);
  };

  return (
    <div className="w-full h-full bg-background overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 flex flex-col gap-6">

        {/* TEST */}
        <div onClick={async () => {
          syncRequest({ name: "pp", receiver: "123", data: { message: "hello", targetUserId: "123" } })
        }}>

        </div>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold text-title">LuckyStack Examples</h1>
            <p className="text-muted text-sm">Interactive demo of all framework features</p>
          </div>
          <Link to="/docs" className="px-4 h-9 bg-container border border-container-border text-commen rounded-md flex items-center justify-center hover:scale-105 transition-all duration-300">
            📖 Docs
          </Link>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-auto">

          {/* User Info - Tall */}
          <div className="md:row-span-2 bg-container border border-container-border rounded-lg p-5 flex flex-col gap-4">
            <h2 className="font-semibold text-title flex items-center gap-2">
              <span className="w-6 h-6 bg-blue-500 rounded flex items-center justify-center text-white text-xs">👤</span>
              User Info
            </h2>
            {session?.id ? (
              <div className="flex flex-col gap-3 flex-1">
                <div className="w-16 h-16 bg-container2 border border-container2-border rounded-full flex items-center justify-center text-title text-2xl font-bold">
                  {session.name?.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-title font-medium">{session.name}</p>
                  <p className="text-xs text-muted">{session.email}</p>
                  <p className={`text-xs mt-2 px-2 py-1 rounded inline-block w-fit ${session.admin ? 'bg-correct text-white' : 'bg-container2 text-muted'}`}>
                    {session.admin ? '✓ Admin' : 'Not Admin'}
                  </p>
                </div>
                <button
                  onClick={() => apiRequest({ name: 'logout' })}
                  className="mt-auto px-4 h-9 bg-container2 border border-container2-border text-commen rounded-md hover:bg-container2-hover transition-colors text-sm"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 flex-1 items-center justify-center">
                <p className="text-muted text-sm">Not logged in</p>
                <Link to="/login" className="px-4 h-9 bg-blue-500 text-white rounded-md flex items-center justify-center hover:scale-105 transition-all duration-300 text-sm">
                  Go to Login
                </Link>
              </div>
            )}
          </div>

          {/* Real-time Sync - Wide */}
          <div className="md:col-span-2 lg:col-span-3 bg-container border border-container-border rounded-lg p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-title flex items-center gap-2">
                <span className="w-6 h-6 bg-orange-500 rounded flex items-center justify-center text-white text-xs">⚡</span>
                Real-time Sync
              </h2>
              <span className="text-xs text-muted">Open in 2 tabs to test</span>
            </div>
            <div className="flex items-center gap-6 justify-center py-4">
              <button
                onClick={() => syncRequest({ name: 'updateCounter', data: { increase: false }, receiver: 'examples-room' })}
                className="w-14 h-14 bg-wrong text-white rounded-full text-3xl font-bold hover:scale-110 transition-transform cursor-pointer"
              >−</button>
              <div className="w-28 h-20 bg-container2 border border-container2-border rounded-lg flex items-center justify-center">
                <span className="text-4xl font-bold text-title">{counter}</span>
              </div>
              <button
                onClick={() => syncRequest({ name: 'updateCounter', data: { increase: true }, receiver: 'examples-room' })}
                className="w-14 h-14 bg-correct text-white rounded-full text-3xl font-bold hover:scale-110 transition-transform cursor-pointer"
              >+</button>
            </div>
          </div>

          {/* Public API */}
          <div className="bg-container border border-container-border rounded-lg p-5 flex flex-col gap-3">
            <h3 className="font-semibold text-title text-sm">🌐 Public API</h3>
            <p className="text-xs text-muted">No login needed</p>
            <button
              onClick={async () => { const result = await apiRequest<"examples", "publicApi">({ name: "publicApi", data: { message: "" } }) }}
              className="mt-auto px-4 h-9 bg-correct text-white rounded-md hover:bg-correct-hover transition-colors text-sm cursor-pointer"
            >
              Call API
            </button>
          </div>

          {/* Toggle Admin */}
          <div className="bg-container border border-container-border rounded-lg p-5 flex flex-col gap-3">
            <h3 className="font-semibold text-title text-sm">🔄 Toggle Admin</h3>
            <p className="text-xs text-muted">Requires login</p>
            <button
              // onClick={async () => await apiRequest({ name: 'toggleAdmin' })}
              onClick={async () => { const result = await apiRequest({ name: "publicApi", data: { message: "" } }) }}
              className="mt-auto px-4 h-9 bg-orange-500 text-white rounded-md hover:bg-orange-600 transition-colors text-sm cursor-pointer"
            >
              Toggle
            </button>
          </div>

          {/* Admin Only */}
          <div className="bg-container border border-container-border rounded-lg p-5 flex flex-col gap-3">
            <h3 className="font-semibold text-title text-sm">🔐 Admin Only</h3>
            <p className="text-xs text-muted">admin: true required</p>
            <button
              onClick={async () => await apiRequest({ name: 'adminOnly' })}
              className="mt-auto px-4 h-9 bg-wrong text-white rounded-md hover:bg-wrong-hover transition-colors text-sm cursor-pointer"
            >
              Call API
            </button>
          </div>

          {/* Notification - Wide */}
          <div className="md:col-span-2 bg-container border border-container-border rounded-lg p-5 flex flex-col gap-3">
            <h3 className="font-semibold text-title text-sm">🔔 Notifications</h3>
            <p className="text-xs text-muted">Toast system with translation support (Sonner)</p>
            <div className="flex gap-2 mt-auto">
              <button
                onClick={() => notify.success({ key: 'test', params: [{ key: 'name', value: session?.name || 'Guest' }] })}
                className="flex-1 px-4 h-9 bg-correct text-white rounded-md hover:bg-correct-hover transition-colors text-sm cursor-pointer"
              >
                ✓ Success
              </button>
              <button
                onClick={() => notify.error({ key: 'commen/.404' })}
                className="flex-1 px-4 h-9 bg-wrong text-white rounded-md hover:bg-wrong-hover transition-colors text-sm cursor-pointer"
              >
                ✗ Error
              </button>
            </div>
          </div>

          {/* API Results - Full Width */}
          <div className="md:col-span-3 lg:col-span-4 bg-container border border-container-border rounded-lg p-5 flex flex-col gap-3">
            <h3 className="font-semibold text-title text-sm">📋 API Results</h3>
            {apiResults.length === 0 ? (
              <p className="text-xs text-muted">Click an API button to see results here</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                {apiResults.map((item, i) => (
                  <div key={i} className="flex gap-3 text-xs p-2 bg-container2 border border-container2-border rounded">
                    <span className="font-mono text-blue-500 w-32 flex-shrink-0">{item.name}</span>
                    <span className="text-muted">{item.ts}</span>
                    <pre className="text-commen flex-1 overflow-x-auto">{JSON.stringify(item.result, null, 0)}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}