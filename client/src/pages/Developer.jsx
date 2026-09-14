import { useState, useEffect, memo } from 'react';
import { useTheme } from '../ThemeContext';
import axios from 'axios';
import { getApiKey } from '../auth';
import { useNavigate } from 'react-router-dom';
import { Code2, Copy, Lock, Check, Terminal, PlayCircle, LoaderCircle, Webhook, Activity, FileText, MessageSquare, Server, Image as ImageIcon, Users, Plus, Trash2, Globe } from 'lucide-react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { motion, AnimatePresence } from 'framer-motion';

SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('php', php);
SyntaxHighlighter.registerLanguage('json', json);

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');

const WEBHOOK_EVENTS = [
  { id: '*', label: 'All events' },
  { id: 'message.received', label: 'Incoming message' },
  { id: 'message.sent', label: 'Outgoing message' },
  { id: 'message.ack', label: 'Read / delivered (ack)' },
  { id: 'message.deleted', label: 'Message deleted' },
  { id: 'message.edited', label: 'Message edited' },
  { id: 'message.reaction', label: 'Reaction' },
  { id: 'call.received', label: 'Incoming call' },
  { id: 'session.status', label: 'Session status' },
  { id: 'whatsapp.state', label: 'WhatsApp state' },
  { id: 'status.received', label: 'Status (story) received' },
  { id: 'status.deleted', label: 'Status deleted' },
];

// Memoized Code Block for heavy optimization
const CodeBlock = memo(({ language, code, theme }) => (
  <SyntaxHighlighter
    language={language}
    style={theme === 'dark' ? vscDarkPlus : vs}
    customStyle={{ margin: 0, padding: '1.25rem', background: 'transparent', fontSize: '0.875rem' }}
  >
    {code}
  </SyntaxHighlighter>
));

