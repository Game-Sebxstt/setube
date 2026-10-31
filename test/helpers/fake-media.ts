/** Elemento multimedia mínimo para probar el motor del reproductor sin navegador. */
export class FakeMedia extends EventTarget {
  src = '';
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  readyState = 0;
  volume = 1;
  muted = false;
  playbackRate = 1;
  clientHeight = 0;
  error: { code: number; message?: string } | null = null;
  ranges: [number, number][] = [];
  seekableLength = 0;
  playCalls = 0;
  loadCalls = 0;
  /** Si se define, `play()` rechaza con este nombre de DOMException. */
  playReject: string | null = null;
  readonly types: Record<string, string>;
  readonly seeks: number[] = [];

  constructor(types: Record<string, string> = {}) {
    super();
    this.types = types;
  }

  get buffered() {
    const r = this.ranges;
    return { length: r.length, start: (i: number) => r[i]![0], end: (i: number) => r[i]![1] };
  }
  get seekable() {
    return { length: this.seekableLength };
  }

  canPlayType(type: string): string {
    return this.types[type] ?? '';
  }
  play(): Promise<void> {
    this.playCalls++;
    if (this.playReject) return Promise.reject(new DOMException('blocked', this.playReject));
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  load(): void {
    this.loadCalls++;
    this.readyState = 0;
    this.error = null;
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
  setAttribute(name: string, value: string): void {
    if (name === 'src') this.src = value;
  }

  fire(name: string): void {
    this.dispatchEvent(new Event(name));
  }
  /** El navegador leyó la cabecera: hay duración y se puede saltar. */
  meta(duration: number): void {
    this.duration = duration;
    this.readyState = 1;
    this.seekableLength = 1;
    this.fire('loadedmetadata');
  }
  /** Avanza la reproducción y emite `timeupdate`. */
  tick(t: number): void {
    this.currentTime = t;
    this.fire('timeupdate');
  }
  fail(code: number): void {
    this.error = { code };
    this.fire('error');
  }
}

export const AUDIO_TYPES = { 'audio/mp4; codecs="mp4a.40.2"': 'probably', 'audio/webm; codecs="opus"': 'probably' };

export function asAudio(m: FakeMedia): HTMLAudioElement {
  return m as unknown as HTMLAudioElement;
}
export function asVideo(m: FakeMedia): HTMLVideoElement {
  return m as unknown as HTMLVideoElement;
}

/** Deja correr las promesas pendientes (play(), import() simulado…). */
export async function flush(): Promise<void> {
  // el import() simulado de hls.js tarda alguna vuelta del bucle de eventos, no solo microtareas
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}
