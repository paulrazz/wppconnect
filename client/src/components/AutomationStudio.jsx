import { useState, useEffect, useSyncExternalStore, useCallback } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Plus, Trash2, Pencil, Check, X, PlayCircle, LoaderCircle, CornerDownRight,
  Sparkles, Activity, ToggleLeft, ToggleRight, Layers, AlertTriangle, ContactRound,
} from 'lucide-react';
import liveStream from '../liveStream';
import EmojiPicker from './EmojiPicker';
import { MEDIA_LABELS } from '../messageText';
import ContactPickerModal from './ContactPickerModal';

const PROMPT_TEMPLATES = [
  { label: '-- Select a Persona Template --', value: '' },
  { label: 'Intelligent Mode', value: 'You are me. Act as the human owner of this WhatsApp account. Before replying, silently analyze the user\'s emotional state, intent, and relationship to you based on the conversation history. Dynamically adapt your personality to fit the exact situation:\n- If they are a friend joking around, be casual and sarcastic.\n- If they are a customer with a problem, be empathetic and professional.\n- If they are asking a quick question, be brief and direct.\nAlways perfectly mirror their language, slang, and casing. Never reveal you are an AI.' },
  { label: 'The Natural Clone (Default)', value: 'You are me. Act as the human owner of this WhatsApp account. Read the conversation context, match the exact language, tone, and casing of the person you are speaking to, and reply naturally. Keep it concise. Never reveal you are an AI.' },
  { label: 'The Busy Professional', value: 'You are me. Act as the human owner of this account. You are currently very busy. Acknowledge their message, match their language, and give a brief, polite, but slightly rushed response.' },
  { label: 'The Friendly & Warm Clone', value: 'You are me. Act as the human owner of this account. Match the other person\'s language and tone, but keep your responses warm, friendly, and approachable.' },
  { label: 'The Strictly Business Clone', value: 'You are me. Act as the human owner of this account. Respond in a highly professional, direct, and no-nonsense manner. Match their language but keep it strictly business.' },
  { label: 'The Casual & Chill Clone', value: 'You are me. Act as the human owner of this account. Match their language and use a very laid-back, casual, and relaxed tone. Use lowercase letters if they do.' },
  { label: 'The Sarcastic Clone', value: 'You are me. Act as the human owner of this account. Match their language, but respond with dry humor, mild sarcasm, and playful banter.' },
  { label: 'The Apologetic Clone', value: 'You are me. Act as the human owner of this account. Match their language, but apologize for being slow to reply. Keep it very polite and human.' },
  { label: 'The Sales Closer', value: 'You are me. Act as the human owner of this account. Match their language and subtly guide the conversation toward closing a deal or answering their product questions confidently.' },
  { label: 'The Empathetic Listener', value: 'You are me. Act as the human owner of this account. Match their language and tone. Show strong empathy, validate their feelings, and be deeply understanding.' },
  { label: 'The Problem Solver', value: 'You are me. Act as the human owner of this account. Match their language. Focus entirely on providing a quick, actionable solution to whatever issue they just raised.' },
  { label: 'The Vague & Mysterious Clone', value: 'You are me. Act as the human owner of this account. Match their language, but give slightly vague, non-committal answers. Keep them guessing.' },
  { label: 'The Over-Explainer', value: 'You are me. Act as the human owner of this account. Match their language, but provide highly detailed, thorough, and lengthy explanations to their questions.' },
  { label: 'The Emojifier', value: 'You are me. Act as the human owner of this account. Match their language and tone, but use a lot of expressive emojis in your response.' },
  { label: 'The Group Admin (Strict)', value: 'You are me, acting as the human admin of this group. Enforce the group rules strictly, but match the language of the group. Do not tolerate spam.' },
  { label: 'The Group Admin (Chill)', value: 'You are me, acting as the human admin of this group. Keep the group vibe relaxed and fun. Match the language of the group.' },
  { label: 'The Tech Wizard', value: 'You are me. Act as the human owner of this account. Match their language. You are highly technical, so explain things using accurate terminology but keep it human.' },
  { label: 'The Concierge', value: 'You are me. Act as the human owner of this account. Match their language. Be extremely accommodating, eager to help, and highly hospitable.' },
  { label: 'The Direct Answerer', value: 'You are me. Act as the human owner of this account. Match their language. Answer their question directly with zero filler words or pleasantries.' },
  { label: 'The Mirror', value: 'You are me. Act exactly like the person you are talking to. Mirror their exact sentence structure, slang, energy level, and language.' },
  { label: 'The Evasive Politician', value: 'You are me. Act as the human owner of this account. Match their language. Answer their questions politely but avoid committing to any specific details or promises.' }
];

