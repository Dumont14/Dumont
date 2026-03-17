import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const url    = new URL(req.url);
    const icao   = url.searchParams.get('icao')?.toUpperCase();
    
    // Suporte para corpo JSON (POST) se necessário
    let bodyData: any = {};
    if (req.method === 'POST') {
      try { bodyData = await req.json(); } catch(e) {}
    }

    const finalIcao = icao || bodyData.icao || bodyData.icaoCode;
    const area      = url.searchParams.get('area') || bodyData.area || 'notam';
    
    const user   = Deno.env.get('AISWEB_USER');
    const pass   = Deno.env.get('AISWEB_PASS');
    const apiKey  = Deno.env.get('AISWEB_API_KEY') || user;
    const apiPass = Deno.env.get('AISWEB_API_PASS') || pass;
    const redemetKey = Deno.env.get('REDEMET_KEY');

    if (!finalIcao) {
      return new Response(
        JSON.stringify({ error: 'Missing ICAO' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    if (!apiKey || !apiPass) {
      return new Response(
        JSON.stringify({ error: 'AISWEB credentials not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar dados do AISWEB
    console.log(`Fetching ${area.toUpperCase()} for ${finalIcao} (v10)...`);
    
    const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

    const fetchAisweb = async () => {
      const params = new URLSearchParams({
        apiKey: apiKey || '',
        apiPass: apiPass || '',
        area,
        icaoCode: finalIcao
      });
      
      const aiswebUrl = `https://aisweb.decea.mil.br/api/?${params.toString()}`;
      console.log(`[DEBUG] AISWEB Proxy v10 Fetch: ${aiswebUrl}`);

      return await fetch(aiswebUrl, {
        headers: { 'Accept': 'application/json, text/xml, */*', 'User-Agent': browserUA },
        signal: AbortSignal.timeout(12000), 
      });
    };

    const fetchRedemet = async () => {
      if (!redemetKey) throw new Error('REDEMET_KEY not configured');
      // Apenas fallback para NOTAM por enquanto
      if (area !== 'notam') throw new Error(`Fallback not available for ${area}`);
      return await fetch(
        `https://api-redemet.decea.mil.br/notam?icao=${finalIcao}&api_key=${redemetKey}`,
        {
          headers: { 'Accept': 'application/json', 'User-Agent': browserUA },
          signal: AbortSignal.timeout(10000), 
        }
      );
    };

    let aisbRes: Response | null = null;
    let errorMsg = '';

    try {
      aisbRes = await fetchAisweb();
      if (!aisbRes.ok) throw new Error(`AISWEB ${aisbRes.status}`);
    } catch (e) {
      errorMsg = `AISWEB: ${e instanceof Error ? e.message : 'Error'}`;
      try {
        aisbRes = await fetchRedemet();
      } catch (re) {
        errorMsg += ` | REDEMET: ${re instanceof Error ? re.message : 'Error'}`;
        throw new Error(errorMsg);
      }
    }

    if (!aisbRes || !aisbRes.ok) {
      throw new Error(errorMsg || `Proxy failed with status ${aisbRes?.status}`);
    }

    const rawText = await aisbRes.text();
    const trimmed = rawText.trim();

    // Se já for JSON válido, repassar direto
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return new Response(trimmed, {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Parsear ROTAER XML separadamente
    if (area === 'rotaer') {
      const rotaer = parseROTAER(trimmed);
      return new Response(
        JSON.stringify({ rotaer }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Parsear XML do AISWEB (NOTAMs)
    const notams = parseAISWEB(trimmed);

    return new Response(
      JSON.stringify({ notamList: notams, raw: trimmed }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});

// ── Parser ROTAER ─────────────────────────────────────────

interface RotaerFrequency {
  type:        string;
  mhz:         string;
  callsign:    string;
  description: string;
}

interface RotaerRunway {
  ident:    string;
  length_m: number;
  width_m:  number;
  surface:  string;
  closed:   boolean;
  tora_le?: number | null;
  tora_he?: number | null;
}

interface RotaerData {
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
  frequencies: RotaerFrequency[];
  runways:     RotaerRunway[];
  remarks:     string[];
  fuel:        string;
}

/** Extract the text content of the first matching XML tag (case-insensitive). */
function xmlGet(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Return all inner-HTML blocks for each matching tag. */
function xmlGetAll(xml: string, tag: string): string[] {
  const results: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1]);
  }
  return results;
}

/** Map AISWEB ATS service area codes to normalised type strings. */
function normalizeAtsArea(area: string): string {
  const u = area.toUpperCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents
  if (u === 'TWR' || u === 'TORRE') return 'TWR';
  if (u === 'APP' || u === 'APPROACH' || u === 'APROXIMACAO') return 'APP';
  if (u === 'RDO' || u === 'RADIO' || u === 'RDIO') return 'RADIO';
  if (u === 'AFIS') return 'AFIS';
  if (u === 'GND' || u === 'SOLO') return 'GND';
  if (u === 'ATIS') return 'ATIS';
  if (u === 'DEL' || u === 'DELIVERY') return 'DEL';
  return u;
}

/** Priority order for determining primary ATS service (lower = higher priority). */
function atsPriority(area: string): number {
  const norm = normalizeAtsArea(area);
  const order: Record<string, number> = { TWR: 0, APP: 1, RADIO: 2, AFIS: 3 };
  return order[norm] ?? 10;
}

/** Build a DLY HHMM-HHMM string or return 'H24'. */
function buildAtsHoursString(begin: string, end: string): string {
  const b = begin.trim();
  const e = end.trim();
  if (!b || !e) return '';
  if (/^H24$/i.test(b) || /^H24$/i.test(e)) return 'H24';
  // Continuous operation: 0000-0000 or 0000-2400
  if ((b === '0000' && (e === '0000' || e === '2400'))) return 'H24';
  return `DLY ${b}-${e}`;
}

function parseROTAER(xml: string): RotaerData | null {
  // The root element may be <rotaer>, <AiswebData>, <Aisweb>, etc.
  // Try to find the main data block.
  const rootMatch = xml.match(/<rotaer[^>]*>([\s\S]*?)<\/rotaer>/i);
  const root = rootMatch ? rootMatch[1] : xml;

  if (!root || root.trim().length < 10) return null;

  // ── Basic airport fields ─────────────────────────────────
  const icao     = xmlGet(root, 'icao') || xmlGet(root, 'icaoCode') || '';
  const name     = xmlGet(root, 'nome') || xmlGet(root, 'name') || '';
  const city     = xmlGet(root, 'cidade') || xmlGet(root, 'city') || xmlGet(root, 'municipio') || '';
  const uf       = xmlGet(root, 'uf') || xmlGet(root, 'estado') || '';
  const lat      = xmlGet(root, 'lat') || xmlGet(root, 'latitude') || '';
  const lng      = xmlGet(root, 'lng') || xmlGet(root, 'longitude') || '';
  const alt_ft   = xmlGet(root, 'elev') || xmlGet(root, 'elevacao') || xmlGet(root, 'alt') || '';
  const utc      = xmlGet(root, 'utc') || xmlGet(root, 'fusoHorario') || '';
  const type_opr = xmlGet(root, 'tipoOpr') || xmlGet(root, 'operacao') || xmlGet(root, 'type_opr') || '';
  const type_util= xmlGet(root, 'tipoUtil') || xmlGet(root, 'utilizacao') || xmlGet(root, 'type_util') || '';
  const fuel     = xmlGet(root, 'combustivel') || xmlGet(root, 'fuel') || '';

  // ── Remarks ──────────────────────────────────────────────
  const remarks: string[] = [];
  const obs = xmlGet(root, 'obs') || xmlGet(root, 'observacoes') || xmlGet(root, 'remarks') || '';
  if (obs) remarks.push(obs);

  // ── Timesheets → ats_hours + frequencies ─────────────────
  const timesheetsMatch = root.match(/<timesheets[^>]*>([\s\S]*?)<\/timesheets>/i);
  const timesheetsXml   = timesheetsMatch ? timesheetsMatch[1] : '';

  const timesheetBlocks = xmlGetAll(timesheetsXml, 'timesheet');

  let primaryBegin   = '';
  let primaryEnd     = '';
  let primaryPriority = 99;
  const frequencies: RotaerFrequency[] = [];
  const seenFreqs    = new Set<string>();

  for (const block of timesheetBlocks) {
    const hol = xmlGet(block, 'hol').toLowerCase();
    // Skip holiday-only sheets for ATS hours determination (use non-hol as primary)
    const isHol = hol === 'true' || hol === '1';

    const hoursXml = block.match(/<hours[^>]*>([\s\S]*?)<\/hours>/i)?.[1] ?? '';
    const begin    = xmlGet(hoursXml, 'begin');
    const end      = xmlGet(hoursXml, 'end');

    // Collect frequencies from this timesheet
    const freqsXml = block.match(/<frequencies[^>]*>([\s\S]*?)<\/frequencies>/i)?.[1] ?? '';
    const comBlocks = xmlGetAll(freqsXml, 'com');

    for (const com of comBlocks) {
      const area  = xmlGet(com, 'area');
      const value = xmlGet(com, 'value') || xmlGet(com, 'freq') || xmlGet(com, 'frequencia');
      if (!area || !value) continue;

      const normType = normalizeAtsArea(area);
      const key = `${normType}:${value}`;
      if (!seenFreqs.has(key)) {
        seenFreqs.add(key);
        frequencies.push({ type: normType, mhz: value, callsign: '', description: '' });
      }

      // Use this timesheet for ATS hours if it has higher priority and is not hol
      if (!isHol && begin && end) {
        const prio = atsPriority(area);
        if (prio < primaryPriority) {
          primaryPriority = prio;
          primaryBegin    = begin;
          primaryEnd      = end;
        }
      }
    }

    // Fallback: if timesheet has hours but no frequencies (airport with no coms data)
    if (!isHol && begin && end && comBlocks.length === 0 && primaryBegin === '') {
      primaryBegin = begin;
      primaryEnd   = end;
    }
  }

  const ats_hours = buildAtsHoursString(primaryBegin, primaryEnd);

  // ── Runways ───────────────────────────────────────────────
  const pistasMatch = root.match(/<(?:pistas|runways)[^>]*>([\s\S]*?)<\/(?:pistas|runways)>/i);
  const pistasXml   = pistasMatch ? pistasMatch[1] : '';
  const runways: RotaerRunway[] = [];

  const rwyBlocks = [
    ...xmlGetAll(pistasXml, 'pista'),
    ...xmlGetAll(pistasXml, 'runway'),
  ];

  for (const rwy of rwyBlocks) {
    const ident   = xmlGet(rwy, 'designador') || xmlGet(rwy, 'ident') || xmlGet(rwy, 'numero') || '';
    const length  = xmlGet(rwy, 'comprimento') || xmlGet(rwy, 'length') || xmlGet(rwy, 'distancia') || '';
    const width   = xmlGet(rwy, 'largura') || xmlGet(rwy, 'width') || '';
    const surface = xmlGet(rwy, 'superficie') || xmlGet(rwy, 'surface') || '';
    const closed  = xmlGet(rwy, 'fechada') || xmlGet(rwy, 'closed') || '';
    const toraLe  = xmlGet(rwy, 'toraLe') || xmlGet(rwy, 'tora_le') || '';
    const toraHe  = xmlGet(rwy, 'toraHe') || xmlGet(rwy, 'tora_he') || '';
    if (!ident) continue;
    runways.push({
      ident,
      length_m: parseInt(length, 10) || 0,
      width_m:  parseInt(width, 10)  || 0,
      surface:  surface || '',
      closed:   closed === 'true' || closed === '1',
      tora_le:  toraLe ? parseInt(toraLe, 10) : null,
      tora_he:  toraHe ? parseInt(toraHe, 10) : null,
    });
  }

  return { icao, name, city, uf, lat, lng, alt_ft, utc, type_opr, type_util, ats_hours, frequencies, runways, remarks, fuel };
}

// ── Parser AISWEB ─────────────────────────────────────────

interface NotamItem {
  id: string;
  text: string;
  from: string;
  to: string;
  q: string;
}

function parseAISWEB(raw: string): NotamItem[] {
  const notams: NotamItem[] = [];

  // Tentar extrair blocos XML estruturados (<item> ou <notam>)
  const blockRe = /<(?:item|notam|NOTAM|Notam)[^>]*>([\s\S]*?)<\/(?:item|notam|NOTAM|Notam)>/gi;
  let block: RegExpExecArray | null;
  let found = false;

  while ((block = blockRe.exec(raw)) !== null) {
    found = true;
    const content = block[1];

    const get = (tag: string): string => {
      // Regex robusto para capturar tags mesmo se houver CDATA ou quebras de linha
      const m = content.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      if (!m) return '';
      return m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Priorizar campos de texto do AISWEB
    const text = get('e') || get('itemE') || get('text') ||
                 get('mens') || get('texto') || get('message') ||
                 content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!text || text.length < 5) continue;

    notams.push({
      id:   get('id') || get('numero') || get('notamId') || String(notams.length + 1),
      text,
      from: get('b') || get('inicio') || get('startValidity') || '',
      to:   get('c') || get('fim')    || get('endValidity')   || '',
      q:    get('q') || get('qLine')  || '',
    });
  }

  // Fallback: se não encontrou blocos XML ou o XML está mal formatado, tentar texto bruto
  if (!found || (notams.length === 0 && raw.length > 50)) {
    // Tentar encontrar padrões de NOTAM (ex: B0283/26) no texto bruto
    const chunks = raw.split(/(?=\b[A-Z]\d{4}\/\d{2}\b)/);
    for (const chunk of chunks) {
      const trimChunk = chunk.trim();
      if (trimChunk.length < 20) continue;

      const idMatch = trimChunk.match(/^([A-Z]\d{4}\/\d{2})/);
      const id = idMatch ? idMatch[1] : String(notams.length + 1);

      // Tentar capturar o texto operacional (geralmente após a linha Q) ou do início
      const qIdx = trimChunk.indexOf('Q)');
      let text = '';
      let qLine = '';
      
      if (qIdx >= 0) {
        const lines = trimChunk.slice(qIdx).split('\n');
        qLine = lines[0].trim();
        text = lines.slice(1).join(' ').trim();
      } else {
        text = trimChunk;
      }

      if (text.length > 10) {
        // Tentar extrair datas simples se existirem
        const dateMatch = trimChunk.match(/(\d{2}\/\d{2}\/\d{2,4}).*?a.*?(\d{2}\/\d{2}\/\d{2,4})/);
        notams.push({ 
          id, 
          text, 
          from: dateMatch ? dateMatch[1] : '', 
          to: dateMatch ? dateMatch[2] : '', 
          q: qLine 
        });
      }
    }
  }

  return notams;
}
