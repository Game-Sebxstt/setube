'use client';

import type { ReactNode } from 'react';
import { formatPct } from '@/lib/format';
import type { GlobalProgress } from '@/lib/queue';
import { Meter } from './Meter';

interface MasterBarProps {
  progress: GlobalProgress;
  /** Botón primario (Convertir/Cancelar); se muestra en móvil y, con jobs activos, también en desktop. */
  primary: ReactNode;
  showPrimaryOnDesktop: boolean;
}

export function MasterBar({ progress, primary, showPrimaryOnDesktop }: MasterBarProps) {
  const done = !progress.active && progress.total > 0 && progress.done === progress.total;
  const pct = progress.active ? progress.pct : done ? 100 : 0;
  const summary = progress.total > 0 ? `${progress.done} de ${progress.total} listos` : 'Sin conversiones';
  const pctText = formatPct(pct, done || pct >= 100);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:static lg:z-auto lg:border-t-0 lg:border-b lg:bg-transparent lg:px-0 lg:pt-0 lg:pb-4">
      <div className="flex items-center gap-3 lg:gap-4">
        <span className="hidden font-display text-base lg:inline">Master</span>
        <Meter
          pct={pct}
          state={done ? 'done' : progress.active ? 'active' : 'idle'}
          size="master"
          label="Progreso total"
          valueText={`${pctText}, ${summary}`}
          className="flex-1"
        />
        <span className="num w-16 shrink-0 text-right">{pctText}</span>
        <div className={showPrimaryOnDesktop ? 'shrink-0' : 'shrink-0 lg:hidden'}>{primary}</div>
      </div>
      <p className="mt-1 hidden text-sm text-ink-muted lg:block">
        <span className="num">{summary}</span>
      </p>
    </div>
  );
}
