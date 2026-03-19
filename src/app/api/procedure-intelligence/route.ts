// src/app/api/procedure-intelligence/route.ts
// Arquitetura: Backend decide → LLM comunica
// Fluxo: ingestão → normalização → parse → RWY ativa → score → seleção → LLM (linguagem apenas)

import { NextRequest, NextResponse } from 'next/server';

const AISWEB_BASE   = 'https://api.decea.mil.br/aisweb/';
const REDEMET_KEY   = process.env.REDEMET_KEY ?? process.env.REDEMET_API_KEY ?? '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';

// ─────────────────────────────────────────────────────────
// CAMADA 1 — INGESTÃO
// ─────────────────────────────────────────────────────────

async function fetchCartas(icao: string): Promise<any[]> {
  const user = process.env.AISWEB_USER;
  const pass = process.env.AISWEB_PASS;
  if (!user || !pass) return [];
  try {
    const q = new URLSearchParams({ apiKey: user, apiPass: pass, area: 'cartas', icao });
    const res = await fetch(`${AISWEB_BASE}?${q}`, {
      next: { revalidate: 43200 },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: any[] = [];
    const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xml)) !== null) {
      const block = m[1];
      const get = (tag: string) => {
        const r = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`);
        const match = r.exec(block);
        return (match?.[1] ?? match?.[2] ?? '').trim();
      };
      const icaoCode = get('IcaoCode');
      if (icaoCode && icaoCode.toUpperCase() !== icao.toUpperCase()) continue;
      items.push({ id: get('id'), tipo: get('tipo'), nome: get('nome'), link: get('link'), icp: get('icp') });
    }
    return items;
  } catch { return []; }
}

async function fetchMetar(icao: string): Promise<string> {
  if (!REDEMET_KEY) return '';
  try {
    const now   = new Date();
    const start = new Date(now.getTime() - 2 * 3600_000);
    const fmt   = (d: Date) =>
      `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}` +
      `${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}`;
    const res = await fetch(
      `https://api-redemet.decea.mil.br/mensagens/metar/${icao}?api_key=${REDEMET_KEY}&data_ini=${fmt(start)}&data_fim=${fmt(now)}`,
      { next: { revalidate: 120 }, signal: AbortSignal.timeout(6_000) }
    );
    const json = await res.json();
    const msgs = json?.data?.data ?? [];
    return msgs[msgs.length - 1]?.mens ?? '';
  } catch { return ''; }
}

// ─────────────────────────────────────────────────────────
// CAMADA 2 — NORMALIZAÇÃO (texto → dados)
// ─────────────────────────────────────────────────────────

interface ProcEnv {
  windDir:       number;
  windSpeedKt:   number;
  gustKt:        number;
  isCalm:        boolean;
  isVRB:         boolean;
  hasCB:         boolean;
  hasLowCeiling: boolean;
  hasLowVis:     boolean;
  isDegraded:    boolean;
}

function parseCeilingFt(text: string): number {
  const re = /\b(BKN|OVC)(\d{3})\b/g;
  let min = 99999, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const ft = parseInt(m[2]) * 100;
    if (ft < min) min = ft;
  }
  return min;
}

// Fix: evitar capturar QNH ou timestamps como visibilidade
function parseVisMt(text: string): number {
  if (/CAVOK/i.test(text)) return 9999;
  const sm = text.match(/(\d+(?:\.\d+)?)SM/);
  if (sm) return Math.round(parseFloat(sm[1]) * 1609);
  // Visibilidade métrica: 4 dígitos seguidos de fenômeno met ou espaço/fim
  const visMatch = text.match(/\b(\d{4})\b(?=\s*(?:BR|FG|HZ|DZ|RA|SN|TS|NSW|\s|$))/);
  return visMatch ? parseInt(visMatch[1]) : 9999;
}

function hasCbTs(text: string): boolean {
  return /\b(CB|TS|TSRA|TSGR|TSSN)\b/i.test(text);
}

