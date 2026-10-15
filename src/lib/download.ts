import type { CreatedJob } from './contract';

export interface DownloadTarget {
  url: string;
  mode: 'file' | 'archive';
  itemId: string | null;
}

 // 1 item válido → /items/:itemId/file; 2 o más → /archive; ninguno → null.
export function downloadTarget(job: Pick<CreatedJob, 'jobId' | 'items'>, api: string): DownloadTarget | null {
  const base = api.replace(/\/+$/, '');
  const valid = job.items.filter((i) => i.status === 'pending');
  const first = valid[0];
  if (!first) return null;
  const jobPath = `${base}/api/jobs/${encodeURIComponent(job.jobId)}`;
  if (valid.length === 1) {
    return { url: `${jobPath}/items/${encodeURIComponent(first.itemId)}/file`, mode: 'file', itemId: first.itemId };
  }
  return { url: `${jobPath}/archive`, mode: 'archive', itemId: null };
}

// Chrome permite la primera descarga sin gesto del usuario.
let dispatchedCount = 0;

export interface Dispatched {
  withActivation: boolean;
  first: boolean;
  /** Quita el iframe tras `delayMs` (60 s después del estado terminal). */
  removeLater(delayMs?: number): void;
  removeNow(): void;
}

export function hasUserActivation(): boolean {
  if (typeof navigator === 'undefined') return true;
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return ua?.isActive ?? true;
}

export function dispatchDownload(url: string): Dispatched {
  const withActivation = hasUserActivation();
  const first = dispatchedCount === 0;
  dispatchedCount++;
  const iframe = document.createElement('iframe');
  iframe.hidden = true;
  iframe.tabIndex = -1;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.title = 'Descarga';
  iframe.src = url;
  document.body.appendChild(iframe);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const removeNow = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    iframe.remove();
  };
  return {
    withActivation,
    first,
    removeNow,
    removeLater(delayMs = 60_000) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(removeNow, delayMs);
    },
  };
}
