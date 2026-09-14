import { useState, useEffect, memo } from 'react';
import axios from 'axios';
import { getApiKey } from '../auth';
import { Code2, Copy, Check, Terminal, PlayCircle, LoaderCircle, Webhook, Activity, FileText, MessageSquare, Server, Image as ImageIcon, Users } from 'lucide-react';
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
  const [copied, setCopied] = useState('');
  const [activeLang, setActiveLang] = useState('curl');
  const [theme, setTheme] = useState('dark');
  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  const [activeSection, setActiveSection] = useState('auth');

  useEffect(() => {
    getApiKey().then(setApiKey);
  }, []);

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
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
      setTestResult({ success: false, data: err.response?.data || { error: err.message } });
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

  return (
    <div className={`flex-1 flex overflow-hidden transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0a0c10] text-slate-300' : 'bg-slate-50 text-slate-700'}`}>
      
      {/* Sidebar Navigation */}
      <div className={`w-64 border-r overflow-y-auto ${theme === 'dark' ? 'border-[#1e222b] bg-[#0f1115]' : 'border-slate-200 bg-white'}`}>
        <div className="p-6">
          <h2 className={`text-xs font-bold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>API Reference</h2>
          <nav className="space-y-1">
            <button onClick={() => setActiveSection('auth')} className={`w-full flex items-center px-3 py-2 text-sm rounded-lg transition-colors ${activeSection === 'auth' ? (theme === 'dark' ? 'bg-indigo-500/10 text-indigo-400 font-medium' : 'bg-indigo-50 text-indigo-600 font-medium') : (theme === 'dark' ? 'text-slate-400 hover:bg-[#1e222b]' : 'text-slate-600 hover:bg-slate-100')}`}>
              <Server className="w-4 h-4 mr-3" /> Authentication
            </button>
            <div className="pt-4 pb-2">
              <span className={`text-xs font-bold uppercase tracking-wider px-3 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>Endpoints</span>
            </div>
            {endpoints.map(ep => (
              <button key={ep.id} onClick={() => setActiveSection(ep.id)} className={`w-full flex items-center px-3 py-2 text-sm rounded-lg transition-colors ${activeSection === ep.id ? (theme === 'dark' ? 'bg-indigo-500/10 text-indigo-400 font-medium' : 'bg-indigo-50 text-indigo-600 font-medium') : (theme === 'dark' ? 'text-slate-400 hover:bg-[#1e222b]' : 'text-slate-600 hover:bg-slate-100')}`}>
                <span className={`text-[10px] font-bold mr-3 ${ep.method === 'GET' ? 'text-emerald-500' : 'text-indigo-500'}`}>{ep.method}</span>
                {ep.title}
              </button>
            ))}
            <button onClick={() => setActiveSection('webhooks')} className={`w-full flex items-center px-3 py-2 text-sm rounded-lg transition-colors mt-4 ${activeSection === 'webhooks' ? (theme === 'dark' ? 'bg-indigo-500/10 text-indigo-400 font-medium' : 'bg-indigo-50 text-indigo-600 font-medium') : (theme === 'dark' ? 'text-slate-400 hover:bg-[#1e222b]' : 'text-slate-600 hover:bg-slate-100')}`}>
              <Webhook className="w-4 h-4 mr-3" /> Webhooks
            </button>
          </nav>
        </div>
      </div>

      {/* Main Content (2-Column API Layout) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Documentation */}
        <div className={`flex-1 overflow-y-auto p-10 lg:p-12 border-r ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-200'}`}>
          <div className="max-w-3xl">
            
            <div className="flex items-center justify-between mb-8">
              <h1 className={`text-4xl font-extrabold tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                {activeSection === 'auth' ? 'Authentication' : 
                 activeSection === 'webhooks' ? 'Webhooks' : 
                 endpoints.find(e => e.id === activeSection)?.title}
              </h1>
              
              {/* Theme Switcher */}
              <button 
                onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${theme === 'dark' ? 'bg-[#1e222b] border-[#2a2f3a] text-slate-300 hover:text-white' : 'bg-slate-200 border-slate-300 text-slate-700 hover:bg-slate-300'}`}
              >
                Theme: {theme === 'dark' ? 'Dark' : 'Light'}
              </button>
            </div>

            <AnimatePresence mode="wait">
              <motion.div key={activeSection} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                
                {activeSection === 'auth' && (
                  <div className="space-y-6">
                    <p className={`text-lg leading-relaxed ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                      CommNexus uses API keys to authenticate requests. You can view and manage your API keys in the Dashboard.
                    </p>
                    <div className={`p-6 rounded-xl border ${theme === 'dark' ? 'bg-[#12151a] border-[#1e222b]' : 'bg-white border-slate-200 shadow-sm'}`}>
                      <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>Your Secret Key</h3>
                      <div className="flex items-center">
                        <code className={`flex-1 font-mono text-sm px-4 py-3 rounded-l-lg border ${theme === 'dark' ? 'bg-[#0a0c10] border-[#262931] text-emerald-400' : 'bg-slate-50 border-slate-300 text-emerald-600'}`}>
                          {apiKey || 'Loading...'}
                        </code>
                        <button onClick={() => copyToClipboard(apiKey, 'apikey')} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-r-lg transition-colors border border-indigo-600">
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
                      Configure webhooks to receive real-time notifications for incoming messages, status updates, and read receipts.
                    </p>
                    <div className={`p-6 rounded-xl border ${theme === 'dark' ? 'bg-[#12151a] border-[#1e222b]' : 'bg-white border-slate-200 shadow-sm'}`}>
                      <h3 className={`text-sm font-bold uppercase tracking-wider mb-2 ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>Event Types</h3>
                      <ul className={`list-disc list-inside space-y-2 mt-4 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                        <li><strong className={theme === 'dark' ? 'text-slate-200' : 'text-slate-900'}>message</strong> - Triggered when a new message is received.</li>
                        <li><strong className={theme === 'dark' ? 'text-slate-200' : 'text-slate-900'}>status</strong> - Triggered when engine connects or disconnects.</li>
                        <li><strong className={theme === 'dark' ? 'text-slate-200' : 'text-slate-900'}>ack</strong> - Triggered when a message is read or delivered.</li>
                      </ul>
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
                        onClick={() => handleTestAPI(ep.path, ep.method, ep.payload)}
                        disabled={isTesting}
                        className={`flex items-center justify-center w-full py-4 rounded-xl font-bold transition-all disabled:opacity-50 ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200'}`}
                      >
                        {isTesting ? <LoaderCircle className="w-5 h-5 mr-2 animate-spin" /> : <PlayCircle className="w-5 h-5 mr-2" />}
                        {isTesting ? 'Executing Request...' : 'Run Test Request'}
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
        <div className={`w-[45%] flex flex-col ${theme === 'dark' ? 'bg-[#0d1015]' : 'bg-[#1e1e1e]'}`}>
          
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
                <CodeBlock language="bash" theme="dark" code={`# All requests must include the x-api-key header\ncurl -X GET ${SERVER_URL}/api/status \\\n  -H "x-api-key: YOUR_API_KEY"`} />
              </div>
            ) : activeSection === 'webhooks' ? (
              <div className="p-6">
                <CodeBlock language="json" theme="dark" code={`{\n  "event": "message",\n  "data": {\n    "from": "15551234567@c.us",\n    "text": "Hello, I need support!",\n    "timestamp": 1694678123,\n    "isGroupMsg": false\n  }\n}`} />
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
    </div>
  );
}
