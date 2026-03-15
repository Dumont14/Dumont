// src/lib/airport/index.ts
// Busca dados oficiais do aeródromo:
// - BR: AISWEB ROTAER via proxy São Paulo (dados DECEA oficiais)
// - Internacional: Our Airports CSV (fallback)

export interface Frequency {
  type:        string;   // TWR, APP, GND, ATIS, RADIO, AFIS, UNICOM
  callsign:    string;
  mhz:         string;   // "125.500"
  description: string;
}

export interface Runway {
  ident:    string;   // "06/24"
  length_m: number;
  width_m:  number;
  surface:  string;   // ASPH, CONC, GRASS
  closed:   boolean;
  tora_le?: number | null;  // distância declarada cabeceira baixa
  tora_he?: number | null;  // distância declarada cabeceira alta
}

export interface AirportInfo {
  icao:       string;
  name:       string;
  city:       string;
  uf:         string;
  lat:        string;
  lng:        string;
  alt_ft:     string;
  utc:        string;
  type_opr:   string;   // "VFR IFR"
  type_util:  string;   // "PUB"
  ats_hours:  string;   // "DLY 1015-2145"
  frequencies: Frequency[];
  runways:    Runway[];
  remarks:    string[];  // observações operacionais
  fuel:       string;    // info de abastecimento
  source:     'aisweb' | 'ourairports';
}

const isBrazilian = (icao: string) => /^S[A-Z]{3}$/i.test(icao);

// ── AISWEB ROTAER (BR) ───────────────────────────────────

