export type MeterState = 'idle' | 'active' | 'done' | 'error';

interface MeterProps {
  pct: number;
  state: MeterState;
  size?: 'row' | 'master';
  label: string;
  valueText: string;
  className?: string;
}

export function Meter({ pct, state, size = 'row', label, valueText, className }: MeterProps) {
  const segs = size === 'master' ? 24 : 20;
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  // Se enciende por segmentos completos; cualquier avance > 0 enciende al menos uno.
  const lit = state === 'done' ? segs : p <= 0 ? 0 : Math.max(1, Math.round((p / 100) * segs));
  const off = 100 - (lit / segs) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(state === 'done' ? 100 : p)}
      aria-valuetext={valueText}
      className={`meter ${className ?? ''}`}
      data-size={size}
      data-state={state}
    >
      <div className="meter-fill" style={{ ['--meter-off' as string]: `${off}%` }} />
    </div>
  );
}
