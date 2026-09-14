import { useState, useEffect } from 'react';
import { getApiKey } from '../auth';
import { Code2, Copy, Check, Server, Terminal, Smartphone } from 'lucide-react';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');

export default function Developer() {
  const [apiKey, setApiKey] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    getApiKey().then(setApiKey);
  }, []);

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  const CodeBlock = ({ id, language, title, code }) => (
    <div className="mb-6 rounded-xl overflow-hidden border border-[#262931] bg-[#16191f]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#262931] bg-[#1a1d24]">
        <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</div>
        <button
          onClick={() => copyToClipboard(code, id)}
          className="text-slate-400 hover:text-indigo-400 transition-colors p-1"
        >
          {copied === id ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
        </button>
      </div>
      <div className="p-4 overflow-x-auto">
        <pre className="text-sm text-slate-300 font-mono">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-8">
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

        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-6 mb-10">
          <h3 className="text-lg font-semibold text-indigo-400 mb-2 flex items-center">
            <Server className="w-5 h-5 mr-2" />
            Your Credentials
          </h3>
          <p className="text-slate-300 mb-4 text-sm">
            Include this key in the <code className="bg-[#16191f] px-2 py-1 rounded border border-[#262931]">x-api-key</code> header of all requests.
          </p>
          <div className="flex items-center">
            <code className="flex-1 bg-[#0f1115] border border-[#262931] p-3 rounded-l-lg text-slate-200 font-mono text-sm break-all">
              {apiKey || 'Loading...'}
            </code>
            <button
              onClick={() => copyToClipboard(apiKey, 'apikey')}
              className="bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-r-lg transition-colors border border-indigo-600"
            >
              {copied === 'apikey' ? <Check size={20} /> : <Copy size={20} />}
            </button>
          </div>
        </div>

        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <Terminal className="w-6 h-6 mr-2 text-slate-400" />
          Quick Start Examples
        </h2>

        <CodeBlock
          id="curl-status"
          language="bash"
          title="Check Session Status (cURL)"
          code={`curl -X GET ${SERVER_URL}/api/status \\
  -H "x-api-key: ${apiKey}"`}
        />

        <CodeBlock
          id="node-send"
          language="javascript"
          title="Send a Text Message (Node.js)"
          code={`const axios = require('axios');

async function sendMessage() {
  try {
    const response = await axios.post('${SERVER_URL}/api/send-message', {
      to: '15551234567@c.us',
      text: 'Hello from CommNexus API!'
    }, {
      headers: { 'x-api-key': '${apiKey}' }
    });
    console.log(response.data);
  } catch (error) {
    console.error(error.response.data);
  }
}

sendMessage();`}
        />

        <CodeBlock
          id="python-file"
          language="python"
          title="Send Media (Python)"
          code={`import requests

url = "${SERVER_URL}/api/send-file"
headers = {
    "x-api-key": "${apiKey}",
    "Content-Type": "application/json"
}
data = {
    "to": "15551234567@c.us",
    "dataUrl": "data:image/png;base64,iVBORw0KGgo...",
    "filename": "document.png",
    "caption": "Please review this document"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())`}
        />

      </div>
    </div>
  );
}
