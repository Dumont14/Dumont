// src/lib/notam/index.ts
import type { ParsedNotamEx, NotamSeverity, AtsHours, ScheduleStatus } from '@/types';

const isBrazilian = (icao: string) => /^SB[A-Z]{2}$/i.test(icao);

// ── FETCH ────────────────────────────────────────────────

export async function fetchNotams(icao: string): Promise<unknown> {
  const code = icao.toUpperCase();
  if (isBrazilian(code)) {
    try {
      return await fetchNotamsAISWEB(code);
    } catch (e) {
      console.warn('AISWEB failed, falling back to FAA:', e);
      return await fetchNotamsFAA(code);
    }
  }
  return fetchNotamsFAA(code);
}

async function fetchNotamsAISWEB(icao: string): Promise<unknown> {
  const proxyUrl = process.env.SUPABASE_AISWEB_PROXY_URL
    || 'https://qwfoxxwctbeemmowaxpj.supabase.co/functions/v1/aisweb-proxy';

  const res = await fetch(`${proxyUrl}?icao=${icao}`, {
    headers: { 'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`AISWEB proxy ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function fetchNotamsFAA(icao: string): Promise<unknown> {
  const clientId     = process.env.FAA_CLIENT_ID;
  const clientSecret = process.env.FAA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    const res = await fetch(
      `https://external-api.faa.gov/notamapi/v1/notams?icaoLocation=${icao}`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) throw new Error(`FAA NOTAM ${res.status}`);
    return res.json();
  }

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
      next: { revalidate: 300 },
    }
  );
  if (!res.ok) throw new Error(`FAA NOTAM ${res.status}`);
  return res.json();
}

// ── HELPERS DE DATA ──────────────────────────────────────

/** YYMMDDHHMM → "DD/MM/AAAA HH:MMZ" */
function fmtNotamDate(raw: string): string {
  if (!raw) return '';
  const s = raw.trim();
  if (!/^\d{10}$/.test(s)) return '';
  return `${s.slice(4,6)}/${s.slice(2,4)}/20${s.slice(0,2)} ${s.slice(6,8)}:${s.slice(8,10)}Z`;
}

// ── SCHEDULE: parsear campo <d> ──────────────────────────

const DAY_MAP: Record<string, number> = {
  MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 0,
};
const DAY_PT: Record<number, string> = {
  0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb',
};

export function parseSchedule(d: string): ScheduleStatus | null {
  if (!d || !d.trim()) return null;
  const s = d.trim().toUpperCase();

  // Extrair horário: HHMM-HHMM
  const timeMatch = s.match(/(\d{4})\s*[-–]\s*(\d{4})/);
  if (!timeMatch) return null;

  const closeStart = parseInt(timeMatch[1].slice(0,2)) * 60 + parseInt(timeMatch[1].slice(2,4));
  const closeEnd   = parseInt(timeMatch[2].slice(0,2)) * 60 + parseInt(timeMatch[2].slice(2,4));

  // Extrair dias
  let activeDays: number[] = [];

  if (/DAILY|DLY|H24/i.test(s)) {
    activeDays = [0, 1, 2, 3, 4, 5, 6];
  } else {
    const rangeMatch = s.match(/([A-Z]{3})\s*[-–]\s*([A-Z]{3})/);
    if (rangeMatch) {
      const start = DAY_MAP[rangeMatch[1]];
      const end   = DAY_MAP[rangeMatch[2]];
      if (start !== undefined && end !== undefined) {
        let cur = start;
        while (cur !== end) {
          activeDays.push(cur);
          cur = cur === 6 ? 0 : cur + 1;
          if (activeDays.length > 7) break;
        }
        activeDays.push(end);
      }
    } else {
      for (const [abbr, num] of Object.entries(DAY_MAP)) {
        if (s.includes(abbr)) activeDays.push(num);
      }
    }
  }

  if (activeDays.length === 0) activeDays = [0,1,2,3,4,5,6];

  // Status agora (UTC)
  const now        = new Date();
  const nowDay     = now.getUTCDay();
  const nowMin     = now.getUTCHours() * 60 + now.getUTCMinutes();
  const isDayActive  = activeDays.includes(nowDay);
  const isTimeActive = nowMin >= closeStart && nowMin < closeEnd;
  const closedNow    = isDayActive && isTimeActive;
  const openNow      = !closedNow;

  const fmtTime = (min: number) =>
    `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}Z`;

  let nextChange = '';
  if (closedNow) {
    nextChange = `Abre às ${fmtTime(closeEnd)}`;
  } else if (isDayActive && nowMin < closeStart) {
    nextChange = `Fecha às ${fmtTime(closeStart)} (em ${closeStart - nowMin}min)`;
  } else {
    const nextDay = activeDays
      .map(d => ({ d, diff: (d - nowDay + 7) % 7 || 7 }))
      .sort((a, b) => a.diff - b.diff)[0];
    if (nextDay) {
      nextChange = `Próx. restrição: ${DAY_PT[nextDay.d]} às ${fmtTime(closeStart)}`;
    }
  }

  const dayNames     = activeDays.map(d => DAY_PT[d]).join('-');
  const closedPeriod = `${dayNames} ${fmtTime(closeStart)}–${fmtTime(closeEnd)}`;
  const openPeriod   = `Aberto fora desse período`;

  return { raw: d, closedNow, openNow, nextChange, closedPeriod, openPeriod };
}

