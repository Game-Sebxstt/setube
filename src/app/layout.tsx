import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import type { ReactNode } from 'react';
import { JsonLd } from '@/components/site/JsonLd';
import { ThemeScript } from '@/components/site/ThemeScript';
import { AUTHOR, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL, TURNSTILE_SITE_KEY } from '@/config/site';
import { TURNSTILE_SCRIPT } from '@/lib/turnstile';
import { body, display, mono } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: '%s | Setube' },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'es_ES',
    siteName: SITE_NAME,
    url: '/',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: SITE_TITLE, description: SITE_DESCRIPTION },
  icons: { icon: '/logo.png', apple: '/logo.png' },
  authors: [{ name: AUTHOR.name, url: AUTHOR.url }],
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#16181B' },
    { media: '(prefers-color-scheme: light)', color: '#ECEEF0' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="es"
      data-theme="dark"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body>
        {children}
        <JsonLd />
        {TURNSTILE_SITE_KEY ? <Script src={TURNSTILE_SCRIPT} strategy="afterInteractive" /> : null}
      </body>
    </html>
  );
}
