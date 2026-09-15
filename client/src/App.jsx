import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { getApiKey } from './auth';
import { LoaderCircle } from 'lucide-react';
import Layout from './components/Layout';
import GodModeListener from './components/GodModeListener';
import { ThemeProvider } from './ThemeContext';

// Lazy load heavy routes to split the bundle and optimize initial load
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Developer = lazy(() => import('./pages/Developer'));
const LiveInbox = lazy(() => import('./pages/LiveInbox'));
const Login = lazy(() => import('./pages/Login'));
const AdminCore = lazy(() => import('./pages/AdminCore'));

const PremiumLoader = () => (
  <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-[#0a0c10] text-indigo-400">
    <div className="relative flex items-center justify-center">
      <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full animate-pulse" />
      <LoaderCircle className="w-10 h-10 animate-spin relative z-10" />
    </div>
    <span className="mt-4 text-sm font-bold tracking-widest text-slate-500 uppercase">Loading Environment...</span>
  </div>
);

function PrivateRoute({ children }) {
  const [apiKey, setApiKey] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    getApiKey().then(key => {
      setApiKey(key);
      setLoading(false);
    });
  }, []);

  if (loading) return <PremiumLoader />;
  if (!apiKey) return <Navigate to="/login" replace />;
  
  return <Layout><Suspense fallback={<PremiumLoader />}>{children}</Suspense></Layout>;
}

export default function App() {
  // Set once globally so every page's API calls carry the key without each
  // page re-hydrating it or showing a loader while it resolves.
  useEffect(() => {
    getApiKey().then(key => { if (key) axios.defaults.headers.common['x-api-key'] = key; });
  }, []);

  return (
    <ThemeProvider>
      <BrowserRouter>
        <GodModeListener />
        <Suspense fallback={<PremiumLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/admin-core" element={<Suspense fallback={<PremiumLoader />}><AdminCore /></Suspense>} />
            <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
            <Route path="/developer" element={<PrivateRoute><Developer /></PrivateRoute>} />
            <Route path="/inbox" element={<PrivateRoute><LiveInbox /></PrivateRoute>} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  );
}
