'use client';

import type { ReactNode } from 'react';
import { formatPct } from '@/lib/format';
import type { GlobalProgress } from '@/lib/queue';
import { Num } from '@/components/ui/Num';
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
  // en móvil el medidor solo aparece cuando hay algo que medir
  const showMeter = progress.active || progress.done > 0;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:static lg:z-auto lg:border-t-0 lg:border-b lg:bg-transparent lg:px-0 lg:pt-0 lg:pb-4">
      <div className={`flex items-center gap-3 lg:gap-4 ${showMeter ? 'max-lg:mb-2' : 'max-lg:hidden'}`}>
        <span className="hidden font-display text-base lg:inline">Master</span>
        <Meter
          pct={pct}
          state={done ? 'done' : progress.active ? 'active' : 'idle'}
          size="master"
          label="Progreso total"
          valueText={`${pctText}, ${summary}`}
          className="flex-1"
        />
        <Num className="w-16 shrink-0 text-right">{pctText}</Num>
        {showPrimaryOnDesktop ? <div className="hidden shrink-0 lg:block">{primary}</div> : null}
      </div>
      <div className="lg:hidden">{primary}</div>
      <p className="mt-1 hidden text-sm text-ink-muted lg:block">
        {progress.total > 0 ? (
          <>
            <Num>{progress.done}</Num> de <Num>{progress.total}</Num> listos
          </>
        ) : (
          summary
        )}
      </p>
    </div>
  );
}
