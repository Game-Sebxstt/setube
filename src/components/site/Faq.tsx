import { COMPILED_CONFIG } from '@/lib/defaults';
import { minutes } from '@/lib/format';

// Las cifras salen de los defaults compilados, que coinciden con los de /api/config.
const c = COMPILED_CONFIG;

const QUESTIONS: { q: string; a: string }[] = [
  {
    q: '¿Qué formatos puedo descargar?',
    a: 'Audio en MP3 (128, 192 o 320 kbps), M4A con la calidad original sin recodificar y WAV sin compresión. Video en MP4, de 360p a 1080p o la mejor calidad disponible.',
  },
  {
    q: '¿Hay algún límite?',
    a: `Hasta ${c.maxItemsPerJob} videos por conversión y playlists de hasta ${c.maxPlaylistItems} videos. Cada video puede durar hasta ${minutes(c.maxDurationAudioSec)} min en audio y ${minutes(c.maxDurationVideoSec)} min en video.`,
  },
  {
    q: '¿Guardan mis archivos?',
    a: 'No. Cada archivo se convierte mientras lo descargas y no se almacena en el servidor.',
  },
  {
    q: '¿Por qué falla un video?',
    a: 'Puede ser privado, tener restricción de edad, ser una transmisión en vivo o superar la duración máxima. A veces YouTube limita las descargas por un rato: espera unos minutos y reintenta.',
  },
];

export function Faq() {
  return (
    <section aria-labelledby="faq-title" className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <h2 id="faq-title" className="font-display text-xl">
        Preguntas frecuentes
      </h2>
      <div className="mt-4 max-w-[72ch] divide-y divide-line border-y border-line">
        {QUESTIONS.map(({ q, a }) => (
          <details key={q} className="group py-1">
            <summary className="flex min-h-11 items-center rounded-control py-2 font-medium">{q}</summary>
            <p className="pb-4 text-ink-muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
