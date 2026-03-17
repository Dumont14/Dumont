// src/components/briefing/RoutePanel.tsx
'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Panel } from '@/components/ui/Panel';
import styles from './RoutePanel.module.css';
import ercStyles from './RoutePanel.routes.module.css';
import { fetchRoutesp } from '@/lib/aisweb/routes';
import type { RoutespItem, ErcLevel } from '@/types/aisweb';

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
  {icao:'SBMK',lat:-16.706,lng:-43.819},
  {icao:'SBTB',lat:-1.489,lng:-48.742},{icao:'SBJF',lat:-21.792,lng:-43.387},
];

// ── Cores ERC ─────────────────────────────────────────────
const ERC_COLOR: Record<string, string> = {
  L: '#ff9900',
  H: '#00aaff',
  DEFAULT: '#00e676',
};

function ercColor(level?: string): string {
  if (!level) return ERC_COLOR.DEFAULT;
  return ERC_COLOR[level.toUpperCase()] ?? ERC_COLOR.DEFAULT;
}

// ── Hook: useErcRoutes ────────────────────────────────────
// Gerencia fetch, debounce, AbortController e cache de rotas ERC.

function useErcRoutes(dep: string, arr: string, level: ErcLevel, enabled: boolean) {
  const [routes, setRoutes]   = useState<RoutespItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const abortRef              = useRef<AbortController | null>(null);
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Limpar ao desativar
    if (!enabled) {
      setRoutes([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (!dep || !arr) return;

    // Debounce 300ms
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      // Cancelar request anterior
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setLoading(true);
      setError(null);

      try {
        const results = await fetchRoutesp({
          adep: dep,
          ades: arr,
          level,
          signal: ctrl.signal,
          limit: 200,
        });
        if (!ctrl.signal.aborted) {
          setRoutes(results);
        }
      } catch (e: unknown) {
        if ((e as Error).name === 'AbortError') return;
        setError((e as Error).message ?? 'Erro ao buscar rotas ERC');
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [dep, arr, level, enabled]);

  return { routes, loading, error };
}

// ── Hook: useErcLayers ────────────────────────────────────
// Gerencia polylines Leaflet para rotas ERC.
// Separado do fetch — recebe o mapa por ref e os dados como props.

function useErcLayers(
  leafRef: React.MutableRefObject<any>,
  routes: RoutespItem[],
  enabled: boolean,
  onRouteClick: (route: RoutespItem) => void,
) {
  const layersRef = useRef<Map<string, any>>(new Map());

  const clearAllLayers = useCallback(() => {
    layersRef.current.forEach(layer => {
      try { layer.remove(); } catch { /* já removida */ }
    });
    layersRef.current.clear();
  }, []);

  useEffect(() => {
    // Capturar snapshot do mapa no momento do efeito.
    // Se o mapa for destruído e recriado, snapshotMap !== leafRef.current
    // e as polylines antigas já terão sido removidas no cleanup.
    const snapshotMap = leafRef.current;
    if (!snapshotMap) return;

    clearAllLayers();
    if (!enabled || routes.length === 0) return;

    // L já está disponível em window após o LeafletMap carregar
    const L = (typeof window !== 'undefined' && (window as any).L)
      || null;

    if (!L) {
      // L ainda não carregou — tentar via import dinâmico sem bloquear o mapa
      import('leaflet' as any).then(mod => {
        const Ldyn = mod.default || mod;
        if (leafRef.current !== snapshotMap) return; // mapa foi substituído
        drawLayers(Ldyn, snapshotMap);
      }).catch(console.warn);
      return clearAllLayers;
    }

    drawLayers(L, snapshotMap);
    return clearAllLayers;

    function drawLayers(Lref: any, map: any) {
      routes.forEach(route => {
        if (!route.coords || route.coords.length < 2) return;

        const color = ercColor(route.level);
        let poly: any;
        try {
          poly = Lref.polyline(route.coords, {
            color, weight: 3, opacity: 0.85,
          }).addTo(map);
        } catch {
          return; // mapa pode já ter sido destruído entre o check e o addTo
        }

        poly.on('mouseover', () => poly.setStyle({ weight: 5, opacity: 1.0 }));
        poly.on('mouseout',  () => poly.setStyle({ weight: 3, opacity: 0.85 }));
        poly.on('click', () => {
          onRouteClick(route);
          poly.setStyle({ weight: 5, opacity: 1.0 });
          try { map.fitBounds(poly.getBounds(), { padding: [30, 30] }); } catch { /* */ }
        });

        layersRef.current.set(route.id, poly);
      });
    }
  }, [routes, enabled, clearAllLayers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) clearAllLayers();
  }, [enabled, clearAllLayers]);

  const focusRoute = useCallback((route: RoutespItem) => {
    const layer = layersRef.current.get(route.id);
    if (!layer || !leafRef.current) return;
    layersRef.current.forEach(l => { try { l.setStyle({ weight: 3, opacity: 0.85 }); } catch { /* */ } });
    layer.setStyle({ weight: 5, opacity: 1.0 });
    try { leafRef.current.fitBounds(layer.getBounds(), { padding: [30, 30] }); } catch { /* */ }
  }, [leafRef]);

  return { focusRoute };
}

// ── Mapa Leaflet ──────────────────────────────────────────
const CAT_COLOR: Record<string,string> = {
  VMC:'#00e676', MVFR:'#ffab00', IFR:'#ff3d3d', LIFR:'#ff00cc',
};

interface LeafletMapProps {
  dep: AirportCoord;
  arr: AirportCoord;
  alternates: AlternateAD[];
  distKm: number;
  onSelect: (icao: string) => void;
  selected: string | null;
  /** Expõe a instância do mapa Leaflet para uso externo (ERC layers) */
  onMapReady: (map: any) => void;
}

function LeafletMap({ dep, arr, alternates, distKm, onSelect, selected, onMapReady }: LeafletMapProps) {
  const mapRef = useRef<any>(null);
  const leafRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

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

      const map = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: true,
      });

      L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 18, minZoom: 3, opacity: 0.6 }
      ).addTo(map);

      L.polyline(
        [[dep.lat, dep.lng], [arr.lat, arr.lng]],
        { color: '#00aaff', weight: 2, dashArray: '8 6', opacity: 0.8 }
      ).addTo(map);

      const midLat = (dep.lat + arr.lat) / 2;
      const midLng = (dep.lng + arr.lng) / 2;
      L.marker([midLat, midLng], {
        icon: L.divIcon({
          html: `<div style="
            background:rgba(6,10,14,.85);
            border:1px solid #00aaff55;
            color:#00d4ff;
            font-family:'Share Tech Mono',monospace;
            font-size:11px;
            padding:2px 8px;
            white-space:nowrap;
            letter-spacing:1px;
          ">${distKm} km</div>`,
          className: '',
          iconAnchor: [30, 10],
        }),
        interactive: false,
        zIndexOffset: -1,
      }).addTo(map);

      const makeIcon = (color: string, size: number) => L.divIcon({
        html: `<div style="
          width:${size}px; height:${size}px; border-radius:50%;
          background:${color}22; border:2px solid ${color};
          box-shadow:0 0 6px ${color}88;
        "></div>`,
        className: '', iconSize: [size, size], iconAnchor: [size/2, size/2],
      });

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

      L.marker([dep.lat, dep.lng], { icon: makeIcon('#00d4ff', 18) })
        .addTo(map)
        .bindTooltip(`<b style="font-family:monospace;color:#00d4ff">${dep.icao}</b><br/>DEP`, {
          permanent: true, direction: 'top', className: 'dumont-tooltip',
        });

      L.marker([arr.lat, arr.lng], { icon: makeIcon('#00d4ff', 18) })
        .addTo(map)
        .bindTooltip(`<b style="font-family:monospace;color:#00d4ff">${arr.icao}</b><br/>ARR`, {
          permanent: true, direction: 'top', className: 'dumont-tooltip',
        });

      const bounds = L.latLngBounds([dep.lat, dep.lng], [arr.lat, arr.lng]);
      alternates.forEach(a => bounds.extend([a.lat, a.lng]));
      map.fitBounds(bounds, { padding: [40, 40] });

      leafRef.current = map;
      // Expor L globalmente para useErcLayers (evita import() duplicado)
      if (typeof window !== 'undefined') (window as any).L = L;
      // Notificar RoutePanel que o mapa está pronto
      onMapReady(map);
    };

    loadLeaflet().catch(console.warn);

    return () => {
      if (leafRef.current) {
        leafRef.current.remove();
        leafRef.current = null;
        // Avisar o pai que o mapa foi destruído — useErcLayers vai ver leafRef.current === null
        onMapReady(null);
      }
    };
  }, [dep.icao, arr.icao, distKm]); // eslint-disable-line

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

