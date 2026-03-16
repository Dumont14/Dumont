// src/lib/voice/intent.ts
// Parses spoken text into structured aviation intents
// Handles: direct ICAO codes, phonetic alphabet, spaced letters, city names, route queries
import type { VoiceIntent } from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IGNORE_WORDS = new Set([
  'O','A','E','I','DE','DA','DO','EM','ME','OS','AS','IS',
  'AT','IN','OF','TO','FOR','THE','AND','OR','BUT','ON','BY',
  'FROM','WITH','WHAT','ARE','HOW','TELL','DUMONT',
  'CONDITIONS','WEATHER','NOTAM','NOTAMS','TAF','ROUTE',
  'FLIGHT','REPORT','REPORTS','BRIEFING','STATUS','CHECK',
  'QUAIS','CONDICOES','CONDICOES','COMO','ESTA','AEROPORTO',
  'THIS','THAT','HAVE','WILL','WOULD','COULD','SHOULD',
  'WIND','VENTO','TETO','CEILING','VISIBILITY','VISIBILIDADE',
  'ROTA','PARA','SAINDO','INDO','POUSANDO','RESUMO',
]);

/** ICAO phonetic alphabet map */
const PHONETIC: Record<string, string> = {
  ALFA:'A', ALPHA:'A', BRAVO:'B', CHARLIE:'C', DELTA:'D',
  ECHO:'E', FOXTROT:'F', GOLF:'G', HOTEL:'H', INDIA:'I',
  JULIET:'J', JULIETT:'J', KILO:'K', LIMA:'L', MIKE:'M',
  NOVEMBER:'N', OSCAR:'O', PAPA:'P', QUEBEC:'Q', ROMEO:'R',
  SIERRA:'S', TANGO:'T', UNIFORM:'U', VICTOR:'V', WHISKEY:'W',
  XRAY:'X', 'X-RAY':'X', YANKEE:'Y', ZULU:'Z',
};

/** Common Brazilian city names → ICAO */
const CITY_TO_ICAO: Record<string, string> = {
  // SUDESTE
  GUARULHOS: 'SBGR',
  CONGONHAS: 'SBSP',
  GALEAO: 'SBGL',
  'SANTOS DUMONT': 'SBRJ',
  'BELO HORIZONTE': 'SBBH', // ou SBPB conforme o plano de voo
  VITORIA: 'SBVT',
  CAMPINAS: 'SBKP',
  'RIBEIRAO PRETO': 'SBRP',
  UBERLANDIA: 'SBUL',
  'SAO JOSE CAMPOS': 'SBSJ',
  'SAO JOSE RIO PRETO': 'SBSR',
  JACAREPAGUA: 'SBJR',
  MARTE: 'SBMT',

  // SUL
  CURITIBA: 'SBCT',
  FLORIANOPOLIS: 'SBFL',
  'PORTO ALEGRE': 'SBPA',
  'FOZ IGUACU': 'SBFI',
  LONDRINA: 'SBLO',
  MARINGA: 'SBMG',
  NAVEGANTES: 'SBNF',
  JOINVILLE: 'SBJV',
  CASCAVEL: 'SBCA',
  PELOTAS: 'SBPK',
  'CAXIAS DO SUL': 'SBCX',
  CHAPECO: 'SBCH',

  // NORDESTE
  SALVADOR: 'SBSV',
  RECIFE: 'SBRF',
  FORTALEZA: 'SBFZ',
  NATAL: 'SBSG',
  MACEIO: 'SBMO',
  'JOAO PESSOA': 'SBJP',
  ARACAJU: 'SBAR',
  TERESINA: 'SBTE',
  'SAO LUIS': 'SBSL',
  'PORTO SEGURO': 'SBPS',
  ILHEUS: 'SBIL',
  PETROLINA: 'SBPL',
  IMPERATRIZ: 'SBIZ',
  'JUAZEIRO NORTE': 'SBJU',
  'CAMPINA GRANDE': 'SBKG',

  // NORTE
  BELEM: 'SBBE',
  MANAUS: 'SBEG',
  SANTAREM: 'SBSN',
  MACAPA: 'SBMQ',
  'PORTO VELHO': 'SBPV',
  RIOBRANCO: 'SBRB',
  PALMAS: 'SBPJ',
  'BOA VISTA': 'SBBV',
  MARABA: 'SBMA',
  ALTAMIRA: 'SBHT',
  TABATINGA: 'SBTT',
  TEFE: 'SBTF',
  ITAITUBA: 'SBIH',
  'CRUZEIRO DO SUL': 'SBCZ',
  JACAREACANGA: 'SBEK',

  // CENTRO-OESTE
  BRASILIA: 'SBBR',
  CUIABA: 'SBCY',
  GOIANIA: 'SBGO',
  'CAMPO GRANDE': 'SBCG',
  SINOP: 'SWSI',
  RONDONOPOLIS: 'SWRD', // Atualmente SWRD (público) ou SBRO
  ANAPOLIS: 'SBAN',

  // ILHAS E OUTROS
  'FERNANDO NORONHA': 'SBFN',
  'CABO FRIO': 'SBCB',
};

