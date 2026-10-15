import type { ReactNode } from 'react';

interface NumProps {
  children: ReactNode;
  /** Variante en píldora, para límites y cifras sueltas. */
  pill?: boolean;
  className?: string;
}

/** Cifra clave: monoespaciada, con peso y en el color de texto principal. */
export function Num({ children, pill = false, className }: NumProps) {
  const cls = ['stat', pill ? 'stat-pill' : null, className].filter(Boolean).join(' ');
  return <strong className={cls}>{children}</strong>;
}
