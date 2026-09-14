import { useState } from 'react';
import { Send, LoaderCircle, X } from 'lucide-react';
import { useTheme } from '../ThemeContext';
import axios from 'axios';

const msgId = (m) => m?.id?._serialized || m?.id?.id || (typeof m?.id === 'string' ? m.id : null);
const previewText = (m) => m?.caption || m?.body || m?.text || m?.type || 'Message';

export default function ChatInputForm({ activeChatId, apiKey, onMessageSent, API_URL, replyTo = null, onClearReply }) {
  const { theme } = useTheme();
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !activeChatId) return;
    
    setSending(true);
    try {
      const payload = { to: activeChatId.split('@')[0], text: replyText };
      if (replyTo && msgId(replyTo)) payload.quotedMsg = msgId(replyTo);
      const res = await axios.post(`${API_URL}/send-message`, payload,
        { headers: { 'x-api-key': apiKey } }
      );
      
      const raw = res.data?.response || res.data;
      const sentMsg = {
        id: raw?.id?._serialized || raw?.id?.id || raw?.id || Date.now().toString(),
        body: replyText,
        fromMe: true,
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      onMessageSent(sentMsg);
      setReplyText('');
      onClearReply?.();
    } catch (err) {
      console.error(err);
      alert('Failed to send message');
    }
    setSending(false);
  };

  return (
    <div className={`shrink-0 border-t ${theme === 'dark' ? 'border-[#1e222b] bg-[#0d1015]' : 'border-slate-200 bg-white'}`}>
      {replyTo && (
        <div className={`flex items-center gap-3 px-4 pt-3 ${theme === 'dark' ? 'bg-[#12151a]' : 'bg-slate-50'}`}>
          <div className={`flex-1 min-w-0 px-3 py-2 rounded-lg border-l-4 text-xs ${theme === 'dark' ? 'bg-black/30 border-indigo-500 text-slate-300' : 'bg-white border-indigo-400 text-slate-600'}`}>
            <p className={`font-semibold mb-0.5 ${theme === 'dark' ? 'text-indigo-300' : 'text-indigo-600'}`}>
              Replying to {replyTo.fromMe ? 'yourself' : (replyTo.senderName || replyTo.notifyName || activeChatId.split('@')[0])}
            </p>
            <p className="truncate italic">{previewText(replyTo)}</p>
          </div>
          <button onClick={onClearReply} className={`p-1.5 rounded-lg ${theme === 'dark' ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-slate-700'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <form onSubmit={handleSend} className={`p-4 ${theme === 'dark' ? 'bg-[#0d1015]' : 'bg-white'}`}>
        <div className={`flex items-end rounded-xl border p-2 transition-colors ${theme === 'dark' ? 'bg-[#16191f] border-[#262931] focus-within:border-indigo-500/50' : 'bg-slate-50 border-slate-300 focus-within:border-indigo-400'}`}>
          <textarea 
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
            placeholder={replyTo ? 'Write your reply...' : 'Type a message...'}
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
    </div>
  );
}