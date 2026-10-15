import { describe, expect, it } from 'vitest';
import { buildCsp } from '../src/config/csp';

describe('buildCsp', () => {
  it("producción: sin 'unsafe-eval' ni ws:", () => {
    const csp = buildCsp({ isDev: false, apiUrl: 'https://api.setube.example', turnstile: false });
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain('ws:');
    expect(csp).toContain("connect-src 'self' https://api.setube.example");
    expect(csp).toContain('frame-src https://api.setube.example');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' https://i.ytimg.com data:");
    expect(csp).not.toContain('challenges.cloudflare.com');
  });

  it("desarrollo: con 'unsafe-eval' y ws:", () => {
    const csp = buildCsp({ isDev: true, apiUrl: 'http://localhost:4000', turnstile: false });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('ws:');
  });

  it('Turnstile añade challenges.cloudflare.com a script-src y frame-src', () => {
    const csp = buildCsp({ isDev: false, apiUrl: 'http://localhost:4000', turnstile: true });
    expect(csp).toMatch(/script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/challenges\.cloudflare\.com/);
  });

  it('usa solo el origen de la API', () => {
    const csp = buildCsp({ isDev: false, apiUrl: 'https://api.example.com/base/', turnstile: false });
    expect(csp).toContain("connect-src 'self' https://api.example.com;");
  });
});
