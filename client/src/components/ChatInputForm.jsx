import { useState } from 'react';
import { Send, LoaderCircle } from 'lucide-react';
import { useTheme } from '../ThemeContext';
import axios from 'axios';

export default function ChatInputForm({ activeChatId, apiKey, onMessageSent, API_URL }) {
  const { theme } = useTheme();
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !activeChatId) return;
    
    setSending(true);
    try {
      const res = await axios.post(`${API_URL}/send-message`, 
        { to: activeChatId.replace('@c.us', ''), text: replyText },
        { headers: { 'x-api-key': apiKey } }
      );
      
      const sentMsg = {
        id: res.data.response?.id || Date.now().toString(),
        body: replyText,
        fromMe: true,
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      onMessageSent(sentMsg);
      setReplyText('');
    } catch (err) {
      console.error(err);
      alert('Failed to send message');
    }
    setSending(false);
  };

  return (
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
  );
}
