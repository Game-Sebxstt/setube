'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Toast {
  id: number;
  message: string;
  tone: 'error' | 'info';
  action?: { label: string; run: () => void };
}

const DURATION_MS = 6000;
const MAX = 3;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((message: string, tone: Toast['tone'] = 'error', action?: Toast['action']) => {
    setToasts((list) => {
      // el mismo mensaje no se apila
      const rest = list.filter((t) => t.message !== message);
      return [...rest, { id: nextId.current++, message, tone, action }].slice(-MAX);
    });
  }, []);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  return { toasts, push, dismiss };
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(DURATION_MS);
  useEffect(() => {
    if (paused) return;
    const start = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - start));
    };
  }, [paused, toast.id, onDismiss]);

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex items-start gap-3 rounded-panel border border-edge bg-panel py-2 pr-1 pl-4 text-sm text-ink animate-row-in"
    >
      <span
        aria-hidden="true"
        className={`mt-2 size-2 shrink-0 rounded-full ${toast.tone === 'error' ? 'bg-red' : 'bg-ink-muted'}`}
      />
      <p className="flex-1 py-1.5">{toast.message}</p>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            onDismiss(toast.id);
          }}
          className="min-h-11 rounded-control px-2 font-medium underline underline-offset-4"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Cerrar"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:text-ink"
      >
        <X aria-hidden="true" focusable="false" className="size-4" />
      </button>
    </div>
  );
}

export function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      aria-label="Notificaciones"
      role="region"
      className="toaster pointer-events-none fixed inset-x-0 z-50 mx-auto flex max-w-md flex-col gap-2 px-4 lg:right-6 lg:left-auto lg:mx-0 lg:w-96 lg:px-0"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
