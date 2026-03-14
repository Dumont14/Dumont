// src/hooks/useSunTimes.ts
'use client';
import { useEffect, useState } from 'react';

export interface SunTimes {
  sunrise: string | null; // "HH:MMZ" UTC
  sunset:  string | null; // "HH:MMZ" UTC
}

const ICAO_COORDS: Record<string, [number, number]> = {
  SBSP: [-23.626, -46.656], SBGR: [-23.432, -46.473], SBBE: [-1.379, -48.476],
  SBCJ: [-8.346, -49.301],  SBBH: [-19.851, -43.951], SBBR: [-15.871, -47.918],
  SBPA: [-29.994, -51.171], SBFL: [-27.670, -48.547], SBCT: [-25.528, -49.176],
  SBRF: [-8.126, -34.923],  SBSV: [-12.911, -38.331], SBFZ: [-3.776, -38.533],
  SBMN: [-3.146, -59.986],  SBCG: [-20.469, -54.673], SBVT: [-20.258, -40.286],
  SBIL: [-14.815, -39.033], SBMC: [-5.919, -35.364],  SBSG: [-5.768, -35.376],
  SBLO: [-23.333, -51.130], SBMG: [-23.476, -52.012],
  // Internacionais comuns
  KJFK: [40.640, -73.779],  KLAX: [33.943, -118.408], EGLL: [51.477, -0.461],
  LFPG: [49.013,   2.550],  SBGL: [-22.809, -43.243],
};

async function fetchCoordsForIcao(icao: string): Promise<[number, number] | null> {
  if (ICAO_COORDS[icao]) return ICAO_COORDS[icao];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${icao}+airport&format=json&limit=1`,
      { headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' } }
    );
    const data = await res.json();
    if (data?.[0]) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  } catch { /* silêncio */ }
  return null;
}

async function fetchSunTimesUTC(lat: number, lon: number): Promise<SunTimes> {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(
    // timezone=UTC — Open-Meteo retorna sunrise/sunset em UTC
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=sunrise,sunset` +
    `&timezone=UTC` +
    `&start_date=${today}&end_date=${today}`
  );
  const data = await res.json();
  // Formato retornado: "2024-03-13T09:24" (já em UTC por timezone=UTC)
  const sr = data?.daily?.sunrise?.[0] as string | undefined;
  const ss = data?.daily?.sunset?.[0]  as string | undefined;
  // Extrair HH:MM e acrescentar Z
  const fmt = (iso: string | undefined) =>
    iso ? iso.slice(11, 16) + 'Z' : null;
  return { sunrise: fmt(sr), sunset: fmt(ss) };
}

export function useSunTimes(icao: string): SunTimes {
  const [times, setTimes] = useState<SunTimes>({ sunrise: null, sunset: null });

  useEffect(() => {
    if (!icao) return;
    let cancelled = false;
    (async () => {
      const coords = await fetchCoordsForIcao(icao.toUpperCase());
      if (!coords || cancelled) return;
      const t = await fetchSunTimesUTC(coords[0], coords[1]);
      if (!cancelled) setTimes(t);
    })();
    return () => { cancelled = true; };
  }, [icao]);

  return times;
}
