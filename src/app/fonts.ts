import { Archivo, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';

export const display = Archivo({ subsets: ['latin'], axes: ['wdth'], display: 'swap', variable: '--font-display' });
export const body = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-body' });
export const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', variable: '--font-mono' });
