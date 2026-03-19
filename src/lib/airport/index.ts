// src/lib/airport/index.ts
// Busca dados oficiais do aeródromo:
// 1. BR: AISWEB ROTAER direto (AISWEB_USER / AISWEB_PASS) — fonte primária
// 2. BR fallback: AISWEB via proxy Supabase
// 3. Internacional: Our Airports CSV

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
  tora_le?: number | null;
  tora_he?: number | null;
}

export interface AirportInfo {
  icao:        string;
  name:        string;
  city:        string;
  uf:          string;
  lat:         string;
  lng:         string;
  alt_ft:      string;
  utc:         string;
  type_opr:    string;
  type_util:   string;
  ats_hours:   string;
  frequencies: Frequency[];
  runways:     Runway[];
  remarks:     string[];
  fuel:        string;
  source:      'aisweb' | 'ourairports';
}

const isBrazilian = (icao: string) => /^S[BDINPRSW][A-Z]{2}$/i.test(icao);

function cleanAirportName(name: string): string {
  return name
    .replace(/\s+(International|Interstate|Regional|Municipal|Domestic)\s+(Airport|Aeroporto|Aeródromo)/gi, '')
    .replace(/\s+(Airport|Aeroporto|Aeródromo)\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── 1. AISWEB ROTAER DIRETO ──────────────────────────────
// Fonte primária para ADs brasileiros — sem proxy, sem dependências externas.
// Requer AISWEB_USER e AISWEB_PASS no .env

async function fetchFromAISWEBDirect(icao: string): Promise<AirportInfo | null> {
  const user = process.env.AISWEB_USER;
  const pass = process.env.AISWEB_PASS;
  if (!user || !pass) return null;

  try {
    const q = new URLSearchParams({ apiKey: user, apiPass: pass, area: 'rotaer', icaoCode: icao });
    const res = await fetch(
      `https://api.decea.mil.br/aisweb/?${q}`,
      { next: { revalidate: 86400 }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;

    const xml = await res.text();
    if (!xml || !xml.includes('<lat>')) return null;

    // Helper: extrai texto de tag XML (suporta CDATA e texto simples)
    const get = (tag: string): string => {
      const re = new RegExp(
        `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`
      );
      const m = xml.match(re);
      return (m?.[1] ?? m?.[2] ?? '').trim();
    };

    const lat = get('lat');
    const lng = get('lng');
    if (!lat || !lng || isNaN(parseFloat(lat))) return null;

    // Frequências
    const frequencies: Frequency[] = [];
    const freqRe = /<freq(?:uencia)?[^>]*>([\s\S]*?)<\/freq(?:uencia)?>/gi;
    let fm: RegExpExecArray | null;
    while ((fm = freqRe.exec(xml)) !== null) {
      const b  = fm[1];
      const bg = (t: string) => {
        const m2 = b.match(new RegExp(`<${t}[^>]*>([^<]*)<\\/${t}>`));
        return m2?.[1]?.trim() ?? '';
      };
      const tipo = bg('tipo') || bg('type');
      const mhz  = bg('freq') || bg('frequencia') || bg('mhz');
      if (tipo && mhz) frequencies.push({ type: tipo, callsign: bg('indicativo') || '', mhz, description: '' });
    }

    // Pistas
    const runways: Runway[] = [];
    const rwyRe = /<pista[^>]*>([\s\S]*?)<\/pista>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = rwyRe.exec(xml)) !== null) {
      const b  = rm[1];
      const bg = (t: string) => {
        const m2 = b.match(new RegExp(`<${t}[^>]*>([^<]*)<\\/${t}>`));
        return m2?.[1]?.trim() ?? '';
      };
      const cab1 = bg('cab1') || bg('cabeceira1');
      const cab2 = bg('cab2') || bg('cabeceira2');
      const lenM = parseInt(bg('comprimento') || bg('length') || '0');
      const widM = parseInt(bg('largura')     || bg('width')  || '0');
      const surf = bg('revestimento')         || bg('surface') || 'N/A';
      if (cab1 && cab2) {
        runways.push({ ident: `${cab1}/${cab2}`, length_m: lenM, width_m: widM, surface: surf, closed: false });
      }
    }

    return {
      icao,
      name:      cleanAirportName(get('name') || get('nome') || icao),
      city:      get('city') || get('cidade') || '',
      uf:        get('uf') || '',
      lat, lng,
      alt_ft:    get('alt_ft') || get('elevacao') || get('altitude') || '',
      utc:       get('utc') || '',
      type_opr:  get('type_opr')  || get('tipo_operacao')   || '',
      type_util: get('type_util') || get('tipo_utilizacao') || '',
      ats_hours: get('ats_hours') || get('horario_ats')     || '',
      frequencies, runways, remarks: [],
      fuel:      get('fuel') || get('combustivel') || '',
      source:    'aisweb',
    };
  } catch { return null; }
}

// ── 2. AISWEB via proxy Supabase (fallback BR) ────────────

async function fetchFromAISWEB(icao: string): Promise<AirportInfo | null> {
  const proxyUrl = process.env.SUPABASE_AISWEB_PROXY_URL
    || 'https://qwfoxxwctbeemmowaxpj.supabase.co/functions/v1/aisweb-proxy';

  const res = await fetch(`${proxyUrl}?icao=${icao}&area=rotaer`, {
    headers: { 'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
    next: { revalidate: 86400 },
  });

  if (!res.ok) throw new Error(`AISWEB ROTAER proxy ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  const r = data.rotaer;
  if (!r) return null;

  return {
    icao:        r.icao        || icao,
    name:        cleanAirportName(r.name || ''),
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

// ── 3. Our Airports CSV (internacional) ──────────────────

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
    'DELIVERY': 'DEL', 'CTAF': 'UNICOM', 'RADIO': 'RADIO', 'INFO': 'AFIS',
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

    let airportId = '', airportName = '', airportLat = '';
    let airportLng = '', airportElev = '', airportCity = '';

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
        type: normalizeFreqType(type), callsign: '',
        mhz: cols[fMhzIdx] || '', description: cols[fDescIdx] || '',
      });
    }

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
      icao, name: cleanAirportName(airportName), city: airportCity,
      uf: '', lat: airportLat, lng: airportLng,
      alt_ft: airportElev, utc: '', type_opr: '', type_util: '',
      ats_hours: '', frequencies, runways, remarks: [], fuel: '',
      source: 'ourairports',
    };
  } catch { return null; }
}

// ── Entry point ───────────────────────────────────────────

export async function fetchAirportInfo(icao: string): Promise<AirportInfo | null> {
  const code = icao.toUpperCase();

  if (isBrazilian(code)) {
    // 1. AISWEB direto — fonte primária oficial, sem dependências externas
    try {
      const direct = await fetchFromAISWEBDirect(code);
      if (direct) return direct;
    } catch { /* tenta próximo */ }

    // 2. Proxy Supabase — fallback se AISWEB_USER/PASS não estiverem no .env
    try {
      const proxy = await fetchFromAISWEB(code);
      if (proxy) return proxy;
    } catch (e) {
      console.warn(`AISWEB proxy failed for ${code}:`, e);
    }
  }

  // 3. Our Airports — internacional ou último recurso
  return fetchFromOurAirports(code);
}
