'use client';

import { LoaderCircle } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import type { Format, Kind, PublicConfig, Quality } from '@/lib/contract';
import { sizeOf, totalsOf } from '@/lib/estimate';
import { formatBytes, formatDuration, formatLimit } from '@/lib/format';
import { AUDIO_FORMATS, type Options, type QueueItem, VIDEO_FORMATS } from '@/lib/queue';
import { Num } from '@/components/ui/Num';

interface OutputBarProps {
  options: Options;
  config: PublicConfig;
  items: readonly QueueItem[];
  /** Calidades de video disponibles cuando hay un solo video en la cola; null si no aplica. */
  singleQualities: number[] | null;
  /** Videos y playlists que todavía cargan su metadata. */
  loading: { items: number; playlists: number };
  onChange: (o: Partial<Options>) => void;
  /** Acción primaria (Convertir/Cancelar) en desktop. */
  action?: ReactNode;
}

const LABEL: Record<Format, string> = { mp3: 'MP3', m4a: 'M4A', wav: 'WAV', mp4: 'MP4' };

const HINT: Record<Format, ReactNode> = {
  mp3: <><Num>MP3</Num>: se reproduce en cualquier dispositivo. Se recodifica.</>,
  m4a: <><Num>M4A</Num>: el audio original sin recodificar, el más rápido.</>,
  wav: (
    <>
      <Num>WAV</Num>: sin compresión, <Num>16 bits</Num> a <Num>44,1 kHz</Num>. Ideal para editar.
    </>
  ),
  mp4: <><Num>MP4</Num>: video <Num>H.264</Num> con su audio, sin recodificar.</>,
};

const KINDS: readonly { value: Kind; label: string }[] = [
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
];

