// src/components/briefing/RoutePanel.tsx
'use client';
import { useState, useEffect, useRef } from 'react';
import { Panel } from '@/components/ui/Panel';
import { decodeMetar, getFlightCategory } from '@/lib/weather/metar';
import styles from './RoutePanel.module.css';

interface RoutePanelProps { dep: string; arr: string; }

interface AirportCoord {
  icao: string; lat: number; lng: number; name: string;
}

interface AlternateAD {
  icao:     string;
  name:     string;
  lat:      number;
  lng:      number;
  distNM:   number;       // distância da linha de rota
  posAlongRoute: number;  // 0..1 — posição ao longo da rota
  metar:    string | null;
  cat:      string | null;
}

interface RouteData {
  dep:       AirportCoord;
  arr:       AirportCoord;
  distance:  number;
  heading:   number;
  bearing:   number;
  decl:      number;
  alternates: AlternateAD[];
}

// ── Geodésicos ────────────────────────────────────────────
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function distNM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065;
  const dLat = (lat2-lat1)*DEG, dLon = (lon2-lon1)*DEG;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*DEG)*Math.cos(lat2*DEG)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function trueBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1=lat1*DEG, φ2=lat2*DEG, Δλ=(lon2-lon1)*DEG;
  const x=Math.sin(Δλ)*Math.cos(φ2);
  const y=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (Math.atan2(x,y)*RAD+360)%360;
}

/** Ponto ao longo da geodésica (t=0..1) */
function interpolate(lat1: number, lon1: number, lat2: number, lon2: number, t: number): [number,number] {
  return [lat1 + (lat2-lat1)*t, lon1 + (lon2-lon1)*t];
}

/** Distância perpendicular de um ponto à linha DEP→ARR */
function crossTrackDist(
  lat: number, lon: number,
  lat1: number, lon1: number,
  lat2: number, lon2: number
): { dist: number; along: number } {
  // Projeção do ponto na linha
  const totalDist = distNM(lat1,lon1,lat2,lon2);
  if (totalDist < 0.1) return { dist: distNM(lat,lon,lat1,lon1), along: 0 };

  // Parâmetro t da projeção mais próxima
  const dx = lon2-lon1, dy = lat2-lat1;
  const t  = Math.max(0, Math.min(1,
    ((lon-lon1)*dx + (lat-lat1)*dy) / (dx*dx+dy*dy)
  ));
  const [projLat, projLon] = interpolate(lat1,lon1,lat2,lon2,t);
  return { dist: distNM(lat,lon,projLat,projLon), along: t };
}

