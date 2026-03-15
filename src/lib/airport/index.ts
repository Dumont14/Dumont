// src/lib/airport/index.ts
// Fetches airport frequencies and runways from OurAirports CSV + AISWEB proxy

export interface Frequency {
  type: string;        // TWR, APP, GND, ATIS, UNICOM, etc
  mhz: string;         // ex: "118.100"
  description: string;
}

export interface Runway {
  le_ident: string;    // ex: "06"
  he_ident: string;    // ex: "24"
  length_ft: number;
  width_ft: number;
  surface: string;     // ASPH, CONC, GRASS, etc
  closed: boolean;
}

export interface AirportInfo {
  icao: string;
  name: string;
  frequencies: Frequency[];
  runways: Runway[];
  source: 'ourairports' | 'aisweb' | 'combined';
}

const CSV_BASE = 'https://davidmegginson.github.io/ourairports-data';
const isBrazilian = (icao: string) => /^SB[A-Z]{2}$/i.test(icao);

function getProxyUrl() {
  return process.env.SUPABASE_AISWEB_PROXY_URL || 'https://qwfoxxwctbeemmowaxpj.supabase.co/functions/v1/aisweb-proxy';
}

function getAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

// Cache em memória para os CSVs (evitar fetch repetido)
const csvCache: Record<string, string> = {};

