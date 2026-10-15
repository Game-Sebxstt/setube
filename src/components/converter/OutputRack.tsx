'use client';

import type { ReactNode } from 'react';
import type { Format, PublicConfig, Quality } from '@/lib/contract';
import { formatBytes, formatDuration, minutes } from '@/lib/format';
import {
  AUDIO_QUALITY_INFO,
  FORMAT_INFO,
  PRESETS,
  VIDEO_QUALITY_INFO,
  presetMatches,
  sizeOf,
  totalsOf,
} from '@/lib/presets';
import { type Options, type QueueItem, defaultQuality } from '@/lib/queue';

interface OutputRackProps {
  options: Options;
  config: PublicConfig;
  items: readonly QueueItem[];
  /** Calidades de video disponibles cuando hay UN solo video en la cola; null si no aplica. */
  singleQualities: number[] | null;
  onChange: (o: Partial<Options>) => void;
  children?: ReactNode;
}

const AUDIO: readonly Format[] = ['mp3', 'm4a', 'wav'];
const VIDEO: readonly Format[] = ['mp4'];

function qualityLabel(format: Format, q: Quality | null): string {
  if (format === 'mp3') return `${q ?? 192} kbps`;
  if (format === 'mp4') return q === 'best' ? 'la mejor calidad' : `${q ?? 720}p`;
  if (format === 'm4a') return 'calidad original';
  return '16 bits / 44,1 kHz';
}

export function outputLabel(o: Options): string {
  return `${FORMAT_INFO[o.format].label} a ${qualityLabel(o.format, o.quality)}`;
}

export function OutputRack({ options, config, items, singleQualities, onChange, children }: OutputRackProps) {
  const info = FORMAT_INFO[options.format];
  const totals = totalsOf(items);
  const size = sizeOf(items, options.format, options.quality);
  const hasItems = items.length > 0;
  const maxDur = options.kind === 'video' ? config.maxDurationVideoSec : config.maxDurationAudioSec;

  const formatCard = (f: Format) => {
    const fi = FORMAT_INFO[f];
    const q = f === options.format ? options.quality : defaultQuality(f);
    const s = hasItems ? sizeOf(items, f, q) : null;
    return (
      <label key={f} className="pick pick-format">
        <input
          type="radio"
          name="format"
          value={f}
          checked={options.format === f}
          onChange={() => onChange({ format: f })}
          aria-describedby="format-detail"
        />
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-display text-lg">{fi.label}</span>
          {s && s.known > 0 ? <span className="num pick-sub text-sm">≈ {formatBytes(s.bytes)}</span> : null}
        </span>
        <span className="pick-sub text-sm">
          {fi.process}
        </span>
      </label>
    );
  };

  let quality: ReactNode;
  if (options.format === 'mp3' || options.format === 'mp4') {
    const list: (number | 'best')[] =
      options.format === 'mp3'
        ? config.formats.mp3.length
          ? config.formats.mp3
          : [128, 192, 320]
        : config.formats.mp4.length
          ? config.formats.mp4
          : [360, 480, 720, 1080, 'best'];
    const notes = options.format === 'mp3' ? AUDIO_QUALITY_INFO : VIDEO_QUALITY_INFO;
    const current = options.quality === null ? null : String(options.quality);
    quality = (
      <fieldset className="min-w-0" aria-describedby="quality-detail">
        <legend className="rack-label">Calidad</legend>
        <div className="ladder" style={{ ['--steps' as string]: list.length }}>
          {list.map((q) => {
            const unavailable = options.format === 'mp4' && q !== 'best' && singleQualities !== null && !singleQualities.includes(q);
            const s = hasItems ? sizeOf(items, options.format, q as Quality) : null;
            return (
              <label key={String(q)} className="pick pick-step" title={unavailable ? 'Este video no está disponible en esta calidad' : undefined}>
                <input
                  type="radio"
                  name="quality"
                  value={String(q)}
                  checked={current === String(q)}
                  disabled={unavailable}
                  onChange={() => onChange({ quality: q as Quality })}
                />
                <span className="num text-sm font-medium">{options.format === 'mp3' ? q : q === 'best' ? 'Máx.' : `${q}p`}</span>
                <span className="num pick-sub text-xs">{s && s.known > 0 ? formatBytes(s.bytes) : options.format === 'mp3' ? 'kbps' : ' '}</span>
              </label>
            );
          })}
        </div>
        <p id="quality-detail" className="mt-2 text-sm text-ink-muted">
          {current ? notes[current] : null}
          {options.format === 'mp4' && items.length > 1 ? ' Si un video no tiene esa calidad, se usa la más cercana disponible.' : null}
        </p>
      </fieldset>
    );
  } else {
    quality = (
      <div>
        <p className="rack-label">Calidad</p>
        <p className="rounded-control border border-dashed border-edge px-3.5 py-2.5 text-sm">
          {options.format === 'm4a'
            ? 'Calidad original: se entrega el audio AAC de YouTube sin tocarlo.'
            : 'Fija: sin compresión, 16 bits a 44,1 kHz, estéreo.'}
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="output-title" className="rack">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="output-title" className="font-display text-lg">
          Salida
        </h2>
        <p className="num text-sm text-ink-muted">{outputLabel(options)}</p>
      </div>

      <div className="mt-4">
        <p className="rack-label" id="presets-label">
          Recetas rápidas
        </p>
        <div role="group" aria-labelledby="presets-label" className="presets">
          {PRESETS.map((p) => {
            const on = presetMatches(p, options);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ format: p.format, quality: p.quality })}
                className="preset"
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-ink-muted">{p.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      <fieldset className="mt-5 min-w-0">
        <legend className="rack-label">Formato</legend>
        <div className="grid gap-3 sm:grid-cols-[3fr_1fr] sm:gap-2">
          <div>
            <p className="mb-1.5 text-sm text-ink-muted" aria-hidden="true">
              Audio
            </p>
            <div className="grid grid-cols-3 gap-2">{AUDIO.map(formatCard)}</div>
          </div>
          <div>
            <p className="mb-1.5 text-sm text-ink-muted" aria-hidden="true">
              Video
            </p>
            <div className="grid">{VIDEO.map(formatCard)}</div>
          </div>
        </div>
        <div id="format-detail" className="mt-3 border-l-2 border-red pl-3 text-sm">
          <p>{info.summary}</p>
          <p className="text-ink-muted">{info.goodFor}</p>
        </div>
      </fieldset>

      <div className="mt-5">{quality}</div>

      <dl className="readout mt-5">
        <div>
          <dt>Videos</dt>
          <dd className="num">
            {totals.convertible}
            <span className="text-ink-muted">/{config.maxItemsPerJob}</span>
          </dd>
        </div>
        <div>
          <dt>Duración total</dt>
          <dd className="num">{totals.withDuration ? formatDuration(totals.duration) : '0:00'}</dd>
        </div>
        <div>
          <dt>Tamaño estimado</dt>
          <dd className="num">
            {size.known > 0 ? `≈ ${formatBytes(size.bytes)}` : 'Sin datos'}
            {size.known > 0 && size.known < totals.convertible ? (
              <span className="block text-xs text-ink-muted">
                de {size.known} de {totals.convertible}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Máximo por video</dt>
          <dd className="num">{minutes(maxDur)} min</dd>
        </div>
      </dl>

      {children}
    </section>
  );
}
