import { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Trash2, Copy, Check, Users, Server, Activity } from 'lucide-react';
import { useTheme } from '../ThemeContext';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');
const API_URL = `${SERVER_URL}/api/admin`;

export default function AdminCore() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');

  const adminKey = sessionStorage.getItem('x-admin-key');

  useEffect(() => {
    if (!adminKey) {
      navigate('/');
      return;
    }
    fetchUsers();
  }, [adminKey, navigate]);

  const fetchUsers = async () => {
    try {
      const res = await axios.get(`${API_URL}/users`, {
        headers: { 'x-admin-key': adminKey }
      });
      setUsers(res.data.users);
      setLoading(false);
    } catch (err) {
      if (err.response?.status === 403) {
        sessionStorage.removeItem('x-admin-key');
        navigate('/');
      }
      setLoading(false);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleDelete = async (userId) => {
    if (!window.confirm('WARNING: Are you sure you want to permanently delete this user, their API key, and their active WhatsApp Session profile folder?')) return;
    
    try {
      await axios.delete(`${API_URL}/users/${userId}`, {
        headers: { 'x-admin-key': adminKey }
      });
      setUsers(users.filter(u => u.id !== userId));
    } catch (err) {
      alert('Failed to delete user.');
    }
  };

  if (loading) {
    return <div className="h-screen w-screen bg-[#0a0c10] text-red-500 flex items-center justify-center">Verifying Clearance...</div>;
  }

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#0a0c10] text-slate-200' : 'bg-slate-50 text-slate-900'} p-8`}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-red-500 flex items-center">
              <ShieldAlert className="w-8 h-8 mr-3" />
              Nexus Command Center
            </h1>
            <p className={`mt-2 font-mono text-sm ${theme === 'dark' ? 'text-slate-500' : 'text-slate-500'}`}>
              God-mode privileges granted. Handle with absolute care.
            </p>
          </div>
          <div className="flex gap-4">
            <div className={`px-4 py-2 rounded-lg border flex items-center font-bold text-sm ${theme === 'dark' ? 'bg-[#12151a] border-[#1e222b] text-indigo-400' : 'bg-white border-slate-200 text-indigo-600'}`}>
              <Users className="w-4 h-4 mr-2" /> {users.length} Users
            </div>
            <button onClick={() => navigate('/')} className={`px-4 py-2 rounded-lg border font-bold text-sm transition-colors ${theme === 'dark' ? 'bg-[#12151a] border-[#1e222b] hover:bg-[#16191f] text-slate-300' : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700'}`}>
              Exit Matrix
            </button>
          </div>
        </div>

        <div className={`rounded-xl border overflow-hidden shadow-2xl ${theme === 'dark' ? 'border-[#1e222b] bg-[#12151a]' : 'border-slate-200 bg-white'}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`${theme === 'dark' ? 'bg-[#16191f] border-b border-[#1e222b]' : 'bg-slate-100 border-b border-slate-200'} text-xs font-bold uppercase tracking-wider text-slate-500`}>
                  <th className="p-4">ID</th>
                  <th className="p-4">Phone / Account</th>
                  <th className="p-4">Master API Key</th>
                  <th className="p-4 text-center">Chrome Profile</th>
                  <th className="p-4 text-center">Engine State</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${theme === 'dark' ? 'divide-[#1e222b]' : 'divide-slate-200'}`}>
                {users.map(u => (
                  <tr key={u.id} className={`transition-colors ${theme === 'dark' ? 'hover:bg-[#16191f]/50' : 'hover:bg-slate-50'}`}>
                    <td className="p-4 font-mono text-sm text-slate-500">#{u.id}</td>
                    <td className="p-4 font-bold">{u.phone}</td>
                    <td className="p-4">
                      <div className={`flex items-center font-mono text-xs px-3 py-2 rounded-lg border w-max ${theme === 'dark' ? 'bg-[#0a0c10] border-[#1e222b] text-emerald-400' : 'bg-slate-50 border-slate-200 text-emerald-600'}`}>
                        {u.api_key.substring(0, 16)}...
                        <button onClick={() => copyToClipboard(u.api_key, u.id)} className="ml-3 hover:text-white transition-colors">
                          {copied === u.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      {u.hasProfile ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                          <Server className="w-3 h-3 mr-1" /> Stored
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-500/10 text-slate-500 border border-slate-500/20">
                          Empty
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      {u.isCurrentlyActive ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          <Activity className="w-3 h-3 mr-1 animate-pulse" /> Active in RAM
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-500/10 text-slate-500 border border-slate-500/20">
                          Sleeping
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <button onClick={() => handleDelete(u.id)} className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors" title="Delete User & Profile">
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-8 text-center text-slate-500">No users found in database.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