// ── PADRÕES DE SEVERIDADE ────────────────────────────────

const CRIT_PATTERNS: RegExp[] = [
  /AD\s{0,6}CLSD/i,
  /AEROD[RÓO]DROMO\s{0,10}FECHA/i,
  /AIRPORT\s{0,10}CLOS/i,
  /CLSD\s{0,10}DUE/i,
  /FECHAD[OA]\s{0,10}(PARA|POR|DUE)/i,
  /RWY.{0,15}CLSD/i,
  /CLSD.{0,15}RWY/i,
  /RUNWAY.{0,10}CLOS/i,
  /PISTA.{0,10}FECHA/i,
  /ILS.{0,8}(U\/S|INOP|UNSERV|INDISPON)/i,
  /LOC.{0,8}(U\/S|INOP|UNSERV)/i,
  /GS.{0,8}(U\/S|INOP|UNSERV)/i,
  /GP.{0,8}(U\/S|INOP|UNSERV)/i,
  /VOR.{0,8}(U\/S|INOP|UNSERV)/i,
  /NDB.{0,8}(U\/S|INOP|UNSERV)/i,
  /DME.{0,8}(U\/S|INOP|UNSERV)/i,
  /FUEL.{0,15}(UNAVAIL|NOT AVBL|INDISPON)/i,
  /ABASTEC.{0,15}(INDISPON|SUSPEN|FECHA|INDISP)/i,
  /HAZARD/i,
  /WIP.{0,20}RWY/i,
];

const WARN_PATTERNS: RegExp[] = [
  /TWY.{0,10}CLSD/i,
  /TAXIWAY.{0,10}CLOS/i,
  /LGT.{0,8}(U\/S|INOP)/i,
  /PAPI.{0,8}(U\/S|INOP)/i,
  /VASI.{0,8}(U\/S|INOP)/i,
  /TWR.{0,8}(CLSD|FECHA|INOP)/i,
  /ATC.{0,8}(CLSD|UNAVAIL)/i,
  /SER\s+ATS/i,
  /AD\s+HR\s+SER/i,
  /HR\s+SER/i,
  /OBST/i,
  /CRANE/i,
  /GUINDASTE/i,
];

function getSeverity(text: string): NotamSeverity {
  if (CRIT_PATTERNS.some(r => r.test(text))) return 'crit';
  if (WARN_PATTERNS.some(r => r.test(text)))  return 'warn';
  return 'info';
}

function getCategory(text: string): { l: string; c: string } {
  if (/AD\s{0,4}CLSD|AEROD[RO]DROMO\s{0,6}FECHA|AIRPORT\s{0,6}CLOS/i.test(text))
    return { l: 'AD CLSD', c: 'nr2' };
  if (/RWY|RUNWAY|PISTA/i.test(text))    return { l: 'RWY',   c: 'nr2' };
  if (/ILS|LOC|GS|GP/i.test(text))       return { l: 'ILS',   c: 'na2' };
  if (/VOR|NDB|DME/i.test(text))         return { l: 'NAV',   c: 'na2' };
  if (/TWY|TAXIWAY/i.test(text))         return { l: 'TWY',   c: 'na2' };
  if (/TWR|TOWER|ATC/i.test(text))       return { l: 'ATC',   c: 'nb2' };
  if (/FUEL|ABASTEC/i.test(text))        return { l: 'FUEL',  c: 'na2' };
  if (/AD\s+HR\s+SER|SER\s+ATS|HR\s+SER/i.test(text)) return { l: 'ATS HR', c: 'nb2' };
  if (/OBST|CRANE|GUINDASTE/i.test(text)) return { l: 'OBST', c: 'nb2' };
  return { l: 'GEN', c: 'ng2' };
}

