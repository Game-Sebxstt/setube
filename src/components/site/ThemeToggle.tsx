'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { type Theme, browserStorage, saveTheme } from '@/lib/storage';

function subscribe(cb: () => void): () => void {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
}
const getSnapshot = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const getServerSnapshot = (): Theme => 'dark';

// La etiqueta es fija; el estado lo comunica aria-pressed.
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const dark = theme === 'dark';
  const toggle = () => {
    const next: Theme = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    saveTheme(browserStorage(), next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Tema oscuro"
      title="Tema oscuro"
      aria-pressed={dark}
      className="inline-flex size-11 items-center justify-center rounded-control border border-edge text-ink hover:bg-panel"
    >
      {dark ? (
        <Moon aria-hidden="true" focusable="false" className="size-5" />
      ) : (
        <Sun aria-hidden="true" focusable="false" className="size-5" />
      )}
    </button>
  );
}
