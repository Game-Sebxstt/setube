'use client';

import { AlertCircle, Check, Download, ExternalLink, Info, ListPlus, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { memo, useState } from 'react';
import { type Options, type QueueItem, isLoadingMeta, metaPhase } from '@/lib/queue';
import { formatBytes, formatDuration, formatPct, formatSpeed } from '@/lib/format';
import { type MessageContext, messageFor } from '@/lib/messages';
import { estimateFor } from '@/lib/estimate';
import { watchUrl } from '@/lib/youtube-url';
import { Num } from '@/components/ui/Num';
import { PlayButton } from '@/components/player/PlayButton';
import { usePlayer } from '@/components/player/PlayerContext';
import { canPreview, toTrack, usePlayerCaps, usePlayerStatus } from '@/lib/player';
import { Meter, type MeterState } from './Meter';

interface QueueRowProps {
  item: QueueItem;
  options: Options;
  busy: boolean;
  /** La metadata completa falló de forma transitoria y se puede volver a pedir. */
  metaFailed: boolean;
  messageCtx: MessageContext;
  onDownload: (key: string) => void;
  onRemove: (key: string) => void;
  onAddPlaylist: (listId: string) => void;
  onRetryMeta: (videoId: string) => void;
  /** La API permite escuchar en streaming. */
  preview: boolean;
}

export function estimatedBytes(item: QueueItem, o: Options): number | null {
  const e = item.estimated;
  if (!e) return null;
  if (o.format === 'mp3') return e.mp3[String(o.quality ?? 192) as '128' | '192' | '320'] ?? null;
  if (o.format === 'm4a') return e.m4a;
  if (o.format === 'wav') return e.wav;
  return e.mp4[String(o.quality ?? 720)] ?? null;
}

export function phaseLabel(item: QueueItem): string {
  switch (item.status) {
    case 'pending':
      return 'En espera';
    case 'queued':
      return item.position ? `En cola, posición ${item.position}` : 'En cola';
    case 'fetching':
      return 'Obteniendo datos';
    case 'downloading':
      return 'Descargando';
    case 'converting':
      return 'Convirtiendo';
    case 'done':
      return 'Listo';
    case 'canceled':
      return 'Cancelada';
    case 'error':
      return 'Error';
    default:
      return '';
  }
}

function meterState(item: QueueItem): MeterState {
  if (item.status === 'done') return 'done';
  if (item.status === 'error') return 'error';
  if (item.status === 'idle' || item.status === 'canceled') return 'idle';
  return 'active';
}

function QueueRowImpl({
  item,
  options,
  busy,
  metaFailed,
  messageCtx,
  onDownload,
  onRemove,
  onAddPlaylist,
  onRetryMeta,
  preview,
}: QueueRowProps) {
  const player = usePlayer();
  const caps = usePlayerCaps(player);
  const playStatus = usePlayerStatus(player, item.key);
  const playable = preview && player !== null && canPreview(item, messageCtx.maxDurationAudioSec ?? 3600, caps);
  const current = playStatus !== null && playStatus !== 'idle';
  const state = meterState(item);
  const phase = phaseLabel(item);
  const speed = item.status === 'downloading' ? formatSpeed(item.speedBps) : '';
  const size = estimatedBytes(item, options);
  const title = item.title ?? 'Video de YouTube';
  const load = metaPhase(item, metaFailed);
  const loading = isLoadingMeta(item, metaFailed);
  const reading = loading && load === 'link';
  const failedDetails = item.status === 'idle' && load === 'failed';
  const errorText = item.status === 'error' && item.error ? messageFor(item.error, { ...messageCtx, details: item.errorDetails }) : null;
  const metaErrorText = item.meta === 'error' && item.metaError ? messageFor(item.metaError, messageCtx) : null;
  const pctText = state === 'idle' && item.pct === 0 ? '' : formatPct(item.pct, item.status === 'done');
  const valueText = [pctText || '0 %', phase && phase.toLowerCase(), speed && `a ${speed}`].filter(Boolean).join(', ');
  const retry = item.status === 'error' || item.status === 'canceled';
  const [open, setOpen] = useState(false);
  const fichaId = `ficha-${item.key}`;

  return (
    <li
      aria-busy={loading || undefined}
      className="grid animate-row-in grid-cols-[96px_minmax(0,1fr)] gap-3 py-2.5 md:py-3 lg:grid-cols-[128px_minmax(0,1fr)] lg:gap-4"
    >
      {reading ? (
        <div aria-hidden="true" className="skel aspect-video w-24 rounded-control lg:w-32" />
      ) : (
        <div className={`relative self-start rounded-control ${current ? 'ring-2 ring-red' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.thumbnail}
            alt=""
            width={128}
            height={72}
            loading="lazy"
            decoding="async"
            className="aspect-video w-24 rounded-control bg-line object-cover lg:w-32"
          />
          {playable && player ? (
            <PlayButton title={title} status={playStatus} onToggle={() => player.toggle(toTrack(item))} />
          ) : null}
        </div>
      )}
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {reading ? (
              <div aria-hidden="true" className="flex flex-col gap-1.5 pt-1">
                <span className="skel block h-4 w-4/5" />
                <span className="skel block h-3 w-2/5" />
              </div>
            ) : (
              <p className="line-clamp-2 font-medium sm:line-clamp-1" title={title}>
                {playStatus === 'playing' ? (
                  <span aria-hidden="true" className="eq mr-2 align-middle">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : null}
                {title}
              </p>
            )}
            {reading ? (
              <span className="visually-hidden">{title}</span>
            ) : item.author ? (
              <p className="hidden text-sm text-ink-muted md:line-clamp-1">{item.author}</p>
            ) : item.description ? (
              <p className="hidden text-sm text-ink-muted md:line-clamp-1" title={item.description}>
                {item.description}
              </p>
            ) : null}
          </div>
          {item.duration != null ? (
            <Num className="shrink-0 pt-0.5 text-sm">{formatDuration(item.duration)}</Num>
          ) : loading ? (
            <span aria-hidden="true" className="skel mt-1 block h-4 w-11 shrink-0" />
          ) : null}
          {item.status === 'done' ? (
            <Check aria-hidden="true" focusable="false" className="mt-0.5 size-5 shrink-0 text-ok" />
          ) : null}
        </div>

        <div className="mt-2 flex items-center gap-3">
          <Meter pct={item.pct} state={state} label={`Progreso de ${title}`} valueText={valueText} className="flex-1" />
          <Num className="w-16 shrink-0 text-right text-sm">{pctText}</Num>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 text-sm text-ink-muted">
            {errorText || metaErrorText ? (
              <span className="inline-flex items-start gap-1.5 text-red-ink">
                <AlertCircle aria-hidden="true" focusable="false" className="mt-0.5 size-4 shrink-0" />
                <span>{errorText ?? metaErrorText}</span>
              </span>
            ) : loading ? (
              <span className="inline-flex items-center gap-1.5">
                <LoaderCircle aria-hidden="true" focusable="false" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
                <span>{reading ? 'Leyendo enlace…' : 'Obteniendo detalles…'}</span>
                {!reading ? <span aria-hidden="true" className="skel ml-1 block h-3.5 w-14" /> : null}
              </span>
            ) : failedDetails ? (
              <span className="inline-flex items-center gap-1.5">
                <AlertCircle aria-hidden="true" focusable="false" className="size-4 shrink-0" />
                <span>Sin detalles</span>
                <button
                  type="button"
                  onClick={() => onRetryMeta(item.videoId)}
                  className="-my-3 inline-flex min-h-11 items-center rounded-control px-2 font-medium text-ink underline underline-offset-4 hover:bg-panel"
                >
                  Reintentar
                </button>
              </span>
            ) : (
              <>
                {phase && item.status !== 'idle' ? <span>{phase}</span> : null}
                {speed ? <Num className="ml-2">{speed}</Num> : null}
                {item.status === 'idle' && size ? (
                  <span>
                    ≈ <Num>{formatBytes(size)}</Num>
                  </span>
                ) : null}
                {item.status === 'idle' && item.origin?.title ? (
                  <span className={`hidden md:inline${size ? ' ml-2' : ''}`}>De {item.origin.title}</span>
                ) : null}
              </>
            )}
          </p>
          <div className="-mr-2 flex shrink-0 items-center">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={fichaId}
              aria-label="Ficha del video"
              title="Ficha del video"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex size-11 items-center justify-center rounded-control text-ink hover:bg-panel aria-expanded:text-red-ink"
            >
              <Info aria-hidden="true" focusable="false" className="size-5" />
            </button>
            {item.listId ? (
              <button
                type="button"
                onClick={() => onAddPlaylist(item.listId as string)}
                title="Agregar la playlist completa"
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-control px-2 text-sm text-ink hover:bg-panel"
              >
                <ListPlus aria-hidden="true" focusable="false" className="size-5 md:size-4" />
                <span className="max-md:sr-only">Agregar la playlist completa</span>
              </button>
            ) : null}
            {!busy && item.meta !== 'error' ? (
              <button
                type="button"
                aria-label={retry ? 'Reintentar' : 'Descargar'}
                title={retry ? 'Reintentar' : 'Descargar'}
                onClick={() => onDownload(item.key)}
                className="inline-flex size-11 items-center justify-center rounded-control text-ink hover:bg-panel"
              >
                {retry ? (
                  <RotateCcw aria-hidden="true" focusable="false" className="size-5" />
                ) : (
                  <Download aria-hidden="true" focusable="false" className="size-5" />
                )}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Quitar"
              title="Quitar"
              disabled={busy}
              onClick={() => onRemove(item.key)}
              className="inline-flex size-11 items-center justify-center rounded-control text-ink hover:bg-panel disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-transparent"
            >
              <X aria-hidden="true" focusable="false" className="size-5" />
            </button>
          </div>
        </div>
        {open ? <Ficha id={fichaId} item={item} options={options} loading={load === 'link' || load === 'details'} /> : null}
      </div>
    </li>
  );
}

export const QueueRow = memo(QueueRowImpl);

/** Ficha del video: todo lo que devuelve GET /api/videos/:id, con los tamaños de cada salida. */
function Ficha({ id, item, options, loading }: { id: string; item: QueueItem; options: Options; loading: boolean }) {
  const sizes: { label: string; bytes: number | null; on: boolean }[] = [];
  if (item.estimated) {
    for (const q of [128, 192, 320] as const) {
      sizes.push({ label: `MP3 ${q}`, bytes: estimateFor(item, 'mp3', q), on: options.format === 'mp3' && options.quality === q });
    }
    sizes.push({ label: 'M4A', bytes: estimateFor(item, 'm4a', null), on: options.format === 'm4a' });
    sizes.push({ label: 'WAV', bytes: estimateFor(item, 'wav', null), on: options.format === 'wav' });
    for (const key of Object.keys(item.estimated.mp4)) {
      const q = key === 'best' ? 'best' : Number(key);
      sizes.push({
        label: key === 'best' ? 'MP4 máx.' : `MP4 ${key}p`,
        bytes: item.estimated.mp4[key] ?? null,
        on: options.format === 'mp4' && options.quality === q,
      });
    }
  }
  return (
    <div id={id} className="ficha mt-2 grid gap-4 rounded-control border border-line p-3 text-sm sm:grid-cols-2">
      {loading ? (
        <p className="inline-flex items-center gap-1.5 text-ink-muted sm:col-span-2">
          <LoaderCircle aria-hidden="true" focusable="false" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
          Obteniendo detalles…
        </p>
      ) : null}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-1">
        {item.author ? (
          <>
            <dt className="text-ink-muted">Canal</dt>
            <dd>{item.author}</dd>
          </>
        ) : null}
        <dt className="text-ink-muted">Duración</dt>
        <dd>{item.duration != null ? <Num>{formatDuration(item.duration)}</Num> : 'Desconocida'}</dd>
        {item.origin?.title ? (
          <>
            <dt className="text-ink-muted">Playlist</dt>
            <dd>{item.origin.title}</dd>
          </>
        ) : null}
        {item.qualities ? (
          <>
            <dt className="text-ink-muted">Video en</dt>
            <dd>{item.qualities.length ? <Num>{item.qualities.map((q) => `${q}p`).join(', ')}</Num> : 'Sin MP4 disponible'}</dd>
          </>
        ) : null}
        <dt className="text-ink-muted">Link</dt>
        <dd>
          <a
            href={watchUrl(item.videoId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-4"
          >
            Abrir en YouTube
            <ExternalLink aria-hidden="true" focusable="false" className="size-3.5" />
            <span className="visually-hidden">(se abre en otra pestaña)</span>
          </a>
        </dd>
      </dl>
      {sizes.length ? (
        <div>
          <p className="text-ink-muted">Tamaño estimado por salida</p>
          <ul className="mt-1 grid grid-cols-2 gap-x-4">
            {sizes.map((s) => (
              <li key={s.label} className={`flex justify-between gap-2 ${s.on ? 'text-red-ink' : ''}`}>
                <span>{s.label}</span>
                {s.bytes != null ? (
                  <Num className={s.on ? 'text-red-ink' : undefined}>{formatBytes(s.bytes)}</Num>
                ) : (
                  <span className="text-ink-muted">No disponible</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {item.description ? (
        <p className="hidden whitespace-pre-line text-ink-muted sm:col-span-2 md:line-clamp-6">{item.description}</p>
      ) : null}
    </div>
  );
}
