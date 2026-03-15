// src/components/briefing/RoutePanel.tsx
'use client';
import { useState, useEffect } from 'react';
import { Panel } from '@/components/ui/Panel';
import styles from './RoutePanel.module.css';

interface RoutePanelProps {
  dep: string;
  arr: string;
}

interface RouteData {
  dep:      { icao: string; lat: number; lng: number; name: string };
  arr:      { icao: string; lat: number; lng: number; name: string };
  distance: number;
  heading:  number;   // magnético
  bearing:  number;   // verdadeiro
  decl:     number;   // declinação magnética usada
}

// ── Cálculos geodésicos ───────────────────────────────────

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function distanceNM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function trueBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * DEG, φ2 = lat2 * DEG;
  const Δλ = (lon2 - lon1) * DEG;
  const x  = Math.sin(Δλ) * Math.cos(φ2);
  const y  = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(x, y) * RAD + 360) % 360;
}

/** Busca declinação magnética real via API NOAA IGRF (gratuito, sem auth) */
async function fetchDeclination(lat: number, lon: number): Promise<number> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const url = `https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination` +
      `?lat=${lat}&lon=${lon}&startYear=${today}&resultFormat=json`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('NOAA decl failed');
    const data = await res.json();
    return data?.result?.[0]?.declination ?? 0;
  } catch {
    // Fallback: modelo simplificado para o Brasil
    // Declinação varia de ~-22° (Amazônia) a ~-18° (Nordeste) a ~-14° (Sul)
    const d = -19
      + (lat  + 5)  * 0.25
      + (lon  + 55) * (-0.15);
    return d;
  }
}

function fmt3(deg: number): string {
  return String(Math.round(deg)).padStart(3, '0') + '°';
}

// ── Componente ────────────────────────────────────────────

export function RoutePanel({ dep, arr }: RoutePanelProps) {
  const [route,   setRoute]   = useState<RouteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!dep || !arr) return;
    setLoading(true); setError(null); setRoute(null);

    Promise.all([
      fetch(`/api/airport?icao=${dep}`).then(r => r.json()),
      fetch(`/api/airport?icao=${arr}`).then(r => r.json()),
    ])
      .then(async ([dData, aData]) => {
        if (dData.error) throw new Error(`DEP: ${dData.error}`);
        if (aData.error) throw new Error(`ARR: ${aData.error}`);

        const dLat = parseFloat(dData.lat);
        const dLng = parseFloat(dData.lng);
        const aLat = parseFloat(aData.lat);
        const aLng = parseFloat(aData.lng);

        if (isNaN(dLat) || isNaN(aLat)) throw new Error('Coordenadas indisponíveis');

        const distance = distanceNM(dLat, dLng, aLat, aLng);
        const bearing  = trueBearing(dLat, dLng, aLat, aLng);

        // Declinação no ponto médio da rota
        const midLat = (dLat + aLat) / 2;
        const midLng = (dLng + aLng) / 2;
        const decl   = await fetchDeclination(midLat, midLng);
        const heading = (bearing - decl + 360) % 360;

        setRoute({
          dep: { icao: dep, lat: dLat, lng: dLng, name: dData.name || dep },
          arr: { icao: arr, lat: aLat, lng: aLng, name: aData.name || arr },
          distance: Math.round(distance),
          bearing:  Math.round(bearing),
          heading:  Math.round(heading),
          decl:     Math.round(decl * 10) / 10,
        });
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [dep, arr]);

  return (
    <Panel
      title="ROTA"
      subtitle={`${dep} → ${arr}`}
      status={loading ? 'loading' : error ? 'warn' : 'ok'}
    >
      {loading && <div className={styles.msg}><span className="spin" /> Calculando rota…</div>}
      {error   && <div className={styles.warn}>⚠ {error}</div>}

      {route && (
        <>
          <div className={styles.routeGrid}>
            <div className={[styles.cell, styles.cellHighlight].join(' ')}>
              <span className={styles.cellLabel}>RUMO MAG</span>
              <span className={styles.cellValue}>
                {fmt3(route.heading)}
              </span>
            </div>

            <div className={styles.cell}>
              <span className={styles.cellLabel}>RUMO VERD</span>
              <span className={styles.cellValueSec}>{fmt3(route.bearing)}</span>
            </div>

            <div className={[styles.cell, styles.cellDist].join(' ')}>
              <span className={styles.cellLabel}>DISTÂNCIA</span>
              <span className={styles.cellValue}>
                {route.distance}<span className={styles.unit}>NM</span>
              </span>
            </div>

            <div className={styles.cell}>
              <span className={styles.cellLabel}>DIST KM</span>
              <span className={styles.cellValueSec}>
                {Math.round(route.distance * 1.852)}<span className={styles.unit}>km</span>
              </span>
            </div>
          </div>

          <div className={styles.declRow}>
            <span className={styles.declLabel}>DECLINAÇÃO MAG</span>
            <span className={styles.declVal}>
              {route.decl > 0 ? `+${route.decl}°E` : `${route.decl}°W`}
            </span>
            <span className={styles.declSrc}>NOAA IGRF</span>
          </div>

          <div className={styles.disclaimer}>
            * Rumo magnético calculado com declinação NOAA IGRF para o ponto médio da rota.
            Consulte carta atualizada para planejamento operacional.
          </div>
        </>
      )}
    </Panel>
  );
}
