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
  // Palavras que são partes de nomes de cidades compostas —
  // NUNCA devem ser interpretadas como ICAOs sozinhas.
  'BELO','SANTO','PORTO','SAO','CAMPO','FOZ','BOA','CAXIAS',
  'JUAZEIRO','CAMPINA','CRUZEIRO','FERNANDO','CABO',
  'RIO',   // "Rio Branco", "Rio de Janeiro" etc.
  'GRANDE','SUL','NORTE','LESTE','OESTE','HORIZONTE',
  'JOSE','JOAO','LUIS','VELHO','BRANCO','VISTA',
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
  'BELO HORIZONTE': 'SBBH',
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
  'RIO BRANCO': 'SBRB',
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
  RONDONOPOLIS: 'SWRD',
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
  briefing:   /\b(BRIEFING|RESUMO|STATUS|CONDICOES|CONDITIONS)\b/,
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

/** Step 1 — Normalize: strip diacritics, uppercase, collapse whitespace. */
function normalize(text: string): string {
  return text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Step 2 — Resolve city names to ICAOs and ERASE them from the text.
 *
 * MUST run BEFORE extractIcaos so that city tokens like BELO and RIO
 * are removed from the string and never reach the ICAO extractor.
 *
 * Sorts cities longest-first to prevent partial matches
 * ("BELO HORIZONTE" before "BELO").
 *
 * Returns { icaos, cleanText } where cleanText has city tokens removed.
 */
function resolveCity(t: string): { icaos: string[]; cleanText: string } {
  const icaos: string[] = [];
  let cleanText = t;

  const sortedCities = Object.entries(CITY_TO_ICAO)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [city, icao] of sortedCities) {
    const escaped = city
      .split(' ')
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'gi');

    if (pattern.test(cleanText)) {
      icaos.push(icao);
      // Erase matched tokens so they don't become false ICAOs downstream
      cleanText = cleanText.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  return { icaos, cleanText };
}

/**
 * Step 3 — Collapse spaced single letters into ICAO candidates.
 * Normalizes Web Speech punctuation: "S. B. S. P." → "S B S P" → "SBSP"
 */
function collapseSpacedLetters(t: string): string {
  t = t.replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/\b([A-Z])\s+([A-Z])\s+([A-Z])\s+([A-Z])\b/g, '$1$2$3$4');
  t = t.replace(/\b([A-Z])\s+([A-Z])\s+([A-Z])\b/g, '$1$2$3');
  return t;
}

/**
 * Step 4 — Extract direct ICAO codes (3–4 uppercase letters).
 * Runs AFTER city resolution so city fragments are already gone.
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
 * Step 5 — Parse phonetic alphabet sequences into ICAO codes.
 * Only emits when exactly 4 consecutive phonetic tokens appear.
 */
function parsePhoneticIcao(t: string): string[] {
  const words = t.split(/[\s,.\u2026]+/);
  const icaos: string[] = [];
  let spelled = '';

  for (const w of words) {
    if (PHONETIC[w]) {
      spelled += PHONETIC[w];
      if (spelled.length === 4) {
        icaos.push(spelled);
        spelled = '';
      }
    } else {
      spelled = ''; // discard partials — standard ICAO is always 4 letters
    }
  }

  return icaos;
}

/** Route requires explicit keywords AND 2+ ICAOs. */
function detectRoute(t: string, unique: string[]): boolean {
  return ROUTE_KEYWORDS.test(t) && unique.length >= 2;
}

/** Intent type from keywords, fallback to aerodrome/route. */
function detectIntentType(t: string, isRoute: boolean): VoiceIntent {
  for (const [intent, pattern] of Object.entries(INTENT_KEYWORDS)) {
    if (pattern.test(t)) return intent as VoiceIntent;
  }
  return isRoute ? 'route' : 'aerodrome';
}

/** Validate ICAO string (3–4 uppercase letters). */
function isValidIcao(code: string): boolean {
  return /^[A-Z]{3,4}$/.test(code);
}

/**
 * Levenshtein distance — corrects single-char Web Speech errors.
 * Example: SBGP → SBGR when SBGR is also a candidate.
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

function correctIcao(code: string, candidates: string[]): string {
  const others = candidates.filter(c => c !== code && isValidIcao(c));
  const close  = others.filter(c => levenshtein(code, c) === 1);
  return close.length === 1 ? close[0] : code;
}

const BR_PREFIXES = ['SB', 'SD', 'SN', 'SW', 'SI'];

function isBrazilian(code: string): boolean {
  return BR_PREFIXES.some(p => code.startsWith(p));
}

function prioritizeBrazilian(icaos: string[]): string[] {
  return [...icaos].sort((a, b) => (isBrazilian(a) ? 0 : 1) - (isBrazilian(b) ? 0 : 1));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse spoken text into a structured aviation intent.
 *
 * Pipeline (ORDER MATTERS):
 *   normalize
 *   → resolveCity          ← FIRST: resolves cities AND erases their tokens
 *   → collapseSpacedLetters (on city-free text)
 *   → extractIcaos         ← safe: city fragments already removed
 *   → parsePhoneticIcao
 *   → levenshtein correction
 *   → Brazilian prioritization
 *   → route & intent detection
 */
export function parseVoiceIntent(text: string): ParsedIntent | null {
  // 1. Normalize
  const normalized = normalize(text);

  // 2. Resolve cities FIRST — erases "BELO", "RIO" etc. from the text
  //    before ICAO extraction can misinterpret them.
  const { icaos: cityIcaos, cleanText } = resolveCity(normalized);

  // 3. Collapse spaced letters on city-free text
  const collapsed = collapseSpacedLetters(cleanText);

  // 4. Extract direct ICAOs from sanitized text
  const directIcaos = extractIcaos(collapsed);

  // 5. Phonetic parsing on city-free text
  const phoneticIcaos = parsePhoneticIcao(cleanText);

  // 6. Merge: city ICAOs first (highest confidence), then direct, then phonetic
  const all    = [...cityIcaos, ...directIcaos, ...phoneticIcaos];
  let   unique = [...new Set(all)].filter(isValidIcao);

  // 7. Levenshtein typo correction
  unique = unique.map(code => correctIcao(code, unique));
  unique = [...new Set(unique)];

  // 8. Prioritize Brazilian airports as dep
  unique = prioritizeBrazilian(unique);

  // 9. Nothing found
  if (unique.length === 0) return null;

  // 10. Route detection
  const isRoute = detectRoute(normalized, unique);

  // 11. Intent type
  const type = detectIntentType(normalized, isRoute);

  // 12. Build result
  const dep = unique[0];
  const arr = isRoute && unique.length >= 2 ? unique[1] : null;

  // 13. Defensive validation
  if (!isValidIcao(dep))        return null;
  if (arr && arr === dep)       return null;
  if (arr && !isValidIcao(arr)) return null;

  return { dep, arr, type };
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

/**
 * Detect language from spoken text (not browser locale).
 * Uses matchAll for accurate multi-match counting.
 */
export function detectLang(text: string): 'pt' | 'en' {
  const enPattern = /\b(conditions?|weather|briefing|status|notam|runway|forecast|route|what|how|tell|check|give)\b/gi;
  const ptPattern = /\b(condicoes|condições|tempo|pista|como|esta|qual|quais|aerodromo|aeródromo|vento|teto|rota|resumo)\b/gi;

  const enScore = [...text.matchAll(enPattern)].length;
  const ptScore = [...text.matchAll(ptPattern)].length;

  return enScore > ptScore ? 'en' : 'pt';
}
