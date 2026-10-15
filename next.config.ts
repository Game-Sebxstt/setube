import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { buildCsp } from './src/config/csp';

export default function config(phase: string): NextConfig {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
  if (phase === PHASE_PRODUCTION_BUILD && !apiUrl) {
    throw new Error('NEXT_PUBLIC_API_URL es obligatorio en build');
  }
  const csp = buildCsp({
    isDev: process.env.NODE_ENV !== 'production',
    apiUrl,
    turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  });

  return {
    output: 'standalone',
    poweredByHeader: false,
    images: {
      unoptimized: true,
      remotePatterns: [{ protocol: 'https', hostname: 'i.ytimg.com' }],
    },
    async headers() {
      return [
        {
          source: '/:path*',
          headers: [
            { key: 'Content-Security-Policy', value: csp },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ],
        },
      ];
    },
  };
}
