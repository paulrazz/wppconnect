import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { getApiKey } from '../auth';
import { Smartphone, Activity, Server, Database, LoaderCircle, CheckCircle2, XCircle, Send, PlayCircle, StopCircle, RefreshCw } from 'lucide-react';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');
const API_URL = `${SERVER_URL}/api`;

export default function Dashboard() {
  const [sessionStatus, setSessionStatus] = useState('DISCONNECTED');
  const [qrCode, setQrCode] = useState(null);
  const [metrics, setMetrics] = useState({ uptime: 0, ready: false });
  const [apiKey, setApiKey] = useState('');
  
  // Sandbox State
  const [sandboxTo, setSandboxTo] = useState('');
  const [sandboxText, setSandboxText] = useState('Hello from CommNexus Dashboard!');
  const [sandboxResult, setSandboxResult] = useState(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    let socket;
    getApiKey().then(key => {
      setApiKey(key);
      if (!key) return;
      
      axios.defaults.headers.common['x-api-key'] = key;
      axios.get(`${API_URL}/status`).then(({ data }) => {
        setSessionStatus(data.status);
        setMetrics(m => ({ ...m, ready: data.ready }));
      }).catch(() => setSessionStatus('OFFLINE'));

      socket = io(SERVER_URL || window.location.origin, { 
        auth: { apiKey: key }, 
        extraHeaders: { 'x-api-key': key } 
      });

      socket.on('session_status', (status) => {
        setSessionStatus(status);
        if (status === 'CONNECTED') setQrCode(null);
      });

      socket.on('session_details', (details) => {
        setMetrics(m => ({ ...m, ready: details.ready }));
      });

      socket.on('qr_code', (qrBase64) => {
        setQrCode(qrBase64);
        setSessionStatus('QR_READY');
      });
    });

    return () => socket && socket.disconnect();
  }, []);

  const handleStartSession = async () => {
    try {
      setSessionStatus('STARTING');
      await axios.post(`${API_URL}/start-session`);
    } catch (e) { console.error(e); }
  };

  const handleStopSession = async () => {
    try {
      await axios.post(`${API_URL}/stop-session`);
      setSessionStatus('DISCONNECTED');
    } catch (e) { console.error(e); }
  };

  const handleSendTest = async (e) => {
    e.preventDefault();
    if (!sandboxTo) return;
    setIsSending(true);
    setSandboxResult(null);
    try {
      const res = await axios.post(`${API_URL}/send-message`, { to: sandboxTo, text: sandboxText });
      setSandboxResult({ success: true, data: res.data });
      setSandboxText('');
    } catch (err) {
      setSandboxResult({ success: false, error: err.response?.data?.error || err.message });
    } finally {
      setIsSending(false);
    }
  };

  const StatusIndicator = () => {
    switch(sessionStatus) {
      case 'CONNECTED': return <div className="flex items-center text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full"><CheckCircle2 className="w-4 h-4 mr-2" /> Online & Ready</div>;
      case 'QR_READY': return <div className="flex items-center text-amber-400 bg-amber-400/10 px-3 py-1 rounded-full"><Activity className="w-4 h-4 mr-2" /> Awaiting Pairing</div>;
      case 'STARTING': return <div className="flex items-center text-indigo-400 bg-indigo-400/10 px-3 py-1 rounded-full"><LoaderCircle className="w-4 h-4 mr-2 animate-spin" /> Booting Engine</div>;
      default: return <div className="flex items-center text-rose-400 bg-rose-400/10 px-3 py-1 rounded-full"><XCircle className="w-4 h-4 mr-2" /> Offline</div>;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight mb-2">Workspace Overview</h1>
            <p className="text-slate-400">Manage your communication engine and monitor connection health.</p>
          </div>
          <StatusIndicator />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Connection Manager */}
          <div className="lg:col-span-1 space-y-8">
            <div className="bg-[#16191f] border border-[#262931] rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-white mb-6 flex items-center">
                <Server className="w-5 h-5 mr-2 text-indigo-400" />
                Connection Engine
              </h2>
              
              {sessionStatus === 'CONNECTED' ? (
                <div className="text-center py-6">
                  <div className="w-20 h-20 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Smartphone className="w-10 h-10" />
                  </div>
                  <h3 className="text-xl font-medium text-white mb-1">Engine Active</h3>
                  <p className="text-slate-400 text-sm mb-6">Your device is securely linked and routing messages.</p>
                  <button onClick={handleStopSession} className="w-full flex justify-center py-3 px-4 rounded-lg font-medium text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 transition-all">
                    <StopCircle className="w-5 h-5 mr-2" /> Suspend Engine
                  </button>
                </div>
              ) : sessionStatus === 'QR_READY' && qrCode ? (
                <div className="text-center">
                  <div className="bg-white p-4 rounded-xl inline-block mb-6 shadow-lg shadow-white/5">
                    <img src={qrCode} alt="Pairing QR Code" className="w-48 h-48" />
                  </div>
                  <h3 className="text-lg font-medium text-white mb-2">Link your device</h3>
                  <p className="text-slate-400 text-sm mb-6 px-4">Open WhatsApp on your phone &gt; Linked Devices &gt; Link a Device.</p>
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="w-20 h-20 bg-slate-800 text-slate-500 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Smartphone className="w-10 h-10" />
                  </div>
                  <h3 className="text-xl font-medium text-white mb-1">Engine Suspended</h3>
                  <p className="text-slate-400 text-sm mb-6">Start the engine to link your device or resume routing.</p>
                  <button onClick={handleStartSession} disabled={sessionStatus === 'STARTING'} className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-all disabled:opacity-50">
                    {sessionStatus === 'STARTING' ? <LoaderCircle className="w-5 h-5 mr-2 animate-spin" /> : <PlayCircle className="w-5 h-5 mr-2" />}
                    {sessionStatus === 'STARTING' ? 'Booting...' : 'Boot Engine'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Sandbox & Analytics */}
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-[#16191f] border border-[#262931] rounded-2xl p-6 shadow-sm min-h-[400px]">
              <h2 className="text-lg font-semibold text-white mb-6 flex items-center">
                <Send className="w-5 h-5 mr-2 text-indigo-400" />
                API Sandbox
              </h2>
              <p className="text-sm text-slate-400 mb-6">
                Test your connection instantly. Messages will be routed through your isolated WhatsApp engine.
              </p>

              <form onSubmit={handleSendTest} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Destination Number</label>
                    <input type="text" required value={sandboxTo} onChange={e => setSandboxTo(e.target.value)} placeholder="e.g. 15551234567" className="w-full bg-[#0f1115] border border-[#262931] rounded-lg py-2.5 px-3 text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Message Type</label>
                    <select disabled className="w-full bg-[#0f1115] border border-[#262931] rounded-lg py-2.5 px-3 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none appearance-none">
                      <option>Text Message</option>
                    </select>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Payload Content</label>
                  <textarea required value={sandboxText} onChange={e => setSandboxText(e.target.value)} rows="3" className="w-full bg-[#0f1115] border border-[#262931] rounded-lg py-2.5 px-3 text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none" />
                </div>

                <div className="flex justify-end pt-2">
                  <button type="submit" disabled={isSending || sessionStatus !== 'CONNECTED'} className="flex items-center py-2.5 px-6 rounded-lg font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-all">
                    {isSending ? <LoaderCircle className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                    {isSending ? 'Routing...' : 'Dispatch Payload'}
                  </button>
                </div>
              </form>

              {sandboxResult && (
                <div className={`mt-6 p-4 rounded-xl border ${sandboxResult.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                  <h4 className="text-sm font-semibold mb-2">{sandboxResult.success ? 'Dispatch Successful' : 'Dispatch Failed'}</h4>
                  <pre className="text-xs font-mono overflow-x-auto">
                    {JSON.stringify(sandboxResult.data || sandboxResult.error, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
