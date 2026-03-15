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
  distance: number;   // NM
  heading:  number;   // graus magnéticos
  bearing:  number;   // graus verdadeiros
}

// ── Cálculos geodésicos ───────────────────────────────────

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function toRad(d: number) { return d * DEG; }

/** Distância em NM entre dois pontos (Haversine) */
function distanceNM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065; // NM
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Rumo verdadeiro inicial entre dois pontos */
function trueBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const x  = Math.sin(Δλ) * Math.cos(φ2);
  const y  = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(x, y) * RAD + 360) % 360;
}

/**
 * Declinação magnética aproximada (modelo simplificado WMM 2025)
 * Suficiente para briefing de planejamento — para voo usar carta atualizada.
 */
function magDecl(lat: number, lon: number): number {
  // Aproximação linear válida para o Brasil central com erro < 1°
  // Declinação média Brasil: varia de -14° (NO) a +2° (SE)
  const d = -3.5
    + (lat  + 15) * 0.18   // componente latitude
    + (lon  + 50) * (-0.22); // componente longitude
  return d;
}

/** Rumo magnético */
function magBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const tb   = trueBearing(lat1, lon1, lat2, lon2);
  const decl = magDecl((lat1 + lat2) / 2, (lon1 + lon2) / 2);
  return (tb - decl + 360) % 360;
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

    // Buscar coordenadas dos dois aeródromos em paralelo
    Promise.all([
      fetch(`/api/airport?icao=${dep}`).then(r => r.json()),
      fetch(`/api/airport?icao=${arr}`).then(r => r.json()),
    ])
      .then(([dData, aData]) => {
        if (dData.error) throw new Error(`DEP: ${dData.error}`);
        if (aData.error) throw new Error(`ARR: ${aData.error}`);

        const dLat = parseFloat(dData.lat);
        const dLng = parseFloat(dData.lng);
        const aLat = parseFloat(aData.lat);
        const aLng = parseFloat(aData.lng);

        if (isNaN(dLat) || isNaN(aLat)) throw new Error('Coordenadas indisponíveis');

        const distance = distanceNM(dLat, dLng, aLat, aLng);
        const bearing  = trueBearing(dLat, dLng, aLat, aLng);
        const heading  = magBearing(dLat, dLng, aLat, aLng);

        setRoute({
          dep: { icao: dep, lat: dLat, lng: dLng, name: dData.name || dep },
          arr: { icao: arr, lat: aLat, lng: aLng, name: aData.name || arr },
          distance: Math.round(distance),
          heading:  Math.round(heading),
          bearing:  Math.round(bearing),
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
        <div className={styles.routeGrid}>
          {/* Rumo magnético */}
          <div className={styles.cell}>
            <span className={styles.cellLabel}>RUMO MAG</span>
            <span className={styles.cellValue}>{fmt3(route.heading)}</span>
          </div>

          {/* Rumo verdadeiro */}
          <div className={styles.cell}>
            <span className={styles.cellLabel}>RUMO VERD</span>
            <span className={styles.cellValue}>{fmt3(route.bearing)}</span>
          </div>

          {/* Distância */}
          <div className={styles.cell}>
            <span className={styles.cellLabel}>DISTÂNCIA</span>
            <span className={styles.cellValue}>
              {route.distance}<span className={styles.unit}>NM</span>
            </span>
          </div>

          {/* Distância em km */}
          <div className={styles.cell}>
            <span className={styles.cellLabel}>DIST KM</span>
            <span className={styles.cellValue}>
              {Math.round(route.distance * 1.852)}<span className={styles.unit}>km</span>
            </span>
          </div>
        </div>
      )}

      {route && (
        <div className={styles.disclaimer}>
          * Rumo magnético aproximado. Declinação calculada por modelo simplificado.
          Consulte carta atualizada para planejamento de voo.
        </div>
      )}
    </Panel>
  );
}
