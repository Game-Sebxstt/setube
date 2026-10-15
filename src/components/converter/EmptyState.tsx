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
    <div className="py-5 md:py-8">
      <p className="font-display text-lg md:text-xl">Tu cola está vacía</p>
      <p className="mt-1 text-ink-muted md:hidden">Pega un link de video o de playlist para empezar.</p>
      <p className="mt-1 hidden max-w-[52ch] text-ink-muted md:block">
        Pega un link de video o de playlist para empezar. No hace falta hacer clic en el campo: <kbd>Ctrl</kbd> <kbd>V</kbd> funciona
        en cualquier parte de la página.
      </p>
      <ol className="mt-6 hidden gap-4 md:grid md:grid-cols-3">
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
      <div className="mt-6 hidden md:block">
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
        className="mt-4 inline-flex min-h-11 items-center rounded-control border border-edge px-4 text-sm font-medium text-ink hover:bg-panel md:mt-6"
      >
        Probar con un video de ejemplo
      </button>
    </div>
  );
}
