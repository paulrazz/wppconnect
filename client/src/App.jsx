import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { getApiKey } from './auth';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Developer from './pages/Developer';
import Layout from './components/Layout';

function PrivateRoute({ children }) {
  const [apiKey, setApiKey] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    getApiKey().then(key => {
      setApiKey(key);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a] text-white">Loading...</div>;
  if (!apiKey) return <Navigate to="/login" replace />;
  
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/developer" element={<PrivateRoute><Developer /></PrivateRoute>} />
      </Routes>
    </BrowserRouter>
  );
}
