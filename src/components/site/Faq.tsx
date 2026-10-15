import type { ReactNode } from 'react';
import { Num } from '@/components/ui/Num';
import { COMPILED_CONFIG } from '@/lib/defaults';
import { formatLimit } from '@/lib/format';

// Las cifras salen de los defaults compilados, que coinciden con los de /api/config.
const c = COMPILED_CONFIG;

const QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: '¿Qué formatos puedo descargar?',
    a: (
      <>
        Audio en <Num>MP3</Num> (<Num>128</Num>, <Num>192</Num> o <Num>320 kbps</Num>), <Num>M4A</Num> con la calidad original sin
        recodificar y <Num>WAV</Num> sin compresión. Video en <Num>MP4</Num>, de <Num>360p</Num> a <Num>1080p</Num> o la mejor calidad
        disponible.
      </>
    ),
  },
  {
    q: '¿Hay algún límite?',
    a: (
      <>
        Hasta <Num>{c.maxItemsPerJob}</Num> videos por conversión y playlists de hasta <Num>{c.maxPlaylistItems}</Num> videos. Cada video
        puede durar hasta <Num>{formatLimit(c.maxDurationAudioSec)}</Num> en audio y <Num>{formatLimit(c.maxDurationVideoSec)}</Num> en
        video.
      </>
    ),
  },
  {
    q: '¿Guardan mis archivos?',
    a: 'No. Cada archivo se convierte mientras lo descargas y no se almacena en el servidor.',
  },
  {
    q: '¿Por qué falla un video?',
    a: (
      <>
        Puede ser privado, tener restricción de edad, ser una transmisión en vivo o superar la duración máxima (
        <Num>{formatLimit(c.maxDurationAudioSec)}</Num> en audio, <Num>{formatLimit(c.maxDurationVideoSec)}</Num> en video). A veces
        YouTube limita las descargas por un rato: espera unos minutos y reintenta.
      </>
    ),
  },
];

export function Faq() {
  return (
    <section aria-labelledby="faq-title" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-12">
      <h2 id="faq-title" className="font-display text-xl">
        Preguntas frecuentes
      </h2>
      <div className="mt-4 grid border-b border-line md:grid-cols-2 md:gap-x-10">
        {QUESTIONS.map(({ q, a }) => (
          <details key={q} className="group border-t border-line py-1">
            <summary className="flex min-h-11 items-center rounded-control py-2 font-medium">{q}</summary>
            <p className="pb-4 text-sm text-ink-muted md:text-base">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
