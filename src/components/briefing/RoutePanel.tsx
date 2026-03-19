// src/components/briefing/RoutePanel.tsx
'use client';
import { useState, useEffect, useRef } from 'react';
import { Panel } from '@/components/ui/Panel';
import { RouteIntelligence } from './RouteIntelligence';
import styles from './RoutePanel.module.css';

interface RoutePanelProps { dep: string; arr: string; }
interface AirportCoord { icao: string; lat: number; lng: number; name: string; }
interface AlternateAD {
  icao: string; lat: number; lng: number;
  distNM: number; posAlongRoute: number;
  metar: string | null; cat: string | null;
}
interface RouteData {
  dep: AirportCoord; arr: AirportCoord;
  distance: number; heading: number;
  alternates: AlternateAD[];
  firs: string[];
}
interface SigmetItem {
  id_fir: string;
  validade_inicial: string;
  validade_final: string;
  mens: string;
  fenomeno: string;
  fenomeno_comp: string;
  fenomeno_cor: string;
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
function crossTrackDist(lat: number, lon: number, lat1: number, lon1: number, lat2: number, lon2: number): { dist: number; along: number } {
  const totalDist = distNM(lat1,lon1,lat2,lon2);
  if (totalDist < 0.1) return { dist: distNM(lat,lon,lat1,lon1), along: 0 };
  const dx=lon2-lon1, dy=lat2-lat1;
  const t=Math.max(0,Math.min(1,((lon-lon1)*dx+(lat-lat1)*dy)/(dx*dx+dy*dy)));
  const [pLat,pLon]=interpolate(lat1,lon1,lat2,lon2,t);
  return { dist: distNM(lat,lon,pLat,pLon), along: t };
}
async function fetchDeclination(lat: number, lon: number): Promise<number> {
  try {
    const year = new Date().getUTCFullYear();
    const res = await fetch(
      `https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination?lat=${lat}&lon=${lon}&startYear=${year}&resultFormat=json`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    return data?.result?.[0]?.declination ?? 0;
  } catch {
    return -19+(lat+5)*0.25+(lon+55)*(-0.15);
  }
}
function fmt3(deg: number) { return String(Math.round(deg)).padStart(3,'0')+'°'; }

// ── FIRs ─────────────────────────────────────────────────
const FIR_IDS = ['SBAO','SBRE','SBBS','SBAZ','SBCW'];
const FIR_BOUNDS: Record<string, (lat: number, lng: number) => boolean> = {
  SBAO: (lat, lng) => lng < -20 && lat > -20,
  SBRE: (lat, lng) => lat > -15 && lng > -48 && lng < -32,
  SBBS: (lat, lng) => lat < -5 && lat > -25 && lng > -55 && lng < -38,
  SBAZ: (lat, lng) => lng < -55 && lat > -15,
  SBCW: (lat, lng) => lat < -20 && lng > -58,
};
function estimateFirs(depLat: number, depLng: number, arrLat: number, arrLng: number): string[] {
  const firs = new Set<string>();
  for (let t = 0; t <= 1; t += 0.125) {
    const lat = depLat + (arrLat-depLat)*t;
    const lng = depLng + (arrLng-depLng)*t;
    FIR_IDS.forEach(id => { if (FIR_BOUNDS[id](lat, lng)) firs.add(id); });
  }
  return [...firs];
}

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
  {icao:'SBMK',lat:-16.706,lng:-43.819},{icao:'SBTB',lat:-1.489,lng:-48.742},
  {icao:'SBJF',lat:-21.792,lng:-43.387},{icao:'SBEG',lat:-3.038,lng:-60.050},
  // Regionais
  {icao:'SBCA',lat:-25.000,lng:-53.501},{icao:'SBDO',lat:-22.200,lng:-54.925},
  {icao:'SBCX',lat:-29.197,lng:-51.188},{icao:'SBPK',lat:-31.717,lng:-52.328},
  {icao:'SBNM',lat:-27.674,lng:-53.697},{icao:'SBCH',lat:-27.135,lng:-52.656},
  {icao:'SBAR',lat:-10.984,lng:-37.071},{icao:'SBIL',lat:-14.815,lng:-39.034},
  {icao:'SBVC',lat:-14.908,lng:-40.917},{icao:'SBPS',lat:-16.438,lng:-39.081},
  {icao:'SBMA',lat:-5.369,lng:-49.138},{icao:'SBSM',lat:-29.711,lng:-53.689},
  {icao:'SBAU',lat:-21.149,lng:-50.426},{icao:'SBDB',lat:-15.990,lng:-52.256},
  {icao:'SBCO',lat:-29.943,lng:-51.144},{icao:'SBBE',lat:-1.379,lng:-48.476},
];

const CAT_COLOR: Record<string,string> = {
  VMC:'#00e676', MVFR:'#ffab00', IFR:'#ff3d3d', LIFR:'#ff00cc',
};

// ── Hook: useSigmet ───────────────────────────────────────
function useSigmet(firs: string[]) {
  const [sigmets, setSigmets] = useState<SigmetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const firsKey = firs.join(',');

  useEffect(() => {
    if (!firsKey) return;
    setLoading(true); setError(null);
    const ctrl = new AbortController();
    fetch('/api/sigmet', { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        if (!data?.data?.data) { setSigmets([]); return; }
        const now = Date.now();
        const filtered: SigmetItem[] = data.data.data.filter((s: SigmetItem) => {
          if (!firs.includes(s.id_fir)) return false;
          const fim = new Date(s.validade_final.replace(' ','T')+'Z').getTime();
          return fim > now;
        });
        setSigmets(filtered);
      })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [firsKey]); // eslint-disable-line

  return { sigmets, loading, error };
}

// ── SigmetBar ─────────────────────────────────────────────
function SigmetBar({ firs }: { firs: string[] }) {
  const { sigmets, loading, error } = useSigmet(firs);

  return (
    <div className={styles.sigmetSection}>
      <div className={styles.sigmetBar}>
        <span className={styles.sigmetLabel}>SIGMET</span>
        {loading && <span className={styles.sigmetLoading}><span className="spin" /> buscando…</span>}
        {error && !loading && <span className={styles.sigmetError}>⚠ {error}</span>}
        {!loading && !error && sigmets.length === 0 && (
          <span className={styles.sigmetClear}>✓ nenhum ativo na rota</span>
        )}
        {!loading && !error && sigmets.length > 0 && (
          <span className={styles.sigmetCount}>⚠ {sigmets.length} ativo{sigmets.length > 1 ? 's' : ''}</span>
        )}
      </div>
      {sigmets.length > 0 && (
        <ul className={styles.sigmetList}>
          {sigmets.map((s, i) => (
            <li key={i} className={styles.sigmetItem}>
              <div className={styles.sigmetItemHeader}>
                <span className={styles.sigmetFir}>{s.id_fir}</span>
                <span className={styles.sigmetFenomeno} style={{ color: s.fenomeno_cor || '#ff4444' }}>
                  {s.fenomeno}
                </span>
                <span className={styles.sigmetValidade}>
                  {s.validade_inicial.slice(11,16)}–{s.validade_final.slice(11,16)}Z
                </span>
              </div>
              <div className={styles.sigmetMens}>{s.mens}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
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
      // Fallback de coords: usar KNOWN_AIRPORTS se a API não retornar coordenadas válidas
      const knownDep = KNOWN_AIRPORTS.find(a => a.icao === dep);
      const knownArr = KNOWN_AIRPORTS.find(a => a.icao === arr);

      let dLat = parseFloat(dData.lat), dLng = parseFloat(dData.lng);
      let aLat = parseFloat(aData.lat), aLng = parseFloat(aData.lng);

      if (isNaN(dLat) && knownDep) { dLat = knownDep.lat; dLng = knownDep.lng; }
      if (isNaN(aLat) && knownArr) { aLat = knownArr.lat; aLng = knownArr.lng; }

      if (isNaN(dLat) || isNaN(aLat)) throw new Error('Coordenadas indisponíveis');

      // Nome do aeródromo: API ou fallback para o ICAO
      if (!dData.name && knownDep) dData.name = dep;
      if (!aData.name && knownArr) aData.name = arr;

      const distance = distNM(dLat,dLng,aLat,aLng);
      const bearing  = trueBearing(dLat,dLng,aLat,aLng);
      const decl     = await fetchDeclination((dLat+aLat)/2,(dLng+aLng)/2);
      const heading  = (bearing-decl+360)%360;

      const alts = KNOWN_AIRPORTS
        .filter(a => a.icao !== dep && a.icao !== arr)
        .map(a => { const r=crossTrackDist(a.lat,a.lng,dLat,dLng,aLat,aLng); return {...a,...r}; })
        .filter(a => a.dist<=80 && a.along>=0.05 && a.along<=0.95)
        .sort((a,b) => a.dist-b.dist).slice(0,6);

      const altWithMetar: AlternateAD[] = await Promise.all(alts.map(async a => {
        try {
          const m = await fetch(`/api/metar?icao=${a.icao}`).then(r=>r.json());
          const raw = m.metar || null;
          let cat: string|null = null;
          if (raw) {
            const { decodeMetar: dm, getFlightCategory: gfc } = await import('@/lib/weather/metar');
            cat = gfc(dm(raw));
          }
          return { icao:a.icao, lat:a.lat, lng:a.lng, distNM:Math.round(a.dist), posAlongRoute:a.along, metar:raw, cat };
        } catch {
          return { icao:a.icao, lat:a.lat, lng:a.lng, distNM:Math.round(a.dist), posAlongRoute:a.along, metar:null, cat:null };
        }
      }));

      setRoute({
        dep: { icao:dep, lat:dLat, lng:dLng, name:dData.name||dep },
        arr: { icao:arr, lat:aLat, lng:aLng, name:aData.name||arr },
        distance: Math.round(distance),
        heading:  Math.round(heading),
        alternates: altWithMetar,
        firs: estimateFirs(dLat, dLng, aLat, aLng),
      });
    }).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  }, [dep, arr]);

  const selectedAlt = route?.alternates.find(a => a.icao === selected);

  return (
    <Panel
      title="ROTA"
      subtitle={route
        ? <span style={{display:'flex',alignItems:'baseline',gap:'6px',fontFamily:'var(--mono)',fontSize:'0.72rem',letterSpacing:'1px'}}>
            <span style={{fontFamily:'var(--disp)',fontSize:'0.85rem',letterSpacing:'2px',color:'var(--acc2)',fontWeight:700}}>{dep}</span>
            <span style={{color:'var(--txtd)'}}>→</span>
            <span style={{color:'var(--txtd)'}}>{fmt3(route.heading)} · {route.distance} NM</span>
            <span style={{color:'var(--txtd)'}}>→</span>
            <span style={{fontFamily:'var(--disp)',fontSize:'0.85rem',letterSpacing:'2px',color:'var(--acc2)',fontWeight:700}}>{arr}</span>
          </span>
        : `${dep} → ${arr}`}
      status={loading?'loading':error?'warn':'ok'}>
      {loading && <div className={styles.msg}><span className="spin"/> Calculando rota…</div>}
      {error   && <div className={styles.warn}>⚠ {error}</div>}

      {route && (<>
        {/* ── Rota Operacional Inteligente ── */}
        <RouteIntelligence dep={dep} arr={arr} />


        {/* ── Alternativo selecionado ── */}
        {selectedAlt && (
          <div className={styles.altDetail}>
            <div className={styles.altHeader}>
              <span className={styles.altIcao}>{selectedAlt.icao}</span>
              {selectedAlt.cat && <span className={styles.altCat} style={{color:CAT_COLOR[selectedAlt.cat]||'var(--txtd)'}}>{selectedAlt.cat}</span>}
              <span className={styles.altDist}>{selectedAlt.distNM}NM da rota</span>
              <button className={styles.altClose} onClick={()=>setSelected(null)}>✕</button>
            </div>
            {selectedAlt.metar ? <pre className={styles.altMetar}>{selectedAlt.metar}</pre> : <span className={styles.altNoMetar}>METAR não disponível</span>}
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
                  style={a.cat ? {borderColor:CAT_COLOR[a.cat]+'55'} : undefined}>
                  <span className={styles.altChipIcao}>{a.icao}</span>
                  {a.cat && <span className={styles.altChipCat} style={{color:CAT_COLOR[a.cat]||'var(--txtd)'}}>{a.cat}</span>}
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
      </>)}
    </Panel>
  );
}
