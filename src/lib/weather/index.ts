// src/lib/weather/index.ts
const isBrazilian = (icao: string) => /^S[BDINPRSW][A-Z]{2}$/i.test(icao);

function extractNumericTime(raw: string): number {
  const m = raw.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  if (!m) return 0;
  return parseInt(m[1]) * 10000 + parseInt(m[2]) * 100 + parseInt(m[3]);
}

function redemetWindow(): { dataIni: string; dataFim: string } {
  const now = new Date();
  const start = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}`;
  return { dataIni: fmt(start), dataFim: fmt(now) };
}

// ── TIPOS ────────────────────────────────────────────────
export interface LatestObs {
  raw: string;
  type: 'METAR' | 'SPECI';
}

export interface TafPeriod {
  raw:     string;
  from:    string;
  to:      string;
  type:    'BASE' | 'BECMG' | 'TEMPO' | 'PROB' | 'FM';
  prob:    number | null;
  wind:    string | null;
  vis:     string | null;
  wx:      string | null;
  clouds:  string[];
  cat:     'VMC' | 'MVFR' | 'IFR' | 'LIFR' | null;
  adverse: string[];
}

export interface ParsedTaf {
  raw:        string;
  icao:       string;
  issued:     string;
  validFrom:  string;
  validTo:    string;
  periods:    TafPeriod[];
  hasAdverse: boolean;
}

// ── LATEST OBS ───────────────────────────────────────────
export async function fetchLatestObs(icao: string): Promise<LatestObs> {
  const code = icao.toUpperCase();
  return isBrazilian(code) ? fetchLatestObsREDEMET(code) : fetchLatestObsNOAA(code);
}

async function fetchLatestObsREDEMET(icao: string): Promise<LatestObs> {
  const key = process.env.REDEMET_KEY;
  if (!key) return fetchLatestObsNOAA(icao);

  const { dataIni, dataFim } = redemetWindow();
  const [metarRes, speciRes] = await Promise.allSettled([
    fetch(
      `https://api-redemet.decea.mil.br/mensagens/metar/${icao}?api_key=${key}&data_ini=${dataIni}&data_fim=${dataFim}`,
      { next: { revalidate: 120 } }
    ),
    fetch(
      `https://api-redemet.decea.mil.br/mensagens/speci/${icao}?api_key=${key}&data_ini=${dataIni}&data_fim=${dataFim}`,
      { next: { revalidate: 120 } }
    ),
  ]);

  const candidates: { raw: string; type: 'METAR' | 'SPECI'; time: number }[] = [];

  if (metarRes.status === 'fulfilled' && metarRes.value.ok) {
    const json = safeJson(await safeText(metarRes.value));
    for (const m of json?.data?.data ?? []) {
      if (m?.mens) candidates.push({ raw: m.mens, type: 'METAR', time: extractNumericTime(m.mens) });
    }
  }
  if (speciRes.status === 'fulfilled' && speciRes.value.ok) {
    const json = safeJson(await safeText(speciRes.value));
    for (const m of json?.data?.data ?? []) {
      if (m?.mens) candidates.push({ raw: m.mens, type: 'SPECI', time: extractNumericTime(m.mens) });
    }
  }

  if (candidates.length === 0) return fetchLatestObsNOAA(icao);

  candidates.sort((a, b) => {
    if (b.time !== a.time) return b.time - a.time;
    if (a.type === 'SPECI' && b.type !== 'SPECI') return -1;
    if (b.type === 'SPECI' && a.type !== 'SPECI') return 1;
    return 0;
  });
  return { raw: candidates[0].raw, type: candidates[0].type };
}

