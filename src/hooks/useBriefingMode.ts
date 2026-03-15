// src/hooks/useBriefingMode.ts
'use client';
import { useState, useEffect, useCallback } from 'react';

export type BriefingMode = 'pilot' | 'full';

const STORAGE_KEY = 'dumont-briefing-mode';

export function useBriefingMode() {
  const [mode, setModeState] = useState<BriefingMode>('pilot');

  // Carregar preferência salva
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as BriefingMode | null;
      if (saved === 'pilot' || saved === 'full') setModeState(saved);
    } catch { /* silêncio */ }
  }, []);

  const setMode = useCallback((m: BriefingMode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch { /* silêncio */ }
  }, []);

  const toggle = useCallback(() => {
    setMode(mode === 'pilot' ? 'full' : 'pilot');
  }, [mode, setMode]);

  return { mode, setMode, toggle };
}