async function fetchCSV(url: string): Promise<string> {
  if (csvCache[url]) return csvCache[url];
  const res = await fetch(url, { next: { revalidate: 86400 } } as any); // cache 24h
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

async function fetchFromOurAirports(icao: string): Promise<AirportInfo | null> {
  try {
    const code = icao.toUpperCase();
    const [freqCSV, rwyCSV, aptCSV] = await Promise.all([
      fetchCSV(`${CSV_BASE}/airport-frequencies.csv`),
      fetchCSV(`${CSV_BASE}/runways.csv`),
      fetchCSV(`${CSV_BASE}/airports.csv`),
    ]);

    // Encontrar airport_ref pelo ICAO
    const aptLines  = aptCSV.split('\n');
    const aptHeader = parseCSVLine(aptLines[0]);
    const icaoIdx   = aptHeader.indexOf('ident');
    const idIdx     = aptHeader.indexOf('id');
    const nameIdx   = aptHeader.indexOf('name');

    let airportId  = '';
    let airportName = '';
    for (let i = 1; i < aptLines.length; i++) {
      const cols = parseCSVLine(aptLines[i]);
      if (cols[icaoIdx]?.toUpperCase() === code) {
        airportId   = cols[idIdx];
        airportName = cols[nameIdx];
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
    for (let i = 1; i < freqLines.length; i++) {
      const cols = parseCSVLine(freqLines[i]);
      if (cols[fRefIdx] !== airportId) continue;
      const type = cols[fTypeIdx]?.toUpperCase() || '';
      // Filtrar apenas tipos relevantes para briefing
      if (!['TWR','TOWER','APP','APPROACH','GND','GROUND',
            'ATIS','UNICOM','CTAF','DEL','DELIVERY',
            'AFIS','RADIO','INFO'].includes(type)) continue;
      frequencies.push({
        type: normalizeFreqType(type),
        mhz:  cols[fMhzIdx] || '',
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
      runways.push({
        le_ident:  cols[rLeIdx]  || '',
        he_ident:  cols[rHeIdx]  || '',
        length_ft: parseInt(cols[rLenIdx]) || 0,
        width_ft:  parseInt(cols[rWidIdx]) || 0,
        surface:   normalizeSurface(cols[rSurfIdx] || ''),
        closed:    cols[rClosIdx] === '1',
      });
    }

    return {
      icao: code, name: airportName,
      frequencies, runways,
      source: 'ourairports',
    };
  } catch {
    return null;
  }
}

async function fetchFromAiswebRotaer(icao: string): Promise<AirportInfo | null> {
  try {
    const proxyUrl = getProxyUrl();
    const res = await fetch(
      `${proxyUrl}?icao=${icao.toUpperCase()}&area=rotaer`,
      {
        headers: { 'Authorization': `Bearer ${getAnonKey()}` },
        next: { revalidate: 3600 },
      } as any
    );

    if (!res.ok) return null;
    const data = await res.json();
    const xml = data.raw || '';
    if (!xml) return null;

    return parseRotaerXML(icao, xml);
  } catch (e) {
    console.error(`[ROTAER] Error for ${icao}:`, e);
    return null;
  }
}

function parseRotaerXML(icao: string, xml: string): AirportInfo {
  const getTag = (content: string, tag: string) => {
    const m = content.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
  };

  const name = getTag(xml, 'nome') || getTag(xml, 'origem') || icao;
  
  // Frequências
  const frequencies: Frequency[] = [];
  const freqBlocks = xml.match(/<frequencia[^>]*>([\s\S]*?)<\/frequencia>/gi) || [];
  for (const block of freqBlocks) {
    const type = getTag(block, 'tipo');
    const mhz = getTag(block, 'valor');
    if (type && mhz) {
      frequencies.push({
        type: normalizeFreqType(type.toUpperCase()),
        mhz,
        description: getTag(block, 'nome') || '',
      });
    }
  }

  // Pistas
  const runways: Runway[] = [];
  const rwyBlocks = xml.match(/<pista[^>]*>([\s\S]*?)<\/pista>/gi) || [];
  for (const block of rwyBlocks) {
    const ident = getTag(block, 'identificacao'); // ex: "10/28"
    const [le, he] = ident.split('/');
    const lengthM = parseInt(getTag(block, 'comprimento')) || 0;
    const widthM = parseInt(getTag(block, 'largura')) || 0;
    runways.push({
      le_ident: le || ident,
      he_ident: he || '',
      length_ft: Math.round(lengthM / 0.3048),
      width_ft: Math.round(widthM / 0.3048),
      surface: normalizeSurface(getTag(block, 'piso')),
      closed: getTag(block, 'status')?.toUpperCase() === 'FECHADA',
    });
  }

  return {
    icao,
    name,
    frequencies,
    runways,
    source: 'aisweb',
  };
}

function normalizeFreqType(type: string): string {
  const map: Record<string, string> = {
    'TOWER': 'TWR', 'APPROACH': 'APP', 'GROUND': 'GND',
    'DELIVERY': 'DEL', 'CTAF': 'UNICOM', 'RADIO': 'AFIS',
    'INFO': 'AFIS',
  };
  return map[type] || type;
}

function normalizeSurface(s: string): string {
  const map: Record<string, string> = {
    'ASP': 'ASPH', 'ASPH': 'ASPH', 'ASPHALT': 'ASPH',
    'CON': 'CONC', 'CONC': 'CONC', 'CONCRETE': 'CONC',
    'GRS': 'GRASS', 'GRASS': 'GRASS', 'GRE': 'GRASS',
    'GRV': 'GRAVEL', 'GRAVEL': 'GRAVEL',
    'TURF': 'GRASS', 'DIRT': 'DIRT', 'EARTH': 'DIRT',
  };
  const upper = s.toUpperCase();
  for (const [k, v] of Object.entries(map)) {
    if (upper.includes(k)) return v;
  }
  return upper || 'N/A';
}

export async function fetchAirportInfo(icao: string): Promise<AirportInfo | null> {
  const code = icao.toUpperCase();
  
  // 1. Se for BR, tentar ROTAER (Oficial) primeiro
  if (isBrazilian(code)) {
    const rotaer = await fetchFromAiswebRotaer(code);
    if (rotaer && rotaer.frequencies.length > 0) {
      return rotaer;
    }
  }

  // 2. Fallback ou Internacional: OurAirports
  const base = await fetchFromOurAirports(code);
  
  // 3. Se OurAirports falhar ou for BR sem ROTAER completo, mesclar o que tiver
  if (isBrazilian(code) && !base) {
    return await fetchFromAiswebRotaer(code);
  }

  return base;
}
