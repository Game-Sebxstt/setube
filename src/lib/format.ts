const nf1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

/** 3725 → «1:02:05»; 222 → «3:42». */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Bytes en unidades de 1000 (como los gestores de descarga): 5_200_000 → «5,2 MB». */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < UNITS.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i === 0 ? nf0.format(v) : nf1.format(v)} ${UNITS[i]}`;
}

/** 2_400_000 → «2,4 MB/s». */
export function formatSpeed(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return '';
  return `${formatBytes(bps)}/s`;
}

/** Un decimal mientras avanza, entero al terminar: «38,1 %», «100 %». */
export function formatPct(pct: number, done = false): string {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return done || p >= 100 ? `${nf0.format(Math.round(p))} %` : `${nf1.format(Math.floor(p * 10) / 10)} %`;
}

/** Minutos enteros para los copys de límites. */
export function minutes(sec: number): string {
  return nf0.format(Math.round(sec / 60));
}
