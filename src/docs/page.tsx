import React, { useEffect, useState } from 'react';
import { apiRequest } from 'src/_sockets/apiRequest'; // We keep using this for the initial fetch as it's within the 'docs' page context
import { socket } from 'src/_sockets/socketInitializer';
import tryCatch from 'src/_functions/tryCatch';
import notify from 'src/_functions/notify';

// Define types for the docs structure (matching server response)
interface ApiDoc {
  page: string;
  name: string;
  method: string;
  description?: string;
  input: string;
  output: string;
  auth: any;
  rateLimit: number | false | undefined;
  path: string;
}

interface SyncDoc {
  page: string;
  name: string;
  clientInput: string;
  serverOutput: string;
  clientOutput: string;
  path: string;
}

interface DocsResult {
  apis: Record<string, ApiDoc[]>;
  syncs: Record<string, SyncDoc[]>;
}

export const template = 'dashboard'; // Use dashboard template for sidebar layout

export default function DocsPage() {
  const [docs, setDocs] = useState<DocsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedApi, setSelectedApi] = useState<ApiDoc | null>(null);
  const [selectedSync, setSelectedSync] = useState<SyncDoc | null>(null);
  const [inputData, setInputData] = useState('{}');
  const [apiResult, setApiResult] = useState<any>(null);
  const [apiStatus, setApiStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  useEffect(() => {
    const fetchDocs = async () => {
      // We can use the generic apiRequest here because we are ON the 'docs' page, 
      // so 'getDocs' resolves to 'api/docs/getDocs' which is correct.
      const [err, res] = await tryCatch(async () => 
        // @ts-ignore - Dynamic API not in generated types yet during dev
        await apiRequest({ name: 'getDocs', data: {} })
      );

      if (err) {
        notify.error({ key: 'Failed to load documentation' });
        console.error(err);
      } else if (res?.status === 'success') {
        setDocs(res.result);
      }
      setLoading(false);
    };

    fetchDocs();
  }, []);

  const handleApiRun = (api: ApiDoc) => {
    if (!socket) {
      notify.error({ key: 'Socket not connected' });
      return;
    }

    setApiStatus('loading');
    setApiResult(null);

    let parsedData = {};
    try {
      parsedData = JSON.parse(inputData);
    } catch (e) {
      notify.error({ key: 'Invalid JSON input' });
      setApiStatus('error');
      return;
    }

    const responseIndex = Date.now(); // Simple index for this manual run
    const eventName = `apiResponse-${responseIndex}`;
    
    // We use raw socket emit to bypass apiRequest's page-scoped logic
    // This allows us to call ANY api from this docs page
    socket.emit('apiRequest', {
      name: api.path, // e.g., 'api/examples/test123'
      data: parsedData,
      responseIndex
    });

    socket.once(eventName, (response: any) => {
      setApiResult(response);
      setApiStatus(response.status === 'success' ? 'success' : 'error');
    });

    // Cleanup listener after timeout
    setTimeout(() => {
      if (socket?.hasListeners(eventName)) {
        socket.off(eventName);
        if (apiStatus === 'loading') {
          setApiStatus('error');
          setApiResult({ message: 'Request timed out' });
        }
      }
    }, 5000);
  };

  if (loading) return <div className="p-8 text-common/60">Loading documentation...</div>;
  if (!docs) return <div className="p-8 text-wrong">Failed to load documentation.</div>;

  return (
    <div className="flex h-full min-h-screen bg-background text-common overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-container-border overflow-y-auto p-4 bg-container/50">
        <h2 className="text-xl font-bold mb-6 text-title">Documentation</h2>
        
        <div className="mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-common/50 mb-3">APIs</h3>
          {Object.entries(docs.apis).map(([page, apis]) => (
            <div key={page} className="mb-4">
              <div className="text-xs font-medium text-container-border mb-2 px-2 uppercase">{page}</div>
              <div className="space-y-1">
                {apis.map(api => (
                  <button
                    key={api.name}
                    onClick={() => { setSelectedApi(api); setSelectedSync(null); setInputData('{}'); setApiResult(null); setApiStatus('idle'); }}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedApi?.path === api.path 
                        ? 'bg-container3 text-title shadow-sm' 
                        : 'hover:bg-container2 text-common/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">{api.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        api.method === 'GET' ? 'bg-blue-500/10 text-blue-500' : 'bg-green-500/10 text-green-500'
                      }`}>{api.method}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-common/50 mb-3">Syncs</h3>
          {Object.entries(docs.syncs).map(([page, syncs]) => (
            <div key={page} className="mb-4">
              <div className="text-xs font-medium text-container-border mb-2 px-2 uppercase">{page}</div>
              <div className="space-y-1">
                {syncs.map(sync => (
                  <button
                    key={sync.name}
                    onClick={() => { setSelectedSync(sync); setSelectedApi(null); }}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedSync?.path === sync.path 
                        ? 'bg-container3 text-title shadow-sm' 
                        : 'hover:bg-container2 text-common/80'
                    }`}
                  >
                    <span className="truncate">{sync.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-8">
        {!selectedApi && !selectedSync && (
          <div className="flex flex-col items-center justify-center h-full text-common/40">
            <div className="text-6xl mb-4">📚</div>
            <p>Select an API or Sync event to view documentation</p>
          </div>
        )}

        {/* API Details */}
        {selectedApi && (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
            {/* Header */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className={`text-sm font-bold px-2 py-1 rounded ${
                  selectedApi.method === 'GET' ? 'bg-blue-500 text-white' : 'bg-green-600 text-white'
                }`}>
                  {selectedApi.method}
                </span>
                <h1 className="text-2xl font-bold text-title tracking-tight">{selectedApi.name}</h1>
              </div>
              <div className="font-mono text-sm text-common/60 bg-container px-3 py-1.5 rounded w-fit border border-container-border">
                {selectedApi.path}
              </div>
            </div>

            {/* Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-container p-4 rounded-xl border border-container-border">
                <h3 className="text-sm font-semibold text-common/70 mb-3 uppercase tracking-wider">Authentication</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Login Required:</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      selectedApi.auth?.login 
                        ? 'bg-wrong/10 text-wrong border border-wrong/20' 
                        : 'bg-correct/10 text-correct border border-correct/20'
                    }`}>
                      {selectedApi.auth?.login ? 'YES' : 'NO'}
                    </span>
                  </div>
                  {/* Additional auth rules could be parsed and listed here */}
                </div>
              </div>

              <div className="bg-container p-4 rounded-xl border border-container-border">
                <h3 className="text-sm font-semibold text-common/70 mb-3 uppercase tracking-wider">Rate Limit</h3>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-title">
                    {selectedApi.rateLimit === false ? 'None' : selectedApi.rateLimit ?? '60'}
                  </span>
                  <span className="text-xs text-common/50">requests / min</span>
                </div>
              </div>
            </div>

            {/* Type Defs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-semibold text-common/70 mb-2 pl-1">Input Schema</h3>
                <pre className="bg-container3 p-4 rounded-lg border border-container-border text-xs font-mono overflow-x-auto text-common/90 leading-relaxed shadow-inner">
                  {selectedApi.input}
                </pre>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-common/70 mb-2 pl-1">Output Schema</h3>
                <pre className="bg-container3 p-4 rounded-lg border border-container-border text-xs font-mono overflow-x-auto text-common/90 leading-relaxed shadow-inner">
                  {selectedApi.output}
                </pre>
              </div>
            </div>

            {/* Try It Playground */}
            <div className="bg-container p-6 rounded-xl border border-container-border shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-title">⚡ Try it out</h3>
                {apiStatus === 'success' && <span className="text-xs text-correct font-bold">Request Successful</span>}
                {apiStatus === 'error' && <span className="text-xs text-wrong font-bold">Request Failed</span>}
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-common/60 mb-1.5 uppercase">Request Body (JSON)</label>
                  <textarea
                    value={inputData}
                    onChange={(e) => setInputData(e.target.value)}
                    className="w-full h-32 bg-background border border-container-border rounded-lg p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all resize-y"
                    placeholder="{}"
                  />
                </div>

                <button
                  onClick={() => handleApiRun(selectedApi)}
                  disabled={apiStatus === 'loading'}
                  className="px-6 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-medium rounded-lg shadow-lg hover:shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {apiStatus === 'loading' ? 'Running...' : 'Run Request'}
                </button>

                {apiResult && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    <label className="block text-xs font-medium text-common/60 mb-1.5 uppercase">Response</label>
                    <pre className={`w-full bg-background border rounded-lg p-3 font-mono text-sm overflow-x-auto ${
                      apiResult.status === 'error' ? 'border-wrong/30 text-wrong' : 'border-correct/30 text-correct'
                    }`}>
                      {JSON.stringify(apiResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* Socket Usage */}
            <div>
              <h3 className="text-lg font-bold text-title mb-4">Socket Usage</h3>
              <div className="bg-[#1e1e1e] text-gray-300 p-4 rounded-xl overflow-x-auto border border-white/10 shadow-inner">
                <code className="font-mono text-xs leading-relaxed">
                  <span className="text-purple-400">socket</span>.<span className="text-blue-400">emit</span>(<span className="text-green-400">'apiRequest'</span>, {'{'}<br/>
                  &nbsp;&nbsp;<span className="text-sky-300">name</span>: <span className="text-green-400">'{selectedApi.path}'</span>,<br/>
                  &nbsp;&nbsp;<span className="text-sky-300">data</span>: {inputData !== '{}' ? inputData : '{ ... }'},<br/>
                  &nbsp;&nbsp;<span className="text-sky-300">responseIndex</span>: <span className="text-yellow-400">123</span><br/>
                  {'}'});<br/>
                  <br/>
                  <span className="text-gray-500">// Listen for response</span><br/>
                  <span className="text-purple-400">socket</span>.<span className="text-blue-400">on</span>(<span className="text-green-400">'apiResponse-123'</span>, (<span className="text-orange-300">response</span>) {'=>'} {'{'}<br/>
                  &nbsp;&nbsp;<span className="text-purple-400">console</span>.<span className="text-yellow-300">log</span>(response);<br/>
                  {'}'});
                </code>
              </div>
            </div>
          </div>
        )}

        {/* Sync Details */}
        {selectedSync && (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm font-bold px-2 py-1 rounded bg-purple-600 text-white">SYNC</span>
                <h1 className="text-2xl font-bold text-title tracking-tight">{selectedSync.name}</h1>
              </div>
              <div className="font-mono text-sm text-common/60 bg-container px-3 py-1.5 rounded w-fit border border-container-border">
                {selectedSync.path}
              </div>
            </div>

            <div className="bg-container p-6 rounded-xl border border-container-border">
               <p className="text-common/80 leading-relaxed">
                Sync events provide real-time updates to all clients in a room. 
                When a client triggers a sync request, the server validates it and broadcasts the result to everyone.
               </p>
            </div>

             <div className="grid grid-cols-1 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-common/70 mb-2 pl-1">Client Input (Trigger)</h3>
                <pre className="bg-container3 p-4 rounded-lg border border-container-border text-xs font-mono overflow-x-auto text-common/90 leading-relaxed">
                  {selectedSync.clientInput}
                </pre>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-common/70 mb-2 pl-1">Server Output (Broadcast)</h3>
                <pre className="bg-container3 p-4 rounded-lg border border-container-border text-xs font-mono overflow-x-auto text-common/90 leading-relaxed">
                  {selectedSync.serverOutput}
                </pre>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-common/70 mb-2 pl-1">Client Output (Local)</h3>
                <pre className="bg-container3 p-4 rounded-lg border border-container-border text-xs font-mono overflow-x-auto text-common/90 leading-relaxed">
                  {selectedSync.clientOutput}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
