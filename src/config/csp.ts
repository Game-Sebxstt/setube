export interface CspOptions {
  isDev: boolean;
  apiUrl: string;
  turnstile: boolean;
}

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

function origin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCsp({ isDev, apiUrl, turnstile }: CspOptions): string {
  const api = origin(apiUrl);
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (isDev) scriptSrc.push("'unsafe-eval'");
  if (turnstile) scriptSrc.push(TURNSTILE_ORIGIN);

  const connectSrc = ["'self'"];
  if (api) connectSrc.push(api);
  if (isDev) connectSrc.push('ws:');

  const frameSrc: string[] = [];
  if (api) frameSrc.push(api);
  if (turnstile) frameSrc.push(TURNSTILE_ORIGIN);
  if (frameSrc.length === 0) frameSrc.push("'none'");

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', scriptSrc],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'https://i.ytimg.com', 'data:']],
    ['connect-src', connectSrc],
    ['media-src', api ? ["'self'", api] : ["'self'"]],
    ['frame-src', frameSrc],
    ['font-src', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
  ];
  return directives.map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}
