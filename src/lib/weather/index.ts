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
  const json = await res.json();
  const metar = json?.data?.data?.[0]?.mens;
  if (!metar) return fetchMetarNOAA(icao);
  return metar;
}

async function fetchMetarNOAA(icao: string): Promise<string> {
  const res = await fetch(
    `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`,
    { next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`NOAA METAR ${res.status}`);
  const data = await res.json();
  const item = Array.isArray(data) ? data[0] : null;
  if (!item?.rawOb) throw new Error('METAR not found');
  return item.rawOb.trim();
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
  const json = await res.json();
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
  const data = await res.json();
  const item = Array.isArray(data) ? data[0] : null;
  if (!item?.rawTAF) throw new Error('TAF not found');
  return item.rawTAF.trim();
}
