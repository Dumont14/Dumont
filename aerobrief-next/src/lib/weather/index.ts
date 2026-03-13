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
  if (!key) return fetchMetarNOAA(icao); // fallback

  const res = await fetch(
    `https://api-redemet.decea.mil.br/mensagens/metar/${icao}?api_key=${key}&data_ini=&data_fim=`,
    { next: { revalidate: 300 } } // cache 5min
  );
  if (!res.ok) throw new Error(`REDEMET METAR ${res.status}`);
  const json = await res.json();
  const metar = json?.data?.data?.[0]?.mens;
  if (!metar) throw new Error('REDEMET: METAR not found');
  return metar;
}

async function fetchMetarNOAA(icao: string): Promise<string> {
  const res = await fetch(
    `https://aviationweather.gov/api/data/metar?ids=${icao}&format=raw&taf=false&hours=2`,
    { next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`NOAA METAR ${res.status}`);
  const text = await res.text();
  const line = text.split('\n').find(l => l.trim().startsWith(icao));
  if (!line) throw new Error('METAR not found');
  return line.trim();
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
    { next: { revalidate: 900 } } // cache 15min
  );
  if (!res.ok) throw new Error(`REDEMET TAF ${res.status}`);
  const json = await res.json();
  const taf = json?.data?.data?.[0]?.mens;
  if (!taf) throw new Error('REDEMET: TAF not found');
  return taf;
}

async function fetchTafNOAA(icao: string): Promise<string> {
  const res = await fetch(
    `https://aviationweather.gov/api/data/taf?ids=${icao}&format=raw`,
    { next: { revalidate: 900 } }
  );
  if (!res.ok) throw new Error(`NOAA TAF ${res.status}`);
  const text = await res.text();
  const line = text.split('\n').find(l => l.trim().startsWith('TAF'));
  if (!line) throw new Error('TAF not found');
  return line.trim();
}
