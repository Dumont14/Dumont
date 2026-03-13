// src/lib/voice/intent.ts
// Parses spoken text into structured aviation intents
// Handles: direct ICAO codes, phonetic alphabet, route queries

import type { VoiceIntent } from '@/types';

const IGNORE_WORDS = new Set([
  'O','A','E','I','DE','DA','DO','EM','ME','OS','AS','IS',
  'AT','IN','OF','TO','FOR','THE','AND','OR','BUT','ON','BY',
  'FROM','WITH','WHAT','ARE','HOW','TELL','DUMONT',
  'CONDITIONS','WEATHER','NOTAM','NOTAMS','TAF','ROUTE',
  'FLIGHT','REPORT','REPORTS','BRIEFING','STATUS','CHECK',
  'QUAIS','CONDICOES','CONDIÇOES','COMO','ESTA','AEROPORTO',
]);

const PHONETIC: Record<string, string> = {
  ALFA:'A', ALPHA:'A', BRAVO:'B', CHARLIE:'C', DELTA:'D',
  ECHO:'E', FOXTROT:'F', GOLF:'G', HOTEL:'H', INDIA:'I',
  JULIET:'J', JULIETT:'J', KILO:'K', LIMA:'L', MIKE:'M',
  NOVEMBER:'N', OSCAR:'O', PAPA:'P', QUEBEC:'Q', ROMEO:'R',
  SIERRA:'S', TANGO:'T', UNIFORM:'U', VICTOR:'V', WHISKEY:'W',
  XRAY:'X', 'X-RAY':'X', YANKEE:'Y', ZULU:'Z',
};

export interface ParsedIntent {
  dep: string;
  arr: string | null;
  type: VoiceIntent;
}

export function parseVoiceIntent(text: string): ParsedIntent | null {
  const t = text.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const icaos: string[] = [];

  // 1. Direct ICAO codes (2–4 uppercase letters, not ignored)
  const directMatches = t.match(/\b([A-Z]{2,4})\b/g) || [];
  for (const m of directMatches) {
    if (!IGNORE_WORDS.has(m) && m.length >= 2 && m.length <= 4) {
      icaos.push(m);
    }
  }

  // 2. Phonetic alphabet (e.g. "sierra bravo sierra papa" → SBSP)
  const words = t.split(/[\s,]+/);
  let spelled = '';
  for (const w of words) {
    if (PHONETIC[w]) {
      spelled += PHONETIC[w];
    } else {
      if (spelled.length >= 2 && spelled.length <= 4) {
        icaos.push(spelled);
      }
      spelled = '';
    }
  }
  if (spelled.length >= 2 && spelled.length <= 4) icaos.push(spelled);

  // Deduplicate preserving order
  const unique = [...new Set(icaos)];
  if (unique.length === 0) return null;

  // 3. Determine if route query
  const routeKeywords = /\b(ROTA|ROUTE|PARA|TO|FROM|ORIGEM|DESTINO|DEP|ARR|DECOLAGEM|POUSO|FLIGHT|SAINDO|INDO|POUSANDO)\b/;
  const isRoute = routeKeywords.test(t) || unique.length >= 2;

  return {
    dep:  unique[0],
    arr:  isRoute && unique.length >= 2 ? unique[1] : null,
    type: isRoute && unique.length >= 2 ? 'route' : 'aerodrome',
  };
}

/** Detect language from spoken text content (not browser locale) */
export function detectLang(text: string): 'pt' | 'en' {
  const enKeywords = /\b(conditions?|weather|briefing|status|notam|runway|forecast|route|what|how|tell|check|give)\b/i;
  const ptKeywords = /\b(condições|condicoes|tempo|pista|como|esta|qual|quais|aeródromo|aerodromo)\b/i;
  const enScore = (text.match(enKeywords) || []).length;
  const ptScore = (text.match(ptKeywords) || []).length;
  return enScore > ptScore ? 'en' : 'pt';
}
