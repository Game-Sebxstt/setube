import { Converter } from '@/components/converter/Converter';
import { Faq } from '@/components/site/Faq';
import { SiteFooter } from '@/components/site/SiteFooter';
import { SiteHeader } from '@/components/site/SiteHeader';

export default function Home() {
  return (
    <>
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:h-auto focus:w-auto focus:rounded-control focus:bg-panel focus:px-4 focus:py-2"
      >
        Saltar al convertidor
      </a>
      <SiteHeader />
      <main id="contenido">
        <Converter />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
