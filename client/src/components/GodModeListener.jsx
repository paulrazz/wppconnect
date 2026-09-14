import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export default function GodModeListener() {
  const navigate = useNavigate();
  const buffer = useRef('');

  useEffect(() => {
    // Hidden string!
    const command = import.meta.env.VITE_COMMAND_STRING || 'sudo-nexus';
    
    const handleKeyDown = (e) => {
      // Ignore if typing inside any form input/textarea to not conflict with normal typing
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key.length !== 1) return; 
      
      buffer.current += e.key;
      if (buffer.current.length > command.length) {
        buffer.current = buffer.current.slice(-command.length);
      }
      
      if (buffer.current === command) {
        sessionStorage.setItem('x-admin-key', command);
        buffer.current = ''; 
        navigate('/admin-core');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  return null;
}