export function OutputBar({ options, config, items, singleQualities, loading, onChange, action }: OutputBarProps) {
  const id = useId();
  const qualityId = `${id}-quality`;
  const hintId = `${id}-hint`;
  const formats = options.kind === 'video' ? VIDEO_FORMATS : AUDIO_FORMATS;
  const totals = totalsOf(items);
  const size = sizeOf(items, options.format, options.quality);

  const qualities: (number | 'best')[] | null =
    options.format === 'mp3'
      ? config.formats.mp3.length
        ? config.formats.mp3
        : [128, 192, 320]
      : options.format === 'mp4'
        ? config.formats.mp4.length
          ? config.formats.mp4
          : [360, 480, 720, 1080, 'best']
        : null;

  const loadingNode: ReactNode =
    loading.items > 0 || loading.playlists > 0 ? (
      <span key="l" className="inline-flex items-center gap-1.5">
        <LoaderCircle aria-hidden="true" focusable="false" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
        {loading.items > 0 ? (
          <span>
            Cargando <Num>{loading.items}</Num> de <Num>{totals.items}</Num>…
          </span>
        ) : (
          <span>Leyendo playlist…</span>
        )}
      </span>
    ) : null;

  const summary: ReactNode[] = [
    loadingNode,
    ...(totals.items === 0
      ? []
      : [
          <span key="n">
            <Num>{totals.convertible}</Num> {totals.convertible === 1 ? 'video' : 'videos'}
          </span>,
          totals.withDuration ? (
            <span key="d">
              <Num>{formatDuration(totals.duration)}</Num>
              <span className="max-md:hidden"> en total</span>
            </span>
          ) : null,
          size.known > 0 ? (
            <span key="s">
              ≈ <Num>{formatBytes(size.bytes)}</Num>
              {size.known < totals.convertible ? <span className="max-md:hidden">{` (de ${size.known})`}</span> : null}
            </span>
          ) : null,
        ]),
  ].filter(Boolean);

  const limits: ReactNode[] = [
    <span key="items">
      Hasta <Num pill>{config.maxItemsPerJob}</Num> links
    </span>,
    <span key="audio" className={options.kind === 'audio' ? 'text-ink' : undefined}>
      audio máx. <Num pill>{formatLimit(config.maxDurationAudioSec)}</Num>
    </span>,
    <span key="video" className={options.kind === 'video' ? 'text-ink' : undefined}>
      video máx. <Num pill>{formatLimit(config.maxDurationVideoSec)}</Num>
    </span>,
    <span key="pl">
      playlists de hasta <Num pill>{config.maxPlaylistItems}</Num> videos
    </span>,
  ];
  const maxDuration = options.kind === 'video' ? config.maxDurationVideoSec : config.maxDurationAudioSec;
  const dot = (i: number) =>
    i > 0 ? (
      <span aria-hidden="true" className="text-ink-muted">
        ·
      </span>
    ) : null;

  return (
    <section aria-label="Salida" className="out">
      <div className="out-row">
        <fieldset className="min-w-0 max-md:w-full">
          <legend className="visually-hidden">Tipo</legend>
          <div className="seg max-md:flex max-md:w-full">
            {KINDS.map((k) => (
              <label key={k.value} className="seg-opt max-md:flex-1">
                <input
                  type="radio"
                  name={`${id}-kind`}
                  value={k.value}
                  checked={options.kind === k.value}
                  onChange={() => onChange({ kind: k.value })}
                />
                <span>{k.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="visually-hidden">Formato</legend>
          <div className="flex gap-1.5">
            {formats.map((f) => (
              <label key={f} className="chip">
                <input
                  type="radio"
                  name={`${id}-format`}
                  value={f}
                  checked={options.format === f}
                  onChange={() => onChange({ format: f })}
                  aria-describedby={hintId}
                />
                <span className="num">{LABEL[f]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex min-w-0 items-center gap-2 max-md:flex-1 max-md:[&>*:last-child]:w-full">
          <label htmlFor={qualityId} className="text-sm text-ink-muted max-md:sr-only">
            Calidad
          </label>
          {qualities ? (
            <select
              id={qualityId}
              value={options.quality === null ? '' : String(options.quality)}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ quality: (v === 'best' ? 'best' : Number(v)) as Quality });
              }}
              className="out-select num"
            >
              {qualities.map((q) => {
                const unavailable = options.format === 'mp4' && q !== 'best' && singleQualities !== null && !singleQualities.includes(q);
                const s = items.length ? sizeOf(items, options.format, q as Quality) : null;
                const text = options.format === 'mp3' ? `${q} kbps` : q === 'best' ? 'Mejor' : `${q}p`;
                return (
                  <option key={String(q)} value={String(q)} disabled={unavailable}>
                    {s && s.known > 0 ? `${text} · ${formatBytes(s.bytes)}` : text}
                  </option>
                );
              })}
            </select>
          ) : (
            <output id={qualityId} className="out-fixed num">
              {options.format === 'm4a' ? 'Original' : '16 bits · 44,1 kHz'}
            </output>
          )}
        </div>

        {action ? <div className="hidden lg:ml-auto lg:block">{action}</div> : null}
      </div>

      <div className="out-foot">
        <p id={hintId} className="text-ink-muted max-md:hidden">
          {HINT[options.format]}
          {options.format === 'mp4' && items.length > 1 ? ' Si un video no tiene esa calidad, se usa la más cercana.' : null}
        </p>
        {summary.length ? (
          <p className="flex flex-wrap items-center gap-x-2 text-ink-muted">
            {summary.map((s, i) => (
              <span key={i} className="contents">
                {dot(i)}
                {s}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <p className="out-limits max-md:hidden">
        {limits.map((l, i) => (
          <span key={i} className="contents">
            {dot(i)}
            {l}
          </span>
        ))}
      </p>
      <p className="out-limits md:hidden">
        <span>
          Máx. <Num pill>{config.maxItemsPerJob}</Num> links
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <Num pill>{formatLimit(maxDuration)}</Num> por {options.kind === 'video' ? 'video' : 'audio'}
        </span>
      </p>
    </section>
  );
}