// ── HORÁRIO ATS ──────────────────────────────────────────

function parseAtsHours(text: string): AtsHours | null {
  if (/\bH24\b/i.test(text)) {
    return { raw: 'H24', open: 0, close: 1440, isH24: true, isOpen: true, closingSoon: false };
  }
  const m = text.match(/(\d{4})\s*[-–]\s*(\d{4})/);
  if (!m) return null;

  const open   = parseInt(m[1].slice(0,2)) * 60 + parseInt(m[1].slice(2,4));
  const close  = parseInt(m[2].slice(0,2)) * 60 + parseInt(m[2].slice(2,4));
  const now    = new Date();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();

  const isOpen      = nowMin >= open && nowMin < close;
  const closingSoon = isOpen && (close - nowMin) <= 60;
  const opensIn     = !isOpen
    ? (nowMin < open ? open - nowMin : 1440 - nowMin + open)
    : undefined;

  return { raw: m[0], open, close, isH24: false, isOpen, closingSoon, opensIn };
}

export function extractAtsHours(notams: ParsedNotamEx[]): AtsHours | null {
  const atsNotam = notams.find(n =>
    /AD\s+HR\s+SER|SER\s+ATS|HR\s+SER/i.test(n.text)
  );
  if (atsNotam) return parseAtsHours(atsNotam.text);
  const critNotam = notams.find(n =>
    n.sev === 'crit' && /(\d{4})\s*[-–]\s*(\d{4})/.test(n.text)
  );
  if (critNotam) return parseAtsHours(critNotam.text);
  return null;
}

// ── PARSE PRINCIPAL ──────────────────────────────────────

export function parseNotams(raw: unknown, maxItems = 20): ParsedNotamEx[] {
  if (!raw) return [];

  const r = raw as any;
  if (r.error) throw new Error(String(r.error));

  let items: any[] = [];
  if (Array.isArray(r.notamList)) items = r.notamList;
  else if (Array.isArray(r.items))  items = r.items;
  else if (Array.isArray(r.notam))  items = r.notam;
  else if (r.notam)                 items = [r.notam];
  else if (Array.isArray(raw))      items = raw as any[];
  else if (r.rawText) {
    const t = String(r.rawText);
    return [{
      id: '?', text: t, from: '', to: '',
      sev: getSeverity(t), cat: getCategory(t),
      notamNum: '?', validFrom: '', validTo: '',
    }];
  }

  return items
    .map((n): ParsedNotamEx | null => {
      const p  = n as any;
      const cr = p.coreNOTAMData?.notam;

      // Texto operacional — campo <e>
      const text = String(
        cr?.text || cr?.originalText ||
        p.text   || p.itemE || p.e   ||
        p.body   || p.mens  || p.texto || p.message || ''
      ).trim();

      if (!text || text === 'undefined' || text.startsWith('<?xml')) return null;

      // Número do NOTAM — campo <n> ex: "G0576/26"
      const notamNum = String(p.n || cr?.id || p.notamId || p.numero || p.id || '?');

      // Datas limpas — campos <b> e <c>
      const validFrom = fmtNotamDate(String(p.from || p.b || cr?.effectiveStart || ''));
      const validTo   = fmtNotamDate(String(p.to   || p.c || cr?.effectiveEnd   || ''));

      // Schedule — campo <d> separado, NÃO concatenado no texto
      const dField   = String(p.d || p.schedule || '').trim();
      const schedule = dField ? (parseSchedule(dField) ?? undefined) : undefined;

      return {
        id:       notamNum,
        text,                    // texto limpo sem schedule
        from:     validFrom,
        to:       validTo,
        sev:      getSeverity(text),
        cat:      getCategory(text),
        notamNum,
        schedule,
        validFrom,
        validTo,
      };
    })
    .filter((n): n is ParsedNotamEx => n !== null)
    .filter(n => n.sev !== 'info' || n.cat.l !== 'GEN')
    .sort((a, b) =>
      ({ crit: 0, warn: 1, info: 2 })[a.sev] -
      ({ crit: 0, warn: 1, info: 2 })[b.sev]
    )
    .slice(0, maxItems);
}

export function extractCriticalTexts(raw: unknown): string[] {
  return parseNotams(raw)
    .filter(n => n.sev === 'crit' || n.sev === 'warn')
    .map(n => {
      const s = n.schedule;
      if (s) return `${n.text} (${s.closedPeriod}) — ${s.closedNow ? 'FECHADO AGORA' : s.nextChange}`;
      return n.text;
    })
    .slice(0, 6);
}
