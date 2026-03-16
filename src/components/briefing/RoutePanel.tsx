// src/components/briefing/RoutePanel.tsx
'use client';
import { useState, useEffect, useRef } from 'react';
import { Panel } from '@/components/ui/Panel';
import styles from './RoutePanel.module.css';

interface RoutePanelProps { dep: string; arr: string; }

interface AirportCoord {
  icao: string; lat: number; lng: number; name: string;
}

interface AlternateAD {
  icao:          string;
  lat:           number;
  lng:           number;
  distNM:        number;
  posAlongRoute: number;
  metar:         string | null;
  cat:           string | null;
}

interface RouteData {
  dep:       AirportCoord;
  arr:       AirportCoord;
  distance:  number;
  heading:   number;
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

function interpolate(lat1: number, lon1: number, lat2: number, lon2: number, t: number): [number,number] {
  return [lat1+(lat2-lat1)*t, lon1+(lon2-lon1)*t];
}

function crossTrackDist(
  lat: number, lon: number,
  lat1: number, lon1: number,
  lat2: number, lon2: number
): { dist: number; along: number } {
  const totalDist = distNM(lat1,lon1,lat2,lon2);
  if (totalDist < 0.1) return { dist: distNM(lat,lon,lat1,lon1), along: 0 };
  const dx=lon2-lon1, dy=lat2-lat1;
  const t=Math.max(0,Math.min(1,((lon-lon1)*dx+(lat-lat1)*dy)/(dx*dx+dy*dy)));
  const [pLat,pLon]=interpolate(lat1,lon1,lat2,lon2,t);
  return { dist: distNM(lat,lon,pLat,pLon), along: t };
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
    return -19+(lat+5)*0.25+(lon+55)*(-0.15);
  }
}

function fmt3(deg: number) { return String(Math.round(deg)).padStart(3,'0')+'°'; }

// ── ADs conhecidos ────────────────────────────────────────
const KNOWN_AIRPORTS = [
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
  {icao:'SBMQ',lat:0.050,lng:-51.072},{icao:'SBBV',lat:2.841,lng:-60.692},
  {icao:'SBPV',lat:-8.709,lng:-63.902},{icao:'SBEG',lat:-3.038,lng:-60.050},
  {icao:'SBRB',lat:-9.869,lng:-67.898},{icao:'SBPJ',lat:-10.291,lng:-48.357},
  {icao:'SBCY',lat:-15.653,lng:-56.117},{icao:'SBCN',lat:-17.726,lng:-48.610},
  {icao:'SBLO',lat:-23.333,lng:-51.130},{icao:'SBMG',lat:-23.476,lng:-52.012},
  {icao:'SBFI',lat:-25.600,lng:-54.485},{icao:'SBUR',lat:-19.765,lng:-47.966},
  {icao:'SBTE',lat:-5.060,lng:-42.823},{icao:'SBSL',lat:-2.585,lng:-44.235},
  {icao:'SBRP',lat:-21.136,lng:-47.777},{icao:'SBKP',lat:-23.007,lng:-47.135},
  {icao:'SBSG',lat:-5.768,lng:-35.376},{icao:'SBJP',lat:-7.145,lng:-34.950},
  {icao:'SBMK',lat:-16.706,lng:-43.819},{icao:'SBGO',lat:-16.632,lng:-49.221},
  {icao:'SBTB',lat:-1.489,lng:-48.742},{icao:'SBJF',lat:-21.792,lng:-43.387},
];

// ── Mapa Leaflet ──────────────────────────────────────────
const CAT_COLOR: Record<string,string> = {
  VMC:'#00e676', MVFR:'#ffab00', IFR:'#ff3d3d', LIFR:'#ff00cc',
};

interface LeafletMapProps {
  dep: AirportCoord;
  arr: AirportCoord;
  alternates: AlternateAD[];
  onSelect: (icao: string) => void;
  selected: string | null;
}