// ── Subcomponente: ERC Control Bar ────────────────────────

interface ErcControlBarProps {
  enabled: boolean;
  level: ErcLevel;
  loading: boolean;
  error: string | null;
  count: number;
  onToggle: (v: boolean) => void;
  onLevelChange: (v: ErcLevel) => void;
}

function ErcControlBar({ enabled, level, loading, error, count, onToggle, onLevelChange }: ErcControlBarProps) {
  return (
    <div className={ercStyles.ercBar}>
      <label className={ercStyles.ercToggle}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => onToggle(e.target.checked)}
        />
        <span className={ercStyles.ercToggleTrack}>
          <span className={ercStyles.ercToggleThumb} />
        </span>
        <span className={ercStyles.ercLabel}>ROTAS ERC</span>
      </label>

      {enabled && (
        <div className={ercStyles.ercLevelWrap}>
          <span>NÍV</span>
          <select
            className={ercStyles.ercLevelSelect}
            value={level}
            onChange={e => onLevelChange(e.target.value as ErcLevel)}
          >
            <option value="ALL">L+H</option>
            <option value="L">L</option>
            <option value="H">H</option>
          </select>
        </div>
      )}

      {enabled && loading && (
        <div className={ercStyles.ercStatus}>
          <span className={ercStyles.ercStatusDot} />
          buscando…
        </div>
      )}

      {enabled && error && !loading && (
        <div className={`${ercStyles.ercStatus} ${ercStyles.ercStatusError}`}>
          ⚠ {error}
        </div>
      )}

      {enabled && !loading && !error && count > 0 && (
        <div className={ercStyles.ercStatus}>
          <span className={ercStyles.ercCount}>{count}</span>&nbsp;rota{count !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

// ── Subcomponente: ERC Route List ─────────────────────────

interface ErcRouteListProps {
  routes: RoutespItem[];
  selected: RoutespItem | null;
  onSelect: (route: RoutespItem) => void;
  onFocus: (route: RoutespItem) => void;
  onClose: () => void;
}

function ErcRouteList({ routes, selected, onSelect, onFocus, onClose }: ErcRouteListProps) {
  const [open, setOpen] = useState(true);

  if (routes.length === 0) {
    return (
      <div className={ercStyles.ercEmpty}>
        Nenhuma rota ERC encontrada para este par.
      </div>
    );
  }

  function levelBadgeClass(level?: string) {
    if (!level) return ercStyles.ercLevelOther;
    const up = level.toUpperCase();
    if (up === 'L') return ercStyles.ercLevelL;
    if (up === 'H') return ercStyles.ercLevelH;
    return ercStyles.ercLevelOther;
  }

  return (
    <div className={ercStyles.ercSection}>
      <div
        className={ercStyles.ercSectionHeader}
        onClick={() => setOpen(o => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={`${ercStyles.ercChevron} ${open ? ercStyles.ercChevronOpen : ''}`}>▶</span>
        <span className={ercStyles.ercSectionTitle}>ROTAS PREFERENCIAIS ({routes.length})</span>
      </div>

      {open && (
        <>
          {/* Detalhe da rota selecionada */}
          {selected && (
            <div className={ercStyles.ercDetail}>
              <div className={ercStyles.ercDetailHeader}>
                <span className={`${ercStyles.ercLevelBadge} ${levelBadgeClass(selected.level)}`}>
                  {selected.level ?? '?'}
                </span>
                <span className={ercStyles.ercDetailIdent}>
                  {selected.ident ?? selected.id}
                </span>
                {selected.type && <span style={{ color: '#4a6878', fontSize: 10 }}>{selected.type}</span>}
                <button className={ercStyles.ercDetailClose} onClick={onClose} title="Fechar">✕</button>
              </div>
              {selected.route && (
                <div className={ercStyles.ercDetailRoute}>{selected.route}</div>
              )}
            </div>
          )}

          <ul className={ercStyles.ercRouteList}>
            {routes.map(route => {
              const hasCoords = route.coords && route.coords.length >= 2;
              const isSelected = selected?.id === route.id;
              return (
                <li
                  key={route.id}
                  className={[
                    ercStyles.ercRouteItem,
                    isSelected ? ercStyles.ercRouteItemSelected : '',
                    !hasCoords ? ercStyles.ercRouteItemNoCoords : '',
                  ].join(' ')}
                  onClick={() => hasCoords ? onSelect(route) : undefined}
                  role={hasCoords ? 'button' : undefined}
                  tabIndex={hasCoords ? 0 : undefined}
                  onKeyDown={e => hasCoords && e.key === 'Enter' && onSelect(route)}
                  title={hasCoords ? 'Clique para ver no mapa' : 'Sem coordenadas disponíveis'}
                >
                  <span className={`${ercStyles.ercLevelBadge} ${levelBadgeClass(route.level)}`}>
                    {route.level ?? '?'}
                  </span>
                  <span className={ercStyles.ercRouteIdent}>
                    {route.ident ?? route.id}
                  </span>
                  {route.type && (
                    <span className={ercStyles.ercRouteType}>{route.type}</span>
                  )}
                  {route.route && (
                    <span className={ercStyles.ercRouteFixes} title={route.route}>
                      {route.route}
                    </span>
                  )}
                  {!hasCoords && (
                    <span className={ercStyles.ercNoCoords}>sem coords</span>
                  )}

                  <div className={ercStyles.ercRouteActions}>
                    {hasCoords && (
                      <button
                        className={ercStyles.ercRouteBtn}
                        onClick={e => { e.stopPropagation(); onFocus(route); }}
                        title="Ir para no mapa"
                      >
                        ⊕ mapa
                      </button>
                    )}
                    {route.pdfUrl && (
                      <button
                        className={ercStyles.ercRouteBtn}
                        onClick={e => { e.stopPropagation(); window.open(route.pdfUrl, '_blank'); }}
                        title="Abrir carta PDF"
                      >
                        PDF
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
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

  // ERC state
  const [showErc,       setShowErc]       = useState(false);
  const [ercLevel,      setErcLevel]      = useState<ErcLevel>('ALL');
  const [selectedRoute, setSelectedRoute] = useState<RoutespItem | null>(null);

  // Ref do mapa Leaflet — preenchida via onMapReady callback
  const leafRef = useRef<any>(null);
  const onMapReady = useCallback((map: any) => {
    leafRef.current = map;
  }, []);

  // Hook de dados ERC
  const { routes: ercRoutes, loading: ercLoading, error: ercError } = useErcRoutes(
    dep, arr, ercLevel, showErc
  );

  // Hook de layers ERC no mapa
  const handleRouteClickFromLayer = useCallback((route: RoutespItem) => {
    setSelectedRoute(route);
  }, []);

  const { focusRoute } = useErcLayers(
    leafRef,
    ercRoutes,
    showErc,
    handleRouteClickFromLayer
  );

  // Ao desativar ERC, limpar seleção de rota
  useEffect(() => {
    if (!showErc) setSelectedRoute(null);
  }, [showErc]);

  // ── Fetch de rota principal ────────────────────────────
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
      subtitle={route ? `${dep} → ${arr}  |  ${fmt3(route.heading)} - ${route.distance} NM` : `${dep} → ${arr}`}
      status={loading?'loading':error?'warn':'ok'}>
      {loading && <div className={styles.msg}><span className="spin"/> Calculando rota…</div>}
      {error   && <div className={styles.warn}>⚠ {error}</div>}

      {route && (
        <>
          {/* ── ERC Control Bar ── */}
          <ErcControlBar
            enabled={showErc}
            level={ercLevel}
            loading={ercLoading}
            error={ercError}
            count={ercRoutes.length}
            onToggle={setShowErc}
            onLevelChange={setErcLevel}
          />

          {/* ── Mapa Leaflet ── */}
          <LeafletMap
            dep={route.dep} arr={route.arr}
            alternates={route.alternates}
            distKm={Math.round(route.distance*1.852)}
            onSelect={icao => setSelected(s => s===icao ? null : icao)}
            selected={selected}
            onMapReady={onMapReady}
          />

          {/* ── Lista de rotas ERC ── */}
          {showErc && !ercLoading && (
            <ErcRouteList
              routes={ercRoutes}
              selected={selectedRoute}
              onSelect={route => {
                setSelectedRoute(r => r?.id === route.id ? null : route);
                focusRoute(route);
              }}
              onFocus={focusRoute}
              onClose={() => setSelectedRoute(null)}
            />
          )}

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
