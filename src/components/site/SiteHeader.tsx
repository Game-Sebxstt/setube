import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';

export function SiteHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-control" aria-label="Setube, inicio">
          <Image src="/logo.png" alt="" width={29} height={26} priority />
          <span className="font-display brand text-lg">Setube</span>
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}

