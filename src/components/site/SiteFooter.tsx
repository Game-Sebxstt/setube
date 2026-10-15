import { AUTHOR } from '@/config/site';

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-ink-muted sm:px-6">
        <p>
          Setube, por{' '}
          <a href={AUTHOR.url} className="text-ink underline underline-offset-4" rel="noopener noreferrer" target="_blank">
            {AUTHOR.name}
          </a>
        </p>
      </div>
    </footer>
  );
}
