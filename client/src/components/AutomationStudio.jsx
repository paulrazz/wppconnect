import { useState, useEffect, useSyncExternalStore, useCallback } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Plus, Trash2, Pencil, Check, X, PlayCircle, LoaderCircle, CornerDownRight,
  Sparkles, Activity, ToggleLeft, ToggleRight, Layers, AlertTriangle,
} from 'lucide-react';
import liveStream from '../liveStream';
import EmojiPicker from './EmojiPicker';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');

const inputCls = (theme) =>
  `w-full rounded-lg border text-sm px-3 py-2.5 outline-none transition-all focus:ring-2 focus:ring-indigo-500/50 ${
    theme === 'dark'
      ? 'bg-[#0a0c10] border-[#262931] text-slate-200 placeholder-slate-500'
      : 'bg-slate-50 border-slate-300 text-slate-800 placeholder-slate-400'
  }`;

const emptyDraft = () => ({
  name: '',
  enabled: true,
  trigger: { event: 'message.received', match: 'all', conditions: [{ field: 'text', op: 'contains', value: '' }] },
  action: { type: 'send_text', text: '', quoted: true, delay: 0 },
});

// Rules loaded from the API must always carry a usable trigger. A legacy/
// malformed rule (e.g. `trigger` as a string) must never crash the page.
const normalizeRule = (rule) => {
  const trigger = rule?.trigger && typeof rule.trigger === 'object' && Array.isArray(rule.trigger.conditions)
    ? rule.trigger
    : { event: 'message.received', match: 'all', conditions: [] };
  return {
    ...rule,
    trigger: { ...trigger, match: trigger.match === 'any' ? 'any' : 'all' },
  };
};

