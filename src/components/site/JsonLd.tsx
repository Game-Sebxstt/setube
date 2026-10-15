import { AUTHOR, SITE_NAME, SITE_URL } from '@/config/site';

const DATA = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: SITE_NAME,
  url: SITE_URL,
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web',
  inLanguage: 'es',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  author: { '@type': 'Person', name: AUTHOR.name, alternateName: AUTHOR.alternateName },
};

const JSON_TEXT = JSON.stringify(DATA).replace(/</g, '\\u003c');

export function JsonLd() {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_TEXT }} />;
}
