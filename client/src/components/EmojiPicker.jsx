import { useState } from 'react';
import { Smile, Hand, PawPrint, Pizza, Trophy, Plane, Package, Heart, Flag } from 'lucide-react';
import { EMOJI_CATEGORIES } from '../emojiData';

const CATEGORY_ICONS = { smile: Smile, hand: Hand, 'paw-print': PawPrint, pizza: Pizza, trophy: Trophy, plane: Plane, package: Package, heart: Heart, flag: Flag };

export default function EmojiPicker({ onSelect, selected = '', theme, gridCols = 'grid-cols-7', heightClass = 'max-h-36', className = '' }) {
  const [cat, setCat] = useState(EMOJI_CATEGORIES[0].id);
  const active = EMOJI_CATEGORIES.find(c => c.id === cat) || EMOJI_CATEGORIES[0];
  const dark = theme === 'dark';

  return (
    <div className={`rounded-xl border shadow-xl overflow-hidden ${dark ? 'bg-[#16191f] border-[#262931]' : 'bg-white border-slate-200'} ${className}`}>
      <div className={`flex items-center gap-0.5 overflow-x-auto px-2 py-1.5 border-b ${dark ? 'border-[#262931]' : 'border-slate-200'}`}>
        {EMOJI_CATEGORIES.map(c => {
          const Icon = CATEGORY_ICONS[c.icon] || Smile;
          const isActive = c.id === active.id;
          return (
            <button
              key={c.id}
              type="button"
              title={c.label}
              onClick={() => setCat(c.id)}
              className={`shrink-0 p-1.5 rounded-lg transition-colors ${isActive ? (dark ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-100 text-indigo-600') : (dark ? 'text-slate-500 hover:text-slate-300 hover:bg-white/5' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100')}`}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
      </div>
      <div className={`overflow-y-auto p-2 ${heightClass}`}>
        <div className={`grid ${gridCols} gap-0.5`}>
          {active.emojis.map(emo => {
            const isSelected = emo === selected;
            return (
              <button
                key={emo}
                type="button"
                onClick={() => onSelect(emo)}
                className={`text-lg leading-none rounded-md p-0.5 transition-transform hover:scale-125 hover:bg-indigo-500/10 ${isSelected ? (dark ? 'bg-indigo-500/25' : 'bg-indigo-200') : ''}`}
              >
                {emo}
              </button>
            );
          })}
        </div>
      </div>
      <div className={`text-center text-[9px] font-semibold uppercase tracking-wide py-0.5 border-t ${dark ? 'text-slate-600 border-[#262931]' : 'text-slate-400 border-slate-200'}`}>
        {active.label}
      </div>
    </div>
  );
}