async function fetchLatestObsNOAA(icao: string): Promise<LatestObs> {
  const res = await fetch(
    `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=3`,
    { next: { revalidate: 120 } }
  );
  if (!res.ok) throw new Error(`NOAA METAR ${res.status}`);
  const data = safeJson(await safeText(res));
  if (!Array.isArray(data) || data.length === 0) throw new Error('METAR not found');

  const candidates = (data as any[])
    .filter(i => i?.rawOb)
    .map(i => ({
      raw:  i.rawOb.trim() as string,
      type: (i.type?.toUpperCase() === 'SPECI' ? 'SPECI' : 'METAR') as 'METAR' | 'SPECI',
      time: extractNumericTime(i.rawOb),
    }));

  if (candidates.length === 0) throw new Error('METAR not found');
  candidates.sort((a, b) => {
    if (b.time !== a.time) return b.time - a.time;
    if (a.type === 'SPECI' && b.type !== 'SPECI') return -1;
    if (b.type === 'SPECI' && a.type !== 'SPECI') return 1;
    return 0;
  });
  return { raw: candidates[0].raw, type: candidates[0].type };
}

export async function fetchMetar(icao: string): Promise<string> {
  return (await fetchLatestObs(icao)).raw;
}

// ── TAF ──────────────────────────────────────────────────
export async function fetchTaf(icao: string): Promise<string> {
  const code = icao.toUpperCase();
  return isBrazilian(code) ? fetchTafREDEMET(code) : fetchTafNOAA(code);
}

async function fetchTafREDEMET(icao: string): Promise<string> {
  const key = process.env.REDEMET_KEY;
  if (!key) return fetchTafNOAA(icao);

  const now   = new Date();
  const start = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const fmt   = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}` +
    `${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}`;

  const res = await fetch(
    `https://api-redemet.decea.mil.br/mensagens/taf/${icao}?api_key=${key}` +
    `&data_ini=${fmt(start)}&data_fim=${fmt(now)}&fim_linha=texto`,
    { next: { revalidate: 900 } }
  );
  if (!res.ok) return fetchTafNOAA(icao);
  const json = safeJson(await safeText(res));
  const taf  = json?.data?.data?.[0]?.mens;
  if (!taf) return fetchTafNOAA(icao);
  return taf;
}

async function fetchTafNOAA(icao: string): Promise<string> {
  const res = await fetch(
    `https://aviationweather.gov/api/data/taf?ids=${icao}&format=json`,
    { next: { revalidate: 900 } }
  );
  if (!res.ok) throw new Error(`NOAA TAF ${res.status}`);
  const data = safeJson(await safeText(res));
  const item = Array.isArray(data) ? (data as any[])[0] : null;
  if (!item?.rawTAF) throw new Error('TAF not found');
  return item.rawTAF.trim();
}

// ── TAF PARSER ───────────────────────────────────────────

function visToMeters(vis: string): number {
  if (!vis || vis === '9999' || vis === 'CAVOK') return 9999;
  const sm = vis.match(/^(\d+(?:\.\d+)?)SM$/);
  if (sm) return Math.round(parseFloat(sm[1]) * 1609);
  const n = parseInt(vis);
  return isNaN(n) ? 9999 : n;
}

function getCeiling(clouds: string[]): number {
  for (const c of clouds) {
    const m = c.match(/^(BKN|OVC)(\d{3})/);
    if (m) return parseInt(m[2]) * 100;
  }
  return 9999;
}

function calcCat(vis: string | null, clouds: string[]): 'VMC' | 'MVFR' | 'IFR' | 'LIFR' {
  const visM = visToMeters(vis || '9999');
  const ceil = getCeiling(clouds);
  if (visM >= 5000 && ceil >= 1500) return 'VMC';
  if (visM >= 1600 && ceil >= 500)  return 'MVFR';
  if (visM >= 800  && ceil >= 200)  return 'IFR';
  return 'LIFR';
}

