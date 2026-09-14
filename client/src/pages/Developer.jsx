import { useState, useEffect } from 'react';
import axios from 'axios';
import { getApiKey } from '../auth';
import { Code2, Copy, Check, Server, Terminal, PlayCircle, LoaderCircle, Webhook, Activity } from 'lucide-react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('php', php);
SyntaxHighlighter.registerLanguage('json', json);

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');

export default function Developer() {
  const [apiKey, setApiKey] = useState('');
  const [copied, setCopied] = useState('');
  const [activeLang, setActiveLang] = useState('curl');
  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    getApiKey().then(setApiKey);
  }, []);

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleTestAPI = async (endpoint, payload = null) => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await axios({
        method: payload ? 'POST' : 'GET',
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

  const codeSnippets = {
    status: {
      curl: `curl -X GET ${SERVER_URL}/api/status \\\n  -H "x-api-key: ${apiKey}"`,
      javascript: `const axios = require('axios');\n\naxios.get('${SERVER_URL}/api/status', {\n  headers: { 'x-api-key': '${apiKey}' }\n})\n.then(res => console.log(res.data))\n.catch(err => console.error(err));`,
      python: `import requests\n\nurl = "${SERVER_URL}/api/status"\nheaders = { "x-api-key": "${apiKey}" }\n\nresponse = requests.get(url, headers=headers)\nprint(response.json())`,
      php: `<?php\n$ch = curl_init();\ncurl_setopt($ch, CURLOPT_URL, "${SERVER_URL}/api/status");\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);\ncurl_setopt($ch, CURLOPT_HTTPHEADER, array(\n  "x-api-key: ${apiKey}"\n));\n\n$result = curl_exec($ch);\ncurl_close($ch);\necho $result;\n?>`
    },
    message: {
      curl: `curl -X POST ${SERVER_URL}/api/send-message \\\n  -H "x-api-key: ${apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"to": "15551234567@c.us", "text": "Hello world!"}'`,
      javascript: `const axios = require('axios');\n\naxios.post('${SERVER_URL}/api/send-message', {\n  to: '15551234567@c.us',\n  text: 'Hello world!'\n}, {\n  headers: { 'x-api-key': '${apiKey}' }\n}).then(console.log);`,
      python: `import requests\n\nurl = "${SERVER_URL}/api/send-message"\nheaders = { "x-api-key": "${apiKey}" }\npayload = { "to": "15551234567@c.us", "text": "Hello world!" }\n\nresponse = requests.post(url, headers=headers, json=payload)\nprint(response.json())`,
      php: `<?php\n$ch = curl_init("${SERVER_URL}/api/send-message");\n$payload = json_encode(array("to" => "15551234567@c.us", "text" => "Hello world!"));\n\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\ncurl_setopt($ch, CURLOPT_POST, true);\ncurl_setopt($ch, CURLOPT_POSTFIELDS, $payload);\ncurl_setopt($ch, CURLOPT_HTTPHEADER, array(\n  "x-api-key: ${apiKey}",\n  "Content-Type: application/json"\n));\n\n$result = curl_exec($ch);\ncurl_close($ch);\necho $result;\n?>`
    }
  };

  const InteractiveSnippet = ({ id, title, endpoint, payload, snippets }) => {
    return (
      <div className="mb-8 rounded-xl overflow-hidden border border-[#262931] bg-[#16191f] shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#262931] bg-[#1a1d24]">
          <div className="flex items-center">
            <span className={`text-xs font-bold px-2 py-1 rounded mr-3 ${payload ? 'bg-indigo-500/20 text-indigo-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
              {payload ? 'POST' : 'GET'}
            </span>
            <div className="text-sm font-medium text-slate-300">{title}</div>
            <div className="text-xs text-slate-500 ml-3 font-mono hidden sm:block">{endpoint}</div>
          </div>
          <button
            onClick={() => handleTestAPI(endpoint, payload)}
            disabled={isTesting}
            className="flex items-center text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition-colors disabled:opacity-50"
          >
            {isTesting ? <LoaderCircle className="w-4 h-4 mr-1.5 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-1.5" />}
            Test Request
          </button>
        </div>

        {/* Language Tabs */}
        <div className="flex border-b border-[#262931] bg-[#111317]">
          {['curl', 'javascript', 'python', 'php'].map(lang => (
            <button
              key={lang}
              onClick={() => setActiveLang(lang)}
              className={`px-4 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${activeLang === lang ? 'text-indigo-400 border-b-2 border-indigo-500 bg-[#16191f]' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {lang === 'javascript' ? 'Node.js' : lang}
            </button>
          ))}
        </div>

        {/* Code View */}
        <div className="relative group">
          <SyntaxHighlighter
            language={activeLang === 'curl' ? 'bash' : activeLang}
            style={vscDarkPlus}
            customStyle={{ margin: 0, padding: '1.25rem', background: 'transparent', fontSize: '0.875rem' }}
          >
            {snippets[activeLang]}
          </SyntaxHighlighter>
          <button
            onClick={() => copyToClipboard(snippets[activeLang], id)}
            className="absolute top-3 right-3 p-1.5 rounded-md bg-[#2a2d35] text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
          >
            {copied === id ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-[#0f1115]">
      <div className="max-w-4xl mx-auto">
        
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2 flex items-center">
            <Code2 className="mr-3 text-indigo-500" size={32} />
            Developer API
          </h1>
          <p className="text-slate-400 text-lg">
            Integrate your workspace programmatically using your unique API Key.
          </p>
        </div>

        <div className="bg-gradient-to-r from-indigo-500/10 to-transparent border border-indigo-500/20 rounded-xl p-6 mb-10 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-indigo-400 mb-1 flex items-center">
              <Server className="w-5 h-5 mr-2" />
              API Key & Authentication
            </h3>
            <p className="text-slate-400 text-sm mb-4">Include this key in the <code className="bg-[#1a1d24] px-1.5 py-0.5 rounded text-slate-300">x-api-key</code> header of all requests.</p>
            <div className="flex items-center space-x-3">
              <code className="bg-[#0f1115] border border-[#262931] px-4 py-2 rounded-lg text-emerald-400 font-mono text-sm shadow-inner">
                {apiKey || 'Loading...'}
              </code>
              <button onClick={() => copyToClipboard(apiKey, 'apikey')} className="text-slate-400 hover:text-white transition-colors">
                {copied === 'apikey' ? <Check size={20} className="text-emerald-400" /> : <Copy size={20} />}
              </button>
            </div>
          </div>
        </div>

        {/* Live Test Result */}
        {testResult && (
          <div className="mb-10 animate-fade-in-down">
            <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center">
              <Activity className="w-4 h-4 mr-2" />
              Last Test Response
            </h3>
            <div className={`rounded-xl overflow-hidden border ${testResult.success ? 'border-emerald-500/30' : 'border-rose-500/30'}`}>
              <SyntaxHighlighter
                language="json"
                style={vscDarkPlus}
                customStyle={{ margin: 0, padding: '1.25rem', background: '#16191f', fontSize: '0.875rem' }}
              >
                {JSON.stringify(testResult.data, null, 2)}
              </SyntaxHighlighter>
            </div>
          </div>
        )}

        <h2 className="text-xl font-bold text-white mb-6 flex items-center">
          <Terminal className="w-6 h-6 mr-2 text-slate-400" />
          Interactive Endpoints
        </h2>

        <InteractiveSnippet
          id="status"
          title="Check Engine Status"
          endpoint="/status"
          snippets={codeSnippets.status}
        />

        <InteractiveSnippet
          id="send-message"
          title="Send Text Message"
          endpoint="/send-message"
          payload={{ to: "1234567890@c.us", text: "Hello!" }}
          snippets={codeSnippets.message}
        />

        {/* Webhooks Section */}
        <div className="mt-12 bg-[#16191f] border border-[#262931] rounded-xl p-6">
          <h2 className="text-xl font-bold text-white mb-2 flex items-center">
            <Webhook className="w-6 h-6 mr-2 text-indigo-400" />
            Receiving Messages (Webhooks)
          </h2>
          <p className="text-slate-400 text-sm mb-6">
            To receive incoming WhatsApp messages in real-time, configure your Webhook URL in the backend environment variables (<code className="text-slate-300 bg-[#262931] px-1 rounded">WEBHOOK_URL</code>). CommNexus will POST JSON payloads to your server instantly.
          </p>
          <div className="rounded-lg overflow-hidden border border-[#262931]">
            <SyntaxHighlighter
              language="json"
              style={vscDarkPlus}
              customStyle={{ margin: 0, padding: '1rem', background: '#111317', fontSize: '0.875rem' }}
            >
              {`// Example Webhook Payload
{
  "event": "message",
  "data": {
    "from": "15551234567@c.us",
    "text": "Hello, I need support!",
    "timestamp": 1694678123,
    "isGroupMsg": false
  }
}`}
            </SyntaxHighlighter>
          </div>
        </div>

      </div>
    </div>
  );
}
