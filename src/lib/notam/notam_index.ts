// src/lib/notam/index.ts
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
    { next: { revalidate: 300 } } // 5min — NOTAMs AD CLSD são urgentes
  );
  if (!res.ok) throw new Error(`AISWEB ${res.status}`);

  // AISWEB retorna XML — converter para objeto utilizável
  const text = await res.text();
  return parseAISWEBResponse(text);
}

/** Parseia resposta AISWEB que pode ser XML ou JSON */
function parseAISWEBResponse(raw: string): unknown {
  const trimmed = raw.trim();

  // Se for JSON válido, retornar direto
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { /* continua para XML */ }
  }

  // Parsear XML manualmente extraindo campos relevantes
  const notams: Record<string, string>[] = [];

  // Extrair blocos <item> ou <notam>
  const blockRe = /<(?:item|notam|NOTAM)[^>]*>([\s\S]*?)<\/(?:item|notam|NOTAM)>/gi;
  let block: RegExpExecArray | null;

  while ((block = blockRe.exec(trimmed)) !== null) {
    const content = block[1];
    const get = (tag: string) => {
      const m = content.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
    };

    const item: Record<string, string> = {
      id:   get('id') || get('numero') || get('notamId') || '',
      text: get('e') || get('itemE') || get('text') || get('mens') || get('texto') || '',
      from: get('b') || get('startValidity') || get('inicio') || '',
      to:   get('c') || get('endValidity')   || get('fim')    || '',
      q:    get('q') || get('qLine')         || '',
    };

    // Se text vazio, tentar extrair do bloco inteiro removendo tags
    if (!item.text) {
      item.text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    if (item.text) notams.push(item);
  }

  // Se não encontrou blocos, tentar extrair texto livre do XML
  if (notams.length === 0 && trimmed.includes('<')) {
    const textContent = trimmed
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (textContent.length > 10) {
      return { rawText: textContent };
    }
  }

  return { notamList: notams };
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

// ── PARSE ────────────────────────────────────────────────

// Padrões críticos — PT e EN
const CRIT_PATTERNS: RegExp[] = [
  // AD fechado
  /AD\s{0,6}CLSD/i,
  /AEROD[RÓO]DROMO\s{0,10}FECHA/i,
  /AIRPORT\s{0,10}CLOS/i,
  /CLSD\s{0,10}DUE/i,
  /FECHAD[OA]\s{0,10}(PARA|POR|DUE)/i,
  // Pista fechada
  /RWY.{0,15}CLSD/i,
  /CLSD.{0,15}RWY/i,
  /RUNWAY.{0,10}CLOS/i,
  /PISTA.{0,10}FECHA/i,
  // Navegação inoperante
  /ILS.{0,8}(U\/S|INOP|UNSERV|INDISPON)/i,
  /LOC.{0,8}(U\/S|INOP|UNSERV)/i,
  /GS.{0,8}(U\/S|INOP|UNSERV)/i,
  /GP.{0,8}(U\/S|INOP|UNSERV)/i,
  /VOR.{0,8}(U\/S|INOP|UNSERV)/i,
  /NDB.{0,8}(U\/S|INOP|UNSERV)/i,
  /DME.{0,8}(U\/S|INOP|UNSERV)/i,
  // Combustível
  /FUEL.{0,15}(UNAVAIL|NOT AVBL|INDISPON)/i,
  /ABASTEC.{0,15}(INDISPON|SUSPEN|FECHA)/i,
  // Perigo / emergência
  /HAZARD/i,
  /WIP.{0,20}RWY/i,
];

// Padrões de aviso
const WARN_PATTERNS: RegExp[] = [
  /TWY.{0,10}CLSD/i,
  /TAXIWAY.{0,10}CLOS/i,
  /LGT.{0,8}(U\/S|INOP)/i,
  /PAPI.{0,8}(U\/S|INOP)/i,
  /VASI.{0,8}(U\/S|INOP)/i,
  /TWR.{0,8}(CLSD|FECHA|INOP)/i,
  /ATC.{0,8}(CLSD|UNAVAIL)/i,
  /SER\s+ATS/i,          // horário de serviço ATS
  /AD\s+HR\s+SER/i,      // horário de serviço do AD
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
  if (/AD\s+HR\s+SER|SER\s+ATS/i.test(text)) return { l: 'ATS HR', c: 'nb2' };
  if (/OBST|CRANE|GUINDASTE/i.test(text)) return { l: 'OBST', c: 'nb2' };
  return { l: 'GEN', c: 'ng2' };
}

// ── HORÁRIO ATS ──────────────────────────────────────────

export interface AtsHours {
  raw: string;        // string original ex: "DLY 0315-2045"
  open: number;       // minutos UTC desde meia-noite
  close: number;      // minutos UTC desde meia-noite
  isH24: boolean;
  isOpen: boolean;    // aberto agora?
  closingSoon: boolean; // fecha em menos de 60min?
  opensIn?: number;   // minutos até abrir (se fechado)
}

function parseAtsHours(text: string): AtsHours | null {
  // Padrões: "DLY 0315-2045", "H24", "MON-FRI 1030-1300", "DLY 1015-2145"
  if (/\bH24\b/i.test(text)) {
    return { raw: 'H24', open: 0, close: 1440, isH24: true, isOpen: true, closingSoon: false };
  }

  const m = text.match(/(\d{4})\s*[-–]\s*(\d{4})/);
  if (!m) return null;

  const open  = parseInt(m[1].slice(0, 2)) * 60 + parseInt(m[1].slice(2, 4));
  const close = parseInt(m[2].slice(0, 2)) * 60 + parseInt(m[2].slice(2, 4));

  const now   = new Date();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();

  const isOpen      = nowMin >= open && nowMin < close;
  const closingSoon = isOpen && (close - nowMin) <= 60;
  const opensIn     = !isOpen ? (nowMin < open ? open - nowMin : 1440 - nowMin + open) : undefined;

  return {
    raw: m[0],
    open, close, isH24: false,
    isOpen, closingSoon,
    opensIn,
  };
}

export function extractAtsHours(notams: ParsedNotam[]): AtsHours | null {
  const atsNotam = notams.find(n =>
    /AD\s+HR\s+SER|SER\s+ATS|HR\s+SER/i.test(n.text)
  );
  if (!atsNotam) return null;
  return parseAtsHours(atsNotam.text);
}

// ── PARSE PRINCIPAL ──────────────────────────────────────

export function parseNotams(raw: unknown, maxItems = 20): ParsedNotam[] {
  if (!raw) return [];

  let items: unknown[] = [];
  const r = raw as Record<string, unknown>;

  // Normalizar estrutura de entrada
  if (Array.isArray(r.items))          items = r.items;
  else if (Array.isArray(r.notamList)) items = r.notamList;
  else if (Array.isArray(r.notam))     items = r.notam;
  else if (r.notam)                    items = [r.notam];
  else if (Array.isArray(raw))         items = raw as unknown[];
  // rawText = fallback de XML mal parseado
  else if (r.rawText) {
    return [{
      id: '?', text: String(r.rawText),
      from: '', to: '',
      sev: getSeverity(String(r.rawText)),
      cat: getCategory(String(r.rawText)),
    }];
  }

  return items
    .map((n): ParsedNotam | null => {
      const p  = n as Record<string, unknown>;
      const cr = (p.coreNOTAMData as Record<string, unknown>)?.notam as Record<string, unknown> | undefined;

      // Tentar extrair texto de todos os campos possíveis — PT e EN
      const text = String(
        cr?.text         ||
        cr?.originalText ||
        p.text           ||
        p.itemE          ||
        p.e              ||
        p.body           ||
        p.mens           ||  // AISWEB XML parseado
        p.texto          ||  // AISWEB PT
        p.message        ||
        ''
      ).trim();

      if (!text || text === 'undefined') return null;

      return {
        id:   String(cr?.id || p.id || p.notamId || p.numero || '?'),
        text,
        from: String(cr?.effectiveStart || p.startValidity || p.from || p.inicio || p.b || ''),
        to:   String(cr?.effectiveEnd   || p.endValidity   || p.to   || p.fim    || p.c || ''),
        sev:  getSeverity(text),
        cat:  getCategory(text),
      };
    })
    .filter((n): n is ParsedNotam => n !== null)
    // Mostrar TUDO que é crit/warn + GEN info com conteúdo relevante
    .filter(n => n.sev === 'crit' || n.sev === 'warn' || n.cat.l !== 'GEN')
    .sort((a, b) => ({ crit: 0, warn: 1, info: 2 })[a.sev] - ({ crit: 0, warn: 1, info: 2 })[b.sev])
    .slice(0, maxItems);
}

export function extractCriticalTexts(raw: unknown): string[] {
  return parseNotams(raw)
    .filter(n => n.sev === 'crit' || n.sev === 'warn')
    .map(n => n.text)
    .slice(0, 6);
}
