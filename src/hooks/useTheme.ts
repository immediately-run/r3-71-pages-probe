import { useCallback, useEffect, useState } from 'react';

// Custom hooks live in their own files (NOT alongside components) to satisfy the
// React Fast Refresh rule. localStorage / document / window are all available in
// the immediately.run iframe.

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'immediately-run-app-theme';

function readInitialTheme(): Theme {
  return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

// Persists the color theme to localStorage and reflects it on <html> as a
// `data-theme` attribute, matching the CSS in index.css. `dark` is the default,
// represented by the absence of the attribute.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, toggle };
}
