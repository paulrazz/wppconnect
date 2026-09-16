import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Code2, LogOut, MessageSquare, Menu, X, Sun, Moon, Inbox } from 'lucide-react';
import { removeApiKey } from '../auth';
import liveStream from '../liveStream';
import { useTheme } from '../ThemeContext';

const NAV_ITEMS = [
  { path: '/inbox', icon: Inbox, label: 'Live Inbox' },
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/developer', icon: Code2, label: 'Developer API' },
];

function SidebarContent({ currentPath, onLogout, onNavigate }) {
  return (
    <>
      <div>
        <div className="h-[72px] flex items-center px-6 border-b border-slate-200 dark:border-[#1e222b]">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold mr-3 shadow-lg shadow-indigo-500/20 shrink-0">
            <MessageSquare size={18} />
          </div>
          <span className="text-slate-900 dark:text-white font-extrabold text-xl tracking-tight">CommNexus</span>
        </div>
        
        <nav className="p-4 space-y-1.5 mt-2" aria-label="Primary">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 px-3">Platform</div>
          {NAV_ITEMS.map((item) => {
            const active = currentPath === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
                className={`flex items-center px-3 py-3 rounded-xl transition-all duration-300 relative group ${
                  active ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {active && (
                  <div className="absolute inset-0 bg-indigo-500/10 border border-indigo-500/20 rounded-xl hidden md:block" />
                )}
                {active && (
                   <div className="absolute inset-0 bg-indigo-500/10 border border-indigo-500/20 rounded-xl md:hidden" />
                )}
                <item.icon className={`w-5 h-5 mr-3 relative z-10 transition-colors ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 group-hover:text-slate-400'}`} />
                <span className="relative z-10 font-semibold text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-200 dark:border-[#1e222b]">
        <button 
          onClick={onLogout}
          className="flex w-full items-center px-3 py-3 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-rose-50/50 dark:hover:bg-rose-500/10 hover:text-rose-500 dark:hover:text-rose-400 transition-all duration-200 font-semibold text-sm group"
        >
          <LogOut className="w-5 h-5 mr-3 text-slate-500 group-hover:text-rose-500 dark:group-hover:text-rose-400 transition-colors" />
          Sign Out
        </button>
      </div>
    </>
  );
}

export default function Layout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const handleLogout = async () => {
    try {
      liveStream.disconnect();
    } catch { /* socket may be uninitialized */ }
    try {
      await removeApiKey();
    } catch { /* ignore localStorage failures */ }
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#0a0c10] text-slate-700 dark:text-slate-300 font-sans selection:bg-indigo-500/30 overflow-hidden flex-col">
      
      {/* Universal Top Header */}
      <div className="min-h-16 safe-area-top flex items-center justify-between px-4 sm:px-6 border-b border-slate-200 dark:border-[#1e222b] bg-white/80 dark:bg-[#0d1015]/80 backdrop-blur-xl z-30 shrink-0">
        <div className="flex items-center">
          <button onClick={() => setMobileMenuOpen(true)} className="p-2 mr-4 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg bg-slate-100 dark:bg-[#16191f] border border-slate-200 dark:border-[#1e222b] transition-colors">
            <Menu size={20} />
          </button>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold mr-3 shadow-lg shadow-indigo-500/20">
            <MessageSquare size={16} />
          </div>
          <span className="text-slate-900 dark:text-white font-extrabold tracking-tight text-lg">CommNexus</span>
        </div>
        
        {/* Global Theme Toggle */}
        <button 
          onClick={toggleTheme}
          className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg bg-slate-100 dark:bg-[#16191f] border border-slate-200 dark:border-[#1e222b] transition-colors"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>

      {/* Universal Sidebar Overlay Modal (CSS-driven: kept mounted so the
          close animation can run; translate/opacity toggle on state). */}
      <div
        className={`fixed inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${mobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setMobileMenuOpen(false)}
      />
      <aside
        className={`fixed top-0 left-0 bottom-0 w-64 max-w-[85vw] bg-white dark:bg-[#0d1015] border-r border-slate-200 dark:border-[#1e222b] flex flex-col justify-between z-50 shadow-2xl safe-area-top safe-area-bottom transition-transform duration-300 ease-out ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        aria-hidden={!mobileMenuOpen}
      >
        {/* Close Button Inside Modal */}
        <button 
          onClick={() => setMobileMenuOpen(false)} 
          className="absolute top-4 right-4 p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white rounded-lg bg-slate-100 dark:bg-[#16191f] border border-slate-200 dark:border-[#1e222b] transition-colors z-50"
        >
          <X size={18} />
        </button>
        <SidebarContent currentPath={location.pathname} onLogout={handleLogout} onNavigate={() => setMobileMenuOpen(false)} />
      </aside>

      {/* Main Content Area with Page Transition (CSS keyframe, keyed by route
          so navigation replays the fade/slide). Honors prefers-reduced-motion
          via the global media rule in index.css. */}
      <main className="flex-1 flex flex-col relative bg-slate-50 dark:bg-[#0a0c10] overflow-hidden">
        <div
          key={location.pathname}
          className="page-transition flex-1 flex flex-col h-full overflow-hidden"
        >
          {children}
        </div>
      </main>
    </div>
  );
}