async function fetchFromAISWEB(icao: string): Promise<AirportInfo | null> {
  const proxyUrl = process.env.SUPABASE_AISWEB_PROXY_URL
    || 'https://qwfoxxwctbeemmowaxpj.supabase.co/functions/v1/aisweb-proxy';

  const res = await fetch(`${proxyUrl}?icao=${icao}&area=rotaer`, {
    headers: { 'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
    next: { revalidate: 86400 }, // cache 24h — ROTAER não muda com frequência
  });

  if (!res.ok) throw new Error(`AISWEB ROTAER proxy ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  const r = data.rotaer;
  if (!r) return null;

  return {
    icao:        r.icao        || icao,
    name:        r.name        || '',
    city:        r.city        || '',
    uf:          r.uf          || '',
    lat:         r.lat         || '',
    lng:         r.lng         || '',
    alt_ft:      r.alt_ft      || '',
    utc:         r.utc         || '',
    type_opr:    r.type_opr    || '',
    type_util:   r.type_util   || '',
    ats_hours:   r.ats_hours   || '',
    frequencies: r.frequencies || [],
    runways:     r.runways     || [],
    remarks:     r.remarks     || [],
    fuel:        r.fuel        || '',
    source:      'aisweb',
  };
}

// ── Our Airports CSV (internacional) ─────────────────────

const CSV_BASE = 'https://davidmegginson.github.io/ourairports-data';
const csvCache: Record<string, string> = {};

async function fetchCSV(url: string): Promise<string> {
  if (csvCache[url]) return csvCache[url];
  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`CSV fetch failed: ${url}`);
  const text = await res.text();
  csvCache[url] = text;
  return text;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; continue; }
    if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
    current += char;
  }
  result.push(current.trim());
  return result;
}

function normalizeFreqType(type: string): string {
  const map: Record<string, string> = {
    'TOWER': 'TWR', 'APPROACH': 'APP', 'GROUND': 'GND',
    'DELIVERY': 'DEL', 'CTAF': 'UNICOM', 'RADIO': 'RADIO',
    'INFO': 'AFIS',
  };
  return map[type.toUpperCase()] || type.toUpperCase();
}

function normalizeSurface(s: string): string {
  const upper = s.toUpperCase();
  if (upper.includes('ASP') || upper.includes('BIT')) return 'ASPH';
  if (upper.includes('CON')) return 'CONC';
  if (upper.includes('GRS') || upper.includes('GRASS') || upper.includes('TURF')) return 'GRASS';
  if (upper.includes('GRV') || upper.includes('GRAVEL')) return 'GRAVEL';
  if (upper.includes('DIRT') || upper.includes('EARTH')) return 'DIRT';
  return upper || 'N/A';
}

async function fetchFromOurAirports(icao: string): Promise<AirportInfo | null> {
  try {
    const [freqCSV, rwyCSV, aptCSV] = await Promise.all([
      fetchCSV(`${CSV_BASE}/airport-frequencies.csv`),
      fetchCSV(`${CSV_BASE}/runways.csv`),
      fetchCSV(`${CSV_BASE}/airports.csv`),
    ]);

    const aptLines  = aptCSV.split('\n');
    const aptHeader = parseCSVLine(aptLines[0]);
    const icaoIdx   = aptHeader.indexOf('ident');
    const idIdx     = aptHeader.indexOf('id');
    const nameIdx   = aptHeader.indexOf('name');
    const latIdx    = aptHeader.indexOf('latitude_deg');
    const lngIdx    = aptHeader.indexOf('longitude_deg');
    const elevIdx   = aptHeader.indexOf('elevation_ft');
    const muniIdx   = aptHeader.indexOf('municipality');

    let airportId = '';
    let airportName = '';
    let airportLat = '';
    let airportLng = '';
    let airportElev = '';
    let airportCity = '';

    for (let i = 1; i < aptLines.length; i++) {
      const cols = parseCSVLine(aptLines[i]);
      if (cols[icaoIdx]?.toUpperCase() === icao) {
        airportId   = cols[idIdx];
        airportName = cols[nameIdx];
        airportLat  = cols[latIdx];
        airportLng  = cols[lngIdx];
        airportElev = cols[elevIdx];
        airportCity = cols[muniIdx];
        break;
      }
    }
    if (!airportId) return null;

    // Frequências
    const freqLines  = freqCSV.split('\n');
    const freqHeader = parseCSVLine(freqLines[0]);
    const fRefIdx    = freqHeader.indexOf('airport_ref');
    const fTypeIdx   = freqHeader.indexOf('type');
    const fMhzIdx    = freqHeader.indexOf('frequency_mhz');
    const fDescIdx   = freqHeader.indexOf('description');

    const frequencies: Frequency[] = [];
    const FREQ_TYPES = ['TWR','TOWER','APP','APPROACH','GND','GROUND','ATIS',
                        'UNICOM','CTAF','DEL','DELIVERY','AFIS','RADIO','INFO'];
    for (let i = 1; i < freqLines.length; i++) {
      const cols = parseCSVLine(freqLines[i]);
      if (cols[fRefIdx] !== airportId) continue;
      const type = cols[fTypeIdx]?.toUpperCase() || '';
      if (!FREQ_TYPES.includes(type)) continue;
      frequencies.push({
        type:        normalizeFreqType(type),
        callsign:    '',
        mhz:         cols[fMhzIdx] || '',
        description: cols[fDescIdx] || '',
      });
    }

    // Pistas
    const rwyLines  = rwyCSV.split('\n');
    const rwyHeader = parseCSVLine(rwyLines[0]);
    const rRefIdx   = rwyHeader.indexOf('airport_ref');
    const rLeIdx    = rwyHeader.indexOf('le_ident');
    const rHeIdx    = rwyHeader.indexOf('he_ident');
    const rLenIdx   = rwyHeader.indexOf('length_ft');
    const rWidIdx   = rwyHeader.indexOf('width_ft');
    const rSurfIdx  = rwyHeader.indexOf('surface');
    const rClosIdx  = rwyHeader.indexOf('closed');

    const runways: Runway[] = [];
    for (let i = 1; i < rwyLines.length; i++) {
      const cols = parseCSVLine(rwyLines[i]);
      if (cols[rRefIdx] !== airportId) continue;
      const lenFt = parseInt(cols[rLenIdx]) || 0;
      runways.push({
        ident:    `${cols[rLeIdx]}/${cols[rHeIdx]}`,
        length_m: Math.round(lenFt * 0.3048),
        width_m:  parseInt(cols[rWidIdx]) || 0,
        surface:  normalizeSurface(cols[rSurfIdx] || ''),
        closed:   cols[rClosIdx] === '1',
      });
    }

    return {
      icao, name: airportName, city: airportCity,
      uf: '', lat: airportLat, lng: airportLng,
      alt_ft: airportElev, utc: '',
      type_opr: '', type_util: '',
      ats_hours: '', frequencies, runways,
      remarks: [], fuel: '',
      source: 'ourairports',
    };
  } catch {
    return null;
  }
}

// ── Entry point ───────────────────────────────────────────

export async function fetchAirportInfo(icao: string): Promise<AirportInfo | null> {
  const code = icao.toUpperCase();

  if (isBrazilian(code)) {
    try {
      const data = await fetchFromAISWEB(code);
      if (data) return data;
    } catch (e) {
      console.warn(`AISWEB ROTAER failed for ${code}, trying Our Airports:`, e);
    }
  }

  // Fallback: Our Airports (internacional ou se AISWEB falhar)
  return fetchFromOurAirports(code);
}