function detectAdverse(vis: string | null, wx: string | null, clouds: string[], cat: string): string[] {
  const alerts: string[] = [];
  if (cat === 'LIFR') alerts.push('LIFR');
  else if (cat === 'IFR') alerts.push('IFR');

  if (wx) {
    // TS sem precipitação (ex: "TS" isolado) ou com (TSRA, TSGR)
    if (/\bTS\b|\bTS(?:RA|GR|SN|DZ)\b/i.test(wx)) alerts.push('TROVOADA');
    if (/FZRA|FZDZ/i.test(wx))    alerts.push('CHUVA GELADA');
    if (/\bGR\b/i.test(wx))       alerts.push('GRANIZO');
    if (/\bSQ\b/i.test(wx))       alerts.push('SQUALL');
    if (/\bFC\b/i.test(wx))       alerts.push('TORNADO');
    if (/\+RA|\+SN|\+SH/i.test(wx)) alerts.push('CHUVA FORTE');
    if (/\bFG\b/i.test(wx))       alerts.push('NEVOEIRO');
  }

  // CB e TCU são alertas independente de wx
  if (clouds.some(c => /CB$/i.test(c)))  alerts.push('CB');
  if (clouds.some(c => /TCU$/i.test(c))) alerts.push('TCU');

  if (visToMeters(vis || '9999') < 1500 && !alerts.includes('NEVOEIRO'))
    alerts.push('BAIXA VIS');

  return [...new Set(alerts)]; // deduplicar
}

/**
 * Parseia um bloco de período TAF.
 * Estratégia: remover tokens conhecidos em ordem para evitar colisões.
 */
function parsePeriodLine(line: string, type: TafPeriod['type'], prob: number | null): TafPeriod {
  // Trabalhar numa cópia limpa — remover tokens que não são meteorologia
  let work = line
    // Remover cabeçalho TAF
    .replace(/^TAF(?:\s+AMD|\s+COR)?\s+\w{4}\s+\d{6}Z\s+/i, '')
    // Remover grupos de validade DDDD/DDDD
    .replace(/\b\d{4}\/\d{4}\b/g, '')
    // Remover FM DDHHMM
    .replace(/^FM\d{6}/g, '')
    // Remover BECMG / TEMPO / PROB
    .replace(/^(BECMG|TEMPO|PROB\d{2}(?:\s+TEMPO)?)\s*/i, '')
    // Remover temperatura TX/TN (ex: TX30/1518Z TN24/1606Z)
    .replace(/\b[TN|TX]\d{2}\/\d{4}Z\b/gi, '')
    // Remover RMK e tudo depois
    .replace(/\bRMK\b.*$/i, '')
    // Remover = no final
    .replace(/=$/, '')
    .trim();

  // ── Validade ──────────────────────────────────────────
  let from = '';
  let to   = '';
  if (type === 'FM') {
    const fm = line.match(/^FM(\d{6})/);
    if (fm) from = fm[1];
  } else {
    const valid = line.match(/\b(\d{4})\/(\d{4})\b/);
    if (valid) { from = valid[1]; to = valid[2]; }
  }

  // ── Vento ─────────────────────────────────────────────
  const windM = work.match(/\b(VRB|\d{3})(\d{2,3})(G\d{2,3})?KT\b/);
  const wind  = windM ? windM[0] : null;
  if (wind) work = work.replace(wind, '');

  // ── CAVOK ─────────────────────────────────────────────
  const cavok = /\bCAVOK\b/i.test(work);

  // ── Visibilidade ──────────────────────────────────────
  // Após remover validade e temperatura, a vis é o primeiro grupo numérico de 4 dígitos
  // ou um valor SM (para TAFs internacionais)
  let vis: string | null = null;
  if (cavok) {
    vis = '9999';
  } else {
    // Formato SM (internacional): "3SM", "1 1/2SM"
    const visSM = work.match(/\b(\d+(?:\s+\d+\/\d+)?|\d+\/\d+)SM\b/);
    if (visSM) {
      vis = visSM[0];
      work = work.replace(visSM[0], '');
    } else {
      // Formato métrico: 4 dígitos isolados que NÃO sejam hora (seguido de KT, Z, /)
      // e NÃO sejam altitude de nuvem (precedidos por FEW/SCT/BKN/OVC)
      const visM = work.match(/(?<![A-Z\/])(\b\d{4}\b)(?!\s*(?:KT|Z|\/|FT))/);
      if (visM) {
        vis = visM[1];
        work = work.replace(visM[0], '');
      }
    }
  }

  // ── Nuvens ────────────────────────────────────────────
  const clouds: string[] = [];
  const cloudRe = /\b(FEW|SCT|BKN|OVC|SKC|NSC|NCD)(\d{3})?(CB|TCU)?\b/g;
  let cm: RegExpExecArray | null;
  while ((cm = cloudRe.exec(work)) !== null) {
    clouds.push(cm[0].trim());
  }
  if (cavok) clouds.push('CAVOK');

  // ── Tempo presente ────────────────────────────────────
  // Capturar grupos de tempo presente — inclui TS isolado
  const wxRe = /\b(-|\+|VC)?(TS|SH|FZ|DZ|RA|SN|GR|GS|BR|FG|HZ|FC|SQ|PL|IC|FZDZ|FZRA|TSRA|TSGR|TSSN)\w*\b/g;
  const wxTokens: string[] = [];
  let wxM: RegExpExecArray | null;
  while ((wxM = wxRe.exec(work)) !== null) {
    // Evitar capturar parte de código ICAO ou nuvem
    if (!/^(FEW|SCT|BKN|OVC|SKC|NSC)/.test(wxM[0])) {
      wxTokens.push(wxM[0]);
    }
  }
  // TS pode aparecer como token único antes de nuvens
  if (/\bTS\b/.test(work) && !wxTokens.some(t => /TS/.test(t))) {
    wxTokens.unshift('TS');
  }
  const wx = wxTokens.length > 0 ? wxTokens.join(' ') : null;

  // ── Categoria e alertas ───────────────────────────────
  const cat     = cavok ? 'VMC' : calcCat(vis, clouds);
  const adverse = detectAdverse(vis, wx, clouds, cat);

  return { raw: line, from, to, type, prob, wind, vis, wx, clouds, cat, adverse };
}

