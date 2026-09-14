import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { getApiKey } from '../auth';
import { useTheme } from '../ThemeContext';
import { Send, UserCircle, Search, MessageSquare, LoaderCircle, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');
const API_URL = `${SERVER_URL}/api`;

export default function LiveInbox() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  const [apiKey, setApiKey] = useState('');
  const [sessionStatus, setSessionStatus] = useState('LOADING');
  const [contacts, setContacts] = useState({});
  const [chats, setChats] = useState({}); // { chatId: { contact: {}, messages: [] } }
  const [activeChatId, setActiveChatId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    let socket;
    getApiKey().then(key => {
      setApiKey(key);
      if (!key) return;

      // Verify connection status
      axios.get(`${API_URL}/status`, { headers: { 'x-api-key': key } })
        .then(res => {
          setSessionStatus(res.data.status);
          if (res.data.status === 'CONNECTED') {
            fetchContacts(key);
            connectSocket(key);
          }
        })
        .catch(() => setSessionStatus('DISCONNECTED'));
    });

    const fetchContacts = async (key) => {
      try {
        const res = await axios.get(`${API_URL}/contacts`, { headers: { 'x-api-key': key } });
        const contactMap = {};
        res.data.contacts.forEach(c => {
          contactMap[c.id._serialized] = c;
        });
        setContacts(contactMap);
      } catch (err) {
        console.error("Failed to load contacts", err);
      }
    };

    const connectSocket = (key) => {
      socket = io(SERVER_URL || window.location.origin, { 
        auth: { apiKey: key },
        transports: ['websocket', 'polling']
      });

      socket.on('new_message', (msg) => {
        const chatId = msg.chatId?._serialized || msg.from;
        setChats(prev => {
          const updated = { ...prev };
          if (!updated[chatId]) {
            updated[chatId] = { messages: [] };
          }
          // Avoid duplicates
          if (!updated[chatId].messages.some(m => m.id === msg.id)) {
            updated[chatId].messages.push(msg);
          }
          return updated;
        });
      });
    };

    return () => socket && socket.disconnect();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chats, activeChatId]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !activeChatId) return;
    
    setSending(true);
    try {
      const res = await axios.post(`${API_URL}/send-message`, 
        { to: activeChatId.replace('@c.us', ''), text: replyText },
        { headers: { 'x-api-key': apiKey } }
      );
      
      // Manually push our own message to the view
      const sentMsg = {
        id: res.data.response?.id || Date.now().toString(),
        body: replyText,
        fromMe: true,
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      setChats(prev => {
        const updated = { ...prev };
        updated[activeChatId].messages.push(sentMsg);
        return updated;
      });
      setReplyText('');
    } catch (err) {
      console.error(err);
      alert('Failed to send message');
    }
    setSending(false);
  };

  const resolveName = (chatId) => {
    if (!chatId) return 'Unknown';
    if (contacts[chatId]?.name) return contacts[chatId].name;
    if (contacts[chatId]?.pushname) return contacts[chatId].pushname;
    return chatId.split('@')[0];
  };

  if (sessionStatus === 'LOADING') {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center ${theme === 'dark' ? 'bg-[#0a0c10] text-indigo-400' : 'bg-slate-50 text-indigo-600'}`}>
        <LoaderCircle className="w-10 h-10 animate-spin mb-4" />
        <span className="font-bold tracking-widest uppercase text-sm">Initializing Inbox...</span>
      </div>
    );
  }

  if (sessionStatus !== 'CONNECTED') {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center p-6 text-center ${theme === 'dark' ? 'bg-[#0a0c10]' : 'bg-slate-50'}`}>
        <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 shadow-2xl ${theme === 'dark' ? 'bg-[#12151a] border border-[#1e222b] text-slate-500' : 'bg-white border border-slate-200 text-slate-400'}`}>
          <Lock className="w-10 h-10" />
        </div>
        <h1 className={`text-3xl font-extrabold tracking-tight mb-4 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
          Inbox Locked
        </h1>
        <p className={`max-w-md mb-8 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
          Your secure inbox requires an active WhatsApp connection. Please connect your device to start streaming live messages.
        </p>
        <button 
          onClick={() => navigate('/')} 
          className="px-8 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 transition-all"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  const activeChatData = activeChatId ? chats[activeChatId] : null;
  const chatList = Object.keys(chats).map(id => ({ id, ...chats[id] })).sort((a, b) => {
    const lastA = a.messages[a.messages.length - 1]?.timestamp || 0;
    const lastB = b.messages[b.messages.length - 1]?.timestamp || 0;
    return lastB - lastA;
  });

  return (
    <div className={`flex-1 flex overflow-hidden ${theme === 'dark' ? 'bg-[#0a0c10]' : 'bg-white'}`}>
      
      {/* Left Sidebar: Chat List */}
      <div className={`w-full md:w-80 lg:w-96 flex flex-col shrink-0 border-r ${theme === 'dark' ? 'border-[#1e222b] bg-[#0d1015]' : 'border-slate-200 bg-slate-50'} ${activeChatId ? 'hidden md:flex' : 'flex'}`}>
        
        {/* Header */}
        <div className={`h-16 flex items-center px-4 shrink-0 border-b ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-200'}`}>
          <h2 className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Live Inbox</h2>
          <span className="ml-auto text-xs font-semibold bg-indigo-500/10 text-indigo-500 px-2 py-1 rounded-full border border-indigo-500/20">Clean Slate</span>
        </div>

        {/* Search */}
        <div className={`p-4 border-b ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-200'}`}>
          <div className="relative">
            <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`} />
            <input type="text" placeholder="Search live sessions..." className={`w-full pl-9 pr-4 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${theme === 'dark' ? 'bg-[#16191f] border-[#1e222b] text-slate-200 placeholder-slate-500' : 'bg-white border-slate-300 text-slate-700 placeholder-slate-400'}`} />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {chatList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <MessageSquare className={`w-12 h-12 mb-4 opacity-50 ${theme === 'dark' ? 'text-slate-600' : 'text-slate-300'}`} />
              <p className={`text-sm font-medium ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Waiting for new messages...</p>
              <p className={`text-xs mt-2 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>Historic chats are hidden to preserve privacy.</p>
            </div>
          ) : (
            chatList.map(chat => {
              const lastMsg = chat.messages[chat.messages.length - 1];
              const isActive = activeChatId === chat.id;
              
              return (
                <button
                  key={chat.id}
                  onClick={() => setActiveChatId(chat.id)}
                  className={`w-full flex items-center p-4 border-b text-left transition-colors ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-100'} ${isActive ? (theme === 'dark' ? 'bg-[#1c2028]' : 'bg-indigo-50') : (theme === 'dark' ? 'hover:bg-[#16191f]' : 'hover:bg-slate-100')}`}
                >
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 mr-4 ${theme === 'dark' ? 'bg-[#262931]' : 'bg-slate-200'}`}>
                    <UserCircle className={`w-8 h-8 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <h3 className={`font-semibold text-sm truncate pr-2 ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>{resolveName(chat.id)}</h3>
                      <span className={`text-[10px] shrink-0 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                        {new Date((lastMsg?.timestamp || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className={`text-xs truncate ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                      {lastMsg?.fromMe ? 'You: ' : ''}{lastMsg?.type === 'chat' ? lastMsg.body : '📷 Media message'}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Content: Active Chat */}
      <div className={`flex-1 flex flex-col min-w-0 ${activeChatId ? 'flex' : 'hidden md:flex'}`}>
        {!activeChatId ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 shadow-xl ${theme === 'dark' ? 'bg-[#12151a] border border-[#1e222b] text-indigo-500/30' : 'bg-white border border-slate-200 text-indigo-300'}`}>
              <MessageSquare className="w-10 h-10" />
            </div>
            <h2 className={`text-2xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>CommNexus Live Inbox</h2>
            <p className={`max-w-md text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
              Select a conversation from the sidebar to start responding to live incoming messages.
            </p>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className={`h-16 flex items-center px-6 shrink-0 border-b shadow-sm z-10 ${theme === 'dark' ? 'border-[#1e222b] bg-[#0d1015]' : 'border-slate-200 bg-white'}`}>
              <button onClick={() => setActiveChatId(null)} className="md:hidden p-2 -ml-3 mr-2 text-slate-500">
                &larr;
              </button>
              <div className={`w-9 h-9 rounded-full flex items-center justify-center mr-3 ${theme === 'dark' ? 'bg-[#1e222b]' : 'bg-slate-100'}`}>
                <UserCircle className={`w-6 h-6 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`} />
              </div>
              <h2 className={`font-bold text-lg truncate ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>
                {resolveName(activeChatId)}
              </h2>
            </div>

            {/* Chat Messages */}
            <div className={`flex-1 overflow-y-auto p-6 flex flex-col gap-4 ${theme === 'dark' ? 'bg-[#0a0c10]' : 'bg-slate-50'}`}>
              {activeChatData.messages.map((msg, idx) => {
                const isMe = msg.fromMe;
                return (
                  <div key={msg.id || idx} className={`flex flex-col max-w-[75%] ${isMe ? 'self-end' : 'self-start'}`}>
                    <div className={`px-4 py-2.5 rounded-2xl ${isMe ? 'bg-indigo-600 text-white rounded-tr-sm shadow-indigo-500/20' : (theme === 'dark' ? 'bg-[#1e222b] text-slate-200 rounded-tl-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm')} shadow-sm`}>
                      {msg.type === 'chat' ? (
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                      ) : (
                        <p className="text-sm italic opacity-80">Media payload hidden (API delivery only)</p>
                      )}
                    </div>
                    <span className={`text-[10px] mt-1 px-1 ${isMe ? 'text-right' : 'text-left'} ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                      {new Date((msg.timestamp || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSend} className={`p-4 shrink-0 border-t ${theme === 'dark' ? 'border-[#1e222b] bg-[#0d1015]' : 'border-slate-200 bg-white'}`}>
              <div className={`flex items-end rounded-xl border p-2 transition-colors ${theme === 'dark' ? 'bg-[#16191f] border-[#262931] focus-within:border-indigo-500/50' : 'bg-slate-50 border-slate-300 focus-within:border-indigo-400'}`}>
                <textarea 
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
                  placeholder="Type a message..."
                  className="flex-1 max-h-32 bg-transparent border-none focus:ring-0 text-sm p-2 resize-none outline-none dark:text-slate-200 text-slate-800 placeholder-slate-500"
                  rows={1}
                />
                <button 
                  type="submit" 
                  disabled={sending || !replyText.trim()}
                  className="p-2 mb-1 mr-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors shrink-0 flex items-center justify-center"
                >
                  {sending ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
                </button>
              </div>
              <div className={`mt-2 text-center text-[10px] font-medium tracking-wide ${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>
                PRESS ENTER TO SEND &bull; SHIFT+ENTER FOR NEW LINE
              </div>
            </form>
          </>
        )}
      </div>

    </div>
  );
}
