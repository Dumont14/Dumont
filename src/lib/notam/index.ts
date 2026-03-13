// src/lib/notam/index.ts
// NOTAM fetching (AISWEB for Brazilian, FAA for international)
// and critical NOTAM extraction

import type { ParsedNotam, NotamSeverity } from '@/types';

const isBrazilian = (icao: string) => /^SB[A-Z]{2}$/i.test(icao);

// ── FETCH ────────────────────────────────────────────────

export async function fetchNotams(icao: string): Promise<unknown> {
  const code = icao.toUpperCase();
  return isBrazilian(code) ? fetchNotamsAISWEB(code) : fetchNotamsFAA(code);
}

async function fetchNotamsAISWEB(icao: string): Promise<unknown> {
  const user = process.env.AISWEB_USER;
  const pass = process.env.AISWEB_PASS;
  if (!user || !pass) throw new Error('AISWEB credentials not configured');

  const res = await fetch(
    `https://www.aisweb.aer.mil.br/api/notam?ICAOCode=${icao}&APIKey=${user}&APIPass=${pass}`,
    { next: { revalidate: 600 } }
  );
  if (!res.ok) throw new Error(`AISWEB ${res.status}`);
  return res.json();
}

async function fetchNotamsFAA(icao: string): Promise<unknown> {
  const clientId     = process.env.FAA_CLIENT_ID;
  const clientSecret = process.env.FAA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // Fallback to public FAA endpoint (no auth, limited)
    const res = await fetch(
      `https://external-api.faa.gov/notamapi/v1/notams?icaoLocation=${icao}`,
      { next: { revalidate: 600 } }
    );
    if (!res.ok) throw new Error(`FAA NOTAM ${res.status}`);
    return res.json();
  }

  // Authenticated FAA endpoint
  const tokenRes = await fetch('https://external-api.faa.gov/auth/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    next: { revalidate: 3600 },
  });
  if (!tokenRes.ok) throw new Error(`FAA auth ${tokenRes.status}`);
  const { access_token } = await tokenRes.json();

  const res = await fetch(
    `https://external-api.faa.gov/notamapi/v1/notams?icaoLocation=${icao}&pageSize=50`,
    {
      headers: { Authorization: `Bearer ${access_token}` },
      next: { revalidate: 600 },
    }
  );
  if (!res.ok) throw new Error(`FAA NOTAM ${res.status}`);
  return res.json();
}

// ── PARSE ────────────────────────────────────────────────

const CRIT_PATTERNS = [
  /RWY.{0,10}CLSD|CLSD.{0,10}RWY/i,
  /RUNWAY.{0,10}CLOS/i,
  /PISTA.{0,10}FECHA/i,
  /ILS.{0,6}(U\/S|INOP|UNSERV)/i,
  /LOC.{0,6}(U\/S|INOP)/i,
  /GS.{0,6}(U\/S|INOP)/i,
  /VOR.{0,6}(U\/S|INOP)/i,
  /NDB.{0,6}(U\/S|INOP)/i,
  /AIRPORT.{0,10}CLSD|AD.{0,4}CLSD/i,
  /FUEL.{0,10}(UNAVAIL|NOT AVBL)/i,
  /HAZARD/i,
];

function getSeverity(text: string): NotamSeverity {
  if (CRIT_PATTERNS.some(r => r.test(text))) return 'crit';
  if (/TWY|TAXIWAY|LGT.*U\/S/i.test(text))  return 'warn';
  return 'info';
}

function getCategory(text: string): { l: string; c: string } {
  if (/RWY|RUNWAY|PISTA/i.test(text))   return { l: 'RWY',  c: 'nr2' };
  if (/ILS|LOC|GS|GP/i.test(text))      return { l: 'ILS',  c: 'na2' };
  if (/VOR|NDB|DME/i.test(text))        return { l: 'NAV',  c: 'na2' };
  if (/TWY|TAXIWAY/i.test(text))        return { l: 'TWY',  c: 'na2' };
  if (/TWR|TOWER|ATC/i.test(text))      return { l: 'ATC',  c: 'nb2' };
  if (/FUEL/i.test(text))               return { l: 'FUEL', c: 'na2' };
  return { l: 'GEN', c: 'ng2' };
}

export function parseNotams(raw: unknown, maxItems = 12): ParsedNotam[] {
  if (!raw) return [];

  let items: unknown[] = [];
  const r = raw as Record<string, unknown>;

  if (Array.isArray(r.items))     items = r.items;
  else if (r.notam)               items = Array.isArray(r.notam) ? r.notam : [r.notam];
  else if (Array.isArray(raw))    items = raw as unknown[];
  else if (r.notamList)           items = r.notamList as unknown[];

  return items
    .map((n): ParsedNotam => {
      const p  = (n as Record<string, unknown>);
      const cr = (p.coreNOTAMData as Record<string, unknown>)?.notam as Record<string, unknown> | undefined;
      const text = String(
        cr?.text || cr?.originalText ||
        p.text || p.itemE || p.e || p.body ||
        (n as Record<string, unknown>).text ||
        JSON.stringify(n).substring(0, 200)
      );
      return {
        id:   String(cr?.id || p.id || p.notamId || '?'),
        text,
        from: String(cr?.effectiveStart || p.startValidity || p.from || p.b || ''),
        to:   String(cr?.effectiveEnd   || p.endValidity   || p.to   || p.c || ''),
        sev:  getSeverity(text),
        cat:  getCategory(text),
      };
    })
    .filter(n => n.sev !== 'info' || n.cat.l !== 'GEN')
    .sort((a, b) => ({ crit: 0, warn: 1, info: 2 })[a.sev] - ({ crit: 0, warn: 1, info: 2 })[b.sev])
    .slice(0, maxItems);
}

/** Returns only the text of critical NOTAMs — used by voice briefing */
export function extractCriticalTexts(raw: unknown): string[] {
  return parseNotams(raw)
    .filter(n => n.sev === 'crit')
    .map(n => n.text)
    .slice(0, 4);
}
