import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { getApiKey } from './auth';
import { LoaderCircle } from 'lucide-react';
import Layout from './components/Layout';

// Lazy load heavy routes to split the bundle and optimize initial load
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Developer = lazy(() => import('./pages/Developer'));
const Login = lazy(() => import('./pages/Login'));

const PremiumLoader = () => (
  <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#0a0c10] text-indigo-400">
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
  return (
    <BrowserRouter>
      <Suspense fallback={<PremiumLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/developer" element={<PrivateRoute><Developer /></PrivateRoute>} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
