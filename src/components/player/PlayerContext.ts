'use client';

import { createContext, useContext } from 'react';
import type { Player } from '@/lib/player';

export const PlayerContext = createContext<Player | null>(null);

export function usePlayer(): Player | null {
  return useContext(PlayerContext);
}
