import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { setApiKey } from '../auth';
import liveStream from '../liveStream';
import { MessageSquare, Phone, Lock, AlertCircle, ArrowRight, Server, ShieldCheck, KeyRound } from 'lucide-react';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');
const API_URL = `${SERVER_URL}/api`;

export default function Login() {
  const [activeTab, setActiveTab] = useState('login'); // 'login', 'signup', 'reset'
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError(''); setSuccessMsg('');
    try {
      const res = await axios.post(`${API_URL}/auth/login`, { phone, password });
      const key = res.data.data.apiKey;
      await setApiKey(key);
      axios.defaults.headers.common['x-api-key'] = key;
      liveStream.connect(key);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to connect to server.');
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true); setError(''); setSuccessMsg('');
    try {
      const res = await axios.post(`${API_URL}/auth/signup`, { phone, password });
      const key = res.data.data.apiKey;
      await setApiKey(key);
      axios.defaults.headers.common['x-api-key'] = key;
      liveStream.connect(key);
      setSuccessMsg(`ACCOUNT CREATED! Please save this Recovery Code to reset your password if you forget it: ${res.data.data.recoveryCode}`);
      // Don't navigate immediately so they can see the code.
      setLoading(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Signup failed.');
      setLoading(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setLoading(true); setError(''); setSuccessMsg('');
    try {
      const res = await axios.post(`${API_URL}/auth/reset-password`, { phone, recoveryCode, newPassword: password });
      const key = res.data.data.apiKey;
      await setApiKey(key);
      axios.defaults.headers.common['x-api-key'] = key;
      liveStream.connect(key);
      setSuccessMsg(`Password reset! Your NEW Recovery Code is: ${res.data.data.newRecoveryCode}.`);
      setLoading(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Password reset failed.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0f1115] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-xl bg-indigo-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <MessageSquare size={32} />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          CommNexus
        </h2>
        <p className="mt-2 text-center text-sm text-slate-400">
          The unified communication API.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-[#16191f] shadow sm:rounded-xl border border-slate-200 dark:border-[#262931] overflow-hidden">
          
          <div className="flex border-b border-slate-200 dark:border-[#262931]">
            <button onClick={() => { setActiveTab('login'); setError(''); setSuccessMsg(''); }} className={`flex-1 py-4 text-sm font-medium transition-colors ${activeTab === 'login' ? 'text-indigo-400 bg-indigo-50 dark:bg-[#1c2028] border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-700 dark:text-slate-300'}`}>Log In</button>
            <button onClick={() => { setActiveTab('signup'); setError(''); setSuccessMsg(''); }} className={`flex-1 py-4 text-sm font-medium transition-colors ${activeTab === 'signup' ? 'text-indigo-400 bg-indigo-50 dark:bg-[#1c2028] border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-700 dark:text-slate-300'}`}>Sign Up</button>
          </div>

          <div className="p-6 sm:px-10 py-8">
            <form className="space-y-5" onSubmit={activeTab === 'login' ? handleLogin : activeTab === 'signup' ? handleSignup : handleReset}>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Phone Number</label>
                <div className="mt-2 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Phone className="h-5 w-5 text-slate-500" />
                  </div>
                  <input required type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="block w-full pl-10 bg-slate-50 dark:bg-[#0f1115] border border-slate-200 dark:border-[#262931] rounded-lg py-3 text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm" placeholder="e.g. 15551234567" />
                </div>
              </div>

              {activeTab === 'reset' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Recovery Code</label>
                  <div className="mt-2 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <KeyRound className="h-5 w-5 text-slate-500" />
                    </div>
                    <input required type="text" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} className="block w-full pl-10 bg-slate-50 dark:bg-[#0f1115] border border-slate-200 dark:border-[#262931] rounded-lg py-3 text-slate-900 dark:text-slate-200 uppercase placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm" placeholder="e.g. A1B2C3D4" />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {activeTab === 'reset' ? 'New Password' : 'Password'}
                </label>
                <div className="mt-2 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-slate-500" />
                  </div>
                  <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="block w-full pl-10 bg-slate-50 dark:bg-[#0f1115] border border-slate-200 dark:border-[#262931] rounded-lg py-3 text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm" placeholder="••••••••" minLength={6} />
                </div>
              </div>

              {error && (
                <div className="text-sm text-rose-400 bg-rose-500/10 p-3 rounded-lg border border-rose-500/20 flex items-start">
                  <AlertCircle className="w-5 h-5 mr-2 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {successMsg && (
                <div className="text-sm text-emerald-400 bg-emerald-500/10 p-4 rounded-lg border border-emerald-500/20">
                  <p className="font-bold mb-2 uppercase tracking-wide">Save this Recovery Code</p>
                  <p className="font-mono text-lg mb-4 text-slate-900 dark:text-white p-2 bg-slate-50 dark:bg-[#0f1115] rounded border border-emerald-500/30 inline-block">
                    {successMsg.split(': ')[1]}
                  </p>
                  <p className="text-xs text-slate-400 mb-4">You must save this code somewhere safe. If you forget your password, this code is the only way to recover your account.</p>
                  <button type="button" onClick={() => navigate('/')} className="w-full bg-emerald-600 hover:bg-emerald-700 text-slate-900 dark:text-white font-medium py-2 rounded transition-colors">
                    I saved it, continue
                  </button>
                </div>
              )}

              {!successMsg && (
                <div>
                  <button type="submit" disabled={loading} className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 focus:ring-offset-[#16191f] transition-all disabled:opacity-50">
                    {loading ? 'Processing...' : activeTab === 'login' ? 'Log In' : activeTab === 'signup' ? 'Create Account' : 'Reset Password'}
                  </button>
                </div>
              )}

            </form>

            {activeTab === 'login' && !successMsg && (
              <div className="mt-6 text-center">
                <button onClick={() => { setActiveTab('reset'); setError(''); }} className="text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                  Forgot your password?
                </button>
              </div>
            )}
            
            {activeTab === 'reset' && !successMsg && (
              <div className="mt-6 text-center">
                <button onClick={() => { setActiveTab('login'); setError(''); }} className="text-sm text-slate-400 hover:text-slate-700 dark:text-slate-300 font-medium transition-colors">
                  Back to login
                </button>
              </div>
            )}

          </div>
        </div>

        <div className="mt-8 text-center text-xs text-slate-500 flex items-center justify-center space-x-2">
          <ShieldCheck className="w-4 h-4" />
          <span>End-to-end encrypted. Passwords are cryptographically hashed.</span>
        </div>
      </div>
    </div>
  );
}
