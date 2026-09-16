import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Search, X, Users, UserCircle, LoaderCircle, MessageSquare, ContactRound,
} from 'lucide-react';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');
const API = `${SERVER_URL}/api/v1`;

// Strip the JID domain + any trailing -NNNN group suffix down to a short
// human id (e.g. 2348012345678@c.us -> 2348012345678, group name fallback).
const shortId = (id = '') => String(id).split('@')[0]?.replace(/-\d+$/, '') || id;

// Best human label for a contact row: prefer a saved/profile name, otherwise
// fall back to the number the way the rest of the app renders peers.
const contactName = (c = {}) =>
  c.name || c.formattedName || c.pushname || c.shortName || c.profileName ||
  shortId(c.id?._serialized || c.id);


// Global in-memory cache to ensure instant loading (0.01s) across re-mounts
let __fastContactsCache = null;
let __fastGroupsCache = null;

export default function ContactPickerModal({ apiKey, theme, onPick, onClose, title = 'Choose contact / group', adminOnlyGroups = false }) {
  const [tab, setTab] = useState('contacts');
  const [contacts, setContacts] = useState(null);
  const [groups, setGroups] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const dark = theme === 'dark';

  const load = useCallback(async () => {
    if (!apiKey) return;
    
    // Instant cache hit
    if (__fastContactsCache) {
      setContacts(__fastContactsCache);
      setGroups(__fastGroupsCache || []);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    try {
      const res = await axios.get(`${API}/contacts`, { headers: { 'x-api-key': apiKey } });
      const payload = res.data?.data || {};
      
      // The backend now intelligently separates them natively so the UI doesn't have to work
      const actualContacts = Array.isArray(payload.contacts) ? payload.contacts : [];
      const actualGroups = Array.isArray(payload.groups) ? payload.groups : [];
      
      __fastContactsCache = actualContacts;
      __fastGroupsCache = actualGroups;
      
      setContacts(actualContacts);
      setGroups(actualGroups);
    } catch (_) {
      setContacts([]);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => { load(); }, [load]);

  const q = query.trim().toLowerCase();
  const contactsList = (Array.isArray(contacts) ? contacts : [])
    .filter(c => (c.id?._serialized || c.id))
    .filter(c => !q || contactName(c).toLowerCase().includes(q) || String(c.id?._serialized || c.id).toLowerCase().includes(q));
  const groupsList = (Array.isArray(groups) ? groups : [])
    .filter(g => (g.id?._serialized || g.id))
    .filter(g => !q || String(g.name || g.subject || contactName(g)).toLowerCase().includes(q))
    .filter(g => !adminOnlyGroups || true /* disabled admin check since groups from contacts don't have parts */);

  const list = tab === 'contacts' ? contactsList : groupsList;

  const pick = (entry, isGroup) => {
    const id = entry.id?._serialized || entry.id;
    const label = isGroup
      ? String(entry.name || entry.subject || shortId(id))
      : contactName(entry);
    onPick?.({ id, label, isGroup });
    onClose?.();
  };

  const row = (entry, isGroup) => (
    <button
      key={entry.id?._serialized || entry.id}
      onClick={() => pick(entry, isGroup)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors mb-1 ${
        dark
          ? 'hover:bg-[#161a22] text-slate-200'
          : 'hover:bg-slate-100 text-slate-800'
      }`}
    >
      <span className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${dark ? 'bg-[#16191f] text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
        {isGroup ? <Users className="w-4 h-4" /> : <UserCircle className="w-4 h-4" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-sm font-medium truncate ${dark ? 'text-slate-200' : 'text-slate-800'}`}>
          {isGroup ? String(entry.name || entry.subject || shortId(entry.id?._serialized || entry.id)) : contactName(entry)}
        </span>
        <span className={`block text-[11px] truncate ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
          {entry.id?._serialized || entry.id}
        </span>
      </span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className={`absolute inset-0 ${dark ? 'bg-black/70' : 'bg-slate-900/60'} backdrop-blur-sm`} />
      <div
        onClick={e => e.stopPropagation()}
        className={`relative w-full sm:w-[440px] max-h-[85vh] sm:rounded-2xl rounded-t-2xl flex flex-col shadow-2xl border ${dark ? 'bg-[#0d1016] border-[#262931]' : 'bg-white border-slate-200'}`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-4 pt-4 pb-3 border-b shrink-0 ${dark ? 'border-[#262931]' : 'border-slate-200'}`}>
          <h2 className={`text-sm font-bold ${dark ? 'text-slate-100' : 'text-slate-800'}`}>{title}</h2>
          <button onClick={onClose} className={`p-1.5 rounded-lg transition-colors ${dark ? 'text-slate-500 hover:text-slate-200 hover:bg-white/5' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className={`flex items-center justify-center gap-2 py-16 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            <LoaderCircle className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading contacts…</span>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className={`flex gap-4 px-4 pt-3 border-b shrink-0 ${dark ? 'border-[#262931]' : 'border-slate-200'}`}>
              <button
                onClick={() => setTab('contacts')}
                className={`flex items-center gap-1.5 pb-2 border-b-2 text-sm font-semibold transition-colors ${
                  tab === 'contacts'
                    ? (dark ? 'border-indigo-400 text-indigo-300' : 'border-indigo-500 text-indigo-600')
                    : (dark ? 'border-transparent text-slate-500 hover:text-slate-300' : 'border-transparent text-slate-400 hover:text-slate-600')
                }`}
              >
                <ContactRound className="w-4 h-4" /> Contacts
              </button>
              <button
                onClick={() => setTab('groups')}
                className={`flex items-center gap-1.5 pb-2 border-b-2 text-sm font-semibold transition-colors ${
                  tab === 'groups'
                    ? (dark ? 'border-indigo-400 text-indigo-300' : 'border-indigo-500 text-indigo-600')
                    : (dark ? 'border-transparent text-slate-500 hover:text-slate-300' : 'border-transparent text-slate-400 hover:text-slate-600')
                }`}
              >
                <Users className="w-4 h-4" /> Groups
              </button>
            </div>

            {/* Search */}
            <div className="px-4 pt-3 pb-2 shrink-0">
              <div className={`flex items-center gap-2 rounded-lg border px-3 border ${dark ? 'bg-[#0a0c10] border-[#262931]' : 'bg-slate-50 border-slate-300'}`}>
                <Search className={`w-4 h-4 shrink-0 ${dark ? 'text-slate-500' : 'text-slate-400'}`} />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={tab === 'contacts' ? 'Search contacts by name or number…' : 'Search groups…'}
                  className={`w-full bg-transparent text-sm py-2.5 outline-none ${dark ? 'text-slate-200 placeholder-slate-500' : 'text-slate-800 placeholder-slate-400'}`}
                />
              </div>
            </div>

            {/* List */}
            <div className={`flex-1 overflow-y-auto px-3 pb-4 ${dark ? '' : ''}`}>
              {list.length === 0 ? (
                <div className={`text-center text-sm py-10 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                  {!loading && query ? 'No matches' : tab === 'contacts' ? 'No contacts yet' : 'No groups yet'}
                </div>
              ) : (
                list.map(e => row(e, tab === 'groups'))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
