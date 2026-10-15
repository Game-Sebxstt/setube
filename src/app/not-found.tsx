import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/site/SiteFooter';
import { SiteHeader } from '@/components/site/SiteHeader';

export const metadata: Metadata = { title: 'Página no encontrada', robots: { index: false } };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="contenido" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h1 className="font-display text-2xl lg:text-3xl">Esta página no existe</h1>
        <p className="mt-3 text-ink-muted">El link que abriste no lleva a ninguna parte de Setube.</p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-control bg-red px-5 font-display text-base text-white"
        >
          Ir al convertidor
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}

