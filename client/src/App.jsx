import { Fragment, useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import MessageContent from './MessageContent';
import { serializedId } from './message-utils';
import { 
  Smartphone, LogOut, MessageSquare, Settings, Users, 
  RefreshCw, Search, MoreVertical, Send, Copy, Code2, ShieldCheck, ZoomIn, ZoomOut,
  Activity, Database, Paperclip, Smile, Sticker, LoaderCircle, Trash2, FlaskConical, ChevronLeft, ChevronRight, EyeOff, X
} from 'lucide-react';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');
const API_URL = `${SERVER_URL}/api`;
const V1_API_URL = `${API_URL}/v1`;
const API_KEY = import.meta.env.VITE_WPPCONNECT_API_KEY || '';
if (API_KEY) axios.defaults.headers.common['x-api-key'] = API_KEY;
// When SERVER_URL is empty the client is served from the same origin as the server
// so socket.io connects to window.location.origin automatically
const socket = io(SERVER_URL || window.location.origin, { auth: API_KEY ? { apiKey: API_KEY } : undefined, extraHeaders: API_KEY ? { 'x-api-key': API_KEY } : undefined });


const MESSAGE_TEMPLATES = {
  text: { endpoint: 'text', payload: { text: 'Hello from the API console' } },
  buttons: { endpoint: 'buttons', payload: { text: 'Choose an option', title: 'Interactive message', footer: 'Sent through WPPConnect', buttons: [{ id: 'option_1', text: 'Option one' }, { id: 'option_2', text: 'Option two' }] } },
  list: { endpoint: 'list', payload: { options: { buttonText: 'View options', description: 'Choose one option', sections: [{ title: 'Actions', rows: [{ rowId: 'option_1', title: 'Option one', description: 'First API action' }, { rowId: 'option_2', title: 'Option two', description: 'Second API action' }] }] } } },
  poll: { endpoint: 'poll', payload: { name: 'Which option?', choices: ['Option A', 'Option B', 'Option C'], options: { selectableCount: 1 } } },
  location: { endpoint: 'location', payload: { latitude: 6.5244, longitude: 3.3792, title: 'Lagos' } },
  contact: { endpoint: 'contact', payload: { contact: '15551234567', name: 'Shared contact' } },
  reaction: { endpoint: 'reaction', payload: { messageId: 'MESSAGE_ID', reaction: '🔥' } },
};

const DEFAULT_SANDBOX_FIELDS = {
  text: 'Hello from the API console', title: 'Interactive message', footer: 'Sent through WPPConnect',
  buttonMode: 'reply', buttonLabels: 'Option one\nOption two', actionLabel: 'Open website', actionValue: 'https://wppconnect.io',
  listButton: 'View options', listDescription: 'Choose one option', listRows: 'Option one | First API action\nOption two | Second API action',
  pollQuestion: 'Which option?', pollChoices: 'Option A\nOption B\nOption C', selectableCount: '1',
  latitude: '6.5244', longitude: '3.3792', locationTitle: 'Lagos', contact: '15551234567', contactName: 'Shared contact', messageId: '', reaction: '🔥'
};

function buildSandboxPayload(type, fields) {
  if (type === 'text') return { text: fields.text };
  if (type === 'buttons') {
    const labels = fields.buttonLabels.split('\n').map(value => value.trim()).filter(Boolean).slice(0, 3);
    const buttons = fields.buttonMode === 'reply'
      ? labels.map((text, index) => ({ id: `option_${index + 1}`, text }))
      : fields.buttonMode === 'url'
        ? [{ url: fields.actionValue.trim(), text: fields.actionLabel.trim() }]
        : [{ phoneNumber: fields.actionValue.trim(), text: fields.actionLabel.trim() }];
    return { text: fields.text, title: fields.title, footer: fields.footer, buttons };
  }
  if (type === 'list') return { options: { buttonText: fields.listButton, description: fields.listDescription, sections: [{ title: fields.title || 'Options', rows: fields.listRows.split('\n').map((row, index) => { const [title, description = ''] = row.split('|').map(value => value.trim()); return { rowId: `option_${index + 1}`, title, description }; }).filter(row => row.title) }] } };
  if (type === 'poll') return { name: fields.pollQuestion, choices: fields.pollChoices.split('\n').map(value => value.trim()).filter(Boolean), options: { selectableCount: Number(fields.selectableCount) || 1 } };
  if (type === 'location') return { latitude: Number(fields.latitude), longitude: Number(fields.longitude), title: fields.locationTitle };
  if (type === 'contact') return { contact: fields.contact, name: fields.contactName };
  if (type === 'reaction') return { messageId: fields.messageId, reaction: fields.reaction };
  return MESSAGE_TEMPLATES[type].payload;
}

function messageTimestamp(message) { return Number(message.timestamp || message.t || 0) * 1000; }
function dayLabel(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

function App() {
  const [sessionStatus, setSessionStatus] = useState('DISCONNECTED');
  const [qrCode, setQrCode] = useState(null);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat', 'status', 'tools'
  const [activeDevTool, setActiveDevTool] = useState(null); // 'sandbox', 'inspector', 'eventlog'
  const [eventsLog, setEventsLog] = useState([]);
  
  // Chat State
  const [chats, setChats] = useState([]);
  const [chatPagination, setChatPagination] = useState({ total: 0, hasMore: false });
  const [chatsLoading, setChatsLoading] = useState(false);
  const [chatFilter, setChatFilter] = useState('all'); // all, unread, groups
  const [searchQuery, setSearchQuery] = useState('');
  
  // Active Chat State
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [sandboxTo, setSandboxTo] = useState('');
  const [sandboxResult, setSandboxResult] = useState(null);
  const [sandboxType, setSandboxType] = useState('text');
  const [sandboxPayload, setSandboxPayload] = useState(JSON.stringify(MESSAGE_TEMPLATES.text.payload, null, 2));
  const [sandboxFields, setSandboxFields] = useState(DEFAULT_SANDBOX_FIELDS);
  const [sandboxRawMode, setSandboxRawMode] = useState(false);
  const [deletedMessages, setDeletedMessages] = useState([]);
  const [selectedDeletion, setSelectedDeletion] = useState(null);
  const [recipientMode, setRecipientMode] = useState('contacts');
  const [recipientSearch, setRecipientSearch] = useState('');
  
  const messagesEndRef = useRef(null);
  const chatScrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const jumpToBottomRef = useRef(false);
  const fileInputRef = useRef(null);
  const stickerInputRef = useRef(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [expandedMedia, setExpandedMedia] = useState(null);
  const [mediaZoom, setMediaZoom] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const historyLoadingRef = useRef(false);

  useEffect(() => {
    axios.get(`${API_URL}/status`).then(({ data }) => setSessionStatus(data.status)).catch(() => setSessionStatus('OFFLINE'));
    socket.on('session_status', (status) => {
      setSessionStatus(status);
      if (status === 'CONNECTED') {
        setQrCode(null);
        fetchChats();
      }
    });

    socket.on('qr_code', (qrBase64) => {
      setQrCode(qrBase64);
      setSessionStatus('QR_READY');
    });

    socket.on('new_message', (message) => {
      // If the message is for the currently open chat, append it
      if (activeChat && (message.from === activeChat.id._serialized || message.to === activeChat.id._serialized)) {
        setMessages(prev => [...prev, message]);
        scrollToBottom();
      }
      // Re-fetch chats to update unread counts and sorting
      fetchChats(true);
    });
    socket.on('message_deleted', (entry) => setDeletedMessages(previous => [entry, ...previous]));
    socket.on('status_deleted', (entry) => setDeletedMessages(previous => [entry, ...previous]));

    // Listen to all socket events for the Event Log
    socket.onAny((eventName, ...args) => {
      const newEvent = {
        id: Math.random().toString(36).substr(2, 9),
        time: new Date().toLocaleTimeString(),
        name: eventName,
        data: args
      };
      setEventsLog(prev => [newEvent, ...prev].slice(0, 100)); // Keep last 100 events
    });

    return () => {
      socket.off('session_status');
      socket.off('qr_code');
      socket.off('new_message');
      socket.off('message_deleted');
      socket.off('status_deleted');
      socket.offAny();
    };
  }, [activeChat]);

  // Fetch Chats when connected
  async function fetchChats(reset = true) {
    try {
      setChatsLoading(true);
      const offset = reset ? 0 : chats.length;
      const res = await axios.get(`${API_URL}/chats`, { params: { offset, limit: 30 } });
      const chatData = res.data.chats.sort((a, b) => (b.lastMessage?.timestamp || b.t || 0) - (a.lastMessage?.timestamp || a.t || 0));
      setChats(current => reset ? chatData : [...current, ...chatData.filter(chat => !current.some(item => item.id._serialized === chat.id._serialized))]);
      setChatPagination(res.data.pagination || { total: chatData.length, hasMore: false });
    } catch (e) {
      console.error('Failed to fetch chats', e);
    } finally {
      setChatsLoading(false);
    }
  }

  // Select a Chat
  const selectChat = async (chat) => {
    setActiveChat(chat);
    setSelectedMessage(null);
    setMessages([]);
    setHistoryError(null);
    setHistoryHasMore(true);
    jumpToBottomRef.current = true;
    stickToBottomRef.current = true;
    try {
      const res = await axios.get(`${API_URL}/messages/${encodeURIComponent(chat.id._serialized)}`);
      const page = Array.isArray(res.data) ? { messages: res.data, hasMore: res.data.length >= 30 } : res.data;
      setMessages(page.messages || []);
      setHistoryHasMore(page.hasMore !== false);
    } catch (e) {
      jumpToBottomRef.current = false;
      console.error('Failed to fetch messages', e);
      setHistoryError(e.response?.data?.error || 'This conversation could not be loaded.');
    }
  };

  async function loadOlderMessages() {
    if (!activeChat || historyLoadingRef.current || !historyHasMore) return;
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    setHistoryError(null);
    const viewport = chatScrollRef.current;
    const previousHeight = viewport?.scrollHeight || 0;
    const chatId = activeChat.id._serialized;
    const before = serializedId(messages[0]?.id);
    try {
      const { data } = await axios.post(`${API_URL}/messages/${encodeURIComponent(chatId)}/sync`, { before, count: 40 });
      if (activeChat.id._serialized !== chatId) return;
      const page = Array.isArray(data) ? { messages: data, hasMore: data.length > 0 } : data;
      const older = page.messages || [];
      setMessages(current => {
        const ids = new Set(current.map(message => serializedId(message.id)));
        return [...older.filter(message => !ids.has(serializedId(message.id))), ...current];
      });
      setHistoryHasMore(page.hasMore !== false && older.length > 0);
      requestAnimationFrame(() => {
        if (viewport) viewport.scrollTop += viewport.scrollHeight - previousHeight;
      });
    } catch (error) {
      setHistoryError(error.response?.data?.error || 'Older messages could not be loaded.');
    } finally {
      historyLoadingRef.current = false;
      setHistoryLoading(false);
    }
  }

  useLayoutEffect(() => {
    if (jumpToBottomRef.current && messages.length) {
      const viewport = chatScrollRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
      jumpToBottomRef.current = false;
    }
  }, [messages, activeChat]);

  // Filter Logic
  const filteredChats = useMemo(() => chats.filter(chat => {
    if (chatFilter === 'groups' && !chat.isGroup) return false;
    if (chatFilter === 'unread' && !(chat.unreadCount > 0)) return false;
    const label = chat.displayName || chat.name || chat.contact?.pushname || chat.id?.user || '';
    return label.toLowerCase().includes(searchQuery.toLowerCase());
  }), [chats, chatFilter, searchQuery]);

  function scrollToBottom(behavior = 'smooth') {
    const viewport = chatScrollRef.current;
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }

  const handleChatScroll = () => {
    const viewport = chatScrollRef.current;
    if (viewport) {
      stickToBottomRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
      if (viewport.scrollTop < 120) void loadOlderMessages();
    }
  };

  const keepInitialBottomAnchor = () => {
    if (stickToBottomRef.current) scrollToBottom('auto');
  };

  const startSession = async () => {
    try {
      await axios.post(`${API_URL}/start-session`);
    } catch (error) {
      console.error('Failed to start session', error);
    }
  };

  const stopSession = async () => {
    try {
      await axios.post(`${API_URL}/stop-session`);
    } catch (error) {
      console.error('Failed to stop session', error);
    }
  };

  const logoutSession = async () => {
    try {
      if (window.confirm("Are you sure you want to completely Unlink this device from WhatsApp?")) {
        await axios.post(`${API_URL}/logout-session`);
      }
    } catch (error) {
      console.error('Failed to logout', error);
    }
  };

  const resetSession = async () => {
    try {
      await axios.post(`${API_URL}/reset-session`);
    } catch (error) {
      console.error('Failed to reset session', error);
    }
  };

  const [statuses, setStatuses] = useState({});
  const [activeStoryViewer, setActiveStoryViewer] = useState(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState(null);

  async function fetchStatuses() {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const { data } = await axios.get(`${API_URL}/stories`);
      setStatuses(data || {});
    } catch (error) {
      setStatusError(error.response?.data?.error || 'Could not load WhatsApp statuses.');
    } finally {
      setStatusLoading(false);
    }
  }

  const openStoryViewer = (senderId) => {
    setActiveStoryViewer(senderId);
    setActiveStoryIndex(0);
  };

  const moveStory = (direction) => {
    const stories = statuses[activeStoryViewer] || [];
    const next = activeStoryIndex + direction;
    if (next >= 0 && next < stories.length) setActiveStoryIndex(next);
  };

  useEffect(() => {
    if (activeTab === 'status') {
      fetchStatuses();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'tools') return;
    Promise.allSettled([axios.get(`${API_URL}/status`), axios.get(`${API_URL}/contacts`), axios.get(`${V1_API_URL}/groups`)]).then(([status, contactList, groupList]) => {
      if (status.status === 'fulfilled') setDiagnostics(status.value.data);
      if (contactList.status === 'fulfilled') setContacts(contactList.value.data.contacts || []);
      if (groupList.status === 'fulfilled') setGroups(groupList.value.data.data || []);
    });
  }, [activeTab, sessionStatus]);

  useEffect(() => {
    if (activeDevTool === 'deleted') axios.get(`${V1_API_URL}/deletions`, { params: { limit: 300 } }).then(({ data }) => setDeletedMessages(data.data || [])).catch(console.error);
  }, [activeDevTool]);

  const runSandbox = async () => {
    setSandboxResult({ pending: true });
    try {
      const parsed = sandboxRawMode ? JSON.parse(sandboxPayload) : buildSandboxPayload(sandboxType, sandboxFields);
      const template = MESSAGE_TEMPLATES[sandboxType];
      const { data } = await axios.post(`${V1_API_URL}/messages/${template.endpoint}`, sandboxType === 'reaction' ? parsed : { to: sandboxTo, ...parsed });
      setSandboxResult({ ok: true, data });
    } catch (error) {
      setSandboxResult({ ok: false, error: error.response?.data?.error?.message || error.response?.data?.error || error.message });
    }
  };

  const selectSandboxType = (type) => {
    setSandboxType(type);
    setSandboxRawMode(false);
    setSandboxPayload(JSON.stringify(buildSandboxPayload(type, sandboxFields), null, 2));
    setSandboxResult(null);
  };

  useEffect(() => {
    if (!sandboxRawMode) setSandboxPayload(JSON.stringify(buildSandboxPayload(sandboxType, sandboxFields), null, 2));
  }, [sandboxType, sandboxFields, sandboxRawMode]);

  const contactId = (item) => item?.id?._serialized || item?.id || '';
  const contactName = (item) => item?.displayName || item?.name || item?.contact?.name || item?.formattedName || item?.verifiedName || item?.pushname || item?.shortName || contactId(item).split('@')[0] || 'Unnamed';
  const recipientOptions = (recipientMode === 'groups' ? groups : contacts)
    .filter(item => recipientMode === 'groups' || (!item.isMe && item.isWAContact !== false))
    .filter(item => `${contactName(item)} ${contactId(item)}`.toLowerCase().includes(recipientSearch.toLowerCase()))
    .slice(0, 100);
  const activeStatusMessage = activeStoryViewer ? statuses[activeStoryViewer]?.[activeStoryIndex] : null;
  const activeStatusType = String(activeStatusMessage?.type || 'chat').toLowerCase();
  const statusHasMedia = ['image', 'video', 'gif', 'audio', 'ptt', 'sticker', 'document'].includes(activeStatusType);

  const openMedia = media => { setMediaZoom(1); setExpandedMedia(media); };

  useEffect(() => {
    if (!expandedMedia) return;
    const closeOnEscape = event => { if (event.key === 'Escape') setExpandedMedia(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [expandedMedia]);

  useEffect(() => {
    const handleNewStatus = () => {
      if (activeTab === 'status') {
         fetchStatuses();
      }
    };
    socket.on('new_status', handleNewStatus);
    return () => socket.off('new_status', handleNewStatus);
  }, [activeTab]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!messageInput.trim() || !activeChat) return;

    const text = messageInput.trim();
    const optimisticId = `pending-${Date.now()}`;
    try {
      setIsSending(true);
      setNotice(null);
      // Optimistic update
      const fakeMsg = {
        id: optimisticId,
        fromMe: true,
        body: text,
        timestamp: Math.floor(Date.now() / 1000),
        pending: true,
      };
      setMessages(prev => [...prev, fakeMsg]);
      setTimeout(scrollToBottom, 100);
      
      setMessageInput('');
      
      await axios.post(`${API_URL}/send-message`, {
        to: activeChat.id._serialized,
        text
      });
      setMessages(prev => prev.map(message => message.id === optimisticId ? { ...message, pending: false } : message));
    } catch (error) {
      setMessages(prev => prev.filter(message => message.id !== optimisticId));
      setMessageInput(text);
      setNotice({ type: 'error', text: error.response?.data?.error || 'Message could not be sent.' });
    } finally {
      setIsSending(false);
    }
  };

  const sendUpload = async (file, asSticker = false) => {
    if (!file || !activeChat) return;
    if (file.size > 15 * 1024 * 1024) {
      setNotice({ type: 'error', text: 'Files must be smaller than 15 MB.' });
      return;
    }
    setIsUploading(true);
    setNotice(null);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const endpoint = asSticker ? 'send-sticker' : 'send-file';
      await axios.post(`${API_URL}/${endpoint}`, asSticker
        ? { to: activeChat.id._serialized, dataUrl }
        : { to: activeChat.id._serialized, dataUrl, filename: file.name, caption: messageInput.trim() });
      if (!asSticker) setMessageInput('');
      setNotice({ type: 'success', text: asSticker ? 'Sticker sent.' : `${file.name} sent.` });
      const res = await axios.get(`${API_URL}/messages/${encodeURIComponent(activeChat.id._serialized)}?count=30`);
      setMessages(Array.isArray(res.data) ? res.data : (res.data.messages || []));
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.error || `Could not send ${asSticker ? 'sticker' : 'file'}.` });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (stickerInputRef.current) stickerInputRef.current.value = '';
    }
  };

  return (
    <div className="app-shell flex h-screen bg-[#0b0f14] text-[#111b21] font-sans">
      {/* Sidebar Navigation */}
        <div className="w-16 bg-[#111820] flex flex-col items-center py-4 justify-between border-r border-[#25303b]">
        <div className="space-y-6">
          <button 
            onClick={() => setActiveTab('chat')}
            className={`p-3 rounded-xl transition ${activeTab === 'chat' ? 'bg-[#374045] text-white' : 'text-[#aebac1] hover:bg-[#374045]'}`}
            title="Chats"
          >
            <MessageSquare className="w-6 h-6" />
          </button>
          <button 
            onClick={() => setActiveTab('status')}
            className={`p-3 rounded-xl transition ${activeTab === 'status' ? 'bg-[#374045] text-white' : 'text-[#aebac1] hover:bg-[#374045]'}`}
            title="Status & Stories"
          >
            <RefreshCw className="w-6 h-6" />
          </button>
          <button 
            onClick={() => setActiveTab('tools')}
            className={`p-3 rounded-xl transition ${activeTab === 'tools' ? 'bg-[#374045] text-white' : 'text-[#aebac1] hover:bg-[#374045]'}`}
            title="Dev Tools"
          >
            <Settings className="w-6 h-6" />
          </button>
        </div>
        
        <div className="space-y-4">
          {sessionStatus === 'ERROR' && (
            <button onClick={resetSession} className="p-3 bg-red-600 text-white rounded-xl hover:bg-red-700" title="Reset Session">
              <RefreshCw className="w-6 h-6" />
            </button>
          )}
          {sessionStatus === 'CONNECTED' && (
            <>
              <button onClick={stopSession} className="p-3 text-yellow-500 hover:bg-[#374045] rounded-xl" title="Pause Engine (Keep Logged In)">
                <RefreshCw className="w-6 h-6" />
              </button>
              <button onClick={logoutSession} className="p-3 text-red-500 hover:bg-[#374045] rounded-xl" title="Unlink Device (Full Logout)">
                <LogOut className="w-6 h-6" />
              </button>
            </>
          )}
          <div title={`Status: ${sessionStatus}`} className="p-2">
            <span className={`block w-4 h-4 rounded-full ${sessionStatus === 'CONNECTED' ? 'bg-green-500' : sessionStatus === 'STARTING' || sessionStatus === 'QR_READY' ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
          </div>
        </div>
      </div>

      {sessionStatus !== 'CONNECTED' ? (
        // Not Connected Screen
        <div className="connection-screen flex-1 flex flex-col items-center justify-center bg-white">
           {qrCode ? (
              <div className="bg-white p-10 rounded-2xl shadow-xl text-center border border-gray-100 max-w-md w-full">
                <h2 className="text-3xl font-light mb-6 text-[#41525d]">Use WhatsApp on your computer</h2>
                <div className="p-4 bg-white border border-gray-200 rounded-2xl inline-block mb-8 shadow-sm">
                  <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64" />
                </div>
                <div className="text-left text-[#3b4a54] space-y-4 text-lg">
                  <p>1. Open WhatsApp on your phone</p>
                  <p>2. Tap Menu <MoreVertical className="inline w-5 h-5"/> or Settings <Settings className="inline w-5 h-5"/></p>
                  <p>3. Tap **Linked Devices** and point your phone to this screen</p>
                </div>
              </div>
           ) : (
              <div className="text-center max-w-sm">
                <div className="w-24 h-24 bg-[#e9edef] text-[#00a884] rounded-full flex items-center justify-center mx-auto mb-6">
                  <Smartphone className="w-12 h-12" />
                </div>
                <div className="eyebrow mb-3">LOCAL WHATSAPP RUNTIME</div>
                <h2 className="text-2xl font-semibold text-[#18212b] mb-2">Connect your workspace</h2>
                <p className="text-sm text-[#667781] mb-6">Your linked session is stored locally and restores automatically when the server restarts.</p>
                {sessionStatus === 'STARTING' ? (
                  <button disabled className="w-full bg-[#00a884] opacity-50 text-white py-3 rounded-full font-medium">
                    Restoring secure session…
                  </button>
                ) : (
                  <button onClick={startSession} className="w-full bg-[#00a884] text-white py-3 rounded-full font-medium hover:bg-[#017561] transition shadow-md">
                    Start WhatsApp runtime
                  </button>
                )}
                {(sessionStatus === 'ERROR' || sessionStatus === 'OFFLINE') && (
                  <p className="mt-4 text-red-500">{sessionStatus === 'OFFLINE' ? 'Backend is offline on port 4005.' : 'Session encountered an error. Restart the runtime.'}</p>
                )}
              </div>
           )}
        </div>
      ) : (
        // Connected Dashboard
        <div className="flex-1 flex overflow-hidden">
          {activeTab === 'chat' && (
            <>
              {/* Chats List Pane */}
              <div className="w-[400px] flex flex-col bg-white border-r border-[#e9edef]">
                <div className="h-16 flex items-center px-4 justify-between bg-[#f0f2f5] border-b border-[#e9edef]">
                  <div><div className="eyebrow">WORKSPACE</div><h2 className="font-semibold text-xl">Conversations</h2></div>
                  <div className="flex gap-4 text-[#54656f]">
                    <RefreshCw onClick={fetchChats} className="w-5 h-5 cursor-pointer hover:text-[#00a884] transition" />
                    <MessageSquare className="w-5 h-5 cursor-pointer hover:text-[#00a884] transition" />
                  </div>
                </div>
                
                <div className="p-2 border-b border-[#e9edef] bg-white">
                  <div className="bg-[#f0f2f5] rounded-lg flex items-center px-3 py-1.5">
                    <Search className="w-4 h-4 text-[#54656f] mr-3" />
                    <input 
                      type="text" 
                      placeholder="Search or start new chat" 
                      className="bg-transparent border-none focus:outline-none w-full text-sm py-1"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex gap-2 px-4 py-2 border-b border-[#e9edef] bg-white overflow-x-auto no-scrollbar">
                  {['all', 'unread', 'groups'].map(filter => (
                    <button 
                      key={filter}
                      onClick={() => setChatFilter(filter)}
                      className={`px-3 py-1 rounded-full text-sm font-medium capitalize transition ${chatFilter === filter ? 'bg-[#00a884] text-white' : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'}`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto bg-white">
                  {filteredChats.map((chat) => (
                    <div 
                      key={chat.id._serialized} 
                      onClick={() => selectChat(chat)}
                      className={`flex items-center px-3 py-3 cursor-pointer border-b border-[#f0f2f5] hover:bg-[#f5f6f6] transition ${activeChat?.id._serialized === chat.id._serialized ? 'bg-[#f0f2f5]' : ''}`}
                    >
                      <div className="w-12 h-12 rounded-full bg-[#dfe5e7] flex items-center justify-center flex-shrink-0 overflow-hidden text-gray-500">
                         {chat.contact?.profilePicThumbObj?.eurl ? (
                           <img src={chat.contact.profilePicThumbObj.eurl} className="w-full h-full object-cover" />
                         ) : (
                           <Users className="w-6 h-6" />
                         )}
                      </div>
                      <div className="ml-3 flex-1 overflow-hidden">
                        <div className="flex justify-between items-baseline">
                          <h3 className="font-normal text-[#111b21] truncate">{chat.displayName}</h3>
                          <span className="text-xs text-[#667781]">
                            {chat.t ? new Date(chat.t * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                          </span>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                          <p className="text-sm text-[#667781] truncate">
                            {chat.lastMessage?.fromMe ? 'You: ' : ''}{chat.lastMessage?.previewText || chat.lastMessage?.body || 'Conversation ready'}
                          </p>
                          {chat.unreadCount > 0 && (
                            <span className="bg-[#00a884] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                              {chat.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {chatPagination.hasMore && <button disabled={chatsLoading} onClick={() => fetchChats(false)} className="w-full py-4 text-sm font-medium text-[#008a6d] hover:bg-[#f5f6f6] disabled:opacity-50">{chatsLoading ? 'Loading conversations…' : `Load more (${Math.max(chatPagination.total - chats.length, 0)} remaining)`}</button>}
                </div>
              </div>

              {/* Chat Window Pane */}
              {activeChat ? (
                <div className="flex-1 flex flex-col bg-[#efeae2] relative" style={{ backgroundImage: "url('https://static.whatsapp.net/rsrc.php/v3/yl/r/r-G-_-R9nUM.png')", backgroundRepeat: 'repeat', backgroundOpacity: 0.4 }}>
                  <div className="h-16 flex items-center px-4 justify-between bg-[#f0f2f5] border-b border-[#e9edef] z-10">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center overflow-hidden">
                         {activeChat.contact?.profilePicThumbObj?.eurl ? (
                           <img src={activeChat.contact.profilePicThumbObj.eurl} className="w-full h-full object-cover" />
                         ) : (
                           <Users className="w-5 h-5 text-gray-500" />
                         )}
                      </div>
                      <div>
                        <h2 className="font-normal">{activeChat.displayName || activeChat.name || activeChat.contact?.pushname || activeChat.id.user}</h2>
                        <p className="text-xs text-[#667781]">{activeChat.id._serialized}</p>
                      </div>
                    </div>
                    <div className="flex gap-3 text-[#54656f] items-center">
                      <div className="chat-privacy-pill" title="Opening and inspecting chats never calls sendSeen"><ShieldCheck className="w-4 h-4" /><span>Passive view</span></div>
                      <div className="chat-metric"><strong>{messages.length}</strong><span>loaded</span></div>
                      <div className="chat-metric"><strong>{messages.filter(message => !message.fromMe).length}</strong><span>inbound</span></div>
                      <button onClick={loadOlderMessages} disabled={historyLoading || !historyHasMore} className="flex items-center gap-1 text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded-md transition disabled:opacity-50" title="Load older messages without sending read receipts">
                        <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} /> {historyLoading ? 'Loading…' : historyHasMore ? 'Load older' : 'History loaded'}
                      </button>
                    </div>
                  </div>

                  <div ref={chatScrollRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto p-4 z-10 space-y-2">
                    {historyLoading && <div className="date-separator"><span>Loading older messages…</span></div>}
                    {historyError && <div className="mx-auto max-w-lg rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm text-center">{historyError}</div>}
                    {!historyLoading && !historyError && messages.length === 0 && <div className="mx-auto mt-16 max-w-sm rounded-xl bg-white/90 shadow-sm px-6 py-5 text-center text-[#54656f]"><MessageSquare className="mx-auto mb-2" /><strong className="block text-[#111b21]">No messages loaded yet</strong><span className="text-sm">Use “Load older” to request this conversation’s history.</span></div>}
                    {messages.map((m, i) => {
                      const timestamp = messageTimestamp(m);
                      const previousTimestamp = i > 0 ? messageTimestamp(messages[i - 1]) : 0;
                      const showDate = !previousTimestamp || new Date(timestamp).toDateString() !== new Date(previousTimestamp).toDateString();
                      const quotedId = serializedId(m.quotedMsgId);
                      const quotedMessage = quotedId ? messages.find(candidate => serializedId(candidate.id) === quotedId) : null;
                      const mediaType = ['image', 'video', 'audio', 'ptt', 'sticker', 'document', 'location', 'live_location', 'vcard', 'contact_card'].includes(String(m.type).toLowerCase());
                      return <Fragment key={serializedId(m.id) || i}>
                      {showDate && <div className="date-separator"><span>{dayLabel(timestamp)}</span></div>}
                      <div key={serializedId(m.id) || i} className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
                        <div onClick={() => setSelectedMessage(m)} title="Inspect message payload" className={`message-bubble max-w-[65%] px-3 py-1.5 rounded-lg shadow-sm relative group ${mediaType ? 'media-bubble' : ''} ${selectedMessage === m ? 'message-selected' : ''} ${m.fromMe ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                          {!m.fromMe && activeChat.isGroup && m.sender?.pushname && (
                             <p className="text-xs font-medium text-orange-500 mb-0.5">{m.sender.pushname}</p>
                          )}
                          <MessageContent message={m} apiUrl={API_URL} quotedMessage={quotedMessage} onOpenMedia={openMedia} onContentResize={keepInitialBottomAnchor} />
                          <div className="text-[11px] text-[#667781] text-right mt-1 flex justify-end items-center gap-1">
                            {timestamp ? new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                            {m.fromMe && <span className={m.pending ? 'text-gray-400' : 'text-blue-500'}>{m.pending ? 'sending…' : '✓✓'}</span>}
                          </div>
                        </div>
                      </div>
                    </Fragment>})}
                    <div ref={messagesEndRef} />
                  </div>

                  {selectedMessage && <aside className="message-inspector">
                    <div className="message-inspector-head"><div><span>MESSAGE INTELLIGENCE</span><h3>Payload inspector</h3></div><button onClick={() => setSelectedMessage(null)} title="Close inspector"><X size={19} /></button></div>
                    <div className="inspector-grid">
                      <div><span>Type</span><strong>{selectedMessage.type || 'chat'}</strong></div>
                      <div><span>Direction</span><strong>{selectedMessage.fromMe ? 'Outbound' : 'Inbound'}</strong></div>
                      <div><span>Delivery ACK</span><strong>{selectedMessage.ack ?? 'n/a'}</strong></div>
                      <div><span>Timestamp</span><strong>{messageTimestamp(selectedMessage) ? new Date(messageTimestamp(selectedMessage)).toLocaleString() : 'n/a'}</strong></div>
                    </div>
                    <label>Message ID</label>
                    <div className="copy-field"><code>{serializedId(selectedMessage.id) || 'Unavailable'}</code><button onClick={() => navigator.clipboard.writeText(serializedId(selectedMessage.id))}><Copy size={15} /></button></div>
                    <label>Sender / author</label>
                    <div className="copy-field"><code>{selectedMessage.author || selectedMessage.from || 'Unavailable'}</code><button onClick={() => navigator.clipboard.writeText(selectedMessage.author || selectedMessage.from || '')}><Copy size={15} /></button></div>
                    <div className="inspector-json-title"><Code2 size={15} /> Raw WhatsApp payload <button onClick={() => navigator.clipboard.writeText(JSON.stringify(selectedMessage, null, 2))}>Copy JSON</button></div>
                    <pre>{JSON.stringify(selectedMessage, null, 2)}</pre>
                    <div className="inspector-safety"><EyeOff size={16} /><span>Inspected passively. No read receipt was sent.</span></div>
                  </aside>}

                  <div className="p-3 bg-[#f0f2f5] flex flex-col gap-2 z-10 relative">
                    {notice && <div className={`rounded-md border px-3 py-2 text-sm flex justify-between ${notice.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}><span>{notice.text}</span><button onClick={() => setNotice(null)}>Dismiss</button></div>}
                    {showEmojiPicker && <div className="absolute bottom-16 left-3 w-72 bg-white border border-gray-200 shadow-xl rounded-xl p-3 grid grid-cols-8 gap-1 z-30">{'😀 😃 😄 😁 😂 🥹 😊 😍 🥰 😘 😎 🤔 😭 😡 👍 👎 🙏 👏 🎉 ❤️ 💚 🔥 ✅ 👀 💯 🚀 🤝 🫶 😴 🤣'.split(' ').map(emoji => <button type="button" key={emoji} onClick={() => setMessageInput(value => value + emoji)} className="text-xl hover:bg-gray-100 rounded p-1">{emoji}</button>)}</div>}
                    <form onSubmit={sendMessage} className="flex-1 flex gap-2 items-end">
                      <button type="button" onClick={() => setShowEmojiPicker(value => !value)} title="Emoji" className="p-2.5 text-[#54656f] hover:text-[#00a884]"><Smile className="w-5 h-5" /></button>
                      <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach photo or file" className="p-2.5 text-[#54656f] hover:text-[#00a884]"><Paperclip className="w-5 h-5" /></button>
                      <button type="button" onClick={() => stickerInputRef.current?.click()} title="Send image as sticker" className="p-2.5 text-[#54656f] hover:text-[#00a884]"><Sticker className="w-5 h-5" /></button>
                      <input ref={fileInputRef} type="file" className="hidden" onChange={event => sendUpload(event.target.files?.[0], false)} />
                      <input ref={stickerInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => sendUpload(event.target.files?.[0], true)} />
                      <textarea 
                        rows={1}
                        placeholder="Type a message" 
                        className="flex-1 px-4 py-2.5 bg-white border-none rounded-lg focus:outline-none text-[15px] resize-none"
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); } }}
                      />
                      <button type="submit" disabled={!messageInput.trim() || isSending || isUploading} className="send-button p-2 text-white bg-[#00a884] rounded-lg hover:bg-[#008f70] disabled:opacity-50 transition">
                        {isSending || isUploading ? <LoaderCircle className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5] border-b-[6px] border-[#00a884]">
                   <h1 className="text-[32px] font-light text-[#41525d] mb-4">WhatsApp Dev Workspace</h1>
                   <p className="text-[#667781] text-[14px]">Send and receive messages seamlessly without keeping your phone online.</p>
                </div>
              )}
            </>
          )}

          {activeTab === 'status' && (
            <div className="flex-1 bg-black flex flex-col text-white relative">
              <div className="p-6 border-b border-gray-800 flex justify-between items-center z-10">
                <div>
                  <h1 className="text-2xl font-light">Status & Stories</h1>
                  <p className="text-gray-400 text-sm mt-1">Inspect synchronized updates without publishing view receipts.</p>
                </div>
                <div className="flex gap-3 items-center"><span className="privacy-badge"><EyeOff className="w-4 h-4" />Ninja mode · receipts disabled</span><button onClick={fetchStatuses} disabled={statusLoading} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm flex gap-2 items-center"><RefreshCw className={`w-4 h-4 ${statusLoading ? 'animate-spin' : ''}`} />Refresh</button></div>
              </div>
              
              {!activeStoryViewer ? (
                <div className="flex-1 overflow-y-auto p-6">
                  {Object.keys(statuses).length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center h-full opacity-50 mt-20">
                       <RefreshCw className={`w-16 h-16 text-gray-700 mx-auto mb-4 ${statusLoading ? 'animate-spin' : ''}`} />
                       <h3 className="text-lg text-gray-300">{statusLoading ? 'Loading statuses…' : statusError ? 'Status sync failed' : 'No active statuses'}</h3>
                       <p className={`text-sm mt-2 text-center max-w-md ${statusError ? 'text-red-400' : 'text-gray-500'}`}>{statusError || 'There are no unexpired contact updates in the linked WhatsApp account.'}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                      {Object.keys(statuses).map(senderId => {
                        const storyCount = statuses[senderId].length;
                        return (
                          <div key={senderId} onClick={() => openStoryViewer(senderId)} className="status-person flex flex-col items-center cursor-pointer group">
                            <div className="relative w-24 h-24 rounded-full p-1 border-4 border-green-500 group-hover:scale-105 transition">
                              <div className="w-full h-full rounded-full bg-gray-800 flex items-center justify-center overflow-hidden">
                                <Users className="w-10 h-10 text-gray-500" />
                              </div>
                            </div>
                            <h3 className="mt-3 text-sm font-medium text-gray-200 truncate w-32 text-center">
                            {statuses[senderId][0]?.notifyName || statuses[senderId][0]?.sender?.formattedName || senderId.split('@')[0]}
                            </h3>
                            <p className="text-xs text-gray-500">{storyCount} update{storyCount === 1 ? '' : 's'} · {dayLabel(messageTimestamp(statuses[senderId][0]))}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="absolute inset-0 bg-black z-50 flex flex-col story-viewer">
                  <div className="h-16 px-6 flex items-center justify-between z-10 bg-gradient-to-b from-black/60 to-transparent absolute top-0 w-full">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center">
                        <Users className="w-6 h-6 text-gray-400" />
                      </div>
                      <div><span className="font-semibold text-white">{statuses[activeStoryViewer]?.[0]?.notifyName || statuses[activeStoryViewer]?.[0]?.sender?.formattedName || activeStoryViewer.split('@')[0]}</span><p className="text-xs text-gray-300">{activeStoryIndex + 1} of {statuses[activeStoryViewer]?.length || 0} · private inspection</p></div>
                    </div>
                    <button onClick={() => setActiveStoryViewer(null)} className="text-white hover:text-gray-300" title="Close viewer"><X className="w-7 h-7" /></button>
                  </div>
                  <div className="flex-1 flex items-center justify-center bg-gray-900 relative">
                     <div className="absolute top-20 w-full px-8 flex gap-1 z-10">
                       {statuses[activeStoryViewer].map((_, i) => (
                         <div key={i} className="h-1 flex-1 bg-white rounded-full bg-opacity-30">
                            <div className={`h-full rounded-full ${i <= activeStoryIndex ? 'bg-white w-full' : 'bg-white/20 w-0'}`}></div>
                         </div>
                       ))}
                     </div>
                     <button disabled={activeStoryIndex === 0} onClick={() => moveStory(-1)} className="story-nav left-5"><ChevronLeft /></button>
                     <div className={`status-content ${statusHasMedia ? 'status-media' : 'status-text'} text-center w-full max-w-5xl`}>
                       <MessageContent key={serializedId(activeStatusMessage?.id) || activeStoryIndex} message={activeStatusMessage} apiUrl={API_URL} context="status" onOpenMedia={openMedia} />
                       <div className="status-meta">{new Date(messageTimestamp(activeStatusMessage)).toLocaleString()} · {activeStatusType.replaceAll('_', ' ')}</div>
                     </div>
                     <button disabled={activeStoryIndex >= statuses[activeStoryViewer].length - 1} onClick={() => moveStory(1)} className="story-nav right-5"><ChevronRight /></button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="flex-1 bg-white flex flex-col overflow-y-auto p-8 relative">
              <div className="mb-6"><div className="eyebrow">CONTROL PLANE</div><h1 className="text-2xl font-semibold text-[#111b21]">Developer Tools</h1><p className="text-sm text-gray-500 mt-1">Inspect runtime data and WebSocket traffic in real time.</p></div>
              
              {!activeDevTool ? (
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-5">
                  <div className="border border-gray-200 rounded-xl p-6 shadow-sm col-span-2 xl:col-span-3 bg-[#111820] text-white">
                    <div className="flex items-center justify-between">
                      <div><div className="text-xs text-[#8fa3b5] uppercase tracking-widest">Runtime</div><h3 className="text-xl mt-1 flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-green-400"></span>{diagnostics?.ready ? 'WhatsApp connected' : sessionStatus}</h3></div>
                      <div className="grid grid-cols-2 gap-8 text-right"><div><div className="text-2xl font-semibold">{chats.length}</div><div className="text-xs text-[#8fa3b5]">Chats</div></div><div><div className="text-2xl font-semibold">{contacts.length}</div><div className="text-xs text-[#8fa3b5]">Contacts</div></div></div>
                    </div>
                  </div>
                  <div className="border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition">
                    <h3 className="text-lg font-medium text-[#111b21] mb-2 flex items-center gap-2">
                      <Settings className="w-5 h-5 text-indigo-500" />
                      API Sandbox
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">Test sending advanced message payloads like buttons, lists, and locations directly through the API.</p>
                    <button onClick={() => setActiveDevTool('sandbox')} className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-100 transition">Launch Sandbox</button>
                  </div>

                  <div className="border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition">
                    <h3 className="text-lg font-medium mb-2 flex items-center gap-2"><Trash2 className="w-5 h-5 text-red-500" />Universal Deletion Monitor</h3>
                    <p className="text-sm text-gray-600 mb-4">Monitor revoked content across private chats, groups, and statuses with sender, source, recovery confidence, and deletion time.</p>
                    <button onClick={() => setActiveDevTool('deleted')} className="px-4 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-medium">Open deletion monitor</button>
                  </div>

                  <div className="border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition">
                    <h3 className="text-lg font-medium mb-2 flex items-center gap-2"><Database className="w-5 h-5 text-amber-500" />Contact Directory</h3>
                    <p className="text-sm text-gray-600 mb-4">Browse the raw WhatsApp address book and verify resolved names and identifiers.</p>
                    <button onClick={() => setActiveDevTool('contacts')} className="px-4 py-2 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium">Browse {contacts.length} contacts</button>
                  </div>

                  <div className="border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition">
                    <h3 className="text-lg font-medium mb-2 flex items-center gap-2"><Activity className="w-5 h-5 text-cyan-500" />Session Diagnostics</h3>
                    <p className="text-sm text-gray-600 mb-4">Inspect readiness, session identity, restore state, and the most recent runtime failure.</p>
                    <button onClick={() => setActiveDevTool('diagnostics')} className="px-4 py-2 bg-cyan-50 text-cyan-700 rounded-lg text-sm font-medium">View diagnostics</button>
                  </div>

                  <div className="border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition">
                    <h3 className="text-lg font-medium text-[#111b21] mb-2 flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-green-500" />
                      Raw JSON Inspector
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">Inspect the raw metadata, hidden IDs, and backend payload of your currently active chat session.</p>
                    <button onClick={() => setActiveDevTool('inspector')} className="px-4 py-2 bg-green-50 text-green-600 rounded-lg text-sm font-medium hover:bg-green-100 transition">Open Inspector</button>
                  </div>

                  <div className="border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition col-span-2">
                    <h3 className="text-lg font-medium text-[#111b21] mb-2 flex items-center gap-2">
                      <RefreshCw className="w-5 h-5 text-blue-500" />
                      Live Event Log
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">A live console streaming every single WebSocket event (typing indicators, read receipts, presence updates).</p>
                    <button onClick={() => setActiveDevTool('eventlog')} className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 transition">Open Live Console</button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col border border-gray-200 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 border-b border-gray-200 p-4 flex justify-between items-center">
                    <h3 className="font-semibold text-gray-700">
                      {activeDevTool === 'sandbox' ? 'Advanced Message Laboratory' : activeDevTool === 'inspector' ? 'Raw JSON Inspector' : activeDevTool === 'contacts' ? 'Contact Directory' : activeDevTool === 'diagnostics' ? 'Session Diagnostics' : activeDevTool === 'deleted' ? 'Universal Deletion Monitor' : 'Live Event Log'}
                    </h3>
                    <button onClick={() => setActiveDevTool(null)} className="text-sm text-gray-500 hover:text-gray-800">Close</button>
                  </div>
                  <div className="p-4 flex-1 overflow-auto bg-[#1e1e1e] text-green-400 font-mono text-xs">
                    {activeDevTool === 'inspector' && (
                      <pre>{JSON.stringify({
                        activeChatId: activeChat?.id._serialized || 'None selected',
                        chatMetadata: activeChat || 'Select a chat in the Chats tab to inspect it',
                        recentMessages: messages.slice(-5)
                      }, null, 2)}</pre>
                    )}
                    {activeDevTool === 'sandbox' && (
                      <div className="text-gray-300 max-w-4xl">
                        <div className="flex items-center gap-2 mb-5 flex-wrap">{Object.keys(MESSAGE_TEMPLATES).map(type => <button key={type} onClick={() => selectSandboxType(type)} className={`px-3 py-2 rounded font-sans text-xs capitalize ${sandboxType === type ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>{type}</button>)}</div>
                        <p className="mb-4 text-gray-500">POST /api/v1/messages/{MESSAGE_TEMPLATES[sandboxType].endpoint}</p>
                        {sandboxType !== 'reaction' && <div className="mb-5">
                          <label className="block mb-2 text-xs text-gray-400">Recipient</label>
                          <div className="flex gap-2 mb-3">{['contacts', 'groups', 'manual'].map(mode => <button key={mode} onClick={() => setRecipientMode(mode)} className={`px-3 py-1.5 rounded font-sans text-xs capitalize ${recipientMode === mode ? 'bg-[#00a884] text-white' : 'bg-gray-800 text-gray-400'}`}>{mode}</button>)}</div>
                          {recipientMode === 'manual' ? <input value={sandboxTo} onChange={e => setSandboxTo(e.target.value)} placeholder="15551234567 or 15551234567@c.us" className="w-full bg-black border border-gray-700 rounded p-3 text-green-400" /> : <>
                            <input value={recipientSearch} onChange={event => setRecipientSearch(event.target.value)} placeholder={`Search ${recipientMode} by name or ID`} className="w-full bg-black border border-gray-700 rounded p-3 mb-2 text-gray-200" />
                            <div className="recipient-picker">{recipientOptions.length === 0 ? <div className="p-4 text-gray-500">No matching {recipientMode} loaded.</div> : recipientOptions.map(item => { const id = contactId(item); return <button key={id} onClick={() => setSandboxTo(id)} className={sandboxTo === id ? 'selected' : ''}><span>{contactName(item)}</span><small>{id}</small></button>})}</div>
                            {sandboxTo && <div className="mt-2 text-xs text-[#72e0bd]">Selected: {contactName(recipientOptions.find(item => contactId(item) === sandboxTo))} · {sandboxTo}</div>}
                          </>}
                        </div>}
                        {!sandboxRawMode && <div className="sandbox-form font-sans">
                          {(sandboxType === 'text' || sandboxType === 'buttons') && <label><span>Message</span><textarea rows={3} value={sandboxFields.text} onChange={e => setSandboxFields(value => ({ ...value, text: e.target.value }))} placeholder="Enter the message people will receive" /></label>}
                          {sandboxType === 'buttons' && <>
                            <div className="sandbox-two"><label><span>Title <small>optional</small></span><input value={sandboxFields.title} onChange={e => setSandboxFields(value => ({ ...value, title: e.target.value }))} /></label><label><span>Footer <small>optional</small></span><input value={sandboxFields.footer} onChange={e => setSandboxFields(value => ({ ...value, footer: e.target.value }))} /></label></div>
                            <label><span>Button mode</span><div className="sandbox-segmented">{[['reply', 'Quick replies'], ['url', 'Website'], ['phone', 'Phone call']].map(([value, label]) => <button key={value} onClick={() => setSandboxFields(fields => ({ ...fields, buttonMode: value, actionValue: value === 'url' ? 'https://wppconnect.io' : value === 'phone' ? '+234' : fields.actionValue }))} className={sandboxFields.buttonMode === value ? 'active' : ''}>{label}</button>)}</div></label>
                            {sandboxFields.buttonMode === 'reply' ? <label><span>Reply buttons <small>one per line, maximum 3</small></span><textarea rows={4} value={sandboxFields.buttonLabels} onChange={e => setSandboxFields(value => ({ ...value, buttonLabels: e.target.value }))} placeholder={'Yes\nNo\nMaybe'} /></label> : <div className="sandbox-two"><label><span>Button label</span><input value={sandboxFields.actionLabel} onChange={e => setSandboxFields(value => ({ ...value, actionLabel: e.target.value }))} /></label><label><span>{sandboxFields.buttonMode === 'url' ? 'Website URL' : 'Phone number'}</span><input value={sandboxFields.actionValue} onChange={e => setSandboxFields(value => ({ ...value, actionValue: e.target.value }))} /></label></div>}
                          </>}
                          {sandboxType === 'list' && <><div className="sandbox-two"><label><span>List button</span><input value={sandboxFields.listButton} onChange={e => setSandboxFields(value => ({ ...value, listButton: e.target.value }))} /></label><label><span>Section title</span><input value={sandboxFields.title} onChange={e => setSandboxFields(value => ({ ...value, title: e.target.value }))} /></label></div><label><span>Description</span><input value={sandboxFields.listDescription} onChange={e => setSandboxFields(value => ({ ...value, listDescription: e.target.value }))} /></label><label><span>Rows <small>Title | Description, one per line</small></span><textarea rows={5} value={sandboxFields.listRows} onChange={e => setSandboxFields(value => ({ ...value, listRows: e.target.value }))} /></label></>}
                          {sandboxType === 'poll' && <><label><span>Poll question</span><input value={sandboxFields.pollQuestion} onChange={e => setSandboxFields(value => ({ ...value, pollQuestion: e.target.value }))} /></label><label><span>Choices <small>one per line</small></span><textarea rows={5} value={sandboxFields.pollChoices} onChange={e => setSandboxFields(value => ({ ...value, pollChoices: e.target.value }))} /></label><label><span>Maximum selections</span><input type="number" min="1" value={sandboxFields.selectableCount} onChange={e => setSandboxFields(value => ({ ...value, selectableCount: e.target.value }))} /></label></>}
                          {sandboxType === 'location' && <><div className="sandbox-two"><label><span>Latitude</span><input type="number" step="any" value={sandboxFields.latitude} onChange={e => setSandboxFields(value => ({ ...value, latitude: e.target.value }))} /></label><label><span>Longitude</span><input type="number" step="any" value={sandboxFields.longitude} onChange={e => setSandboxFields(value => ({ ...value, longitude: e.target.value }))} /></label></div><label><span>Location name</span><input value={sandboxFields.locationTitle} onChange={e => setSandboxFields(value => ({ ...value, locationTitle: e.target.value }))} /></label></>}
                          {sandboxType === 'contact' && <div className="sandbox-two"><label><span>Contact number</span><input value={sandboxFields.contact} onChange={e => setSandboxFields(value => ({ ...value, contact: e.target.value }))} /></label><label><span>Display name</span><input value={sandboxFields.contactName} onChange={e => setSandboxFields(value => ({ ...value, contactName: e.target.value }))} /></label></div>}
                          {sandboxType === 'reaction' && <div className="sandbox-two"><label><span>Message ID</span><input value={sandboxFields.messageId} onChange={e => setSandboxFields(value => ({ ...value, messageId: e.target.value }))} placeholder="Copy from Message Intelligence" /></label><label><span>Reaction</span><input value={sandboxFields.reaction} onChange={e => setSandboxFields(value => ({ ...value, reaction: e.target.value }))} /></label></div>}
                        </div>}
                        <div className="flex items-center justify-between mb-2"><label className="text-xs text-gray-400">{sandboxRawMode ? 'Raw JSON payload' : 'Generated API payload'}</label><button onClick={() => setSandboxRawMode(value => !value)} className="text-xs text-indigo-300 hover:text-indigo-200 font-sans">{sandboxRawMode ? 'Use visual form' : 'Edit advanced JSON'}</button></div>
                        {sandboxRawMode ? <textarea value={sandboxPayload} onChange={e => setSandboxPayload(e.target.value)} spellCheck={false} className="w-full h-72 bg-black text-green-400 p-3 border border-gray-700 rounded mb-4 font-mono" /> : <pre className="sandbox-preview">{sandboxPayload}</pre>}
                        <button disabled={(sandboxType !== 'reaction' && !sandboxTo.trim()) || sandboxResult?.pending} onClick={runSandbox} className="px-4 py-2 bg-indigo-600 disabled:opacity-50 text-white rounded font-sans text-sm flex items-center gap-2"><FlaskConical className="w-4 h-4" />{sandboxResult?.pending ? 'Executing…' : 'Execute API request'}</button>
                        {sandboxResult && !sandboxResult.pending && <pre className={`mt-5 p-4 rounded border ${sandboxResult.ok ? 'border-green-800 text-green-400' : 'border-red-800 text-red-400'}`}>{JSON.stringify(sandboxResult, null, 2)}</pre>}
                      </div>
                    )}
                    {activeDevTool === 'diagnostics' && <pre>{JSON.stringify({ ...diagnostics, socketConnected: socket.connected, apiBaseUrl: API_URL, loadedChats: chats.length, loadedContacts: contacts.length }, null, 2)}</pre>}
                    {activeDevTool === 'contacts' && <div className="space-y-2">{contacts.map((contact, index) => <div key={contact.id?._serialized || contact.id || index} className="border-b border-gray-800 pb-2"><span className="text-white">{contact.name || contact.formattedName || contact.verifiedName || contact.pushname || contact.shortName || 'Unnamed contact'}</span><span className="ml-3 text-gray-500">{contact.id?._serialized || contact.id}</span></div>)}</div>}
                    {activeDevTool === 'deleted' && <div className="space-y-3">{deletedMessages.length === 0 ? <div className="text-gray-500">Monitoring is active. No private-chat, group, or status deletions have been captured yet.</div> : deletedMessages.map(entry => { const original = entry.data?.original; const senderId = original?.author || original?.from || entry.data?.author || entry.data?.from; const contact = contacts.find(item => (item.id?._serialized || item.id) === senderId); const recovered = Boolean(original); const scope = entry.deletionScope || (entry.type === 'status.deleted' || entry.data?.from === 'status@broadcast' ? 'status' : 'private-chat'); const probable = entry.data?.recoveryStatus === 'probable-sender-match'; return <button type="button" key={entry.ledgerId} onClick={() => setSelectedDeletion(entry)} className="w-full text-left rounded border border-red-950 bg-[#251719] p-4 hover:bg-[#321d20] transition cursor-pointer"><div className="flex justify-between gap-4"><div className="flex items-center gap-2"><span className="text-red-400 font-semibold">{contact?.name || contact?.formattedName || original?.notifyName || senderId || 'Unknown sender'}</span><span className="rounded bg-gray-800 px-2 py-0.5 text-[9px] uppercase text-gray-300">{scope.replace('-', ' ')}</span></div><span className="text-gray-500">{new Date(entry.data?.deletedAt || entry.recordedAt).toLocaleString()}</span></div><div className={`inline-flex mt-2 px-2 py-1 rounded text-[10px] font-semibold ${recovered ? 'bg-green-950 text-green-400' : 'bg-amber-950 text-amber-300'}`}>{probable ? 'PROBABLE STATUS MATCH' : recovered ? 'ORIGINAL RECOVERED · CLICK TO VIEW' : 'NOT OBSERVED BEFORE DELETION'}</div><div className="text-gray-300 mt-2 whitespace-pre-wrap">{original?.body || original?.content || original?.caption || (original?.type ? `[Deleted ${original.type}]` : `A ${scope.replace('-', ' ')} deletion was detected, but WhatsApp supplied no recoverable original payload.`)}</div><div className="text-gray-600 mt-2">Source: {scope === 'status' ? 'Status broadcast' : original?.chatId?._serialized || original?.chatId || original?.to || entry.data?.from || 'unknown'}{entry.data?.referenceId ? ` · Message: ${entry.data.referenceId}` : ''}</div></button>})}</div>}
                    {activeDevTool === 'eventlog' && (
                      <div className="space-y-2">
                        {eventsLog.length === 0 ? (
                          <div className="text-gray-500">Waiting for events... Try sending a message from your phone.</div>
                        ) : (
                          eventsLog.map(ev => (
                            <div key={ev.id} className="border-b border-gray-800 pb-2">
                              <span className="text-blue-400">[{ev.time}]</span> <span className="text-purple-400 font-bold">{ev.name}</span>
                              <pre className="mt-1 text-gray-400 ml-4 overflow-hidden text-ellipsis">{JSON.stringify(ev.data, null, 2)}</pre>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {expandedMedia && <div className="media-lightbox" role="dialog" aria-label={`${expandedMedia.kind} viewer`} onClick={() => setExpandedMedia(null)}>
        <div className="media-lightbox-toolbar" onClick={event => event.stopPropagation()}>
          {expandedMedia.kind !== 'video' && <><button onClick={() => setMediaZoom(value => Math.max(.5, value - .25))} title="Zoom out"><ZoomOut size={20} /></button><span>{Math.round(mediaZoom * 100)}%</span><button onClick={() => setMediaZoom(value => Math.min(3, value + .25))} title="Zoom in"><ZoomIn size={20} /></button></>}
          <button onClick={() => setExpandedMedia(null)} title="Close media"><X size={23} /></button>
        </div>
        <div className="media-lightbox-stage" onClick={event => event.stopPropagation()}>
          {expandedMedia.kind === 'video' ? <video src={expandedMedia.url} controls autoPlay playsInline /> : <img src={expandedMedia.url} alt={expandedMedia.caption || expandedMedia.kind} style={{ transform: `scale(${mediaZoom})` }} />}
        </div>
        {expandedMedia.caption && <div className="media-lightbox-caption" onClick={event => event.stopPropagation()}>{expandedMedia.caption}</div>}
      </div>}
      {selectedDeletion && <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" role="dialog" aria-label="Deleted message viewer" onClick={() => setSelectedDeletion(null)}>
        <div className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl bg-[#111827] border border-red-900 p-5 text-white" onClick={event => event.stopPropagation()}>
          <div className="flex items-center justify-between mb-4"><div><div className="text-xs uppercase tracking-wider text-red-300">Recovered deleted content</div><h3 className="text-lg font-semibold">{selectedDeletion.data?.original?.type || 'Message'}</h3></div><button type="button" onClick={() => setSelectedDeletion(null)} title="Close"><X size={22} /></button></div>
          {selectedDeletion.data?.original ? <MessageContent message={selectedDeletion.data.original} apiUrl={API_URL} context="deletion" onOpenMedia={openMedia} /> : <div className="text-gray-400">WhatsApp reported the deletion, but no original payload was available to recover.</div>}
          <div className="mt-5 text-xs text-gray-500">Deleted {new Date(selectedDeletion.data?.deletedAt || selectedDeletion.recordedAt).toLocaleString()}</div>
        </div>
      </div>}
    </div>
  );
}

export default App;