const SERVER_URL =  (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');

const selectCls = (theme) =>
  `rounded-lg border text-sm px-2 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50 ${
    theme === 'dark' ? 'bg-[#0a0c10] border-[#262931] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'
  }`;

const inputCls = (theme) =>
  `w-full rounded-lg border text-sm px-3 py-2.5 outline-none transition-all focus:ring-2 focus:ring-indigo-500/50 ${
    theme === 'dark'
      ? 'bg-[#0a0c10] border-[#262931] text-slate-200 placeholder-slate-500'
      : 'bg-slate-50 border-slate-300 text-slate-800 placeholder-slate-400'
  }`;

const emptyDraft = (chatScope) => ({
  name: '',
  enabled: true,
  trigger: { event: 'message.received', match: 'all', conditions: [{ field: 'text', op: 'contains', value: '' }], ...(chatScope ? { chatScope } : {}) },
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

// Count leaf conditions across a tree (root array or nested group).
const countLeaves = (conds) => (conds || []).reduce((n, c) => n + (c.field ? 1 : countLeaves(c.conditions)), 0);
// True when the tree contains at least one populated leaf value.
const hasAnyValue = (conds) => (conds || []).some(c => c.field ? (c.value !== '' && c.value != null) : hasAnyValue(c.conditions));
// Walk `path` (array of child indexes) to find the node at that position.
const getNode = (conditions, path) => {
  let node = conditions[path[0]];
  for (let i = 1; i < path.length; i++) node = node.conditions[path[i]];
  return node;
};
// The child array that owns a path (root array for [], a group's children otherwise).
const getContainer = (conditions, path) => (path.length ? getNode(conditions, path).conditions : conditions);

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
  // Nested group: render "( … )" with its own all/any joiner between children.
  if (condition.conditions) {
    return (
      <span className="font-mono text-xs">
        <span className="text-violet-400">(</span>
        {condition.conditions.map((c, i) => (
          <span key={i}>
            {i > 0 && (
              <span className={`mx-1 text-[10px] font-black ${condition.match === 'all' ? 'text-indigo-400' : 'text-amber-400'}`}>
                {condition.match === 'all' ? 'AND' : 'OR'}
              </span>
            )}
            <ConditionLabel condition={c} fieldLabel={fieldLabel} opLabel={opLabel} />
          </span>
        ))}
        <span className="text-violet-400">)</span>
      </span>
    );
  }
  const value =
    typeof condition.value === 'boolean' ? (condition.value ? 'true' : 'false')
    : Array.isArray(condition.value) ? condition.value.join(', ')
    : String(condition.value ?? '');
  return (
    <span className="font-mono text-xs">
      <span className="text-sky-400">{typeof fieldLabel === 'function' ? fieldLabel(condition.field) : fieldLabel}</span>
      <span className={opLabel === 'is_true' || opLabel === 'is_false' ? 'text-violet-400' : 'text-indigo-400'}> {opLabel}</span>
      {value && <span className="text-emerald-400"> “{value.length > 24 ? `${value.slice(0, 24)}…` : value}”</span>}
    </span>
  );
}

// Recursive condition editor: renders a leaf row (field/op/value) OR a nested
// group box (its own all/any joiner + child conditions). `path` tracks the
// child indexes from the root so edits hit the exact node. Nesting supports
// "(A and B) or (C and D)" - the whole point of groups.
function ConditionNodeEditor({
  node, path, label, match, depth,
  spec, eventFields, theme,
  fieldLabel, opLabel, isBoolField, isEnumField, isIdentityField, isNameField, shortId, setPickerOpen, selectCls,
  updateNode, removeNode, addLeaf, addGroup, canRemoveAll,
}) {
  if (!node?.conditions) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[10px] font-black uppercase w-8 ${match === 'all' ? 'text-indigo-400' : 'text-amber-400'}`}>{label}</span>
        <select
          value={node.field}
          onChange={e => {
            const field = e.target.value;
            const ops = spec.operators[field] || ['equals'];
            updateNode(path, { field, op: isBoolField(field) ? 'is_true' : ops[0], value: isBoolField(field) ? true : '' });
          }}
          className={`rounded-lg border text-sm px-2 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50 ${theme === 'dark' ? 'bg-[#0a0c10] border-[#262931] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
        >
          {eventFields.map(f => <option key={f.field} value={f.field}>{f.label}</option>)}
        </select>
        <select
          value={node.op}
          onChange={e => updateNode(path, { op: e.target.value })}
          className={`rounded-lg border text-sm px-2 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50 ${theme === 'dark' ? 'bg-[#0a0c10] border-[#262931] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
        >
          {(spec.operators[node.field] || []).map(op => <option key={op} value={op}>{opLabel(op)}</option>)}
        </select>
        {isBoolField(node.field) ? (
          <select
            value={node.value ? 'true' : 'false'}
            onChange={e => updateNode(path, { value: e.target.value === 'true' })}
            className={`${selectCls(theme)} flex-1`}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : isIdentityField(node.field) ? (
          <button
            type="button"
            onClick={() => setPickerOpen({ path, field: node.field })}
            className={`flex items-center gap-2 ${inputCls(theme)} flex-1 min-w-[160px] text-left`}
            title="Pick contact / group…"
          >
            <ContactRound className={`w-4 h-4 shrink-0 ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-500'}`} />
            <span className={`truncate ${node.value ? '' : (theme === 'dark' ? 'text-slate-500' : 'text-slate-400')}`}>
              {node.value ? (isNameField(node.field) ? node.value : shortId(node.value)) : 'Pick contact / group…'}
            </span>
          </button>
        ) : isEnumField(node.field) ? (
          <select
            value={node.value}
            onChange={e => updateNode(path, { value: e.target.value })}
            className={`${selectCls(theme)} flex-1 min-w-[160px]`}
          >
            <option value="" disabled>Select {fieldLabel(node.field)}…</option>
            {isEnumField(node.field).map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        ) : node.field === 'reaction' ? (
          <div className="flex-1 min-w-[160px] relative">
            <input
              value={node.value}
              onChange={e => updateNode(path, { value: e.target.value })}
              placeholder="👍"
              className={`${inputCls(theme)} pr-10`}
            />
            <div className="absolute right-1 top-1 bottom-1">
              <EmojiPicker
                theme={theme}
                gridCols="grid-cols-6"
                heightClass="max-h-48"
                selected={node.value}
                onSelect={(emo) => updateNode(path, { value: emo })}
              />
            </div>
          </div>
        ) : (
          <input
            value={node.value}
            onChange={e => updateNode(path, { value: e.target.value })}
            placeholder={spec.operatorMeta[node.op]?.example || 'value'}
            className={`${inputCls(theme)} flex-1 min-w-[160px]`}
          />
        )}
        <button
          onClick={() => removeNode(path)}
          disabled={canRemoveAll}
          className={`p-2 rounded-lg transition-colors disabled:opacity-30 ${theme === 'dark' ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-500/10' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'}`}
          title="Remove condition"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // Nested group box
  return (
    <div className={`rounded-xl border ${theme === 'dark' ? 'border-violet-500/30 bg-[#0a0c10]/60' : 'border-violet-300 bg-violet-50/40'}`}>
      <div className={`flex items-center gap-2 rounded-t-xl border-b px-3 py-1.5 ${theme === 'dark' ? 'border-[#262931]' : 'border-slate-200'}`}>
        <span className={`text-[10px] font-black uppercase ${match === 'all' ? 'text-indigo-400' : 'text-amber-400'}`}>{label}</span>
        <span className={`text-[10px] font-black uppercase tracking-wider ${theme === 'dark' ? 'text-violet-400' : 'text-violet-600'}`}>Group</span>
        <div className={`ml-1 flex items-center rounded-md border overflow-hidden text-[10px] ${theme === 'dark' ? 'border-[#262931]' : 'border-slate-300'}`}>
          <button
            onClick={() => updateNode(path, { match: 'all' })}
            className={`px-2 py-0.5 font-bold transition-colors ${node.match === 'all' ? (theme === 'dark' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-100 text-indigo-700') : (theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700')}`}
          >ALL</button>
          <button
            onClick={() => updateNode(path, { match: 'any' })}
            className={`px-2 py-0.5 font-bold transition-colors ${node.match === 'any' ? (theme === 'dark' ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700') : (theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700')}`}
          >ANY</button>
        </div>
        <button
          onClick={() => removeNode(path)}
          disabled={canRemoveAll}
          className={`ml-auto p-1.5 rounded-lg transition-colors disabled:opacity-30 ${theme === 'dark' ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-500/10' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'}`}
          title="Remove group"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-2 p-3">
        {node.conditions.map((child, i) => (
          <ConditionNodeEditor
            key={i}
            node={child}
            path={[...path, i]}
            label={i === 0 ? 'If' : (node.match === 'all' ? 'And' : 'Or')}
            match={node.match}
            depth={depth + 1}
            spec={spec}
            eventFields={eventFields}
            theme={theme}
            fieldLabel={fieldLabel}
            opLabel={opLabel}
            isBoolField={isBoolField}
            updateNode={updateNode}
            removeNode={removeNode}
            addLeaf={addLeaf}
            addGroup={addGroup}
            canRemoveAll={canRemoveAll}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 pb-2">
        <button
          onClick={() => addLeaf(path)}
          disabled={countLeaves(node.conditions) >= (spec.maxConditions || 10)}
          className={`inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors disabled:opacity-40 ${theme === 'dark' ? 'text-violet-300 hover:bg-violet-500/10' : 'text-violet-600 hover:bg-violet-50'}`}
        >
          <Plus className="w-3 h-3 mr-1" /> Condition
        </button>
        {depth < (spec.maxGroupDepth || 3) - 1 && (
          <button
            onClick={() => addGroup(path)}
            disabled={countLeaves(node.conditions) >= (spec.maxConditions || 10)}
            className={`inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors disabled:opacity-40 ${theme === 'dark' ? 'text-slate-400 hover:text-slate-200 hover:bg-[#1e222b]' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
          >
            <Layers className="w-3 h-3 mr-1" /> Nested group
          </button>
        )}
      </div>
    </div>
  );
}

export default function AutomationStudio({ apiKey, theme, onDraftChange, initialChatScope, lockedChatScope }) {
  const [rules, setRules] = useState([]);
  const [spec, setSpec] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const displayRules = lockedChatScope ? rules.filter(r => r.trigger.chatScope === lockedChatScope) : rules;
  const [testing, setTesting] = useState({ id: null, busy: false, result: null, text: '', sender: '' });

  const liveVersion = useSyncExternalStore(
    (cb) => liveStream.subscribe(cb),
    () => liveStream.version
  );
  void liveVersion;
  const events = liveStream.getAutomationEvents();

  const load = useCallback(() => {
    setLoadError(false);
    axios.get(`${SERVER_URL}/api/v1/automation`, { headers: { 'x-api-key': apiKey } })
      .then(res => setRules((Array.isArray(res.data?.data) ? res.data.data : []).map(normalizeRule)))
      .catch(() => { setRules([]); setLoadError(true); });
    axios.get(`${SERVER_URL}/api/v1/automation/config`, { headers: { 'x-api-key': apiKey } })
      .then(res => { if (res.data?.provider) setAiConfig(res.data); })
      .catch(() => {});
    axios.get(`${SERVER_URL}/api/v1/automation/spec`, { headers: { 'x-api-key': apiKey } })
      .then(res => setSpec(res.data?.data))
      .catch(() => {});
  }, [apiKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (onDraftChange) onDraftChange(draft);
  }, [onDraftChange, draft]);

  const startNew = () => { setEditingId(null); setDraft(emptyDraft(initialChatScope)); setMsg(null); };
  const startEdit = (rule) => { setEditingId(rule.id); setDraft(normalizeRule(JSON.parse(JSON.stringify(rule)))); setMsg(null); };

  const patchDraft = (patch) => setDraft(prev => ({ ...(prev || emptyDraft()), ...patch }));
  const patchTrigger = (patch) => setDraft(prev => ({ ...prev, trigger: { ...prev.trigger, ...patch } }));
  const patchAction = (patch) => setDraft(prev => ({ ...prev, action: { ...prev.action, ...patch } }));

  // Path-based condition tree mutations (path = child indexes from the root).
  const updateNode = (path, patch) => setDraft(prev => {
    const conditions = JSON.parse(JSON.stringify(prev.trigger.conditions || []));
    const node = getNode(conditions, path);
    Object.assign(node, patch);
    return { ...prev, trigger: { ...prev.trigger, conditions } };
  });

  const removeNode = (path) => setDraft(prev => {
    const conditions = JSON.parse(JSON.stringify(prev.trigger.conditions || []));
    const container = getContainer(conditions, path);
    container.splice(path[path.length - 1], 1);
    return { ...prev, trigger: { ...prev.trigger, conditions } };
  });

  const addLeaf = (path) => setDraft(prev => {
    const meta = spec?.events?.find(e => e.id === prev.trigger.event);
    const conditions = JSON.parse(JSON.stringify(prev.trigger.conditions || []));
    const container = getContainer(conditions, path);
    const condition = { ...(meta?.defaultCondition || { field: 'sender', op: 'equals', value: '' }) };
    if (typeof condition.value !== 'boolean') condition.value = '';
    container.push(condition);
    return { ...prev, trigger: { ...prev.trigger, conditions } };
  });

  const addGroup = (path) => setDraft(prev => {
    const meta = spec?.events?.find(e => e.id === prev.trigger.event);
    const conditions = JSON.parse(JSON.stringify(prev.trigger.conditions || []));
    const container = getContainer(conditions, path);
    const leaf = { ...(meta?.defaultCondition || { field: 'sender', op: 'equals', value: '' }) };
    if (typeof leaf.value !== 'boolean') leaf.value = '';
    container.push({ match: 'all', conditions: [leaf] });
    return { ...prev, trigger: { ...prev.trigger, conditions } };
  });

  const fieldLabel = (field) => spec?.fields?.find(f => f.field === field)?.label || field;
  const opLabel = (op) => spec?.operatorMeta?.[op]?.label || op;

  const save = async () => {
    if (!draft || !draft.name.trim() || !hasAnyValue(draft.trigger?.conditions)) {
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
  const isIdentityField = (field) => ['sender', 'to', 'author'].includes(field);
  const isNameField = (field) => ['contactName', 'name'].includes(field);
  const shortId = (id = '') => String(id).split('@')[0]?.replace(/-\d+$/, '') || id;
  const isEnumField = (field) => {
    if (field === 'mediaType' || field === 'type') {
      return Object.entries(MEDIA_LABELS).map(([k, v]) => ({ value: k, label: v }));
    }
    if (field === 'action') {
      return ['add', 'remove', 'join', 'leave', 'promote', 'demote'].map(k => ({ value: k, label: k }));
    }
    if (field === 'callKind') {
      return ['voice', 'video'].map(k => ({ value: k, label: k }));
    }
    if (field === 'recoveryStatus') {
      return ['recovered', 'not-observed', 'probable-sender-match'].map(k => ({ value: k, label: k }));
    }
    return false;
  };
  const [pickerOpen, setPickerOpen] = useState(null);
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [aiConfig, setAiConfig] = useState({ provider: "gemini", model: "gemini-1.5-flash", apiKey: "" });
  const [aiTesting, setAiTesting] = useState(false);
  const eventMeta = spec?.events?.find(e => e.id === draft?.trigger?.event);
  
  const isDM = lockedChatScope && !lockedChatScope.endsWith('@g.us') && lockedChatScope !== 'status@broadcast';
  const allowedField = (id) => {
    if (!lockedChatScope) return true;
    if (id === 'isGroup' || id === 'chatId' || id === 'chatName' || id === 'groupName') return false;
    if (isDM && (id === 'sender' || id === 'senderName' || id === 'contactName')) return false;
    return true;
  };
  
  const eventFields = (eventMeta?.fields || [])
    .filter(allowedField)
    .map(id => spec?.fields?.find(f => f.field === id))
    .filter(Boolean);
    
  const switchEvent = (event) => {
    const meta = spec.events.find(e => e.id === event);
    let condition = meta?.defaultCondition || { field: 'sender', op: 'equals', value: '' };
    if (!allowedField(condition.field)) {
      const fallback = (meta?.fields || []).filter(allowedField)[0];
      condition = { field: fallback || 'text', op: 'equals', value: '' };
    }
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
          <div className="flex gap-2">
            <button onClick={() => setAiConfigOpen(true)} className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${theme === 'dark' ? 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-400' : 'bg-purple-100 hover:bg-purple-200 text-purple-600'}`}>
              <span className="mr-1 text-sm">🤖</span> AI Copilot
            </button>
            <button onClick={startNew} className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
              <Plus className="w-4 h-4 mr-1" /> New rule
            </button>
          </div>
        </div>

        {displayRules.length === 0 ? (
          loadError ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className={`text-sm ${theme === 'dark' ? 'text-rose-400' : 'text-rose-600'}`}>
                Couldn't load your automation rules — check your connection.
              </p>
              <button onClick={load} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
                Retry
              </button>
            </div>
          ) : (
            <p className={`text-sm py-6 text-center ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
              No rules yet. Click “New rule” and build your first automation.
            </p>
          )
        ) : (
          <ul className="space-y-3">
            {displayRules.map(rule => (
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
                        ) : (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <ConditionLabel condition={rule.trigger.conditions[0]} fieldLabel={fieldLabel} opLabel={opLabel} />
                            {rule.trigger.conditions.slice(1).map((c, i) => (
                              <span key={i} className="flex items-center gap-1.5">
                                <span className={`text-[10px] font-black uppercase ${rule.trigger.match === 'all' ? 'text-indigo-400' : 'text-amber-400'}`}>{rule.trigger.match === 'all' ? 'AND' : 'OR'}</span>
                                <ConditionLabel condition={c} fieldLabel={fieldLabel} opLabel={opLabel} />
                              </span>
                            ))}
                          </span>
                        )}
                        {rule.trigger.chatScope && (
                          <Chip active tone="indigo">In: {rule.trigger.chatScope.split('@')[0]}</Chip>
                        )}
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
              <ConditionNodeEditor
                key={index}
                node={condition}
                path={[index]}
                label={index === 0 ? 'If' : (draft.trigger.match === 'all' ? 'And' : 'Or')}
                match={draft.trigger.match}
                depth={0}
                spec={spec}
                eventFields={eventFields}
                theme={theme}
                fieldLabel={fieldLabel}
                opLabel={opLabel}
                isBoolField={isBoolField}
                isEnumField={isEnumField}
                isIdentityField={isIdentityField}
                isNameField={isNameField}
                shortId={shortId}
                setPickerOpen={setPickerOpen}
                selectCls={selectCls}
                updateNode={updateNode}
                removeNode={removeNode}
                addLeaf={addLeaf}
                addGroup={addGroup}
                canRemoveAll={countLeaves(draft.trigger.conditions) <= 1}
              />
            ))}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={() => addLeaf([])}
                disabled={countLeaves(draft.trigger.conditions) >= (spec.maxConditions || 10)}
                className={`inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${theme === 'dark' ? 'text-indigo-300 hover:bg-indigo-500/10' : 'text-indigo-600 hover:bg-indigo-50'}`}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add condition
              </button>
              <button
                onClick={() => addGroup([])}
                disabled={countLeaves(draft.trigger.conditions) >= (spec.maxConditions || 10)}
                className={`inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${theme === 'dark' ? 'text-slate-400 hover:text-slate-200 hover:bg-[#1e222b]' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
              >
                <Layers className="w-3.5 h-3.5 mr-1" /> Add group
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
            </div>
            {draft.trigger.chatScope && (
              <div className={`flex items-center gap-2 text-[10px] px-3 py-1.5 rounded-lg border ${theme === 'dark' ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-indigo-50 border-indigo-200 text-indigo-700'}`}>
                <Sparkles className="w-3 h-3 shrink-0" />
                Only fires in chat <span className="font-mono">{draft.trigger.chatScope}</span>
                <button onClick={() => patchTrigger({ chatScope: null })} className={`ml-auto font-bold hover:underline ${theme === 'dark' ? 'text-indigo-300' : 'text-indigo-700'}`}>Remove scope</button>
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <label className={`text-[10px] font-semibold whitespace-nowrap ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                Scope to chat (optional)
              </label>
              <button
                type="button"
                onClick={() => setPickerOpen({ target: 'chatScope' })}
                className={`flex items-center gap-2 ${inputCls(theme)} flex-1 sm:max-w-[280px] text-left`}
              >
                <ContactRound className={`w-4 h-4 shrink-0 ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-500'}`} />
                <span className={`truncate ${draft.trigger.chatScope ? '' : (theme === 'dark' ? 'text-slate-500' : 'text-slate-400')}`}>
                  {draft.trigger.chatScope ? shortId(draft.trigger.chatScope) : 'Pick a group you manage…'}
                </span>
              </button>
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
                        {field.name === 'prompt' && (
                          <select 
                            onChange={e => e.target.value && patchAction({ [field.name]: e.target.value })}
                            className={`${inputCls(theme)} mb-2`}
                            defaultValue=""
                          >
                            {PROMPT_TEMPLATES.map((t, i) => <option key={i} value={t.value}>{t.label}</option>)}
                          </select>
                        )}
                        <textarea
                          rows={field.name === 'prompt' ? 4 : (field.name === 'text' ? 3 : 2)}
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

            {(function hasRegex(nodes) { return (nodes || []).some(c => c.op === 'matches_regex' || (c.conditions && hasRegex(c.conditions))); })(draft.trigger.conditions) && (
              <div className={`mt-4 px-4 py-3 rounded-lg border text-xs flex items-center gap-2 ${theme === 'dark' ? 'bg-amber-500/5 border-amber-500/20 text-amber-400/90' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Regular expressions are evaluated on every message. Keep patterns simple and anchor them (e.g. ^…) to avoid surprises.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {pickerOpen && (
        <ContactPickerModal
          apiKey={apiKey}
          theme={theme}
          adminOnlyGroups={pickerOpen.target === 'chatScope' || pickerOpen.field === 'chatId'}
          onClose={() => setPickerOpen(null)}
          onPick={(contact) => {
            const v = pickerOpen.field && isNameField(pickerOpen.field) ? (contact.name || contact.formattedName || contact.pushname || contact.shortName) : contact.id?._serialized || contact.id;
            if (pickerOpen.target === 'chatScope') {
               patchTrigger({ chatScope: v || null });
            } else if (pickerOpen.path) {
               updateNode(pickerOpen.path, { value: v || '' });
            }
            setPickerOpen(null);
          }}
        />
      )}

      {aiConfigOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAiConfigOpen(false)} />
          <div className={`relative w-full max-w-md rounded-2xl p-6 shadow-2xl border ${theme === 'dark' ? 'bg-[#0d1016] border-[#262931]' : 'bg-white border-slate-200'}`}>
            <h2 className={`text-lg font-bold mb-4 flex items-center gap-2 ${theme === 'dark' ? 'text-slate-100' : 'text-slate-800'}`}>
              <span className="text-xl mr-2">🤖</span> AI Copilot Settings
            </h2>
            <div className="space-y-4 text-sm">
              <div>
                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Provider</label>
                <select 
                  value={aiConfig.provider} 
                  onChange={e => {
                    const provider = e.target.value;
                    let model = aiConfig.model;
                    if (provider === 'gemini') model = 'gemini-1.5-flash';
                    else if (provider === 'groq') model = 'llama3-8b-8192';
                    else if (provider === 'openrouter') model = 'anthropic/claude-3.5-sonnet';
                    setAiConfig(prev => ({ ...prev, provider, model }));
                  }}
                  className={inputCls(theme)}
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="groq">Groq (Llama 3)</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>
              <div>
                                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Model</label>
                <input 
                  type="text"
                  value={aiConfig.model} 
                  onChange={e => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="e.g. gemini-1.5-flash"
                  className={inputCls(theme)}
                />
              </div>
              <div>
                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>API Key</label>
                <input 
                  type="password"
                  value={aiConfig.apiKey} 
                  onChange={e => setAiConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="Enter API Key..."
                  className={inputCls(theme)}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setAiConfigOpen(false)} className={`px-4 py-2 text-sm font-semibold rounded-lg ${theme === 'dark' ? 'hover:bg-white/5 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`}>Cancel</button>
              <button 
                onClick={async () => {
                  if (!aiConfig.apiKey) return alert('Enter API key first');
                  setAiTesting(true);
                  try {
                    const res = await axios.post(`${SERVER_URL}/api/v1/automation/config/test`, aiConfig, { headers: { 'x-api-key': apiKey } });
                    if (res.data.response === 'OK') alert('Connection successful!');
                    else alert('Unexpected response: ' + res.data.response);
                  } catch (err) {
                    alert('Test failed: ' + (err.response?.data?.error || err.message));
                  }
                  setAiTesting(false);
                }}
                disabled={aiTesting}
                className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${theme === 'dark' ? 'border-[#363a45] text-slate-300 hover:bg-white/5' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
              >
                {aiTesting ? 'Testing...' : 'Test Connection'}
              </button>
              <button 
                onClick={async () => {
                  try {
                    await axios.put(`${SERVER_URL}/api/v1/automation/config`, aiConfig, { headers: { 'x-api-key': apiKey } });
                    setAiConfigOpen(false);
                    alert('Saved!');
                  } catch (e) {
                    alert('Failed to save config: ' + (e.response?.data?.error || e.message));
                  }
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 shadow-md"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}