async function fetchDeclination(lat: number, lon: number): Promise<number> {
  try {
    const today = new Date().toISOString().slice(0,10);
    const res = await fetch(
      `https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination?lat=${lat}&lon=${lon}&startYear=${today}&resultFormat=json`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    return data?.result?.[0]?.declination ?? 0;
  } catch {
    return -19 + (lat+5)*0.25 + (lon+55)*(-0.15);
  }
}

function fmt3(deg: number) { return String(Math.round(deg)).padStart(3,'0')+'°'; }

// ── ADs alternativos conhecidos (Brasil) ──────────────────
// Fonte: Our Airports CSV (coordenadas aproximadas dos principais)
const KNOWN_AIRPORTS: { icao: string; lat: number; lng: number }[] = [
  {icao:'SBSP',lat:-23.626,lng:-46.656},{icao:'SBGR',lat:-23.432,lng:-46.473},
  {icao:'SBBH',lat:-19.851,lng:-43.951},{icao:'SBBR',lat:-15.871,lng:-47.918},
  {icao:'SBCF',lat:-19.624,lng:-43.972},{icao:'SBPA',lat:-29.994,lng:-51.171},
  {icao:'SBFL',lat:-27.670,lng:-48.547},{icao:'SBCT',lat:-25.528,lng:-49.176},
  {icao:'SBRF',lat:-8.126,lng:-34.923},{icao:'SBSV',lat:-12.911,lng:-38.331},
  {icao:'SBFZ',lat:-3.776,lng:-38.533},{icao:'SBMN',lat:-3.146,lng:-59.986},
  {icao:'SBCG',lat:-20.469,lng:-54.673},{icao:'SBVT',lat:-20.258,lng:-40.286},
  {icao:'SBBE',lat:-1.379,lng:-48.476},{icao:'SBIZ',lat:-5.531,lng:-47.457},
  {icao:'SBSN',lat:-2.425,lng:-54.786},{icao:'SBIH',lat:-4.242,lng:-56.001},
  {icao:'SBCJ',lat:-8.346,lng:-49.301},{icao:'SBUL',lat:-18.884,lng:-48.225},
  {icao:'SBGO',lat:-16.632,lng:-49.221},{icao:'SBCR',lat:-19.012,lng:-57.673},
  {icao:'SBMO',lat:-9.511,lng:-35.792},{icao:'SBNT',lat:-5.911,lng:-35.248},
  {icao:'SBMQ',lat:0.050,lng:-51.072}, {icao:'SBBV',lat:2.841,lng:-60.692},
  {icao:'SBPV',lat:-8.709,lng:-63.902},{icao:'SBEG',lat:-3.038,lng:-60.050},
  {icao:'SBRB',lat:-9.869,lng:-67.898},{icao:'SBPJ',lat:-10.291,lng:-48.357},
  {icao:'SBCY',lat:-15.653,lng:-56.117},{icao:'SBCN',lat:-17.726,lng:-48.610},
  {icao:'SBLO',lat:-23.333,lng:-51.130},{icao:'SBMG',lat:-23.476,lng:-52.012},
  {icao:'SBFI',lat:-25.600,lng:-54.485},{icao:'SBUR',lat:-19.765,lng:-47.966},
  {icao:'SBTE',lat:-5.060,lng:-42.823},{icao:'SBSL',lat:-2.585,lng:-44.235},
  {icao:'SBCX',lat:-29.197,lng:-51.188},{icao:'SBRP',lat:-21.136,lng:-47.777},
  {icao:'SBKP',lat:-23.007,lng:-47.135},{icao:'SBSG',lat:-5.768,lng:-35.376},
  {icao:'SBJP',lat:-7.145,lng:-34.950},{icao:'SBMK',lat:-16.706,lng:-43.819},
  {icao:'SBIP',lat:-19.471,lng:-42.488},{icao:'SBTB',lat:-1.489,lng:-48.742},
  {icao:'SBYA',lat:-3.856,lng:-32.394},{icao:'SBJF',lat:-21.792,lng:-43.387},
];

// ── Mapa SVG ──────────────────────────────────────────────

interface MapProps {
  dep: AirportCoord;
  arr: AirportCoord;
  alternates: AlternateAD[];
  onSelect: (icao: string) => void;
  selected: string | null;
}

function RouteMap({ dep, arr, alternates, onSelect, selected }: MapProps) {
  // Projetar lat/lng para SVG (Mercator simples)
  const W = 560, H = 240, PAD = 36;

  const lats = [dep.lat, arr.lat, ...alternates.map(a => a.lat)];
  const lngs = [dep.lng, arr.lng, ...alternates.map(a => a.lng)];
  const minLat = Math.min(...lats) - 0.5;
  const maxLat = Math.max(...lats) + 0.5;
  const minLng = Math.min(...lngs) - 0.5;
  const maxLng = Math.max(...lngs) + 0.5;

  const project = (lat: number, lng: number): [number, number] => {
    const x = PAD + ((lng - minLng) / (maxLng - minLng)) * (W - PAD*2);
    const y = PAD + ((maxLat - lat) / (maxLat - minLat)) * (H - PAD*2);
    return [x, y];
  };

  const [dx, dy] = project(dep.lat, dep.lng);
  const [ax, ay] = project(arr.lat, arr.lng);

  const CAT_COLOR: Record<string, string> = {
    VMC: '#00e676', MVFR: '#ffab00', IFR: '#ff3d3d', LIFR: '#ff00cc',
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.mapSvg}>
      {/* Grid sutil */}
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0,100,160,.06)" strokeWidth="1"/>
        </pattern>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />

      {/* Linha de rota tracejada */}
      <line
        x1={dx} y1={dy} x2={ax} y2={ay}
        stroke="#00aaff" strokeWidth="1.5"
        strokeDasharray="8 5" opacity="0.6"
      />
      {/* Sombra da linha */}
      <line
        x1={dx} y1={dy} x2={ax} y2={ay}
        stroke="#00aaff" strokeWidth="4"
        opacity="0.08"
      />

      {/* ADs alternativos */}
      {alternates.map(alt => {
        const [px, py] = project(alt.lat, alt.lng);
        const col = alt.cat ? (CAT_COLOR[alt.cat] || '#4a6878') : '#4a6878';
        const isSel = selected === alt.icao;
        return (
          <g key={alt.icao} onClick={() => onSelect(alt.icao)} style={{ cursor: 'pointer' }}>
            {/* Linha pontilhada do ponto da rota ao AD */}
            {(() => {
              const [rx, ry] = project(
                ...interpolate(dep.lat, dep.lng, arr.lat, arr.lng, alt.posAlongRoute)
              );
              return (
                <line
                  x1={rx} y1={ry} x2={px} y2={py}
                  stroke={col} strokeWidth="1"
                  strokeDasharray="3 3" opacity="0.4"
                />
              );
            })()}
            {/* Ponto */}
            <circle cx={px} cy={py} r={isSel ? 7 : 5}
              fill={col} fillOpacity="0.15"
              stroke={col} strokeWidth={isSel ? 2 : 1.5}
              filter={isSel ? 'url(#glow)' : undefined}
            />
            {/* Label */}
            <text x={px} y={py - 9} textAnchor="middle"
              fill={col} fontSize="9" fontFamily="var(--disp)"
              letterSpacing="1"
            >{alt.icao}</text>
          </g>
        );
      })}

      {/* DEP */}
      <circle cx={dx} cy={dy} r="8" fill="#00aaff" fillOpacity="0.15"
        stroke="#00aaff" strokeWidth="2" filter="url(#glow)" />
      <circle cx={dx} cy={dy} r="3" fill="#00d4ff" />
      <text x={dx} y={dy-12} textAnchor="middle"
        fill="#00d4ff" fontSize="10" fontFamily="var(--disp)" letterSpacing="1.5">
        {dep.icao}
      </text>

      {/* ARR */}
      <circle cx={ax} cy={ay} r="8" fill="#00aaff" fillOpacity="0.15"
        stroke="#00aaff" strokeWidth="2" filter="url(#glow)" />
      <circle cx={ax} cy={ay} r="3" fill="#00d4ff" />
      <text x={ax} y={ay-12} textAnchor="middle"
        fill="#00d4ff" fontSize="10" fontFamily="var(--disp)" letterSpacing="1.5">
        {arr.icao}
      </text>

      {/* Seta de direção no meio da rota */}
      {(() => {
        const mx = (dx+ax)/2, my = (dy+ay)/2;
        const angle = Math.atan2(ay-dy, ax-dx) * RAD;
        return (
          <g transform={`translate(${mx},${my}) rotate(${angle})`}>
            <polygon points="-6,-3 0,0 -6,3" fill="#00aaff" opacity="0.6" />
          </g>
        );
      })()}
    </svg>
  );
}

