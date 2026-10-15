interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_TIMEOUT_MS = 15_000;

export class TurnstileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TurnstileError';
  }
}

export interface TurnstileHandle {
  /** Ejecuta el desafío y devuelve el token; los pedidos se serializan. */
  getToken(): Promise<string>;
  destroy(): void;
}

function waitForApi(timeoutMs: number): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (window.turnstile) return resolve(window.turnstile);
      if (Date.now() - start > timeoutMs) return reject(new TurnstileError('script'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

export function createTurnstile(el: HTMLElement, sitekey: string): TurnstileHandle {
  let widgetId: string | null = null;
  let pending: ((r: { token?: string; error?: string }) => void) | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const ready = waitForApi(TOKEN_TIMEOUT_MS).then((t) => {
    widgetId = t.render(el, {
      sitekey,
      execution: 'execute',
      appearance: 'interaction-only',
      language: 'es',
      callback: (token: string) => pending?.({ token }),
      'error-callback': () => pending?.({ error: 'failed' }),
      'expired-callback': () => pending?.({ error: 'expired' }),
      'timeout-callback': () => pending?.({ error: 'timeout' }),
    });
    return t;
  });

  const once = async (): Promise<string> => {
    const t = await ready;
    if (!widgetId) throw new TurnstileError('render');
    const id = widgetId;
    try {
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = null;
          reject(new TurnstileError('timeout'));
        }, TOKEN_TIMEOUT_MS);
        pending = (r) => {
          clearTimeout(timer);
          pending = null;
          if (r.token) resolve(r.token);
          else reject(new TurnstileError(r.error ?? 'failed'));
        };
        t.execute(id);
      });
    } finally {
      // cada token es de un solo uso
      t.reset(id);
    }
  };

  return {
    getToken() {
      const run = chain.then(once, once);
      chain = run.catch(() => undefined);
      return run;
    },
    destroy() {
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      widgetId = null;
    },
  };
}