function LeafletMap({ dep, arr, alternates, onSelect, selected }: LeafletMapProps) {
  const mapRef = useRef<any>(null);
  const leafRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Carregar Leaflet dinamicamente
    const loadLeaflet = async () => {
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      const L = (await import('leaflet' as any)).default || (await import('leaflet' as any));

      if (!mapRef.current) return;
      if (leafRef.current) { leafRef.current.remove(); leafRef.current = null; }

      // Inicializar mapa
      const map = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: true,
      });

      // Tile layer OpenStreetMap — estilo escuro via Stadia
      // Tile OpenStreetMap — gratuito, sem autenticação
      L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 18, minZoom: 3, opacity: 0.6 }
      ).addTo(map);

      // Linha de rota tracejada
      const routeLine = L.polyline(
        [[dep.lat, dep.lng], [arr.lat, arr.lng]],
        { color: '#00aaff', weight: 2, dashArray: '8 6', opacity: 0.8 }
      ).addTo(map);

      // Ícone customizado para ADs
      const makeIcon = (color: string, size: number) => L.divIcon({
        html: `<div style="
          width:${size}px; height:${size}px; border-radius:50%;
          background:${color}22; border:2px solid ${color};
          box-shadow:0 0 6px ${color}88;
        "></div>`,
        className: '', iconSize: [size, size], iconAnchor: [size/2, size/2],
      });

      // Marcadores dos alternativos
      markersRef.current = alternates.map(alt => {
        const col = alt.cat ? (CAT_COLOR[alt.cat] || '#4a6878') : '#4a6878';
        const marker = L.marker([alt.lat, alt.lng], { icon: makeIcon(col, 14) })
          .addTo(map)
          .bindTooltip(`<b style="font-family:monospace;color:${col}">${alt.icao}</b><br/>${alt.cat||'—'} · ${alt.distNM}NM`, {
            permanent: false, direction: 'top',
            className: 'dumont-tooltip',
          })
          .on('click', () => onSelect(alt.icao));
        return marker;
      });

      // Marcador DEP
      L.marker([dep.lat, dep.lng], { icon: makeIcon('#00d4ff', 18) })
        .addTo(map)
        .bindTooltip(`<b style="font-family:monospace;color:#00d4ff">${dep.icao}</b><br/>DEP`, {
          permanent: true, direction: 'top', className: 'dumont-tooltip',
        });

      // Marcador ARR
      L.marker([arr.lat, arr.lng], { icon: makeIcon('#00d4ff', 18) })
        .addTo(map)
        .bindTooltip(`<b style="font-family:monospace;color:#00d4ff">${arr.icao}</b><br/>ARR`, {
          permanent: true, direction: 'top', className: 'dumont-tooltip',
        });

      // Ajustar zoom para mostrar toda a rota
      const bounds = L.latLngBounds(
        [dep.lat, dep.lng], [arr.lat, arr.lng]
      );
      alternates.forEach(a => bounds.extend([a.lat, a.lng]));
      map.fitBounds(bounds, { padding: [40, 40] });

      leafRef.current = map;
    };

    loadLeaflet().catch(console.warn);

    return () => {
      if (leafRef.current) { leafRef.current.remove(); leafRef.current = null; }
    };
  }, [dep.icao, arr.icao]); // eslint-disable-line

  // Atualizar visual do selecionado
  useEffect(() => {
    if (!leafRef.current) return;
    // Recriar marcadores com tamanho diferente para o selecionado
  }, [selected]);

  return (
    <>
      <style>{`
        .dumont-tooltip {
          background: rgba(6,10,14,.92) !important;
          border: 1px solid #162535 !important;
          color: #b8cdd8 !important;
          font-family: 'Share Tech Mono', monospace !important;
          font-size: 11px !important;
          border-radius: 2px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,.5) !important;
          padding: 4px 8px !important;
        }
        .dumont-tooltip::before { display: none !important; }
        .leaflet-control-zoom {
          border: 1px solid #162535 !important;
          background: rgba(6,10,14,.9) !important;
        }
        .leaflet-control-zoom a {
          background: transparent !important;
          color: #b8cdd8 !important;
          border-bottom: 1px solid #162535 !important;
        }
        .leaflet-control-zoom a:hover { background: rgba(0,170,255,.15) !important; }
      `}</style>
      <div ref={mapRef} className={styles.leafletMap} />
    </>
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

      const dLat=parseFloat(dData.lat), dLng=parseFloat(dData.lng);
      const aLat=parseFloat(aData.lat), aLng=parseFloat(aData.lng);
      if (isNaN(dLat)||isNaN(aLat)) throw new Error('Coordenadas indisponíveis');

      const distance = distNM(dLat,dLng,aLat,aLng);
      const bearing  = trueBearing(dLat,dLng,aLat,aLng);
      const decl     = await fetchDeclination((dLat+aLat)/2,(dLng+aLng)/2);
      const heading  = (bearing-decl+360)%360;

      // Alternativos na rota (80NM)
      const alts = KNOWN_AIRPORTS
        .filter(a => a.icao !== dep && a.icao !== arr)
        .map(a => { const r=crossTrackDist(a.lat,a.lng,dLat,dLng,aLat,aLng); return {...a,...r}; })
        .filter(a => a.dist<=80 && a.along>=0.05 && a.along<=0.95)
        .sort((a,b) => a.dist-b.dist)
        .slice(0,6);

      const altWithMetar: AlternateAD[] = await Promise.all(
        alts.map(async a => {
          try {
            const m = await fetch(`/api/metar?icao=${a.icao}`).then(r=>r.json());
            const raw = m.metar || null;
            let cat: string|null = null;
            if (raw) {
              const { decodeMetar: dm, getFlightCategory: gfc } = await import('@/lib/weather/metar');
              cat = gfc(dm(raw));
            }
            return { icao:a.icao, lat:a.lat, lng:a.lng,
              distNM:Math.round(a.dist), posAlongRoute:a.along, metar:raw, cat };
          } catch {
            return { icao:a.icao, lat:a.lat, lng:a.lng,
              distNM:Math.round(a.dist), posAlongRoute:a.along, metar:null, cat:null };
          }
        })
      );

      setRoute({
        dep: { icao:dep, lat:dLat, lng:dLng, name:dData.name||dep },
        arr: { icao:arr, lat:aLat, lng:aLng, name:aData.name||arr },
        distance: Math.round(distance),
        heading:  Math.round(heading),
        alternates: altWithMetar,
      });
    }).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  }, [dep, arr]);

  const selectedAlt = route?.alternates.find(a => a.icao === selected);

  return (
    <Panel
      title="ROTA"
      subtitle={route ? `${dep} → ${arr}  |  ${Math.round(route.distance*1.852)}km` : `${dep} → ${arr}`}
      status={loading?'loading':error?'warn':'ok'}>
      {loading && <div className={styles.msg}><span className="spin"/> Calculando rota…</div>}
      {error   && <div className={styles.warn}>⚠ {error}</div>}

      {route && (
        <>
          {/* ── Métricas em linha única ── */}
          <div className={styles.metricsRow}>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>RUMO MAG</span>
              <span className={styles.metricVal}>{fmt3(route.heading)}</span>
            </div>
            <div className={styles.metricSep}>·</div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>DISTÂNCIA</span>
              <span className={styles.metricVal}>
                {route.distance}<span className={styles.unit}>NM</span>
              </span>
            </div>
            <div className={styles.metricSep}>·</div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>KM</span>
              <span className={styles.metricVal}>
                {Math.round(route.distance*1.852)}<span className={styles.unit}>km</span>
              </span>
            </div>
          </div>

          {/* ── Mapa Leaflet ── */}
          <LeafletMap
            dep={route.dep} arr={route.arr}
            alternates={route.alternates}
            onSelect={icao => setSelected(s => s===icao ? null : icao)}
            selected={selected}
          />

          {/* ── Alternativo selecionado ── */}
          {selectedAlt && (
            <div className={styles.altDetail}>
              <div className={styles.altHeader}>
                <span className={styles.altIcao}>{selectedAlt.icao}</span>
                {selectedAlt.cat && (
                  <span className={styles.altCat}
                    style={{color: CAT_COLOR[selectedAlt.cat]||'var(--txtd)'}}>
                    {selectedAlt.cat}
                  </span>
                )}
                <span className={styles.altDist}>{selectedAlt.distNM}NM da rota</span>
                <button className={styles.altClose} onClick={()=>setSelected(null)}>✕</button>
              </div>
              {selectedAlt.metar
                ? <pre className={styles.altMetar}>{selectedAlt.metar}</pre>
                : <span className={styles.altNoMetar}>METAR não disponível</span>
              }
            </div>
          )}

          {/* ── Chips de alternativos ── */}
          {route.alternates.length > 0 && (
            <div className={styles.altList}>
              <span className={styles.altListLabel}>ALTERNATIVOS NA ROTA</span>
              <div className={styles.altChips}>
                {route.alternates.map(a => (
                  <button key={a.icao}
                    className={[styles.altChip, selected===a.icao ? styles.altChipSel:''].join(' ')}
                    onClick={()=>setSelected(s=>s===a.icao?null:a.icao)}
                    style={a.cat ? {borderColor:CAT_COLOR[a.cat]+'55'} : undefined}
                  >
                    <span className={styles.altChipIcao}>{a.icao}</span>
                    {a.cat && <span className={styles.altChipCat}
                      style={{color:CAT_COLOR[a.cat]||'var(--txtd)'}}>{a.cat}</span>}
                    <span className={styles.altChipDist}>{a.distNM}NM</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.disclaimer}>
            * Rumo magnético NOAA IGRF · Alternativos até 80NM da rota ·
            Consulte carta atualizada para planejamento operacional.
          </div>
        </>
      )}
    </Panel>
  );
}
