import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  X, Zap, Plus, Trash2, ToggleLeft, ToggleRight, LoaderCircle, Users, User as UserIcon,
} from 'lucide-react';
import EmojiPicker from './EmojiPicker';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');

const inputCls = (theme) =>
  `w-full rounded-lg border text-sm px-3 py-2.5 outline-none transition-all focus:ring-2 focus:ring-indigo-500/50 ${
    theme === 'dark'
      ? 'bg-[#0a0c10] border-[#262931] text-slate-200 placeholder-slate-500'
      : 'bg-slate-50 border-slate-300 text-slate-800 placeholder-slate-400'
  }`;

// A compact per-chat automation manager. Opened from the chat header, it lists
// every rule that can fire in THIS conversation (chat-scoped + global) and lets
// you create a new rule pre-scoped to this chat with a couple of clicks. Deep
// editing (nested condition groups, placeholders) lives in the Developer studio.
export default function ChatAutomationsModal({ apiKey, theme, chatId, chatName, isGroup, onClose }) {
  const [rules, setRules] = useState([]);
  const [spec, setSpec] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', event: 'message.received', text: '' });

  useEffect(() => {
    if (!apiKey || !chatId) return;
    Promise.all([
      axios.get(`${SERVER_URL}/api/v1/automation?chatId=${encodeURIComponent(chatId)}`, { headers: { 'x-api-key': apiKey } }),
      axios.get(`${SERVER_URL}/api/v1/automation/spec`, { headers: { 'x-api-key': apiKey } }),
    ])
      .then(([rulesRes, specRes]) => {
        setRules(Array.isArray(rulesRes.data?.data) ? rulesRes.data.data : []);
        setSpec(specRes.data?.data);
      })
      .catch(() => setMsg({ ok: false, text: 'Failed to load automation rules.' }))
      .finally(() => setLoading(false));
  }, [apiKey, chatId]);

  // Close on Escape for keyboard accessibility.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const eventMeta = spec?.events?.find(e => e.id === form.event);
  const placeholders = spec?.placeholders || [];

  const createRule = async () => {
    if (!form.name.trim()) { setMsg({ ok: false, text: 'Give the rule a name.' }); return; }
    setBusy(true);
    setMsg(null);
    const condition = eventMeta?.defaultCondition || { field: 'sender', op: 'equals', value: '' };
    try {
      const res = await axios.post(`${SERVER_URL}/api/v1/automation`, {
        name: form.name.trim(),
        enabled: true,
        trigger: { event: form.event, match: 'all', conditions: [condition], chatScope: chatId },
        action: { type: 'send_text', text: form.text, quoted: true, delay: 0 },
      }, { headers: { 'x-api-key': apiKey } });
      setRules(prev => [...prev, res.data?.data]);
      setMsg({ ok: true, text: `Rule created for ${chatName || 'this chat'}. It fires only here.` });
      setCreating(false);
      setForm({ name: '', event: 'message.received', text: '' });
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  };

  const toggleRule = async (rule) => {
    try {
      const res = await axios.put(`${SERVER_URL}/api/v1/automation/${rule.id}`, { enabled: !rule.enabled }, { headers: { 'x-api-key': apiKey } });
      setRules(prev => prev.map(r => (r.id === rule.id ? res.data?.data : r)));
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || err.message });
    }
  };

  const removeRule = async (rule) => {
    if (!window.confirm(`Delete the automation rule "${rule.name}"?`)) return;
    try {
      await axios.delete(`${SERVER_URL}/api/v1/automation/${rule.id}`, { headers: { 'x-api-key': apiKey } });
      setRules(prev => prev.filter(r => r.id !== rule.id));
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || err.message });
    }
  };

  const actionLabel = (type) => ({ send_text: 'send text', send_media: 'send media', send_reaction: 'react', forward_to: 'relay' }[type] || type);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-label={`Automations for ${chatName || 'this chat'}`}
    >
      <div
        onClick={e => e.stopPropagation()}
        className={`w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border shadow-2xl ${theme === 'dark' ? 'bg-[#12151a] border-[#262931]' : 'bg-white border-slate-200'}`}
      >
        <div className={`sticky top-0 z-10 flex items-center gap-3 px-5 py-4 border-b backdrop-blur ${theme === 'dark' ? 'bg-[#12151a]/95 border-[#1e222b]' : 'bg-white/95 border-slate-200'}`}>
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isGroup ? (theme === 'dark' ? 'bg-violet-500/15 text-violet-400' : 'bg-violet-100 text-violet-600') : (theme === 'dark' ? 'bg-indigo-500/15 text-indigo-400' : 'bg-indigo-100 text-indigo-600')}`}>
            {isGroup ? <Users className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <h3 className={`font-bold truncate ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>{chatName || 'This chat'}</h3>
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${theme === 'dark' ? 'text-violet-400' : 'text-violet-600'}`}>
              {isGroup ? 'Group automations' : 'Automations for this contact'}
            </p>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono truncate max-w-[160px] ${theme === 'dark' ? 'bg-[#1e222b] text-slate-400' : 'bg-slate-100 text-slate-500'}`}>{chatId}</span>
          <button onClick={onClose} className={`ml-auto p-2 rounded-lg transition-colors ${theme === 'dark' ? 'text-slate-500 hover:text-slate-300 hover:bg-[#1e222b]' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {msg && (
            <div className={`px-3 py-2 rounded-lg border text-xs ${msg.ok ? (theme === 'dark' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-emerald-50 border-emerald-300 text-emerald-700') : (theme === 'dark' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-rose-50 border-rose-300 text-rose-700')}`}>
              {msg.text}
            </div>
          )}

          {loading ? (
            <div className={`flex items-center justify-center py-10 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
              <LoaderCircle className="w-5 h-5 mr-3 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {rules.length === 0 ? (
                <p className={`text-sm py-6 text-center border border-dashed rounded-xl ${theme === 'dark' ? 'text-slate-500 border-[#262931]' : 'text-slate-400 border-slate-300'}`}>
                  No automation rules here yet. Create one and it will only fire in this {isGroup ? 'group' : 'chat'}.
                </p>
              ) : (
                <ul className="space-y-2">
                  {rules.map(rule => (
                    <li key={rule.id} className={`rounded-xl border p-3 ${theme === 'dark' ? 'border-[#1e222b] bg-[#0a0c10]' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => toggleRule(rule)} className={rule.enabled ? (theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600') : (theme === 'dark' ? 'text-slate-600' : 'text-slate-400')}>
                          {rule.enabled ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                        </button>
                        <div className="min-w-0">
                          <p className={`text-sm font-semibold truncate ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>{rule.name}</p>
                          <p className={`text-[10px] ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                            {spec?.events?.find(e => e.id === rule.trigger.event)?.label || rule.trigger.event} → {actionLabel(rule.action?.type)}
                            {rule.trigger.chatScope ? ' · this chat only' : ' · any chat'}
                          </p>
                        </div>
                        <button onClick={() => removeRule(rule)} className={`ml-auto p-1.5 rounded-lg transition-colors ${theme === 'dark' ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-500/10' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'}`} title="Delete rule">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {!creating && (
                <button onClick={() => setCreating(true)} className={`w-full inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                  <Plus className="w-4 h-4 mr-1.5" /> New rule for this {isGroup ? 'group' : 'contact'}
                </button>
              )}

              {creating && (
                <div className={`rounded-xl border p-4 space-y-3 ${theme === 'dark' ? 'border-indigo-500/30 bg-[#0a0c10]' : 'border-indigo-300 bg-indigo-50/40'}`}>
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-bold uppercase tracking-wider flex items-center ${theme === 'dark' ? 'text-indigo-300' : 'text-indigo-700'}`}>
                      <Zap className="w-3.5 h-3.5 mr-1.5 text-amber-400" /> New rule (fires only here)
                    </p>
                    <button onClick={() => setCreating(false)} className={`text-[10px] font-semibold ${theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700'}`}>Cancel</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={`Rule name, e.g. reply to ${isGroup ? 'this group' : 'this contact'}`} className={inputCls(theme)} />
                    <select value={form.event} onChange={e => setForm(f => ({ ...f, event: e.target.value }))} className={inputCls(theme)}>
                      {spec?.events.map(ev => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={`block text-[10px] font-semibold mb-1 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                      Reply text
                      <span className="ml-1 font-normal opacity-70">— placeholders: {placeholders.slice(0, 8).map(p => (
                        <button key={p.token} type="button" title={p.label} onClick={() => setForm(f => ({ ...f, text: `${f.text}${f.text && !f.text.endsWith(' ') ? ' ' : ''}${p.token}` }))} className={`px-1.5 py-0.5 mx-0.5 rounded font-mono text-[9px] transition-colors ${theme === 'dark' ? 'bg-[#1e222b] text-indigo-300 hover:text-indigo-200' : 'bg-slate-200 text-indigo-600 hover:bg-slate-300'}`}>
                          {p.token}
                        </button>
                      ))}</span>
                    </label>
                    <textarea rows={2} value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} placeholder="e.g. Thanks {name}! I’ll reply shortly." className={`${inputCls(theme)} resize-none`} />
                  </div>
                  <button onClick={createRule} disabled={busy} className={`w-full inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                    {busy ? <LoaderCircle className="w-4 h-4 mr-1.5 animate-spin" /> : <Zap className="w-4 h-4 mr-1.5" />}
                    {busy ? 'Creating…' : 'Create rule'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}