import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ThemeContext = createContext();

// Guarded read so a blocked/disabled localStorage (private mode, sandboxed
// iframe) can never crash the whole app.
const readTheme = () => {
  try {
    return localStorage.getItem('theme') || 'dark';
  } catch (_) {
    return 'dark';
  }
};

const applyTheme = (theme) => {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  root.style.colorScheme = theme;
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readTheme);

  // The initial class is applied pre-paint by an inline script in index.html;
  // this keeps it in sync for toggles and any theme change after mount.
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem('theme', theme);
    } catch (_) {}
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme(t => (t === 'dark' ? 'light' : 'dark')), []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