export default function Developer() {
  const [apiKey, setApiKey] = useState('');
  const [sessionStatus, setSessionStatus] = useState('LOADING');
  const [copied, setCopied] = useState('');
  const [activeLang, setActiveLang] = useState('curl');
  const { theme } = useTheme();
  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  const [activeSection, setActiveSection] = useState('auth');
  const [playgroundModal, setPlaygroundModal] = useState({ isOpen: false, endpoint: null });
  const [webhooks, setWebhooks] = useState([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [webhookEvents, setWebhookEvents] = useState(['*']);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookMsg, setWebhookMsg] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (activeSection !== 'webhooks' || !apiKey) return;
    axios.get(`${SERVER_URL}/api/v1/webhooks`, { headers: { 'x-api-key': apiKey } })
      .then(res => setWebhooks(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setWebhooks([]));
  }, [activeSection, apiKey]);

  const toggleWebhookEvent = (eventId) => {
    setWebhookEvents(prev => {
      if (eventId === '*') return ['*'];
      const rest = prev.filter(e => e !== '*');
      if (rest.includes(eventId)) return rest.length === 1 ? ['*'] : rest.filter(e => e !== eventId);
      return [...rest, eventId];
    });
  };

  const createWebhook = async (e) => {
    e.preventDefault();
    if (!webhookUrl.trim()) return;
    setWebhookBusy(true);
    setWebhookMsg(null);
    try {
      const res = await axios.post(`${SERVER_URL}/api/v1/webhooks`,
        { url: webhookUrl.trim(), events: webhookEvents.length ? webhookEvents : ['*'], secret: webhookSecret.trim() || undefined },
        { headers: { 'x-api-key': apiKey } });
      setWebhooks(prev => [...prev, res.data?.data]);
      setWebhookUrl('');
      setWebhookSecret('');
      setWebhookEvents(['*']);
      setWebhookMsg({ ok: true, text: 'Webhook created. It will receive POST requests on the selected events.' });
    } catch (err) {
      setWebhookMsg({ ok: false, text: err.response?.data?.error || err.message });
    } finally {
      setWebhookBusy(false);
    }
  };

  const deleteWebhook = async (id) => {
    if (!window.confirm('Remove this webhook endpoint?')) return;
    setWebhookMsg(null);
    try {
      await axios.delete(`${SERVER_URL}/api/v1/webhooks/${id}`, { headers: { 'x-api-key': apiKey } });
      setWebhooks(prev => prev.filter(w => w.id !== id));
    } catch (err) {
      setWebhookMsg({ ok: false, text: err.response?.data?.error || err.message });
    }
  };

  useEffect(() => {
    getApiKey().then(key => {
      setApiKey(key);
      axios.get(`${import.meta.env.VITE_WPPCONNECT_URL || ''}/api/status`, { headers: { 'x-api-key': key } })
        .then(res => setSessionStatus(res.data.status))
        .catch(() => setSessionStatus('DISCONNECTED'));
    });
  }, []);

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  const openPlayground = (ep) => {
    if (ep.method === 'GET') {
      handleTestAPI(ep.path, ep.method); // GET requests don't need a modal payload
    } else {
      setPlaygroundModal({ isOpen: true, endpoint: ep });
    }
  };

  const handleTestAPI = async (endpoint, method, payload = null) => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await axios({
        method,
        url: `${SERVER_URL}/api${endpoint}`,
        data: payload,
        headers: { 'x-api-key': apiKey }
      });
      setTestResult({ success: true, data: res.data });
    } catch (err) {
      let errorMsg = err.response?.data?.error || err.message;
      // Sanitize internal server paths or node stack traces
      if (typeof errorMsg === 'string' && (errorMsg.includes('/app/') || errorMsg.includes('node_modules') || errorMsg.includes('node:'))) {
        errorMsg = 'An internal server error occurred while processing the request.';
      }
      setTestResult({ 
        success: false, 
        data: { 
          error: errorMsg,
          code: err.response?.status || 500
        } 
      });
    } finally {
      setIsTesting(false);
    }
  };

  const getSnippets = (endpoint, method, payloadStr) => {
    const fullUrl = `${SERVER_URL}/api${endpoint}`;
    return {
      curl: `curl -X ${method} ${fullUrl} \\\n  -H "x-api-key: ${apiKey}"${payloadStr ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${payloadStr}'` : ''}`,
      javascript: `const axios = require('axios');\n\naxios({\n  method: '${method}',\n  url: '${fullUrl}',\n  headers: { 'x-api-key': '${apiKey}' }${payloadStr ? `,\n  data: ${payloadStr}` : ''}\n})\n.then(res => console.log(res.data))\n.catch(console.error);`,
      python: `import requests\n\nurl = "${fullUrl}"\nheaders = { "x-api-key": "${apiKey}" }\n${payloadStr ? `payload = ${payloadStr}\n` : ''}\nresponse = requests.request("${method}", url, headers=headers${payloadStr ? ', json=payload' : ''})\nprint(response.json())`,
      php: `<?php\n$ch = curl_init("${fullUrl}");\ncurl_setopt($ch, CURLOPT_CUSTOMREQUEST, "${method}");\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n${payloadStr ? `curl_setopt($ch, CURLOPT_POSTFIELDS, '${payloadStr}');\n` : ''}curl_setopt($ch, CURLOPT_HTTPHEADER, [\n  "x-api-key: ${apiKey}"${payloadStr ? ',\n  "Content-Type: application/json"' : ''}\n]);\n\n$result = curl_exec($ch);\ncurl_close($ch);\necho $result;\n?>`
    };
  };

  const endpoints = [
    {
      id: 'status',
      icon: <Activity className="w-5 h-5 text-emerald-400" />,
      title: 'Check Status',
      method: 'GET',
      path: '/status',
      desc: 'Retrieves the current connection status of your WhatsApp engine (e.g. CONNECTED, QR_READY).',
      payload: null
    },
    {
      id: 'send-message',
      icon: <MessageSquare className="w-5 h-5 text-indigo-400" />,
      title: 'Send Text Message',
      method: 'POST',
      path: '/send-message',
      desc: 'Dispatch a standard text message to any valid WhatsApp number or Group ID.',
      payload: { to: "1234567890@c.us", text: "Hello from CommNexus!" }
    },
    {
      id: 'send-file',
      icon: <ImageIcon className="w-5 h-5 text-sky-400" />,
      title: 'Send Media File',
      method: 'POST',
      path: '/send-file',
      desc: 'Send an image, document, or video using a base64 Data URL or public web URL.',
      payload: { to: "1234567890@c.us", dataUrl: "data:image/png;base64,iVBORw0K...", filename: "receipt.png", caption: "Your receipt" }
    },
    {
      id: 'create-group',
      icon: <Users className="w-5 h-5 text-purple-400" />,
      title: 'Create Group',
      method: 'POST',
      path: '/create-group',
      desc: 'Create a new WhatsApp group programmatically and add participants instantly.',
      payload: { groupName: "VIP Customers", participants: ["1234567890@c.us", "0987654321@c.us"] }
    }
  ];

  if (sessionStatus === 'LOADING') {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center ${theme === 'dark' ? 'bg-[#0a0c10] text-indigo-400' : 'bg-slate-50 text-indigo-600'}`}>
        <LoaderCircle className="w-10 h-10 animate-spin mb-4" />
        <span className="font-bold tracking-widest uppercase text-sm">Verifying Session...</span>
      </div>
    );
  }

  if (sessionStatus !== 'CONNECTED') {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center p-6 text-center ${theme === 'dark' ? 'bg-[#0a0c10]' : 'bg-slate-50'}`}>
        <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 shadow-2xl ${theme === 'dark' ? 'bg-white dark:bg-[#12151a] border-slate-200 dark:border-[#1e222b] text-slate-500' : 'bg-white border border-slate-200 text-slate-400'}`}>
          <Lock className="w-10 h-10" />
        </div>
        <h1 className={`text-3xl font-extrabold tracking-tight mb-4 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
          API Keys Locked
        </h1>
        <p className={`max-w-md mb-8 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
          Your API Keys are securely locked. Please connect your WhatsApp device to generate and view your active API credentials.
        </p>
        <button 
          onClick={() => navigate('/')} 
          className="px-8 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 transition-all"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col lg:flex-row overflow-hidden transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0a0c10] text-slate-300' : 'bg-slate-50 text-slate-700'}`}>
      
      {/* Sidebar Navigation (Horizontal on Mobile, Vertical on PC) */}
      <div className={`lg:w-64 border-b lg:border-b-0 lg:border-r overflow-x-auto lg:overflow-y-auto shrink-0 ${theme === 'dark' ? 'border-[#1e222b] bg-[#0f1115]' : 'border-slate-200 bg-white'}`}>
        <div className="p-4 lg:p-6 flex lg:flex-col items-center lg:items-stretch gap-2 lg:gap-0">
          <h2 className={`hidden lg:block text-xs font-bold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>API Reference</h2>
          
          <div className="flex lg:flex-col gap-2 lg:gap-1 min-w-max lg:min-w-0">
            <button onClick={() => setActiveSection('auth')} className={`flex items-center px-4 lg:px-3 py-2 lg:py-2.5 text-sm rounded-lg transition-colors ${activeSection === 'auth' ? (theme === 'dark' ? 'bg-indigo-500/10 text-indigo-400 font-medium' : 'bg-indigo-50 text-indigo-600 font-medium') : (theme === 'dark' ? 'text-slate-400 hover:bg-[#1e222b]' : 'text-slate-600 hover:bg-slate-100')}`}>
              <Server className="w-4 h-4 mr-2 lg:mr-3 shrink-0" /> Authentication
            </button>
            <div className="hidden lg:block pt-4 pb-2">
              <span className={`text-xs font-bold uppercase tracking-wider px-3 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>Endpoints</span>
            </div>
            {endpoints.map(ep => (
              <button key={ep.id} onClick={() => setActiveSection(ep.id)} className={`flex items-center px-4 lg:px-3 py-2 lg:py-2.5 text-sm rounded-lg transition-colors ${activeSection === ep.id ? (theme === 'dark' ? 'bg-indigo-500/10 text-indigo-400 font-medium' : 'bg-indigo-50 text-indigo-600 font-medium') : (theme === 'dark' ? 'text-slate-400 hover:bg-[#1e222b]' : 'text-slate-600 hover:bg-slate-100')}`}>
                <span className={`text-[10px] font-bold mr-2 lg:mr-3 shrink-0 ${ep.method === 'GET' ? 'text-emerald-500' : 'text-indigo-500'}`}>{ep.method}</span>
                {ep.title}
              </button>
            ))}
            <button onClick={() => setActiveSection('webhooks')} className={`flex items-center px-4 lg:px-3 py-2 lg:py-2.5 text-sm rounded-lg transition-colors lg:mt-4 ${activeSection === 'webhooks' ? (theme === 'dark' ? 'bg-indigo-500/10 text-indigo-400 font-medium' : 'bg-indigo-50 text-indigo-600 font-medium') : (theme === 'dark' ? 'text-slate-400 hover:bg-[#1e222b]' : 'text-slate-600 hover:bg-slate-100')}`}>
              <Webhook className="w-4 h-4 mr-2 lg:mr-3 shrink-0" /> Webhooks
            </button>
          </div>
        </div>
      </div>

      {/* Main Content (2-Column API Layout on PC, Stacked on Mobile) */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 overflow-y-auto xl:overflow-hidden">
        
        {/* Left: Documentation */}
        <div className={`xl:col-span-7 overflow-y-visible xl:overflow-y-auto p-6 lg:p-10 xl:p-12 border-b xl:border-b-0 xl:border-r ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-200'}`}>
          <div className="max-w-3xl mx-auto xl:mx-0 min-w-0">
            
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
              <h1 className={`text-3xl sm:text-4xl font-extrabold tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                {activeSection === 'auth' ? 'Authentication' : 
                 activeSection === 'webhooks' ? 'Webhooks' : 
                 endpoints.find(e => e.id === activeSection)?.title}
              </h1>
              
            </div>

            <AnimatePresence mode="wait">
              <motion.div key={activeSection} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                
                {activeSection === 'auth' && (
                  <div className="space-y-6">
                    <p className={`text-base sm:text-lg leading-relaxed ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                      CommNexus uses API keys to authenticate requests. You can view and manage your API keys in the Dashboard.
                    </p>
                    <div className={`p-4 sm:p-6 rounded-xl border ${theme === 'dark' ? 'bg-[#12151a] border-[#1e222b]' : 'bg-white border-slate-200 shadow-sm'}`}>
                      <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>Your Secret Key</h3>
                      <div className="flex items-center w-full">
                        <code className={`flex-1 font-mono text-xs sm:text-sm px-3 sm:px-4 py-3 rounded-l-lg border overflow-x-auto whitespace-nowrap ${theme === 'dark' ? 'bg-[#0a0c10] border-[#262931] text-emerald-400' : 'bg-slate-50 border-slate-300 text-emerald-600'}`}>
                          {apiKey || 'Loading...'}
                        </code>
                        <button onClick={() => copyToClipboard(apiKey, 'apikey')} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-r-lg transition-colors border border-indigo-600 shrink-0">
                          {copied === 'apikey' ? <Check size={20} /> : <Copy size={20} />}
                        </button>
                      </div>
                      <p className={`mt-4 text-sm ${theme === 'dark' ? 'text-slate-500' : 'text-slate-500'}`}>
                        Pass this key in the <code className={`px-1 py-0.5 rounded ${theme === 'dark' ? 'bg-[#1e222b]' : 'bg-slate-200'}`}>x-api-key</code> header of every request.
                      </p>
                    </div>
                  </div>
                )}

                {activeSection === 'webhooks' && (
                  <div className="space-y-6">
                    <p className={`text-lg leading-relaxed ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                      Webhooks let your server react in real time to WhatsApp events — incoming and outgoing messages, read receipts, deletions, statuses, and more. Add your endpoint URL and choose which events to deliver.
                    </p>

                    {webhookMsg && (
                      <div className={`px-4 py-3 rounded-lg border text-sm ${webhookMsg.ok ? (theme === 'dark' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-emerald-50 border-emerald-300 text-emerald-700') : (theme === 'dark' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-rose-50 border-rose-300 text-rose-700')}`}>
                        {webhookMsg.text}
                      </div>
                    )}

                    {/* Create form */}
                    <form onSubmit={createWebhook} className={`p-6 rounded-xl border ${theme === 'dark' ? 'bg-[#12151a] border-[#1e222b]' : 'bg-white border-slate-200 shadow-sm'}`}>
                      <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 flex items-center ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>
                        <Plus className="w-4 h-4 mr-2 text-indigo-500" /> Add Webhook Endpoint
                      </h3>

                      <label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Destination URL</label>
                      <div className={`flex items-center rounded-lg border mb-4 overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500/40 transition-all ${theme === 'dark' ? 'bg-[#0a0c10] border-[#262931]' : 'bg-slate-50 border-slate-300'}`}>
                        <Globe className={`w-4 h-4 ml-3 shrink-0 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`} />
                        <input
                          type="url"
                          value={webhookUrl}
                          onChange={(e) => setWebhookUrl(e.target.value)}
                          placeholder="https://your-app.example.com/webhook/wppconnect"
                          className={`flex-1 bg-transparent border-none focus:ring-0 text-sm px-3 py-3 outline-none ${theme === 'dark' ? 'text-slate-200 placeholder-slate-500' : 'text-slate-800 placeholder-slate-400'}`}
                        />
                      </div>

                      <label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Secret <span className="font-normal opacity-60">(optional — signs deliveries with HMAC-SHA256 via X-WPP-Signature)</span></label>
                      <input
                        type="password"
                        value={webhookSecret}
                        onChange={(e) => setWebhookSecret(e.target.value)}
                        placeholder="verify your delivery is genuine"
                        className={`w-full rounded-lg border text-sm px-3 py-3 mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${theme === 'dark' ? 'bg-[#0a0c10] border-[#262931] text-slate-200 placeholder-slate-500' : 'bg-slate-50 border-slate-300 text-slate-800 placeholder-slate-400'}`}
                      />

                      <label className={`block text-xs font-semibold mb-2 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Trigger events</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
                        {WEBHOOK_EVENTS.map(event => (
                          <label key={event.id} className={`flex items-center px-3 py-2.5 rounded-lg border cursor-pointer select-none transition-colors ${webhookEvents.includes(event.id) ? (theme === 'dark' ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-indigo-50 border-indigo-400') : (theme === 'dark' ? 'bg-[#0a0c10] border-[#262931]' : 'bg-slate-50 border-slate-200')}`}>
                            <input
                              type="checkbox"
                              checked={webhookEvents.includes(event.id)}
                              onChange={() => toggleWebhookEvent(event.id)}
                              className="mr-2 accent-indigo-600"
                            />
                            <span className={`text-sm ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>{event.label}</span>
                          </label>
                        ))}
                      </div>

                      <button
                        type="submit"
                        disabled={webhookBusy || !webhookUrl.trim()}
                        className={`flex items-center justify-center w-full py-3 rounded-xl font-bold transition-all disabled:opacity-50 ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200'}`}
                      >
                        {webhookBusy ? <LoaderCircle className="w-5 h-5 mr-2 animate-spin" /> : <Plus className="w-5 h-5 mr-2" />}
                        {webhookBusy ? 'Creating...' : 'Add Webhook'}
                      </button>
                    </form>

                    {/* Existing webhooks */}
                    <div className={`p-6 rounded-xl border ${theme === 'dark' ? 'bg-[#12151a] border-[#1e222b]' : 'bg-white border-slate-200 shadow-sm'}`}>
                      <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>
                        Active Webhooks ({webhooks.length})
                      </h3>
                      {webhooks.length === 0 ? (
                        <p className={`text-sm py-6 text-center ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                          No webhooks configured yet. Add your first endpoint above.
                        </p>
                      ) : (
                        <ul className="space-y-3">
                          {webhooks.map(webhook => (
                            <li key={webhook.id} className={`flex items-start justify-between gap-3 p-4 rounded-lg border ${theme === 'dark' ? 'border-[#1e222b] bg-[#0a0c10]' : 'border-slate-200 bg-slate-50'}`}>
                              <div className="flex-1 min-w-0">
                                <p className={`font-mono text-xs sm:text-sm truncate ${theme === 'dark' ? 'text-indigo-300' : 'text-indigo-600'}`}>{webhook.url}</p>
                                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                  {webhook.events.map(evt => (
                                    <span key={evt} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${evt === '*' ? (theme === 'dark' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-100 text-emerald-700') : (theme === 'dark' ? 'bg-[#1e222b] text-slate-300' : 'bg-slate-200 text-slate-700')}`}>
                                      {evt === '*' ? 'All events' : evt}
                                    </span>
                                  ))}
                                  {webhook.hasSecret && (
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${theme === 'dark' ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-100 text-amber-700'}`}>Signed</span>
                                  )}
                                  <span className={`text-[10px] ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>{new Date(webhook.createdAt).toLocaleString()}</span>
                                </div>
                              </div>
                              <button
                                onClick={() => deleteWebhook(webhook.id)}
                                className={`p-2 rounded-lg transition-colors shrink-0 ${theme === 'dark' ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-500/10' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'}`}
                                title="Delete webhook"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                {endpoints.map(ep => activeSection === ep.id && (
                  <div key={ep.id} className="space-y-8">
                    <p className={`text-lg leading-relaxed ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                      {ep.desc}
                    </p>
                    
                    <div>
                      <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>Endpoint</h3>
                      <div className="flex items-center space-x-4">
                        <span className={`font-bold px-3 py-1.5 rounded-lg text-sm ${ep.method === 'GET' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-indigo-500/20 text-indigo-500'}`}>
                          {ep.method}
                        </span>
                        <code className={`text-lg font-mono ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>
                          {ep.path}
                        </code>
                      </div>
                    </div>

                    {ep.payload && (
                      <div>
                        <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>Parameters</h3>
                        <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-200'}`}>
                          <table className="w-full text-left text-sm">
                            <thead className={theme === 'dark' ? 'bg-[#12151a]' : 'bg-slate-50'}>
                              <tr>
                                <th className={`px-4 py-3 font-semibold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Field</th>
                                <th className={`px-4 py-3 font-semibold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Type</th>
                                <th className={`px-4 py-3 font-semibold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Description</th>
                              </tr>
                            </thead>
                            <tbody className={`divide-y ${theme === 'dark' ? 'divide-[#1e222b]' : 'divide-slate-200'}`}>
                              {Object.entries(ep.payload).map(([key, val]) => (
                                <tr key={key} className={theme === 'dark' ? 'bg-[#0a0c10]' : 'bg-white'}>
                                  <td className={`px-4 py-4 font-mono font-medium ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>{key}</td>
                                  <td className={`px-4 py-4 ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}>{typeof val === 'object' ? 'array' : typeof val}</td>
                                  <td className={`px-4 py-4 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>The {key} property for the payload.</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div className="pt-6">
                      <button
                        onClick={() => openPlayground(ep)}
                        disabled={isTesting}
                        className={`flex items-center justify-center w-full py-4 rounded-xl font-bold transition-all disabled:opacity-50 ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200'}`}
                      >
                        {isTesting ? <LoaderCircle className="w-5 h-5 mr-2 animate-spin" /> : <PlayCircle className="w-5 h-5 mr-2" />}
                        {isTesting ? 'Executing Request...' : 'Open Test Playground'}
                      </button>
                    </div>

                    {testResult && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-8">
                        <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 flex items-center ${testResult.success ? 'text-emerald-500' : 'text-rose-500'}`}>
                          <Activity className="w-4 h-4 mr-2" />
                          {testResult.success ? '200 OK Response' : 'Error Response'}
                        </h3>
                        <div className={`rounded-xl overflow-hidden border ${testResult.success ? (theme==='dark'?'border-emerald-500/30':'border-emerald-400') : (theme==='dark'?'border-rose-500/30':'border-rose-400')}`}>
                          <CodeBlock language="json" code={JSON.stringify(testResult.data, null, 2)} theme={theme} />
                        </div>
                      </motion.div>
                    )}

                  </div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Right: Interactive Code View */}
        <div className={`xl:col-span-5 flex flex-col shrink-0 min-h-[500px] xl:min-h-0 ${theme === 'dark' ? 'bg-[#0d1015]' : 'bg-[#1e1e1e]'}`}>
          
          {/* Language Tabs */}
          <div className="flex px-4 pt-4 space-x-1 bg-[#18181b]">
            {['curl', 'javascript', 'python', 'php'].map(lang => (
              <button
                key={lang}
                onClick={() => setActiveLang(lang)}
                className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-t-lg transition-colors ${activeLang === lang ? 'bg-[#1e1e1e] text-indigo-400 border-t-2 border-indigo-500' : 'bg-transparent text-slate-500 hover:text-slate-300'}`}
              >
                {lang === 'javascript' ? 'Node.js' : lang}
              </button>
            ))}
          </div>

          <div className="flex-1 relative overflow-y-auto">
            {activeSection === 'auth' ? (
              <div className="p-6">
                <CodeBlock language="bash" theme="dark" code={`# All requests must include the x-api-key header\ncurl -X GET /api/status \\\n  -H "x-api-key: YOUR_API_KEY"`} />
              </div>
            ) : activeSection === 'webhooks' ? (
              <div className="p-6">
                <CodeBlock language="json" theme="dark" code={`// Delivered as POST to your URL (envelope + event payload)\n{\n  "id": "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",\n  "event": "message.received",\n  "createdAt": "2026-09-14T10:30:00.000Z",\n  "data": {\n    "from": "2349034040635@c.us",\n    "body": "Hello, I need support!",\n    "timestamp": 1694678123,\n    "fromMe": false\n  }\n}\n\n// Signed deliveries add the header:\n// X-WPP-Signature: sha256=<HMAC-SHA256(secret, body)>\n\n// Create it with:\n// POST /api/v1/webhooks\n// {\n//   "url": "https://your-app.example.com/webhook/wppconnect",\n//   "events": ["message.received", "message.sent", "message.ack"],\n//   "secret": "optional-shared-secret"\n// }`} />
              </div>
            ) : (
              endpoints.map(ep => activeSection === ep.id && (
                <div key={ep.id} className="relative group">
                  <div className="absolute top-4 right-4 z-10">
                    <button onClick={() => copyToClipboard(getSnippets(ep.path, ep.method, ep.payload ? JSON.stringify(ep.payload, null, 2) : null)[activeLang], 'code')} className="p-2 rounded bg-[#2d2d2d] text-slate-400 hover:text-white transition-colors">
                      {copied === 'code' ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                    </button>
                  </div>
                  <CodeBlock 
                    language={activeLang === 'curl' ? 'bash' : activeLang} 
                    theme="dark" // Right pane code is always dark for that IDE feel
                    code={getSnippets(ep.path, ep.method, ep.payload ? JSON.stringify(ep.payload, null, 2) : null)[activeLang]} 
                  />
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* Test Playground Modal */}
      <AnimatePresence>
        {playgroundModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-[#12151a] border-slate-200 dark:border-[#1e222b] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-[#1e222b] bg-slate-100 dark:bg-[#16191f]">
                <h2 className="text-lg font-bold text-white flex items-center">
                  <PlayCircle className="w-5 h-5 mr-2 text-indigo-400" />
                  Test {playgroundModal.endpoint.title}
                </h2>
                <button onClick={() => setPlaygroundModal({ isOpen: false, endpoint: null })} className="text-slate-400 hover:text-white">
                  ✕
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto max-h-[70vh]">
                <form id="playground-form" onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.target);
                  const newPayload = {};
                  Object.keys(playgroundModal.endpoint.payload).forEach(key => {
                    let val = fd.get(key);
                    if (Array.isArray(playgroundModal.endpoint.payload[key])) {
                      val = val.split(',').map(s => s.trim()).filter(Boolean);
                    }
                    newPayload[key] = val;
                  });
                  setPlaygroundModal({ isOpen: false, endpoint: null });
                  handleTestAPI(playgroundModal.endpoint.path, playgroundModal.endpoint.method, newPayload);
                }} className="space-y-4">
                  {Object.entries(playgroundModal.endpoint.payload).map(([key, val]) => (
                    <div key={key}>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">{key}</label>
                      {typeof val === 'string' && val.startsWith('data:image') ? (
                         <input type="text" name={key} defaultValue={val} className="w-full bg-slate-50 dark:bg-[#0a0c10] border-slate-200 dark:border-[#1e222b] rounded-lg py-2.5 px-3 text-slate-900 dark:text-slate-200 focus:outline-none focus:border-indigo-500 font-mono text-xs" />
                      ) : Array.isArray(val) ? (
                        <textarea name={key} defaultValue={val.join(', ')} rows="2" placeholder="Comma separated values" className="w-full bg-slate-50 dark:bg-[#0a0c10] border-slate-200 dark:border-[#1e222b] rounded-lg py-2.5 px-3 text-slate-900 dark:text-slate-200 focus:outline-none focus:border-indigo-500 font-mono text-sm resize-none" />
                      ) : (
                        <textarea name={key} defaultValue={val} rows={key === 'text' || key === 'caption' ? 3 : 1} className="w-full bg-slate-50 dark:bg-[#0a0c10] border-slate-200 dark:border-[#1e222b] rounded-lg py-2.5 px-3 text-slate-900 dark:text-slate-200 focus:outline-none focus:border-indigo-500 font-mono text-sm resize-none" />
                      )}
                      <p className="text-[10px] text-slate-500 mt-1">Expected: {Array.isArray(val) ? 'Array (comma separated)' : typeof val}</p>
                    </div>
                  ))}
                </form>
              </div>

              <div className="p-4 border-t border-slate-200 dark:border-[#1e222b] bg-slate-100 dark:bg-[#16191f] flex justify-end space-x-3">
                <button onClick={() => setPlaygroundModal({ isOpen: false, endpoint: null })} className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">Cancel</button>
                <button type="submit" form="playground-form" className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-indigo-500/20 transition-all flex items-center">
                  Execute <Terminal className="w-4 h-4 ml-2" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
