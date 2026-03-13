// src/lib/weather/index.ts
// Weather data fetching — smart routing between REDEMET (Brazilian airports)
// and NOAA Aviation Weather Center (international)

const isBrazilian = (icao: string) => /^SB[A-Z]{2}$/i.test(icao);

// ── METAR ────────────────────────────────────────────────
export async function fetchMetar(icao: string): Promise<string> {
  const code = icao.toUpperCase();
  return isBrazilian(code) ? fetchMetarREDEMET(code) : fetchMetarNOAA(code);
}

async function fetchMetarREDEMET(icao: string): Promise<string> {
  const key = process.env.REDEMET_KEY;
  if (!key) return fetchMetarNOAA(icao);
  const res = await fetch(
    `https://api-redemet.decea.mil.br/mensagens/metar/${icao}?api_key=${key}`,
    { next: { revalidate: 300 } }
  );
  if (!res.ok) return fetchMetarNOAA(icao);
  // ✅ Checar se body não está vazio antes de parsear
  const text = await res.text();
  if (!text || !text.trim()) return fetchMetarNOAA(icao);
  let json: unknown;
  try { json = JSON.parse(text); } catch { return fetchMetarNOAA(icao); }
  const metar = (json as any)?.data?.data?.[0]?.mens;
  if (!metar) return fetchMetarNOAA(icao);
  return metar;
}

async function fetchMetarNOAA(icao: string): Promise<string> {
  const res = await fetch(
    `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`,
    { next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`NOAA METAR ${res.status}`);
  const text = await res.text();
  if (!text || !text.trim()) throw new Error('METAR not found');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('METAR: invalid JSON'); }
  const item = Array.isArray(data) ? (data as any[])[0] : null;
  if (!item?.rawOb) throw new Error('METAR not found');
  return item.rawOb.trim();
}

// ── SPECI ────────────────────────────────────────────────
export async function fetchSpeci(icao: string): Promise<string | null> {
  const code = icao.toUpperCase();
  return isBrazilian(code) ? fetchSpeciREDEMET(code) : fetchSpeciNOAA(code);
}

async function fetchSpeciREDEMET(icao: string): Promise<string | null> {
  const key = process.env.REDEMET_KEY;
  if (!key) return fetchSpeciNOAA(icao);
  const res = await fetch(
    `https://api-redemet.decea.mil.br/mensagens/speci/${icao}?api_key=${key}`,
    { next: { revalidate: 120 } }
  );
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || !text.trim()) return null;           // ✅ body vazio → null, sem crash
  let json: unknown;
  try { json = JSON.parse(text); } catch { return null; }
  return (json as any)?.data?.data?.[0]?.mens ?? null;
}

async function fetchSpeciNOAA(icao: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&type=speci`,
      { next: { revalidate: 120 } }
    );
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || !text.trim()) return null;         // ✅ body vazio → null, sem crash
    let data: unknown;
    try { data = JSON.parse(text); } catch { return null; }
    const item = Array.isArray(data) ? (data as any[])[0] : null;
    return item?.rawOb?.trim() ?? null;
  } catch {
    return null;
  }
}

// ── LATEST OBS (METAR ou SPECI, o mais recente) ──────────
export interface LatestObs {
  raw: string;
  type: 'METAR' | 'SPECI';
}

/** Retorna o mais recente entre METAR e SPECI com base no horário ZZ da string */
export async function fetchLatestObs(icao: string): Promise<LatestObs> {
  const [metar, speci] = await Promise.all([
    fetchMetar(icao),
    fetchSpeci(icao).catch(() => null),   // SPECI nunca quebra o briefing
  ]);

  if (!speci) return { raw: metar, type: 'METAR' };

  // Extrair horário DDHHMM do grupo de tempo (ex: "130530Z")
  const timeOf = (msg: string): number => {
    const m = msg.match(/\b\d{6}Z\b/);
    return m ? parseInt(m[0].slice(0, 6), 10) : 0;
  };

  const useSpeci = timeOf(speci) >= timeOf(metar);
  return useSpeci
    ? { raw: speci, type: 'SPECI' }
    : { raw: metar, type: 'METAR' };
}

// ── TAF ──────────────────────────────────────────────────
export async function fetchTaf(icao: string): Promise<string> {
  const code = icao.toUpperCase();
  return isBrazilian(code) ? fetchTafREDEMET(code) : fetchTafNOAA(code);
}

async function fetchTafREDEMET(icao: string): Promise<string> {
  const key = process.env.REDEMET_KEY;
  if (!key) return fetchTafNOAA(icao);
  const res = await fetch(
    `https://api-redemet.decea.mil.br/mensagens/taf/${icao}?api_key=${key}`,
    { next: { revalidate: 900 } }
  );
  if (!res.ok) return fetchTafNOAA(icao);
  const text = await res.text();
  if (!text || !text.trim()) return fetchTafNOAA(icao);
  let json: unknown;
  try { json = JSON.parse(text); } catch { return fetchTafNOAA(icao); }
  const taf = (json as any)?.data?.data?.[0]?.mens;
  if (!taf) return fetchTafNOAA(icao);
  return taf;
}

async function fetchTafNOAA(icao: string): Promise<string> {
  const res = await fetch(
    `https://aviationweather.gov/api/data/taf?ids=${icao}&format=json`,
    { next: { revalidate: 900 } }
  );
  if (!res.ok) throw new Error(`NOAA TAF ${res.status}`);
  const text = await res.text();
  if (!text || !text.trim()) throw new Error('TAF not found');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('TAF: invalid JSON'); }
  const item = Array.isArray(data) ? (data as any[])[0] : null;
  if (!item?.rawTAF) throw new Error('TAF not found');
  return item.rawTAF.trim();
}
