'use client';

import { History, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';

interface RecentSearchesProps {
  /** De la más reciente a la más antigua. Sin elementos solo queda la región aria-live. */
  items: readonly string[];
  onPick: (query: string) => void;
  /** Si era la última, el que llama devuelve el foco al campo. */
  onRemove: (query: string) => void;
  onClear: () => void;
}

/**
 * Búsquedas guardadas en el navegador, bajo la barra de comandos. La región aria-live se queda montada aunque no
 * haya nada que mostrar, para que se anuncie también cuando se quita la última.
 */
export function RecentSearches({ items, onPick, onRemove, onClear }: RecentSearchesProps) {
  const headingId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  // id cambia en cada anuncio: el texto va en un nodo nuevo y se lee aunque se repita el mismo mensaje
  const [message, setMessage] = useState({ text: '', id: 0 });
  const announce = (text: string) => setMessage((m) => ({ text, id: m.id + 1 }));

  const remove = (query: string, index: number) => {
    // el foco pasa a la siguiente o, si no hay, a la anterior (los nodos se conservan: la key es la consulta)
    const picks = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-recent-pick]');
    const target = picks?.[index + 1] ?? picks?.[index - 1] ?? null;
    onRemove(query);
    announce(`Se quitó «${query}» del historial.`);
    target?.focus();
  };

  return (
    <>
      {items.length > 0 ? (
        <section aria-labelledby={headingId} className="recent">
          <h2 id={headingId} className="recent-title">
            Búsquedas recientes
          </h2>
          <div className="recent-row">
            <ul ref={listRef} className="recent-list">
              {items.map((q, i) => (
                <li key={q} className="recent-chip">
                  <button
                    type="button"
                    data-recent-pick=""
                    onClick={() => {
                      announce('');
                      onPick(q);
                    }}
                    aria-label={`Buscar «${q}»`}
                    title={q}
                    className="recent-pick"
                  >
                    <History aria-hidden="true" focusable="false" className="size-4 shrink-0 text-ink-muted" />
                    <span className="recent-q">{q}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(q, i)}
                    aria-label={`Quitar «${q}» del historial`}
                    title="Quitar del historial"
                    className="recent-remove"
                  >
                    <X aria-hidden="true" focusable="false" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                announce('');
                onClear();
              }}
              className="recent-clear"
            >
              Borrar historial
            </button>
          </div>
        </section>
      ) : null}
      <p className="visually-hidden" aria-live="polite">
        {message.text ? <span key={message.id}>{message.text}</span> : null}
      </p>
    </>
  );
}
