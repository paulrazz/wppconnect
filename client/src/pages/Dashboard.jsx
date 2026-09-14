import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { getApiKey } from '../auth';
import { Smartphone, Activity, Server, Database, LoaderCircle, CheckCircle2, XCircle, Send, PlayCircle, StopCircle, Battery, BatteryCharging, MonitorSmartphone, Wifi, Cpu, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');
const API_URL = `${SERVER_URL}/api`;

export default function Dashboard() {
  const [sessionStatus, setSessionStatus] = useState('DISCONNECTED');
  const [qrCode, setQrCode] = useState(null);
  const [metrics, setMetrics] = useState({ ready: false, battery: null, platform: null, connected: false });
  const [apiKey, setApiKey] = useState('');
  const autoStarted = useRef(false);
  
  // Sandbox State
  const [sandboxTo, setSandboxTo] = useState('');
  const [sandboxText, setSandboxText] = useState('Hello from CommNexus Command Center!');
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
        setMetrics(m => ({ ...m, ready: data.ready, ...data.info }));
        // Auto-restore: if a saved pairing exists, relaunching the browser will
        // reconnect without asking for a new QR scan.
        if (!autoStarted.current && data.status === 'DISCONNECTED') {
          autoStarted.current = true;
          setSessionStatus('STARTING');
          axios.post(`${API_URL}/start-session`, {}, { headers: { 'x-api-key': key } })
            .catch(() => setSessionStatus('DISCONNECTED'));
        }
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
        setMetrics(m => ({ ...m, ready: details.ready, ...details.info }));
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
      await axios.post(`${API_URL}/start-session`, {}, { headers: { 'x-api-key': apiKey } });
    } catch (e) {
      console.error(e);
      setSessionStatus('DISCONNECTED');
    }
  };

  const handleStopSession = async () => {
    try {
      await axios.post(`${API_URL}/stop-session`, {}, { headers: { 'x-api-key': apiKey } });
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
      case 'CONNECTED': return <div className="flex items-center text-emerald-400 bg-emerald-400/10 px-4 py-1.5 rounded-full font-bold text-sm"><CheckCircle2 className="w-4 h-4 mr-2" /> ONLINE</div>;
      case 'QR_READY': return <div className="flex items-center text-amber-400 bg-amber-400/10 px-4 py-1.5 rounded-full font-bold text-sm"><Activity className="w-4 h-4 mr-2 animate-pulse" /> WAITING FOR QR</div>;
      case 'STARTING': return <div className="flex items-center text-indigo-400 bg-indigo-400/10 px-4 py-1.5 rounded-full font-bold text-sm"><LoaderCircle className="w-4 h-4 mr-2 animate-spin" /> CONNECTING</div>;
      default: return <div className="flex items-center text-rose-400 bg-rose-400/10 px-4 py-1.5 rounded-full font-bold text-sm"><XCircle className="w-4 h-4 mr-2" /> OFFLINE</div>;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-10 bg-slate-50 dark:bg-[#0a0c10]">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white dark:bg-[#12151a] p-6 rounded-2xl border border-slate-200 dark:border-[#1e222b]">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2 flex items-center">
              <Server className="w-8 h-8 mr-3 text-indigo-500" />
              Device Manager
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Manage your WhatsApp connection and device health.</p>
          </div>
          <div className="mt-4 md:mt-0 flex flex-col items-end">
            <StatusIndicator />
            <div className="text-xs text-slate-500 mt-2 font-mono flex items-center">
              <ShieldCheck className="w-3 h-3 mr-1" /> SECURE CONNECTION
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          
          {/* Main Connection Screen */}
          <div className="xl:col-span-2 relative bg-white dark:bg-[#12151a] border border-slate-200 dark:border-[#1e222b] rounded-2xl p-8 overflow-hidden shadow-2xl">
            {/* Background ambient glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[400px] bg-indigo-500/10 blur-[100px] pointer-events-none rounded-full" />

            <div className="relative z-10 flex flex-col items-center justify-center min-h-[400px]">
              
              <AnimatePresence mode="wait">
                {sessionStatus === 'CONNECTED' ? (
                  <motion.div key="connected" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="w-full text-center">
                    <div className="relative inline-block mb-6">
                      <div className="absolute inset-0 bg-emerald-500/20 blur-2xl rounded-full" />
                      <div className={`w-32 h-32 ${metrics.profilePic ? '' : 'bg-gradient-to-br from-[#12151a] to-[#1e222b]'} border-2 border-emerald-500/50 rounded-full flex items-center justify-center relative z-10 overflow-hidden`}>
                        {metrics.profilePic ? (
                          <img src={metrics.profilePic} alt="WhatsApp profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <Smartphone className="w-14 h-14 text-emerald-400" />
                        )}
                        <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0, 0.5] }} transition={{ repeat: Infinity, duration: 2 }} className="absolute inset-0 border border-emerald-400 rounded-full" />
                      </div>
                    </div>
                    <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white mb-2">{metrics.profileName || 'Device Connected'}</h2>
                    <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-10">
                      {metrics.profileName ? `Welcome back, ${metrics.profileName}. Your WhatsApp account is linked and ready to send and receive messages.` : 'Your WhatsApp account is successfully linked and ready to send and receive messages.'}
                    </p>

                    {/* Device Metrics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto mb-10 text-left">
                      <div className="bg-slate-50 dark:bg-[#0f1115] border border-slate-200 dark:border-[#1e222b] p-4 rounded-xl">
                        <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2 flex items-center"><Battery className="w-3 h-3 mr-1.5" /> Battery</div>
                        <div className="text-xl font-medium text-slate-900 dark:text-white">{metrics.battery != null ? `${metrics.battery}%` : '—'}</div>
                      </div>
                      <div className="bg-slate-50 dark:bg-[#0f1115] border border-slate-200 dark:border-[#1e222b] p-4 rounded-xl">
                        <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2 flex items-center"><MonitorSmartphone className="w-3 h-3 mr-1.5" /> Platform</div>
                        <div className="text-xl font-medium text-slate-900 dark:text-white">{metrics.platform || '—'}</div>
                      </div>
                      <div className="bg-slate-50 dark:bg-[#0f1115] border border-slate-200 dark:border-[#1e222b] p-4 rounded-xl">
                        <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2 flex items-center"><Wifi className="w-3 h-3 mr-1.5" /> Network</div>
                        <div className={`text-xl font-medium ${metrics.network === 'Stable' ? 'text-emerald-400' : metrics.network === 'Syncing' ? 'text-amber-400' : 'text-slate-400'}`}>{metrics.network || '—'}</div>
                      </div>
                      <div className="bg-slate-50 dark:bg-[#0f1115] border border-slate-200 dark:border-[#1e222b] p-4 rounded-xl">
                        <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2 flex items-center"><Cpu className="w-3 h-3 mr-1.5" /> API Status</div>
                        <div className={`text-xl font-medium ${metrics.apiStatus === 'Active' ? 'text-indigo-400' : 'text-rose-400'}`}>{metrics.apiStatus || 'Active'}</div>
                      </div>
                    </div>

                    <button onClick={handleStopSession} className="px-8 py-3 rounded-lg font-bold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all flex items-center justify-center mx-auto">
                      <StopCircle className="w-5 h-5 mr-2" /> DISCONNECT
                    </button>
                  </motion.div>

                ) : sessionStatus === 'QR_READY' && qrCode ? (
                  <motion.div key="qr" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center">
                    <div className="bg-gradient-to-br from-indigo-500/20 to-purple-500/20 p-1 rounded-2xl mb-6 shadow-2xl shadow-indigo-500/10">
                      <div className="bg-white p-4 rounded-xl relative overflow-hidden group">
                        <img src={qrCode} alt="Pairing QR Code" className="w-64 h-64 relative z-10 mix-blend-multiply" />
                        
                        {/* Scanning Laser Animation */}
                        <motion.div 
                          animate={{ y: [0, 256, 0] }}
                          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                          className="absolute left-0 right-0 h-1 bg-indigo-500/50 z-20 shadow-[0_0_15px_rgba(99,102,241,0.8)]"
                        />
                      </div>
                    </div>
                    
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-3 flex items-center">
                      <Activity className="w-6 h-6 mr-2 text-indigo-400 animate-pulse" />
                      Link Your Device
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 text-center max-w-sm mb-6 text-sm">
                      Open WhatsApp on your phone, navigate to <strong>Linked Devices</strong>, and scan the QR code above to connect.
                    </p>
                  </motion.div>

                ) : (
                  <motion.div key="offline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
                    <div className="w-24 h-24 bg-slate-50 dark:bg-[#0f1115] border border-slate-200 dark:border-[#1e222b] text-slate-400 dark:text-slate-600 rounded-full flex items-center justify-center mx-auto mb-6">
                      <Smartphone className="w-10 h-10" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Disconnected</h2>
                    <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-8 text-sm">
                      Your WhatsApp session is currently offline. Click below to start the connection process.
                    </p>
                    <button onClick={handleStartSession} disabled={sessionStatus === 'STARTING'} className="px-8 py-4 rounded-xl font-extrabold text-white bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center mx-auto disabled:opacity-50">
                      {sessionStatus === 'STARTING' ? <LoaderCircle className="w-5 h-5 mr-3 animate-spin" /> : <PlayCircle className="w-5 h-5 mr-3" />}
                      {sessionStatus === 'STARTING' ? 'CONNECTING...' : 'CONNECT DEVICE'}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

            </div>
          </div>

          {/* Sandbox Panel */}
          <div className="xl:col-span-1 bg-white dark:bg-[#12151a] border border-slate-200 dark:border-[#1e222b] rounded-2xl p-6 shadow-xl flex flex-col">
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white mb-1 flex items-center">
              <Send className="w-5 h-5 mr-2 text-indigo-400" />
              Test Connection
            </h2>
            <p className="text-xs text-slate-500 font-medium mb-6">Send a test message to verify your connection.</p>

            <form onSubmit={handleSendTest} className="space-y-5 flex-1 flex flex-col">
              <div>
                <label className="block text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase mb-2">Destination Number</label>
                <input type="text" required value={sandboxTo} onChange={e => setSandboxTo(e.target.value)} placeholder="15551234567" className="w-full bg-slate-50 dark:bg-[#0a0c10] border border-slate-200 dark:border-[#1e222b] rounded-xl py-3 px-4 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all font-mono text-sm" />
              </div>
              
              <div className="flex-1 flex flex-col">
                <label className="block text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase mb-2">Message</label>
                <textarea required value={sandboxText} onChange={e => setSandboxText(e.target.value)} placeholder="Type a message..." className="w-full flex-1 min-h-[120px] bg-slate-50 dark:bg-[#0a0c10] border border-slate-200 dark:border-[#1e222b] rounded-xl py-3 px-4 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none transition-all text-sm" />
              </div>

              <button type="submit" disabled={isSending || sessionStatus !== 'CONNECTED'} className="w-full py-3.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-all flex items-center justify-center">
                {isSending ? <LoaderCircle className="w-5 h-5 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}
                {isSending ? 'SENDING...' : 'SEND MESSAGE'}
              </button>
            </form>

            <AnimatePresence>
              {sandboxResult && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className={`mt-6 p-4 rounded-xl border ${sandboxResult.success ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'}`}>
                  <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 ${sandboxResult.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {sandboxResult.success ? 'Success' : 'Failed'}
                  </h4>
                  <pre className={`text-[10px] font-mono overflow-x-auto ${sandboxResult.success ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>
                    {JSON.stringify(sandboxResult.data || sandboxResult.error, null, 2)}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>

          </div>

        </div>
      </div>
    </div>
  );
}