/** Route-indicating keywords */
const ROUTE_KEYWORDS =
  /\b(ROTA|ROUTE|PARA|TO|FROM|ORIGEM|DESTINO|DEP|ARR|SAINDO|INDO|POUSANDO|DECOLAGEM|POUSO)\b/;

/** Intent-specific keyword patterns */
const INTENT_KEYWORDS: Record<string, RegExp> = {
  wind:       /\b(VENTO|WIND)\b/,
  visibility: /\b(VISIBILIDADE|VISIBILITY)\b/,
  ceiling:    /\b(TETO|CEILING)\b/,
  briefing:   /\b(BRIEFING|RESUMO|STATUS)\b/,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParsedIntent {
  dep: string;
  arr: string | null;
  type: VoiceIntent;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Step 1 — Normalize: strip diacritics, uppercase, collapse whitespace.
 */
function normalize(text: string): string {
  return text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Step 2 — Collapse spaced single letters into ICAO candidates.
 * Also normalizes Web Speech punctuation: "S. B. S. P." → "S B S P" → "SBSP"
 * Handles 3-letter (FAA) and 4-letter sequences.
 */
function collapseSpacedLetters(t: string): string {
  // Web Speech API sometimes returns "S. B. S. P." — strip dots before collapsing
  t = t.replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  // 4-letter sequence: S B S P → SBSP
  t = t.replace(/\b([A-Z])\s+([A-Z])\s+([A-Z])\s+([A-Z])\b/g, '$1$2$3$4');
  // 3-letter sequence: K J F → KJF
  t = t.replace(/\b([A-Z])\s+([A-Z])\s+([A-Z])\b/g, '$1$2$3');
  return t;
}

/**
 * Step 3 — Extract direct ICAO codes (3–4 uppercase letters, not ignored,
 * not all-vowels).
 */
function extractIcaos(t: string): string[] {
  const VOWELS_ONLY = /^[AEIOU]+$/;
  const matches = t.match(/\b([A-Z]{3,4})\b/g) || [];
  const icaos: string[] = [];

  for (const m of matches) {
    if (!IGNORE_WORDS.has(m) && !VOWELS_ONLY.test(m)) {
      icaos.push(m);
    }
  }

  return icaos;
}

/**
 * Step 4 — Parse phonetic alphabet sequences into ICAO codes.
 * Only emits a code when exactly 4 consecutive phonetic tokens are found,
 * which matches the standard 4-letter ICAO format and avoids partial codes.
 * Handles punctuation/pauses between tokens (commas, dots, ellipsis).
 */
function parsePhoneticIcao(t: string): string[] {
  // Split on spaces and common separators
  const words = t.split(/[\s,.\u2026]+/);
  const icaos: string[] = [];
  let spelled = '';

  for (const w of words) {
    if (PHONETIC[w]) {
      spelled += PHONETIC[w];
      // Flush only when exactly 4 phonetic letters accumulated
      if (spelled.length === 4) {
        icaos.push(spelled);
        spelled = '';
      }
    } else {
      // Non-phonetic word — discard partial (< 4) to avoid false codes
      spelled = '';
    }
  }

  // Remaining letters after end of input — discard if not exactly 4
  // (strict mode: ICAO is always 4 letters)

  return icaos;
}

/**
 * Step 5 — Resolve city names to ICAO codes when no direct ICAO was found.
 * Uses word-boundary regex to avoid false positives (e.g. "MANAUS" inside "XMANAUSTRIP").
 */
function resolveCity(t: string): string[] {
  const icaos: string[] = [];

  for (const [city, icao] of Object.entries(CITY_TO_ICAO)) {
    // Escape spaces in multi-word cities (e.g. "PORTO VELHO") for regex safety
    const escaped = city.replace(/ /g, '\\s+');
    if (new RegExp(`\\b${escaped}\\b`).test(t)) {
      icaos.push(icao);
    }
  }

  return icaos;
}

/**
 * Step 6 — Determine if the query describes a route.
 * Requires explicit route keywords; two ICAOs alone are NOT enough.
 */
function detectRoute(t: string, unique: string[]): boolean {
  return ROUTE_KEYWORDS.test(t) && unique.length >= 2;
}

/**
 * Step 7 — Detect specific aviation intent type from keywords.
 * Falls back to "aerodrome" or "route" based on ICAO count.
 */
function detectIntentType(t: string, isRoute: boolean): VoiceIntent {
  for (const [intent, pattern] of Object.entries(INTENT_KEYWORDS)) {
    if (pattern.test(t)) return intent as VoiceIntent;
  }

  return isRoute ? 'route' : 'aerodrome';
}

/**
 * Step 8 — Validate a single ICAO string (3–4 letters).
 */
function isValidIcao(code: string): boolean {
  return /^[A-Z]{3,4}$/.test(code);
}

/**
 * Levenshtein distance between two strings (no external deps).
 * Used to correct single-character Web Speech transcription errors.
 * Example: SBGP → SBGR (distance = 1)
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

/**
 * Attempt to correct a single ICAO code that is one edit away from
 * another candidate in the detected list. Helps recover from Web Speech
 * transcription errors (e.g. SBGP → SBGR when SBGR is also detected).
 * Only corrects when exactly one candidate is at distance 1.
 */
function correctIcao(code: string, candidates: string[]): string {
  const others = candidates.filter(c => c !== code && isValidIcao(c));
  const close  = others.filter(c => levenshtein(code, c) === 1);
  return close.length === 1 ? close[0] : code;
}

/** Brazilian ICAO prefixes — used to sort domestic airports first */
const BR_PREFIXES = ['SB', 'SD', 'SN', 'SW', 'SI'];

function isBrazilian(code: string): boolean {
  return BR_PREFIXES.some(p => code.startsWith(p));
}

/**
 * Sort ICAO list so Brazilian airports appear first (dep priority).
 */
function prioritizeBrazilian(icaos: string[]): string[] {
  return [...icaos].sort((a, b) => {
    const aBr = isBrazilian(a) ? 0 : 1;
    const bBr = isBrazilian(b) ? 0 : 1;
    return aBr - bBr;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse spoken text into a structured aviation intent.
 *
 * Pipeline:
 *   normalize → collapse spaced letters → extract direct ICAOs
 *   → parse phonetic ICAOs → city resolution → route & intent detection
 *
 * Returns null if no valid ICAO could be extracted.
 */
export function parseVoiceIntent(text: string): ParsedIntent | null {
  // 1. Normalize
  const t = normalize(text);

  // 2. Collapse "S B S P" → "SBSP"
  const collapsed = collapseSpacedLetters(t);

  // 3. Collect ICAO candidates from multiple sources
  const directIcaos   = extractIcaos(collapsed);
  const phoneticIcaos = parsePhoneticIcao(t);      // run on original normalized text

  // Merge, deduplicate, preserve order
  const all    = [...directIcaos, ...phoneticIcaos];
  let   unique = [...new Set(all)].filter(isValidIcao);

  // Apply Levenshtein typo correction (fixes Web Speech 1-char errors, e.g. SBGP→SBGR)
  unique = unique.map(code => correctIcao(code, unique));
  unique = [...new Set(unique)]; // re-deduplicate after correction

  // Prioritize Brazilian airports as dep candidate
  unique = prioritizeBrazilian(unique);

  // 4. City-name fallback (only when no ICAO found yet)
  if (unique.length === 0) {
    const cityIcaos = resolveCity(t);
    unique = [...new Set(cityIcaos)].filter(isValidIcao);
  }

  // 5. Still nothing → cannot parse
  if (unique.length === 0) return null;

  // 6. Route detection (requires explicit keywords)
  const isRoute = detectRoute(t, unique);

  // 7. Intent type
  const type = detectIntentType(t, isRoute);

  // 8. Build result
  const dep = unique[0];
  const arr = isRoute && unique.length >= 2 ? unique[1] : null;

  // 9. Defensive validation
  if (!isValidIcao(dep))       return null;
  if (arr && arr === dep)      return null;
  if (arr && !isValidIcao(arr)) return null;

  return { dep, arr, type };
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

/**
 * Detect language from spoken text content (not browser locale).
 * Uses matchAll for accurate multi-match counting.
 */
export function detectLang(text: string): 'pt' | 'en' {
  const enPattern = /\b(conditions?|weather|briefing|status|notam|runway|forecast|route|what|how|tell|check|give)\b/gi;
  const ptPattern = /\b(condicoes|condições|tempo|pista|como|esta|qual|quais|aerodromo|aeródromo|vento|teto|rota|resumo)\b/gi;

  const enScore = [...text.matchAll(enPattern)].length;
  const ptScore = [...text.matchAll(ptPattern)].length;

  return enScore > ptScore ? 'en' : 'pt';
}
