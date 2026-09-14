import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { setApiKey } from '../auth';
import { MessageSquare, KeyRound, ArrowRight, Server, ShieldCheck } from 'lucide-react';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');
const API_URL = `${SERVER_URL}/api`;

export default function Login() {
  const [apiKey, setKeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e?.preventDefault();
    if (!apiKey || apiKey.length < 32) {
      setError('Invalid API Key format.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Validate the key by trying to hit /status
      await axios.get(`${API_URL}/status`, { headers: { 'x-api-key': apiKey } });
      await setApiKey(apiKey);
      navigate('/');
    } catch (err) {
      setError('Invalid API Key or server offline.');
      setLoading(false);
    }
  };

  const handleProvision = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.post(`${API_URL}/v1/provision`);
      const newKey = response.data.data.apiKey;
      await setApiKey(newKey);
      navigate('/');
    } catch (err) {
      setError('Failed to provision a new workspace.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1115] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-xl bg-indigo-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <MessageSquare size={32} />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-white tracking-tight">
          Welcome to CommNexus
        </h2>
        <p className="mt-2 text-center text-sm text-slate-400">
          The unified communication API for developers.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-[#16191f] py-8 px-4 shadow sm:rounded-xl sm:px-10 border border-[#262931]">
          
          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label htmlFor="apiKey" className="block text-sm font-medium text-slate-300">
                Workspace API Key
              </label>
              <div className="mt-2 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  id="apiKey"
                  type="text"
                  value={apiKey}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="block w-full pl-10 bg-[#0f1115] border border-[#262931] rounded-lg py-3 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent sm:text-sm transition-all"
                  placeholder="Paste your 64-character API key"
                />
              </div>
            </div>

            {error && (
              <div className="text-sm text-rose-400 bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">
                {error}
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 focus:ring-offset-[#16191f] transition-all disabled:opacity-50"
              >
                {loading ? 'Connecting...' : 'Access Workspace'}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#262931]" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-[#16191f] text-slate-500">Or create a new one</span>
              </div>
            </div>

            <div className="mt-6">
              <button
                onClick={handleProvision}
                disabled={loading}
                className="w-full flex items-center justify-center py-3 px-4 border border-[#262931] rounded-lg shadow-sm text-sm font-medium text-slate-300 bg-[#20242c] hover:bg-[#2a2f3a] focus:outline-none transition-all disabled:opacity-50"
              >
                <Server className="w-4 h-4 mr-2 text-slate-400" />
                Provision New Workspace
                <ArrowRight className="w-4 h-4 ml-2 text-slate-400" />
              </button>
            </div>
          </div>

        </div>

        <div className="mt-8 text-center text-xs text-slate-500 flex items-center justify-center space-x-2">
          <ShieldCheck className="w-4 h-4" />
          <span>End-to-end encrypted sessions. Keys never stored in Vercel.</span>
        </div>
      </div>
    </div>
  );
}
