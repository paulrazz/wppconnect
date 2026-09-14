import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Code2, LogOut, Settings, MessageSquare } from 'lucide-react';
import { removeApiKey } from '../auth';

export default function Layout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await removeApiKey();
    navigate('/login');
  };

  const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/developer', icon: Code2, label: 'Developer API' },
  ];

  return (
    <div className="flex h-screen bg-[#0f1115] text-slate-300 font-sans">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-[#16191f] border-r border-[#262931] flex flex-col justify-between hidden md:flex">
        <div>
          <div className="h-16 flex items-center px-6 border-b border-[#262931]">
            <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-white font-bold mr-3 shadow-lg shadow-indigo-500/20">
              <MessageSquare size={18} />
            </div>
            <span className="text-white font-semibold text-lg tracking-tight">CommNexus</span>
          </div>
          
          <nav className="p-4 space-y-1">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 px-2">Platform</div>
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center px-3 py-2.5 rounded-lg transition-all duration-200 ${
                    active 
                      ? 'bg-indigo-500/10 text-indigo-400 font-medium' 
                      : 'text-slate-400 hover:bg-[#20242c] hover:text-slate-200'
                  }`}
                >
                  <item.icon className={`w-5 h-5 mr-3 ${active ? 'text-indigo-400' : 'text-slate-400'}`} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-[#262931]">
          <button 
            onClick={handleLogout}
            className="flex w-full items-center px-3 py-2.5 rounded-lg text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 transition-all duration-200"
          >
            <LogOut className="w-5 h-5 mr-3" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative bg-[#0f1115]">
        {children}
      </main>
    </div>
  );
}