export function parseTaf(raw: string): ParsedTaf | null {
  if (!raw) return null;

  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  const headerM = normalized.match(
    /TAF(?:\s+AMD|\s+COR)?\s+(\w{4})\s+(\d{6}Z)\s+(\d{4})\/(\d{4})/
  );
  if (!headerM) return null;

  const icao      = headerM[1];
  const issued    = headerM[2];
  const validFrom = headerM[3];
  const validTo   = headerM[4];

  // Dividir em linhas e agrupar em blocos por tipo de período
  const lines = normalized.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);

  const blocks: string[] = [];
  let current = '';

  for (const line of lines) {
    if (/^(BECMG|TEMPO|PROB\d{2}|FM\d{6})\b/.test(line)) {
      if (current.trim()) blocks.push(current.trim());
      current = line;
    } else {
      current += (current ? ' ' : '') + line;
    }
  }
  if (current.trim()) blocks.push(current.trim());

  const periods: TafPeriod[] = [];

  for (const block of blocks) {
    if (/^TAF/.test(block)) {
      periods.push(parsePeriodLine(block, 'BASE', null));
    } else if (/^BECMG/.test(block)) {
      periods.push(parsePeriodLine(block, 'BECMG', null));
    } else if (/^PROB(\d{2})\s+TEMPO/.test(block)) {
      const p = parseInt(block.match(/^PROB(\d{2})/)?.[1] || '0');
      periods.push(parsePeriodLine(block, 'TEMPO', p));
    } else if (/^TEMPO/.test(block)) {
      periods.push(parsePeriodLine(block, 'TEMPO', null));
    } else if (/^PROB(\d{2})/.test(block)) {
      const p = parseInt(block.match(/^PROB(\d{2})/)?.[1] || '0');
      periods.push(parsePeriodLine(block, 'PROB', p));
    } else if (/^FM\d{6}/.test(block)) {
      periods.push(parsePeriodLine(block, 'FM', null));
    }
  }

  const hasAdverse = periods.some(p => p.adverse.length > 0);

  return { raw: normalized, icao, issued, validFrom, validTo, periods, hasAdverse };
}

// ── HELPERS ──────────────────────────────────────────────
async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

function safeJson(text: string): any {
  if (!text || !text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}