function Chip({ active, tone = 'indigo', children }) {
  const tones = {
    indigo: active ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/40' : 'bg-[#0a0c10] text-slate-400 border-[#262931]',
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${tones.indigo}`}>
      {children}
    </span>
  );
}

function ActionBadge({ rule, theme }) {
  const a = rule.action || {};
  const label = ({ send_text: 'Reply text', send_media: 'Send media', send_reaction: 'React', forward_to: 'Relay to chat' })[a.type] || a.type;
  const detail =
    a.type === 'send_text' ? a.text || '…' :
    a.type === 'send_media' ? (a.caption || a.filename || 'media') :
    a.type === 'send_reaction' ? a.reaction || '…' :
    a.type === 'forward_to' ? a.to : '';
  return (
    <span className={`flex items-center gap-1 text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
      <CornerDownRight className={`w-3.5 h-3.5 ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`} />
      <span className="font-semibold">{label}</span>
      {detail && <span className={`truncate max-w-[220px] ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>— {detail}</span>}
      {Number(a.delay) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${theme === 'dark' ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-100 text-amber-700'}`}>{a.delay}s delay</span>}
    </span>
  );
}

function ConditionLabel({ condition, fieldLabel, opLabel }) {
  const value =
    typeof condition.value === 'boolean' ? (condition.value ? 'true' : 'false')
    : Array.isArray(condition.value) ? condition.value.join(', ')
    : String(condition.value ?? '');
  return (
    <span className="font-mono text-xs">
      <span className="text-sky-400">{fieldLabel}</span>
      <span className={opLabel === 'is_true' || opLabel === 'is_false' ? 'text-violet-400' : 'text-indigo-400'}> {opLabel}</span>
      {value && <span className="text-emerald-400"> “{value.length > 24 ? `${value.slice(0, 24)}…` : value}”</span>}
    </span>
  );
}

export default function AutomationStudio({ apiKey, theme, onDraftChange }) {
  const [rules, setRules] = useState([]);
  const [spec, setSpec] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [testing, setTesting] = useState({ id: null, busy: false, result: null, text: '', sender: '' });

  const liveVersion = useSyncExternalStore(
    (cb) => liveStream.subscribe(cb),
    () => liveStream.version
  );
  void liveVersion;
  const events = liveStream.getAutomationEvents();

  const load = useCallback(() => {
    axios.get(`${SERVER_URL}/api/v1/automation`, { headers: { 'x-api-key': apiKey } })
      .then(res => setRules((Array.isArray(res.data?.data) ? res.data.data : []).map(normalizeRule)))
      .catch(() => setRules([]));
    axios.get(`${SERVER_URL}/api/v1/automation/spec`, { headers: { 'x-api-key': apiKey } })
      .then(res => setSpec(res.data?.data))
      .catch(() => {});
  }, [apiKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (onDraftChange) onDraftChange(draft);
  }, [onDraftChange, draft]);

  const startNew = () => { setEditingId(null); setDraft(emptyDraft()); setMsg(null); };
  const startEdit = (rule) => { setEditingId(rule.id); setDraft(normalizeRule(JSON.parse(JSON.stringify(rule)))); setMsg(null); };

  const patchDraft = (patch) => setDraft(prev => ({ ...(prev || emptyDraft()), ...patch }));
  const patchTrigger = (patch) => setDraft(prev => ({ ...prev, trigger: { ...prev.trigger, ...patch } }));
  const patchAction = (patch) => setDraft(prev => ({ ...prev, action: { ...prev.action, ...patch } }));

  const updateCondition = (index, patch) => setDraft(prev => {
    const conditions = prev.trigger.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c));
    return { ...prev, trigger: { ...prev.trigger, conditions } };
  });

  const addCondition = () => setDraft(prev => {
    const meta = spec?.events?.find(e => e.id === prev.trigger.event);
    const condition = meta?.defaultCondition || prev.trigger.conditions[prev.trigger.conditions.length - 1] || { field: 'sender', op: 'equals', value: '' };
    return { ...prev, trigger: { ...prev.trigger, conditions: [...prev.trigger.conditions, { ...condition, value: typeof condition.value === 'boolean' ? false : '' }] } };
  });

  const removeCondition = (index) => setDraft(prev => ({
    ...prev,
    trigger: { ...prev.trigger, conditions: prev.trigger.conditions.filter((_, i) => i !== index) },
  }));

  const fieldLabel = (field) => spec?.fields?.find(f => f.field === field)?.label || field;
  const opLabel = (op) => spec?.operatorMeta?.[op]?.label || op;

  const save = async () => {
    if (!draft || !draft.name.trim() || !draft.trigger?.conditions?.some(c => c.value !== '' || typeof c.value === 'boolean')) {
      setMsg({ ok: false, text: 'Give the rule a name and at least one populated condition.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (editingId) {
        const res = await axios.put(`${SERVER_URL}/api/v1/automation/${editingId}`, draft, { headers: { 'x-api-key': apiKey } });
        setRules(prev => prev.map(r => (r.id === editingId ? normalizeRule(res.data?.data) : r)));
        setMsg({ ok: true, text: 'Rule updated.' });
      } else {
        const res = await axios.post(`${SERVER_URL}/api/v1/automation`, draft, { headers: { 'x-api-key': apiKey } });
        setRules(prev => [...prev, normalizeRule(res.data?.data)]);
        setMsg({ ok: true, text: 'Rule created. It fires on matching incoming messages now.' });
      }
      setDraft(null);
      setEditingId(null);
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  };

  const toggleRule = async (rule) => {
    try {
      const res = await axios.put(`${SERVER_URL}/api/v1/automation/${rule.id}`, { enabled: !rule.enabled }, { headers: { 'x-api-key': apiKey } });
      setRules(prev => prev.map(r => (r.id === rule.id ? normalizeRule(res.data?.data) : r)));
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || err.message });
    }
  };

  const removeRule = async (rule) => {
    if (!window.confirm(`Delete the automation rule "${rule.name}"?`)) return;
    try {
      await axios.delete(`${SERVER_URL}/api/v1/automation/${rule.id}`, { headers: { 'x-api-key': apiKey } });
      setRules(prev => prev.filter(r => r.id !== rule.id));
      if (editingId === rule.id) { setDraft(null); setEditingId(null); }
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || err.message });
    }
  };

  const runTest = async (rule) => {
    const target = testing.id === rule.id ? testing : { id: rule.id, busy: false, result: null, text: '', sender: '' };
    setTesting({ ...target, busy: true, result: null });
    try {
      const res = await axios.post(`${SERVER_URL}/api/v1/automation/${rule.id}/test`, { text: testing.text, sender: testing.sender }, { headers: { 'x-api-key': apiKey } });
      setTesting(prev => ({ ...prev, busy: false, result: res.data?.data?.match }));
    } catch (err) {
      setTesting(prev => ({ ...prev, busy: false, result: { error: err.response?.data?.error || err.message } }));
    }
  };

  const openTest = (rule) => setTesting(prev => (prev.id === rule.id ? { id: null, busy: false, result: null, text: '', sender: '' } : { id: rule.id, busy: false, result: null, text: '', sender: prev.text && prev.id === rule.id ? prev.text : '' }));

  const actionMeta = spec?.actions?.find(a => a.type === draft?.action?.type);
  const isBoolField = (field) => spec?.operators?.[field]?.includes('is_true') || false;
  const eventMeta = spec?.events?.find(e => e.id === draft?.trigger?.event);
  const eventFields = (eventMeta?.fields || []).map(id => spec?.fields?.find(f => f.field === id)).filter(Boolean);
  const switchEvent = (event) => {
    const meta = spec.events.find(e => e.id === event);
    const condition = meta?.defaultCondition || { field: 'sender', op: 'equals', value: '' };
    patchTrigger({ event, conditions: [condition] });
  };

  if (!spec) {
    return (
      <div className={`flex items-center justify-center py-24 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
        <LoaderCircle className="w-5 h-5 mr-3 animate-spin" /> Loading automation playground…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <p className={`text-lg leading-relaxed ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
        Build automations from triggers and conditions — “when this happens, do that”. Rules can react to incoming
        messages, mentions, quotes, reactions, deletions, statuses, missed calls and group member changes. Each rule
        is stored per API key and survives restarts.
      </p>

      {msg && (
        <div className={`px-4 py-3 rounded-lg border text-sm ${msg.ok ? (theme === 'dark' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-emerald-50 border-emerald-300 text-emerald-700') : (theme === 'dark' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-rose-50 border-rose-300 text-rose-700')}`}>
          {msg.text}
        </div>
      )}

      {/* Live activity feed */}
      <div className={`p-6 rounded-xl border ${theme === 'dark' ? 'bg-[#12151a] border-[#1e222b]' : 'bg-white border-slate-200 shadow-sm'}`}>
        <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 flex items-center ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>
          <Activity className="w-4 h-4 mr-2 text-indigo-500" /> Live rule activity
        </h3>
        {events.length === 0 ? (
          <p className={`text-sm py-4 text-center ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
            Nothing has fired yet. Send a matching message to a connected chat and watch it appear here in real time.
          </p>
        ) : (
          <ul className="space-y-2">
            {events.slice(0, 8).map((event, i) => (
              <li key={`${event.at || event.receivedAt}-${i}`} className={`flex items-center gap-2 text-xs py-1.5 px-3 rounded-lg border ${theme === 'dark' ? 'border-[#1e222b] bg-[#0a0c10]' : 'border-slate-200 bg-slate-50'}`}>
                <Sparkles className={`w-3.5 h-3.5 ${event.status === 'ran' ? (theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600') : (theme === 'dark' ? 'text-rose-400' : 'text-rose-600')}`} />
                <span className={`font-semibold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>{event.name}</span>
                {event.status === 'ran'
                  ? <span className={`${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>ran {event.actionType}</span>
                  : <span className={`text-rose-400`}>{event.error}</span>}
                <span className={`ml-auto ${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>
                  {new Date(event.at || event.receivedAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Rules list */}
      <div className={`p-6 rounded-xl border ${theme === 'dark' ? 'bg-[#12151a] border-[#1e222b]' : 'bg-white border-slate-200 shadow-sm'}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>
            <Layers className="w-4 h-4 mr-2 text-indigo-500" /> Your Rules ({rules.length})
          </h3>
          <button onClick={startNew} className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
            <Plus className="w-4 h-4 mr-1" /> New rule
          </button>
        </div>

        {rules.length === 0 ? (
          <p className={`text-sm py-6 text-center ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
            No rules yet. Click “New rule” and build your first automation.
          </p>
        ) : (
          <ul className="space-y-3">
            {rules.map(rule => (
              <li key={rule.id} className={`p-4 rounded-xl border ${theme === 'dark' ? 'border-[#1e222b] bg-[#0a0c10]' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleRule(rule)}
                    title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                    className={rule.enabled ? (theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600') : (theme === 'dark' ? 'text-slate-600' : 'text-slate-400')}
                  >
                    {rule.enabled ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold truncate ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>{rule.name}</p>
                      <Chip active tone="indigo">{rule.enabled ? 'On' : 'Off'}</Chip>
                      {Number(rule.runCount) > 0 && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${theme === 'dark' ? 'bg-[#1e222b] text-emerald-400' : 'bg-emerald-100 text-emerald-700'}`}>
                          fired {rule.runCount}×
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wide ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>When</span>
                        {rule.trigger.conditions.length === 0 ? (
                          <span className={`text-xs italic ${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>
                            {rule.trigger.event === 'message.received' ? 'Any incoming message' : (spec.events.find(e => e.id === rule.trigger.event)?.label || rule.trigger.event)}
                          </span>
                        ) : rule.trigger.conditions.map((c, i) => (
                          <span key={i} className="flex items-center gap-1.5">
                            {i > 0 && (
                              <span className={`text-[10px] font-black uppercase ${rule.trigger.match === 'all' ? 'text-indigo-400' : 'text-amber-400'}`}>{rule.trigger.match === 'all' ? 'AND' : 'OR'}</span>
                            )}
                            <ConditionLabel condition={c} fieldLabel={fieldLabel(c.field)} opLabel={opLabel(c.op)} />
                          </span>
                        ))}
                      </div>
                      <ActionBadge rule={rule} theme={theme} />
                      <div className="flex flex-wrap items-center gap-3 mt-0.5">
                        {rule.lastRunAt && <span className={`text-[10px] ${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>Last run {new Date(rule.lastRunAt).toLocaleString()}</span>}
                        <div className="flex gap-1 ml-auto">
                          <button onClick={() => openTest(rule)} className={`inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${theme === 'dark' ? 'text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10' : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50'}`}>
                            <PlayCircle className="w-3.5 h-3.5 mr-1" /> Test match
                          </button>
                          <button onClick={() => startEdit(rule)} className={`inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${theme === 'dark' ? 'text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10' : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50'}`}>
                            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                          </button>
                          <button onClick={() => removeRule(rule)} className={`inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${theme === 'dark' ? 'text-slate-400 hover:text-rose-400 hover:bg-rose-500/10' : 'text-slate-500 hover:text-rose-600 hover:bg-rose-50'}`}>
                            <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                          </button>
                        </div>
                      </div>
                    </div>

                    {testing.id === rule.id && (
                      <div className={`mt-3 pt-3 border-t ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-200'}`}>
                        <p className={`text-[10px] font-bold uppercase tracking-wide mb-2 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                          Simulate this trigger (the action is <span className="text-indigo-400">not</span> executed)
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            value={testing.sender}
                            onChange={e => setTesting(prev => ({ ...prev, sender: e.target.value }))}
                            placeholder="Sender, e.g. 2348012345678@c.us"
                            className={`${inputCls(theme)} font-mono text-xs`}
                          />
                          <input
                            value={testing.text}
                            onChange={e => setTesting(prev => ({ ...prev, text: e.target.value }))}
                            placeholder="Message text, e.g. order 42"
                            className={`${inputCls(theme)} font-mono text-xs`}
                          />
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          <button
                            onClick={() => runTest(rule)}
                            disabled={testing.busy}
                            className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition-all disabled:opacity-50"
                          >
                            {testing.busy ? <LoaderCircle className="w-3.5 h-3.5 mr-1 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5 mr-1" />}
                            Run check
                          </button>
                          {testing.result && testing.result.error ? (
                            <span className="text-xs text-rose-400">{testing.result.error}</span>
                          ) : testing.result ? (
                            <span className={`text-xs font-semibold ${testing.result.matched ? (theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600') : (theme === 'dark' ? 'text-slate-400' : 'text-slate-500')}`}>
                              {testing.result.matched ? '✓ Would fire this rule' : '✗ Would not fire'}
                              <span className={`ml-2 font-normal ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                                {testing.result.conditions?.filter(c => c.passed).length}/{testing.result.conditions?.length} conditions true
                              </span>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Builder */}
      <AnimatePresence>
        {draft && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className={`p-6 rounded-xl border ${theme === 'dark' ? 'bg-[#14181f] border-indigo-500/30' : 'bg-white border-indigo-300 shadow-lg shadow-indigo-500/5'}`}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>
                <Zap className="w-4 h-4 mr-2 text-amber-400" /> {editingId ? 'Edit rule' : 'New rule'}
              </h3>
              <button onClick={() => { setDraft(null); setEditingId(null); }} className={`p-1.5 rounded-lg transition-colors ${theme === 'dark' ? 'text-slate-500 hover:text-slate-300 hover:bg-[#1e222b]' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Rule name</label>
                <input
                  value={draft.name}
                  onChange={e => patchDraft({ name: e.target.value })}
                  placeholder="e.g. Auto-reply to price inquiries"
                  className={inputCls(theme)}
                />
              </div>
              <div className="flex items-end">
                <label className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer select-none transition-colors w-full sm:w-auto ${draft.enabled ? (theme === 'dark' ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-emerald-50 border-emerald-400') : (theme === 'dark' ? 'bg-[#0a0c10] border-[#262931]' : 'bg-slate-50 border-slate-200')}`}>
                  <input type="checkbox" checked={draft.enabled} onChange={e => patchDraft({ enabled: e.target.checked })} className="accent-emerald-600" />
                  <span className={`text-sm font-medium ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Enabled</span>
                </label>
              </div>
            </div>

            {/* WHEN */}
            <div className="mb-5">
              <div className={`flex items-center flex-wrap gap-2 rounded-t-xl border-t border-x px-4 py-2 ${theme === 'dark' ? 'border-[#262931] bg-[#0f1115] text-slate-300' : 'border-slate-300 bg-slate-100 text-slate-700'}`}>
                <span className="text-[10px] font-black uppercase tracking-wider mr-1 text-indigo-400">When</span>
                <select
                  value={draft.trigger.event}
                  onChange={e => switchEvent(e.target.value)}
                  className={`rounded-lg border text-sm font-semibold px-2 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500/50 ${theme === 'dark' ? 'bg-[#0a0c10] border-[#262931] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                >
                  {spec.events.map(ev => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
                </select>
                {eventMeta?.description && (
                  <span className={`text-xs ml-auto ${theme === 'dark' ? 'text-slate-500' : 'text-slate-500'}`}>{eventMeta.description}</span>
                )}
              </div>
              <div className={`rounded-b-xl border overflow-hidden ${theme === 'dark' ? 'border-[#262931]' : 'border-slate-300'}`}>
                <div className="space-y-2 p-4">
                  {draft.trigger.conditions.map((condition, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <span className={`text-[10px] font-black uppercase w-8 ${draft.trigger.match === 'all' ? (index === 0 ? 'text-slate-500' : 'text-indigo-400') : (index === 0 ? 'text-slate-500' : 'text-amber-400')}`}>
                        {index === 0 ? 'If' : draft.trigger.match === 'all' ? 'And' : 'Or'}
                      </span>
                      <select
                        value={condition.field}
                        onChange={e => {
                          const field = e.target.value;
                          const ops = spec.operators[field] || ['equals'];
                          updateCondition(index, { field, op: isBoolField(field) ? 'is_true' : ops[0], value: isBoolField(field) ? true : '' });
                        }}
                        className={`rounded-lg border text-sm px-2 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50 ${theme === 'dark' ? 'bg-[#0a0c10] border-[#262931] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                      >
                        {eventFields.map(f => <option key={f.field} value={f.field}>{f.label}</option>)}
                      </select>
                      <select
                        value={condition.op}
                        onChange={e => updateCondition(index, { op: e.target.value })}
                        className={`rounded-lg border text-sm px-2 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50 ${theme === 'dark' ? 'bg-[#0a0c10] border-[#262931] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                      >
                        {(spec.operators[condition.field] || []).map(op => <option key={op} value={op}>{opLabel(op)}</option>)}
                      </select>
                      {isBoolField(condition.field) ? (
                        <select
                          value={condition.value ? 'true' : 'false'}
                          onChange={e => updateCondition(index, { value: e.target.value === 'true' })}
                          className={`rounded-lg border text-sm px-2 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50 ${theme === 'dark' ? 'bg-[#0a0c10] border-[#262931] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input
                          value={condition.value}
                          onChange={e => updateCondition(index, { value: e.target.value })}
                          placeholder={spec.operatorMeta[condition.op]?.example || 'value'}
                          className={`${inputCls(theme)} flex-1 min-w-[160px]`}
                        />
                      )}
                      <button
                        onClick={() => removeCondition(index)}
                        disabled={draft.trigger.conditions.length <= 1}
                        className={`p-2 rounded-lg transition-colors disabled:opacity-30 ${theme === 'dark' ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-500/10' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'}`}
                        title="Remove condition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={addCondition}
                      disabled={draft.trigger.conditions.length >= (spec.maxConditions || 10)}
                      className={`inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${theme === 'dark' ? 'text-indigo-300 hover:bg-indigo-500/10' : 'text-indigo-600 hover:bg-indigo-50'}`}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add condition
                    </button>
                    <div className={`flex items-center rounded-lg border overflow-hidden text-xs ${theme === 'dark' ? 'border-[#262931]' : 'border-slate-300'}`}>
                      <button
                        onClick={() => patchTrigger({ match: 'all' })}
                        className={`px-3 py-1.5 font-semibold transition-colors ${draft.trigger.match === 'all' ? (theme === 'dark' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-100 text-indigo-700') : (theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700')}`}
                      >
                        ALL must match
                      </button>
                      <button
                        onClick={() => patchTrigger({ match: 'any' })}
                        className={`px-3 py-1.5 font-semibold transition-colors ${draft.trigger.match === 'any' ? (theme === 'dark' ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700') : (theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700')}`}
                      >
                        ANY may match
                      </button>
                    </div>
                    {spec.fields.find(f => f.field === (draft.trigger.conditions[draft.trigger.conditions.length - 1]?.field))?.hint && (
                      <p className={`text-[10px] ${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>
                        {spec.fields.find(f => f.field === draft.trigger.conditions[draft.trigger.conditions.length - 1].field).hint}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* THEN */}
            <div className="mb-5">
              <div className={`flex items-center rounded-t-xl border-t border-x px-4 py-2 ${theme === 'dark' ? 'border-[#262931] bg-[#0f1115] text-slate-300' : 'border-slate-300 bg-slate-100 text-slate-700'}`}>
                <span className="text-[10px] font-black uppercase tracking-wider mr-3 text-emerald-400">Then</span>
                <select
                  value={draft.action.type}
                  onChange={e => {
                    const type = e.target.value;
                    const meta = spec.actions.find(a => a.type === type);
                    const base = {};
                    meta.fields.forEach(f => { base[f.name] = 'default' in f ? f.default : (f.type === 'number' ? 0 : f.type === 'bool' ? true : ''); });
                    patchAction({ type, ...base });
                  }}
                  className={`rounded-lg border text-sm px-2 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50 ${theme === 'dark' ? 'bg-[#0a0c10] border-[#262931] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                >
                  {spec.actions.map(a => <option key={a.type} value={a.type}>{a.label}</option>)}
                </select>
              </div>
              <div className={`rounded-b-xl border space-y-4 p-4 ${theme === 'dark' ? 'border-[#262931]' : 'border-slate-300'}`}>
                {actionMeta?.fields.map(field => {
                  const value = draft.action[field.name];
                  if (field.type === 'bool') {
                    return (
                      <label key={field.name} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer select-none transition-colors w-fit ${value ? (theme === 'dark' ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-indigo-50 border-indigo-400') : (theme === 'dark' ? 'bg-[#0a0c10] border-[#262931]' : 'bg-slate-50 border-slate-200')}`}>
                        <input type="checkbox" checked={value} onChange={e => patchAction({ [field.name]: e.target.checked })} className="accent-indigo-600" />
                        <span className={`text-sm ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>{field.label}</span>
                      </label>
                    );
                  }
                  if (field.type === 'number') {
                    return (
                      <div key={field.name}>
                        <label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>{field.label}</label>
                        <input
                          type="number"
                          min={field.min}
                          max={field.max}
                          value={value}
                          onChange={e => patchAction({ [field.name]: e.target.value })}
                          className={`${inputCls(theme)} sm:max-w-[160px]`}
                        />
                      </div>
                    );
                  }
                  if (field.type === 'textarea') {
                    return (
                      <div key={field.name}>
                        <label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                          {field.label}
                          <span className="ml-1 font-normal opacity-60">
                            {' '}— placeholders: {spec.placeholders.map(p => (
                              <button key={p.token} type="button" title={p.label} onClick={() => patchAction({ [field.name]: `${value}${value && !String(value).endsWith(' ') ? ' ' : ''}${p.token}` })} className={`px-1.5 py-0.5 mx-0.5 rounded font-mono text-[10px] transition-colors ${theme === 'dark' ? 'bg-[#1e222b] text-indigo-300 hover:text-indigo-200' : 'bg-slate-200 text-indigo-600 hover:bg-slate-300'}`}>
                                {p.token}
                              </button>
                            ))}
                          </span>
                        </label>
                        <textarea
                          rows={field.name === 'text' ? 3 : 2}
                          value={value}
                          onChange={e => patchAction({ [field.name]: e.target.value })}
                          placeholder={field.name === 'caption' ? 'Optional caption…' : "e.g. Thanks {name}! We got your message: {text}"}
                          className={`${inputCls(theme)} resize-none`}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={field.name}>
                      <label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>{field.label}</label>
                      <input
                        value={value}
                        onChange={e => patchAction({ [field.name]: e.target.value })}
                        placeholder={field.name === 'media' ? 'https://… or data:image/png;base64,…' : field.name === 'to' ? '2348012345678' : field.name === 'reaction' ? '👍' : ''}
                        className={`${inputCls(theme)} font-mono text-xs`}
                      />
                    </div>
                  );
                })}

                {draft.action.type === 'send_reaction' && (
                  <EmojiPicker
                    theme={theme}
                    gridCols="grid-cols-8"
                    heightClass="max-h-56"
                    selected={draft.action.reaction}
                    onSelect={(emo) => patchAction({ reaction: draft.action.reaction === emo ? '' : emo })}
                  />
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={busy}
                className={`flex items-center justify-center px-6 py-2.5 rounded-xl font-bold transition-all disabled:opacity-50 ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200'}`}
              >
                {busy ? <LoaderCircle className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create rule'}
              </button>
              <button
                onClick={() => { setDraft(null); setEditingId(null); }}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${theme === 'dark' ? 'text-slate-400 hover:text-slate-200 hover:bg-[#1e222b]' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
              >
                Cancel
              </button>
              {(spec.placeholders || []).length > 0 && (
                <span className={`hidden lg:flex items-center gap-1 text-[10px] ml-auto ${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  Message rules never reply to their own replies — no loops.
                </span>
              )}
            </div>

            {draft.trigger.conditions.some(c => c.op === 'matches_regex') && (
              <div className={`mt-4 px-4 py-3 rounded-lg border text-xs flex items-center gap-2 ${theme === 'dark' ? 'bg-amber-500/5 border-amber-500/20 text-amber-400/90' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Regular expressions are evaluated on every message. Keep patterns simple and anchor them (e.g. ^…) to avoid surprises.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}