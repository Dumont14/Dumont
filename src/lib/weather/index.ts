// src/lib/weather/index.ts
// Weather data fetching — smart routing between REDEMET (Brazilian airports)
// and NOAA Aviation Weather Center (international)

// src/lib/weather/index.ts
const isBrazilian = (icao: string) => /^SB[A-Z]{2}$/i.test(icao);

/** Extrai DDHHMM como número para comparação de tempo */
function extractNumericTime(raw: string): number {
  const m = raw.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  if (!m) return 0;
  return parseInt(m[1]) * 10000 + parseInt(m[2]) * 100 + parseInt(m[3]);
}

/** Janela de 3h formatada para a REDEMET (YYYYMMDDHH) */
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

// ── LATEST OBS (entry point principal) ──────────────────
export async function fetchLatestObs(icao: string): Promise<LatestObs> {
  const code = icao.toUpperCase();
  return isBrazilian(code)
    ? fetchLatestObsREDEMET(code)
    : fetchLatestObsNOAA(code);
}

// ── REDEMET ──────────────────────────────────────────────
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

  // Processar METAR
  if (metarRes.status === 'fulfilled' && metarRes.value.ok) {
    const text = await safeText(metarRes.value);
    const json = safeJson(text);
    const msgs: any[] = json?.data?.data ?? [];
    for (const m of msgs) {
      if (m?.mens) candidates.push({ raw: m.mens, type: 'METAR', time: extractNumericTime(m.mens) });
    }
  }

  // Processar SPECI
  if (speciRes.status === 'fulfilled' && speciRes.value.ok) {
    const text = await safeText(speciRes.value);
    const json = safeJson(text);
    const msgs: any[] = json?.data?.data ?? [];
    for (const m of msgs) {
      if (m?.mens) candidates.push({ raw: m.mens, type: 'SPECI', time: extractNumericTime(m.mens) });
    }
  }

  if (candidates.length === 0) return fetchLatestObsNOAA(icao);

  // Ordenar: mais recente primeiro; empate → SPECI ganha
  candidates.sort((a, b) => {
    if (b.time !== a.time) return b.time - a.time;
    if (a.type === 'SPECI' && b.type !== 'SPECI') return -1;
    if (b.type === 'SPECI' && a.type !== 'SPECI') return 1;
    return 0;
  });

  const best = candidates[0];
  return { raw: best.raw, type: best.type };
}

// ── NOAA ─────────────────────────────────────────────────
async function fetchLatestObsNOAA(icao: string): Promise<LatestObs> {
  const res = await fetch(
    `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=3`,
    { next: { revalidate: 120 } }
  );
  if (!res.ok) throw new Error(`NOAA METAR ${res.status}`);

  const text = await safeText(res);
  const data = safeJson(text);
  if (!Array.isArray(data) || data.length === 0) throw new Error('METAR not found');

  // NOAA retorna array do mais recente para o mais antigo
  // Preferir SPECI se houver um mais recente ou de igual tempo
  const candidates = (data as any[])
    .filter(item => item?.rawOb)
    .map(item => ({
      raw: item.rawOb.trim() as string,
      type: (item.type?.toUpperCase() === 'SPECI' ? 'SPECI' : 'METAR') as 'METAR' | 'SPECI',
      time: extractNumericTime(item.rawOb),
    }));

  if (candidates.length === 0) throw new Error('METAR not found');

  candidates.sort((a, b) => {
    if (b.time !== a.time) return b.time - a.time;
    if (a.type === 'SPECI' && b.type !== 'SPECI') return -1;
    if (b.type === 'SPECI' && a.type !== 'SPECI') return 1;
    return 0;
  });

  const best = candidates[0];
  return { raw: best.raw, type: best.type };
}

// ── METAR (compat — usado por outros módulos) ────────────
export async function fetchMetar(icao: string): Promise<string> {
  const obs = await fetchLatestObs(icao);
  return obs.raw;
}

// ── TAF ──────────────────────────────────────────────────
export async function fetchTaf(icao: string): Promise<string> {
  const code = icao.toUpperCase();
  return isBrazilian(code) ? fetchTafREDEMET(code) : fetchTafNOAA(code);
}

async function fetchTafREDEMET(icao: string): Promise<string> {
  const key = process.env.REDEMET_KEY;
  if (!key) return fetchTafNOAA(icao);

  const { dataIni, dataFim } = redemetWindow();
  const res = await fetch(
    `https://api-redemet.decea.mil.br/mensagens/taf/${icao}?api_key=${key}&data_ini=${dataIni}&data_fim=${dataFim}`,
    { next: { revalidate: 900 } }
  );
  if (!res.ok) return fetchTafNOAA(icao);
  const text = await safeText(res);
  const json = safeJson(text);
  const taf = json?.data?.data?.[0]?.mens;
  if (!taf) return fetchTafNOAA(icao);
  return taf;
}

async function fetchTafNOAA(icao: string): Promise<string> {
  const res = await fetch(
    `https://aviationweather.gov/api/data/taf?ids=${icao}&format=json`,
    { next: { revalidate: 900 } }
  );
  if (!res.ok) throw new Error(`NOAA TAF ${res.status}`);
  const text = await safeText(res);
  const data = safeJson(text);
  const item = Array.isArray(data) ? (data as any[])[0] : null;
  if (!item?.rawTAF) throw new Error('TAF not found');
  return item.rawTAF.trim();
}

// ── HELPERS ──────────────────────────────────────────────
async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

function safeJson(text: string): any {
  if (!text || !text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}
