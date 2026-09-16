import sys

path = 'client/src/components/ChatAutomationsModal.jsx'
content = """import React from 'react';
import { X, Users, User as UserIcon } from 'lucide-react';
import AutomationStudio from './AutomationStudio';

export default function ChatAutomationsModal({ apiKey, theme, chatId, chatName, isGroup, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className={`w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col rounded-2xl border shadow-2xl ${theme === 'dark' ? 'bg-[#12151a] border-[#262931]' : 'bg-white border-slate-200'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`shrink-0 flex items-center gap-3 px-6 py-4 border-b ${theme === 'dark' ? 'bg-[#12151a] border-[#1e222b]' : 'bg-white border-slate-200'}`}>
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isGroup ? (theme === 'dark' ? 'bg-violet-500/15 text-violet-400' : 'bg-violet-100 text-violet-600') : (theme === 'dark' ? 'bg-indigo-500/15 text-indigo-400' : 'bg-indigo-100 text-indigo-600')}`}>
            {isGroup ? <Users className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <h3 className={`font-bold text-lg truncate ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>{chatName || 'This chat'}</h3>
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${theme === 'dark' ? 'text-violet-400' : 'text-violet-600'}`}>
              {isGroup ? 'Group automations' : 'Automations for this contact'}
            </p>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono truncate max-w-[160px] ${theme === 'dark' ? 'bg-[#1e222b] text-slate-400' : 'bg-slate-100 text-slate-500'}`}>{chatId}</span>
          <button onClick={onClose} className={`ml-auto p-2 rounded-lg transition-colors ${theme === 'dark' ? 'text-slate-500 hover:text-slate-300 hover:bg-[#1e222b]' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <AutomationStudio 
            apiKey={apiKey} 
            theme={theme} 
            initialChatScope={chatId}
            lockedChatScope={chatId}
          />
        </div>
      </div>
    </div>
  );
}
"""

with open(path, 'w') as f:
    f.write(content)

