import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Code2, LogOut, MessageSquare, Menu, X } from 'lucide-react';
import { removeApiKey } from '../auth';
import { motion, AnimatePresence } from 'framer-motion';

export default function Layout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await removeApiKey();
    navigate('/login');
  };

  const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/developer', icon: Code2, label: 'Developer API' },
  ];

  const SidebarContent = () => (
    <>
      <div>
        <div className="h-[72px] flex items-center px-6 border-b border-[#1e222b]">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold mr-3 shadow-lg shadow-indigo-500/20 shrink-0">
            <MessageSquare size={18} />
          </div>
          <span className="text-white font-extrabold text-xl tracking-tight">CommNexus</span>
        </div>
        
        <nav className="p-4 space-y-1.5 mt-2">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 px-3">Platform</div>
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center px-3 py-3 rounded-xl transition-all duration-300 relative group ${
                  active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {active && (
                  <motion.div layoutId="activeNavIndicator" className="absolute inset-0 bg-indigo-500/10 border border-indigo-500/20 rounded-xl hidden md:block" />
                )}
                {active && (
                   <div className="absolute inset-0 bg-indigo-500/10 border border-indigo-500/20 rounded-xl md:hidden" />
                )}
                <item.icon className={`w-5 h-5 mr-3 relative z-10 transition-colors ${active ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-400'}`} />
                <span className="relative z-10 font-semibold text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-[#1e222b]">
        <button 
          onClick={handleLogout}
          className="flex w-full items-center px-3 py-3 rounded-xl text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 transition-all duration-200 font-semibold text-sm group"
        >
          <LogOut className="w-5 h-5 mr-3 text-slate-500 group-hover:text-rose-400 transition-colors" />
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-[#0a0c10] text-slate-300 font-sans selection:bg-indigo-500/30 overflow-hidden flex-col">
      
      {/* Universal Top Header */}
      <div className="h-16 flex items-center justify-between px-4 sm:px-6 border-b border-[#1e222b] bg-[#0d1015]/80 backdrop-blur-xl z-30 shrink-0">
        <div className="flex items-center">
          <button onClick={() => setMobileMenuOpen(true)} className="p-2 mr-4 text-slate-400 hover:text-white rounded-lg bg-[#16191f] border border-[#1e222b] transition-colors">
            <Menu size={20} />
          </button>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold mr-3 shadow-lg shadow-indigo-500/20">
            <MessageSquare size={16} />
          </div>
          <span className="text-white font-extrabold tracking-tight text-lg">CommNexus</span>
        </div>
      </div>

      {/* Universal Sidebar Overlay Modal */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            />
            <motion.aside 
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
              className="fixed top-0 left-0 bottom-0 w-64 bg-[#0d1015] border-r border-[#1e222b] flex flex-col justify-between z-50 shadow-2xl"
            >
              {/* Close Button Inside Modal */}
              <button 
                onClick={() => setMobileMenuOpen(false)} 
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-lg bg-[#16191f] border border-[#1e222b] transition-colors z-50"
              >
                <X size={18} />
              </button>
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content Area with Page Transitions */}
      <main className="flex-1 flex flex-col relative bg-[#0a0c10] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div 
            key={location.pathname}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="flex-1 flex flex-col h-full overflow-hidden"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
      
    </div>
  );
}
