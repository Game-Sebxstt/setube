'use client';

import { Volume2, VolumeX } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Num } from '@/components/ui/Num';
import { formatDuration } from '@/lib/format';
import { type Player as PlayerEngine, usePlayerTime } from '@/lib/player';

export const SEEK_STEP = 5;
const SEEK_DEBOUNCE_MS = 250;

/**
 * Barra de posición. `bar` es la de la mini barra (en móvil, una línea sobre su borde superior);
 * `panel` es la de los controles del video en pantalla completa, siempre con los tiempos.
 */
export function SeekBar({ player, variant = 'bar' }: { player: PlayerEngine; variant?: 'bar' | 'panel' }) {
  const time = usePlayerTime(player);
  const [drag, setDrag] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const duration = time.duration;
  const value = drag ?? time.current;
  const pct = duration ? Math.min(100, (value / duration) * 100) : 0;
  const buf = duration ? Math.min(100, (time.buffered / duration) * 100) : 0;
  const durText = duration ? formatDuration(duration) : '–:–';
  const curText = formatDuration(value) || '0:00';

  const onChange = (v: number) => {
    setDrag(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      player.seek(v);
      setDrag(null);
    }, SEEK_DEBOUNCE_MS);
  };

  const panel = variant === 'panel';
  const timeClass = panel ? 'w-14 shrink-0 text-sm' : 'hidden w-14 shrink-0 text-sm lg:inline';
  return (
    <div className={panel ? 'flex min-w-0 flex-1 items-center gap-3' : 'seek-wrap flex items-center gap-3 lg:min-w-0 lg:flex-1'}>
      <Num className={`${timeClass} text-right`}>{curText}</Num>
      <input
        type="range"
        className="seek"
        min={0}
        max={duration ?? 0}
        step={SEEK_STEP}
        value={Math.min(value, duration ?? 0)}
        disabled={!duration}
        aria-label="Posición"
        aria-valuetext={`${curText} de ${durText}`}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--pct': `${pct}%`, '--buf': `${buf}%` } as CSSProperties}
      />
      <Num className={timeClass}>{durText}</Num>
    </div>
  );
}

export function VolumeControl({ player, volume, muted }: { player: PlayerEngine; volume: number; muted: boolean }) {
  const shown = muted ? 0 : volume;
  return (
    <div className="hidden shrink-0 items-center gap-1 lg:flex">
      <button
        type="button"
        onClick={() => player.toggleMute()}
        aria-label={muted || volume === 0 ? 'Activar sonido' : 'Silenciar'}
        title={muted || volume === 0 ? 'Activar sonido' : 'Silenciar'}
        className="inline-flex size-11 items-center justify-center rounded-control text-ink hover:bg-panel"
      >
        {muted || volume === 0 ? (
          <VolumeX aria-hidden="true" focusable="false" className="size-5" />
        ) : (
          <Volume2 aria-hidden="true" focusable="false" className="size-5" />
        )}
      </button>
      <input
        type="range"
        className="seek w-24"
        min={0}
        max={1}
        step={0.05}
        value={shown}
        aria-label="Volumen"
        aria-valuetext={`${Math.round(shown * 100)} %`}
        onChange={(e) => player.setVolume(Number(e.target.value))}
        style={{ '--pct': `${shown * 100}%`, '--buf': '0%' } as CSSProperties}
      />
    </div>
  );
}