// ── Componente principal ──────────────────────────────────

export function RoutePanel({ dep, arr }: RoutePanelProps) {
  const [route,    setRoute]    = useState<RouteData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!dep || !arr) return;
    setLoading(true); setError(null); setRoute(null); setSelected(null);

    Promise.all([
      fetch(`/api/airport?icao=${dep}`).then(r => r.json()),
      fetch(`/api/airport?icao=${arr}`).then(r => r.json()),
    ]).then(async ([dData, aData]) => {
      if (dData.error) throw new Error(`DEP: ${dData.error}`);
      if (aData.error) throw new Error(`ARR: ${aData.error}`);

      const dLat = parseFloat(dData.lat), dLng = parseFloat(dData.lng);
      const aLat = parseFloat(aData.lat), aLng = parseFloat(aData.lng);
      if (isNaN(dLat) || isNaN(aLat)) throw new Error('Coordenadas indisponíveis');

      const distance = distNM(dLat, dLng, aLat, aLng);
      const bearing  = trueBearing(dLat, dLng, aLat, aLng);
      const decl     = await fetchDeclination((dLat+aLat)/2, (dLng+aLng)/2);
      const heading  = (bearing - decl + 360) % 360;

      // Encontrar ADs alternativos próximos à rota (máx 80NM, excluindo DEP e ARR)
      const MAX_DIST_NM = 80;
      const altCandidates = KNOWN_AIRPORTS
        .filter(a => a.icao !== dep && a.icao !== arr)
        .map(a => {
          const { dist, along } = crossTrackDist(a.lat, a.lng, dLat, dLng, aLat, aLng);
          return { ...a, dist, along };
        })
        .filter(a => a.dist <= MAX_DIST_NM && a.along >= 0.05 && a.along <= 0.95)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 6); // máx 6 alternativos

      // Buscar METAR de cada alternativo em paralelo
      const altWithMetar: AlternateAD[] = await Promise.all(
        altCandidates.map(async a => {
          try {
            const m = await fetch(`/api/metar?icao=${a.icao}`).then(r => r.json());
            const raw = m.metar || null;
            let cat: string | null = null;
            if (raw) {
              const { decodeMetar: dm, getFlightCategory: gfc } = await import('@/lib/weather/metar');
              cat = gfc(dm(raw));
            }
            return {
              icao: a.icao, name: a.icao,
              lat: a.lat, lng: a.lng,
              distNM: Math.round(a.dist),
              posAlongRoute: a.along,
              metar: raw, cat,
            };
          } catch {
            return {
              icao: a.icao, name: a.icao,
              lat: a.lat, lng: a.lng,
              distNM: Math.round(a.dist),
              posAlongRoute: a.along,
              metar: null, cat: null,
            };
          }
        })
      );

      setRoute({
        dep: { icao: dep, lat: dLat, lng: dLng, name: dData.name || dep },
        arr: { icao: arr, lat: aLat, lng: aLng, name: aData.name || arr },
        distance: Math.round(distance),
        bearing:  Math.round(bearing),
        heading:  Math.round(heading),
        decl:     Math.round(decl * 10) / 10,
        alternates: altWithMetar,
      });
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [dep, arr]);

  const selectedAlt = route?.alternates.find(a => a.icao === selected);
  const CAT_COLOR: Record<string, string> = {
    VMC: '#00e676', MVFR: '#ffab00', IFR: '#ff3d3d', LIFR: '#ff00cc',
  };

  return (
    <Panel title="ROTA" subtitle={`${dep} → ${arr}`}
      status={loading ? 'loading' : error ? 'warn' : 'ok'}>
      {loading && <div className={styles.msg}><span className="spin" /> Calculando rota…</div>}
      {error   && <div className={styles.warn}>⚠ {error}</div>}

      {route && (
        <>
          {/* ── Métricas ── */}
          <div className={styles.routeGrid}>
            <div className={[styles.cell, styles.cellHighlight].join(' ')}>
              <span className={styles.cellLabel}>RUMO MAG</span>
              <span className={styles.cellValue}>{fmt3(route.heading)}</span>
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

          {/* ── Mapa SVG ── */}
          <div className={styles.mapWrap}>
            <RouteMap
              dep={route.dep} arr={route.arr}
              alternates={route.alternates}
              onSelect={icao => setSelected(s => s === icao ? null : icao)}
              selected={selected}
            />
          </div>

          {/* ── Painel do alternativo selecionado ── */}
          {selectedAlt && (
            <div className={styles.altDetail}>
              <div className={styles.altHeader}>
                <span className={styles.altIcao}>{selectedAlt.icao}</span>
                {selectedAlt.cat && (
                  <span className={styles.altCat}
                    style={{ color: CAT_COLOR[selectedAlt.cat] || 'var(--txtd)' }}>
                    {selectedAlt.cat}
                  </span>
                )}
                <span className={styles.altDist}>{selectedAlt.distNM}NM da rota</span>
                <button className={styles.altClose} onClick={() => setSelected(null)}>✕</button>
              </div>
              {selectedAlt.metar && (
                <pre className={styles.altMetar}>{selectedAlt.metar}</pre>
              )}
              {!selectedAlt.metar && (
                <span className={styles.altNoMetar}>METAR não disponível</span>
              )}
            </div>
          )}

          {/* ── Lista de alternativos ── */}
          {route.alternates.length > 0 && (
            <div className={styles.altList}>
              <span className={styles.altListLabel}>ALTERNATIVOS NA ROTA</span>
              <div className={styles.altChips}>
                {route.alternates.map(a => (
                  <button
                    key={a.icao}
                    className={[styles.altChip, selected === a.icao ? styles.altChipSel : ''].join(' ')}
                    onClick={() => setSelected(s => s === a.icao ? null : a.icao)}
                    style={a.cat ? { borderColor: CAT_COLOR[a.cat] + '66' } : undefined}
                  >
                    <span className={styles.altChipIcao}>{a.icao}</span>
                    {a.cat && (
                      <span className={styles.altChipCat}
                        style={{ color: CAT_COLOR[a.cat] || 'var(--txtd)' }}>
                        {a.cat}
                      </span>
                    )}
                    <span className={styles.altChipDist}>{a.distNM}NM</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {route.alternates.length === 0 && (
            <div className={styles.altEmpty}>
              — Nenhum alternativo conhecido próximo à rota
            </div>
          )}

          <div className={styles.disclaimer}>
            * Rumo magnético NOAA IGRF · Alternativos dentro de 80NM da rota ·
            Consulte carta atualizada para planejamento operacional.
          </div>
        </>
      )}
    </Panel>
  );
}