function normalizeEnv(metar: string, taf: string): ProcEnv {
  const windM   = metar.match(/\b(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  const isVRB   = windM?.[1] === 'VRB';
  const windSpd = windM ? parseInt(windM[2]) : 0;
  const isCalm  = !windM || windSpd < 3;
  const windDir = (windM && !isVRB) ? parseInt(windM[1]) : 0;
  const gust    = windM?.[3] ? parseInt(windM[3]) : 0;
  const allText = `${metar} ${taf}`;
  const ceiling = parseCeilingFt(allText);
  const vis     = parseVisMt(allText);
  const hasCB   = hasCbTs(allText);

  return {
    windDir, windSpeedKt: windSpd, gustKt: gust,
    isCalm, isVRB, hasCB,
    hasLowCeiling: ceiling < 1500,
    hasLowVis:     vis < 5000,
    isDegraded:    hasCB || ceiling < 1500 || vis < 5000,
  };
}

// ─────────────────────────────────────────────────────────
// CAMADA 3 — PARSE DE PROCEDIMENTOS
// ─────────────────────────────────────────────────────────

interface ParsedProcedure {
  id:     string;
  tipo:   string;
  nome:   string;
  rwy:    string;    // normalizado sem L/R/C, ex: "29", "10"
  rwyRaw: string;    // original, ex: "10R"
  suffix: string;    // "1B", "2A"
  link:   string;
  icp:    string;
}

function normalizeRwy(rwy: string): string {
  return rwy.replace(/[LRC]/gi, '').trim();
}

function parseProcedures(raw: any[], tipoFiltro: string[]): ParsedProcedure[] {
  return raw
    .filter(p => tipoFiltro.includes((p.tipo ?? '').toUpperCase()))
    .map(p => {
      const rwyM   = p.nome.match(/RWY\s+(\d{1,2}[LRC]?)/i);
      const rwyRaw = rwyM ? rwyM[1].toUpperCase() : 'GERAL';
      const rwy    = normalizeRwy(rwyRaw);
      const sufM   = p.nome.match(/\b(\d[A-Z])\b/);
      const suffix = sufM ? sufM[1] : '';
      return { ...p, rwy, rwyRaw, suffix };
    });
}

// ─────────────────────────────────────────────────────────
// CAMADA 4 — RWY ATIVA (determinístico)
// ─────────────────────────────────────────────────────────

function runwayHeading(rwy: string): number {
  const n = parseInt(normalizeRwy(rwy));
  return isNaN(n) ? 0 : n * 10;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

function getActiveRunway(env: ProcEnv, runways: string[]): string | null {
  if (!runways.length) return null;

  // Calmaria ou VRB: sem determinação por vento, usar primeira RWY como fallback
  // (decisão existe mas sem base meteorológica)
  if (env.isCalm || env.isVRB) return runways[0] ?? null;

  let best = runways[0];
  let minDiff = 999;

  for (const rwy of runways) {
    const diff = angleDiff(env.windDir, runwayHeading(rwy));
    if (diff < minDiff) { minDiff = diff; best = rwy; }
  }

  // Só declarar ativa se componente de proa real (diff < 90°)
  return minDiff < 90 ? best : runways[0];
}

// ─────────────────────────────────────────────────────────
// CAMADA 5 — SCORE (determinístico)
// ─────────────────────────────────────────────────────────

function scoreProcedure(
  proc: ParsedProcedure,
  activeRwy: string | null,
  env: ProcEnv,
  routeFlags?: { hasCBInInitialSector?: boolean }
): number {
  let score = 50;

  // RWY ativa — critério principal (comparação normalizada)
  if (activeRwy) {
    const procNorm   = normalizeRwy(proc.rwy);
    const activeNorm = normalizeRwy(activeRwy);
    if (proc.rwy === 'GERAL')             score -= 20;
    else if (procNorm === activeNorm)     score += 50;
    else                                  score -= 50;
  }

  // Cenário degradado → preferir letra A (mais simples)
  if (env.isDegraded) {
    const letter = proc.suffix?.[1] ?? 'A';
    if (letter === 'A')      score += 5;
    else if (letter >= 'C') score -= 5;
  }

  // CB penaliza apenas procedimentos da RWY ativa (mantém diferenciação relativa)
  if (env.hasCB && activeRwy && normalizeRwy(proc.rwy) === normalizeRwy(activeRwy)) {
    score -= 10;
  }

  // Integração rota+procedimento: CB no setor inicial da rota penaliza mais
  if (routeFlags?.hasCBInInitialSector && activeRwy &&
      normalizeRwy(proc.rwy) === normalizeRwy(activeRwy)) {
    score -= 20;
  }

  return score;
}

// ─────────────────────────────────────────────────────────
// CAMADA 6 — SELEÇÃO E TAGS
// ─────────────────────────────────────────────────────────

type ProcTag = 'RECOMENDADA' | 'RWY_ATIVA' | 'VENTO_FAVORAVEL'
             | 'CB_NA_AREA'  | 'TETO_BAIXO' | 'CALMARIA' | 'VRB';

const TAG_LABELS: Record<ProcTag, string> = {
  RECOMENDADA:     '⭐ RECOMENDADA',
  RWY_ATIVA:       '🟢 RWY ATIVA',
  VENTO_FAVORAVEL: '✅ VENTO FAVORÁVEL',
  CB_NA_AREA:      '⛈️ CB NA ÁREA',
  TETO_BAIXO:      '☁️ TETO BAIXO',
  CALMARIA:        '🔵 CALMARIA',
  VRB:             '🔵 VENTO VARIÁVEL',
};

interface ScoredProcedure extends ParsedProcedure {
  score:       number;
  recommended: boolean;
  tags:        ProcTag[];
  tagLabels:   string[];
}

function buildScoredProcedures(
  procs: ParsedProcedure[],
  activeRwy: string | null,
  env: ProcEnv,
  routeFlags?: { hasCBInInitialSector?: boolean }
): ScoredProcedure[] {
  const scored: ScoredProcedure[] = procs.map(p => {
    const score = scoreProcedure(p, activeRwy, env, routeFlags);
    const tags: ProcTag[] = [];
    const isActiveRwy = activeRwy && normalizeRwy(p.rwy) === normalizeRwy(activeRwy);

    if (isActiveRwy) {
      tags.push('RWY_ATIVA');
      tags.push('VENTO_FAVORAVEL');
    }
    if (env.isCalm)        tags.push('CALMARIA');
    if (env.isVRB)         tags.push('VRB');
    if (env.hasCB)         tags.push('CB_NA_AREA');
    if (env.hasLowCeiling) tags.push('TETO_BAIXO');

    return { ...p, score, recommended: false, tags, tagLabels: tags.map(t => TAG_LABELS[t]) };
  });

  // Ordenação com desempate determinístico
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aNorm = normalizeRwy(a.rwy);
    const bNorm = normalizeRwy(b.rwy);
    const actN  = activeRwy ? normalizeRwy(activeRwy) : '';
    if (aNorm === actN && bNorm !== actN) return -1;
    if (bNorm === actN && aNorm !== actN) return  1;
    return a.nome.localeCompare(b.nome);
  });

  // Marcar recomendado
  if (scored.length > 0) {
    scored[0].recommended = true;
    scored[0].tags.unshift('RECOMENDADA');
    scored[0].tagLabels.unshift(TAG_LABELS.RECOMENDADA);
  }

  return scored;
}

// ─────────────────────────────────────────────────────────
// CAMADA 7 — AGRUPAMENTO POR RWY
// ─────────────────────────────────────────────────────────

interface RwyGroup {
  rwy:        string;
  active:     boolean;
  heading:    number;
  procedures: ScoredProcedure[];
}

function groupByRwy(procs: ScoredProcedure[], activeRwy: string | null): RwyGroup[] {
  const map = new Map<string, ScoredProcedure[]>();
  for (const p of procs) {
    if (!map.has(p.rwy)) map.set(p.rwy, []);
    map.get(p.rwy)!.push(p);
  }

  const groups: RwyGroup[] = [];
  for (const [rwy, list] of map.entries()) {
    groups.push({
      rwy,
      active:     activeRwy ? normalizeRwy(rwy) === normalizeRwy(activeRwy) : false,
      heading:    runwayHeading(rwy),
      procedures: list,
    });
  }

  groups.sort((a, b) => {
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return  1;
    return a.heading - b.heading;
  });

  return groups;
}

// ─────────────────────────────────────────────────────────
// CAMADA 8 — LLM (linguagem apenas)
// ─────────────────────────────────────────────────────────

function buildPrompt(
  icao: string,
  type: 'dep' | 'arr',
  recommended: ScoredProcedure,
  activeRwy: string | null,
  env: ProcEnv,
  isWindDetermined: boolean
): string {
  const windStr = env.isCalm   ? 'Calmaria'
    : env.isVRB                ? 'Variável (VRB)'
    : `${String(env.windDir).padStart(3,'0')}°/${env.windSpeedKt}kt${env.gustKt ? ` G${env.gustKt}kt` : ''}`;

  return `Você é a camada de linguagem do sistema Dumont. Não decide nada — apenas redige.

PROCEDIMENTO RECOMENDADO (já escolhido pelo backend): ${recommended.nome}
AERÓDROMO: ${icao}
TIPO: ${type === 'dep' ? 'SID — Saída Padrão por Instrumentos' : 'STAR/IAC — Chegada por Instrumentos'}
RWY: ${recommended.rwyRaw !== 'GERAL' ? recommended.rwyRaw : 'não especificada'}
RWY ATIVA: ${activeRwy ? `${activeRwy}${!isWindDetermined ? ' (fallback — sem vento determinado)' : ''}` : 'não determinada'}
VENTO: ${windStr}
CB NA ÁREA: ${env.hasCB}
TETO BAIXO: ${env.hasLowCeiling}
CENÁRIO DEGRADADO: ${env.isDegraded}

TAREFA — responda APENAS com JSON, sem markdown:
{
  "reasons": ["razão 1 ≤ 8 palavras", "razão 2 ≤ 8 palavras"],
  "briefing": "3-4 linhas. Tipo de navegação (RNAV ou convencional se inferível), alinhamento com RWY, contexto meteorológico se relevante. NÃO inventar altitudes, curvas, waypoints ou restrições específicas."
}

REGRAS ABSOLUTAS:
- Máximo 2 reasons baseadas nos dados fornecidos
- Nunca inventar "subir para FL080", "curva à esquerda após 400ft" etc.
- Se cenário degradado, mencionar atenção extra de forma genérica
- Responda em português brasileiro`;
}

// ─────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const icao = searchParams.get('icao')?.toUpperCase();
  const type = (searchParams.get('type') ?? 'dep') as 'dep' | 'arr';
  // Flag opcional passada pelo RoutePanel para integração rota+procedimento
  const routeHasCB = searchParams.get('routeHasCB') === 'true';

  if (!icao) return NextResponse.json({ error: 'icao obrigatório' }, { status: 400 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: 'ANTHROPIC_KEY não configurada' }, { status: 503 });

  // Camada 1 — Ingestão paralela
  const [cartas, metar] = await Promise.all([fetchCartas(icao), fetchMetar(icao)]);

  // Camada 2 — Normalização
  const env = normalizeEnv(metar, '');

  // Camada 3 — Parse de procedimentos
  const tipoFiltro = type === 'dep' ? ['SID'] : ['STAR', 'IAC', 'ARC'];
  const parsed     = parseProcedures(cartas, tipoFiltro);

  // Proteção: sem procedimentos → retorno seguro
  if (parsed.length === 0) {
    return NextResponse.json({
      activeRwy: null, windSummary: '',
      recommended: null, byRwy: [], allCartas: cartas,
    });
  }

  // Camada 4 — RWY ativa
  const runways         = [...new Set(parsed.map(p => p.rwy).filter(r => r !== 'GERAL'))];
  const isWindDetermined = !env.isCalm && !env.isVRB;
  const activeRwy       = getActiveRunway(env, runways);

  // Flags de integração rota+procedimento
  const routeFlags = { hasCBInInitialSector: routeHasCB && env.hasCB };

  // Camada 5+6 — Score e seleção
  const scored      = buildScoredProcedures(parsed, activeRwy, env, routeFlags);

  // Proteção: se scored vazio após filtro → retorno seguro
  if (!scored.length) {
    return NextResponse.json({
      activeRwy, windSummary: '',
      recommended: null, byRwy: [], allCartas: cartas,
    });
  }

  const recommended = scored[0];

  // Camada 7 — Agrupamento
  const byRwy = groupByRwy(scored, activeRwy);

  // Wind summary — formato cockpit padronizado
  const windSummary = env.isCalm
    ? 'Calmaria | sem preferência de RWY'
    : env.isVRB
    ? 'Vento variável | sem preferência de RWY'
    : `Vento ${String(env.windDir).padStart(3,'0')}°/${env.windSpeedKt}kt${env.gustKt ? ` G${env.gustKt}kt` : ''} | RWY ${activeRwy} favorecida`;

  // Camada 8 — LLM (linguagem apenas, timeout reduzido para UX)
  let reasons  = ['Melhor alinhamento com condições atuais'];
  let briefing = `${type === 'dep' ? 'Saída' : 'Chegada'} padrão por instrumentos — consultar carta para detalhes operacionais.`;

  try {
    const prompt = buildPrompt(icao, type, recommended, activeRwy, env, isWindDetermined);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(8_000),  // reduzido: fallback rápido
    });

    if (res.ok) {
      const data  = await res.json();
      const text  = data.content?.[0]?.text ?? '';
      const clean = text.replace(/```json|```/g, '').trim();
      // Proteção robusta contra JSON malformado
      let llm: any = null;
      try { llm = JSON.parse(clean); } catch { llm = null; }
      if (llm && Array.isArray(llm.reasons) && llm.reasons.length)  reasons  = llm.reasons;
      if (llm && typeof llm.briefing === 'string' && llm.briefing)   briefing = llm.briefing;
    }
  } catch { /* fallback mantido silenciosamente */ }

  // Output final — backend prevalece em tudo exceto linguagem
  return NextResponse.json({
    activeRwy,
    windSummary,
    recommended: {
      nome:      recommended.nome,
      tipo:      recommended.tipo,
      rwy:       recommended.rwyRaw,
      score:     recommended.score,
      reasons,
      briefing,
      tagLabels: recommended.tagLabels,
      link:      recommended.link,
      icp:       recommended.icp,
    },
    byRwy: byRwy.map(g => ({
      rwy:        g.rwy,
      active:     g.active,
      heading:    g.heading,
      procedures: g.procedures.map(p => ({
        nome:        p.nome,
        tipo:        p.tipo,
        rwy:         p.rwyRaw,
        recommended: p.recommended,
        score:       p.score,
        tagLabels:   p.tagLabels,
        link:        p.link,
        icp:         p.icp,
      })),
    })),
    allCartas: cartas,
  }, {
    headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=60' },
  });
}
