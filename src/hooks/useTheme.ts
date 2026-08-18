import { useCallback, useEffect, useState } from 'react';

// Custom hooks live in their own files (NOT alongside components) to satisfy the
// React Fast Refresh rule.
//
// ⚠ `localStorage` is NOT available to an app on immediately.run. Apps run in a
// sandboxed iframe at an OPAQUE origin, where merely *touching* `window.localStorage`
// throws `SecurityError: The document is sandboxed and lacks the 'allow-same-origin'
// flag` — it is not absent, it is present-and-throwing. So a `typeof localStorage`
// guard does NOT help: the throw happens on property access, before any comparison.
// It must be try/catch.
//
// This is easy to miss because it works everywhere you'd normally test: `vite dev`
// serves a same-origin page, and jsdom provides a working stub. The failure only
// appears on the real host — and because it threw during render here, it took the
// WHOLE app down with an error boundary, not just the theme toggle.
//
// Consequence for the feature, stated honestly rather than hidden: the theme choice
// is **session-only** on immediately.run. It applies for the life of the frame and is
// forgotten on reload. Persisting it for real needs host-mediated storage, not
// `localStorage`.
//
// (`document` and `window` themselves ARE available — it is specifically the
// same-origin-gated storage APIs that are not.)

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'immediately-run-app-theme';

/** Read the persisted theme, or `null` where storage is unreachable (the sandboxed
 *  iframe on immediately.run). Never throws. */
function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // opaque origin — no storage, and that is normal here
  }
}

/** Persist the theme where possible; a no-op where storage is unreachable. */
function writeStored(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* session-only on immediately.run — see the note above */
  }
}

function readInitialTheme(): Theme {
  return readStored() === 'light' ? 'light' : 'dark';
}

// Reflects the color theme on <html> as a `data-theme` attribute, matching the CSS
// in index.css, and persists it where storage exists. `dark` is the default,
// represented by the absence of the attribute.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    writeStored(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, toggle };
}
