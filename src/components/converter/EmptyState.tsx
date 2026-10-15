const FORMS = [
  'youtube.com/watch?v=…',
  'youtu.be/…',
  'youtube.com/shorts/…',
  'music.youtube.com/watch?v=…',
  'youtube.com/playlist?list=…',
];

const STEPS = [
  { t: 'Pega los links', d: 'Uno por línea, todos a la vez. Las playlists se abren en sus videos.' },
  { t: 'Elige la salida', d: 'Una receta rápida o el formato y la calidad exactos.' },
  { t: 'Convierte', d: 'Cada video muestra su progreso en vivo y la descarga empieza sola.' },
];

export function EmptyState({ onExample }: { onExample: () => void }) {
  return (
    <div className="py-8">
      <p className="font-display text-xl">Tu cola está vacía</p>
      <p className="mt-1 max-w-[52ch] text-ink-muted">
        Pega un link de video o de playlist para empezar. No hace falta hacer clic en el campo: <kbd>Ctrl</kbd> <kbd>V</kbd> funciona
        en cualquier parte de la página.
      </p>
      <ol className="mt-6 grid gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.t} className="border-t border-line pt-3">
            <span className="num text-sm text-red-ink" aria-hidden="true">
              {i + 1}
            </span>
            <p className="font-medium">{s.t}</p>
            <p className="text-sm text-ink-muted">{s.d}</p>
          </li>
        ))}
      </ol>
      <div className="mt-6">
        <p className="text-sm text-ink-muted">Links que reconoce</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {FORMS.map((f) => (
            <li key={f} className="num rounded-control border border-line px-2.5 py-1 text-sm">
              {f}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={onExample}
        className="mt-6 inline-flex min-h-11 items-center rounded-control border border-edge px-4 text-sm font-medium text-ink hover:bg-panel"
      >
        Probar con un video de ejemplo
      </button>
    </div>
  );
}
