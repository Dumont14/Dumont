// src/app/api/route-intelligence/route.ts
// Arquitetura: Backend decide → LLM comunica
// Fluxo: rawData → normalize → flags → threats → riskScore → Claude (linguagem apenas)

import { NextRequest, NextResponse } from 'next/server';

const REDEMET_KEY   = process.env.REDEMET_KEY ?? process.env.REDEMET_API_KEY ?? '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';

// ─────────────────────────────────────────────────────────
// CAMADA 1 — INGESTÃO
// ─────────────────────────────────────────────────────────

function redemetWindow(hoursBack: number) {
  const now   = new Date();
  const start = new Date(now.getTime() - hoursBack * 3600_000);
  const fmt   = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}` +
    `${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}`;
  return { dataIni: fmt(start), dataFim: fmt(now) };
}

async function fetchTaf(icao: string): Promise<string> {
  if (!REDEMET_KEY) return '';
  try {
    const { dataIni, dataFim } = redemetWindow(6);
    const res = await fetch(
      `https://api-redemet.decea.mil.br/mensagens/taf/${icao}?api_key=${REDEMET_KEY}&data_ini=${dataIni}&data_fim=${dataFim}&fim_linha=texto`,
      { next: { revalidate: 900 }, signal: AbortSignal.timeout(8000) }
    );
    const json = await res.json();
    return json?.data?.data?.[0]?.mens ?? '';
  } catch { return ''; }
}

async function fetchMetar(icao: string): Promise<string> {
  if (!REDEMET_KEY) return '';
  try {
    const { dataIni, dataFim } = redemetWindow(2);
    const res = await fetch(
      `https://api-redemet.decea.mil.br/mensagens/metar/${icao}?api_key=${REDEMET_KEY}&data_ini=${dataIni}&data_fim=${dataFim}`,
      { next: { revalidate: 120 }, signal: AbortSignal.timeout(8000) }
    );
    const json = await res.json();
    const msgs = json?.data?.data ?? [];
    return msgs[msgs.length - 1]?.mens ?? '';
  } catch { return ''; }
}

async function fetchSigmets(): Promise<any[]> {
  if (!REDEMET_KEY) return [];
  try {
    const res = await fetch(
      `https://api-redemet.decea.mil.br/mensagens/sigmet/?api_key=${REDEMET_KEY}&pais=Brasil&page_tam=150`,
      { next: { revalidate: 300 }, signal: AbortSignal.timeout(8000) }
    );
    const json = await res.json();
    const now  = Date.now();
    return (json?.data?.data ?? []).filter((s: any) => {
      const fim = new Date(s.validade_final.replace(' ', 'T') + 'Z').getTime();
      return fim > now;
    });
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────
// CAMADA 2 — NORMALIZAÇÃO (texto → dados)
// ─────────────────────────────────────────────────────────

interface Normalized {
  ceilingDepFt: number;
  ceilingArrFt: number;
  visDepMt:     number;
  visArrMt:     number;
  windDepKt:    number;
  gustDepKt:    number;
  windArrKt:    number;
  gustArrKt:    number;
  hasCbDep:     boolean;
  hasCbArr:     boolean;
  hasCbSigmet:  boolean;
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

function parseVisMt(text: string): number {
  if (/CAVOK/i.test(text)) return 9999;
  const sm = text.match(/(\d+(?:\.\d+)?)SM/);
  if (sm) return Math.round(parseFloat(sm[1]) * 1609);
  const m = text.match(/\b(\d{4})\b/);
  return m ? parseInt(m[1]) : 9999;
}

function parseWindKt(text: string): { spd: number; gust: number } {
  const m = text.match(/\b(?:VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  if (!m) return { spd: 0, gust: 0 };
  return { spd: parseInt(m[1]), gust: m[2] ? parseInt(m[2]) : 0 };
}

function hasCbTs(text: string): boolean {
  return /\b(CB|TS|TSRA|TSGR|TSSN|TSSQ)\b/i.test(text);
}

function normalize(
  depMetar: string, arrMetar: string,
  depTaf: string, arrTaf: string,
  sigmets: any[]
): Normalized {
  const wDep = parseWindKt(depMetar);
  const wArr = parseWindKt(arrMetar);
  return {
    ceilingDepFt: parseCeilingFt(`${depMetar} ${depTaf}`),
    ceilingArrFt: parseCeilingFt(`${arrMetar} ${arrTaf}`),
    visDepMt:     parseVisMt(`${depMetar} ${depTaf}`),
    visArrMt:     parseVisMt(`${arrMetar} ${arrTaf}`),
    windDepKt:    wDep.spd,
    gustDepKt:    wDep.gust,
    windArrKt:    wArr.spd,
    gustArrKt:    wArr.gust,
    hasCbDep:     hasCbTs(`${depMetar} ${depTaf}`),
    hasCbArr:     hasCbTs(`${arrMetar} ${arrTaf}`),
    hasCbSigmet:  sigmets.some(s => /TS|CB/.test(s.fenomeno)),
  };
}

// ─────────────────────────────────────────────────────────
// CAMADA 3 — MOTOR DE FLAGS
// ─────────────────────────────────────────────────────────

interface Flags {
  hasSigmet:        boolean;
  hasCB:            boolean;
  hasLowCeilingArr: boolean;
  hasLowCeilingDep: boolean;
  hasStrongWindArr: boolean;
  hasStrongWindDep: boolean;
  hasLowVisArr:     boolean;
  hasLowVisDep:     boolean;
  isBothVMC:        boolean;
  hasDetermination: boolean;
}

function tafHasDetermination(tafText: string): boolean {
  if (!tafText) return false;
  const nowH = new Date().getUTCHours();
  const blocks = tafText.match(/(TEMPO|BECMG)\s+\d{4}\/\d{4}[^\n]*/g) ?? [];
  for (const block of blocks) {
    const tm = block.match(/\d{4}\/(\d{2})(\d{2})/);
    if (!tm) continue;
    const diff = ((parseInt(tm[2]) - nowH + 24) % 24);
    if (diff > 6) continue;
    if (/CB|TS|FG|BKN0[0-4]|OVC0[0-4]/i.test(block)) return true;
  }
  return false;
}

function computeFlags(n: Normalized, sigmets: any[], arrTaf: string): Flags {
  const isVMCDep = n.visDepMt >= 5000 && n.ceilingDepFt >= 1500;
  const isVMCArr = n.visArrMt >= 5000 && n.ceilingArrFt >= 1500;
  return {
    hasSigmet:        sigmets.length > 0,
    hasCB:            n.hasCbDep || n.hasCbArr || n.hasCbSigmet,
    hasLowCeilingArr: n.ceilingArrFt < 1500,
    hasLowCeilingDep: n.ceilingDepFt < 1500,
    hasStrongWindArr: n.windArrKt >= 25 || n.gustArrKt >= 35,
    hasStrongWindDep: n.windDepKt >= 25 || n.gustDepKt >= 35,
    hasLowVisArr:     n.visArrMt < 5000,
    hasLowVisDep:     n.visDepMt < 5000,
    isBothVMC:        isVMCDep && isVMCArr,
    hasDetermination: tafHasDetermination(arrTaf),
  };
}

// ─────────────────────────────────────────────────────────
// CAMADA 4 — MOTOR DE DECISÃO (100% sem LLM)
// ─────────────────────────────────────────────────────────

type Severity = 'low' | 'medium' | 'high';
type ThreatType =
  | 'SIGMET' | 'CB'
  | 'LOW_CEILING_ARR' | 'LOW_CEILING_DEP'
  | 'STRONG_WIND_ARR' | 'STRONG_WIND_DEP'
  | 'LOW_VIS_ARR'     | 'LOW_VIS_DEP';

interface ThreatRaw {
  type:     ThreatType;
  severity: Severity;
  icon:     string;
  textKey:  string;
  impact:   string;
}

// Prioridade decrescente — slice(0,4) garante os mais críticos
const THREAT_MAP: { flag: keyof Flags; threat: ThreatRaw }[] = [
  {
    flag: 'hasSigmet',
    threat: { type:'SIGMET', severity:'high', icon:'⛈️',
      textKey:'SIGMET ativo na rota',
      impact:'Consultar despacho — possíveis desvios e combustível extra' },
  },
  {
    flag: 'hasCB',
    threat: { type:'CB', severity:'high', icon:'⛈️',
      textKey:'CB/TS identificado nos dados',
      impact:'Planejar desvios — reserva extra de combustível' },
  },
  {
    flag: 'hasLowCeilingArr',
    threat: { type:'LOW_CEILING_ARR', severity:'medium', icon:'☁️',
      textKey:'Teto baixo previsto na chegada',
      impact:'Verificar mínimos IAC — possível necessidade de alternado' },
  },
  {
    flag: 'hasLowCeilingDep',
    threat: { type:'LOW_CEILING_DEP', severity:'medium', icon:'☁️',
      textKey:'Teto baixo na partida',
      impact:'Possível demora na liberação IFR pelo ACC/APP' },
  },
  {
    flag: 'hasStrongWindArr',
    threat: { type:'STRONG_WIND_ARR', severity:'medium', icon:'💨',
      textKey:'Vento forte na chegada',
      impact:'Verificar componente de través e limitações de performance' },
  },
  {
    flag: 'hasStrongWindDep',
    threat: { type:'STRONG_WIND_DEP', severity:'medium', icon:'💨',
      textKey:'Vento forte na partida',
      impact:'Verificar limitações de decolagem — performance reduzida' },
  },
  {
    flag: 'hasLowVisArr',
    threat: { type:'LOW_VIS_ARR', severity:'medium', icon:'🌫️',
      textKey:'Baixa visibilidade na chegada',
      impact:'Verificar mínimos de aproximação — possível alternado' },
  },
  {
    flag: 'hasLowVisDep',
    threat: { type:'LOW_VIS_DEP', severity:'medium', icon:'🌫️',
      textKey:'Baixa visibilidade na partida',
      impact:'Verificar mínimos de decolagem do operador' },
  },
];

function buildThreats(flags: Flags): ThreatRaw[] {
  const threats: ThreatRaw[] = [];
  for (const { flag, threat } of THREAT_MAP) {
    if (flags[flag]) {
      // Se já tem SIGMET, não adicionar CB separado (são a mesma ameaça)
      if (threat.type === 'CB' && flags.hasSigmet) continue;
      threats.push(threat);
    }
    if (threats.length === 4) break;
  }
  return threats;
}

function calculateRisk(flags: Flags, threats: ThreatRaw[]): {
  riskScore: number;
  riskLabel: string;
  statusLevel: string;
} {
  const base  = flags.isBothVMC ? 5 : 20;
  const points = threats.reduce((sum, t) =>
    sum + (t.severity === 'high' ? 30 : t.severity === 'medium' ? 20 : 10), 0);
  const riskScore = Math.min(base + points, 100);

  const riskLabel   = riskScore <= 20 ? 'BAIXO' : riskScore <= 50 ? 'MODERADO' : riskScore <= 75 ? 'ALTO' : 'CRÍTICO';
  const statusLevel = riskScore <= 20 ? 'ok'    : riskScore <= 50 ? 'caution'  : riskScore <= 75 ? 'warning' : 'critical';

  return { riskScore, riskLabel, statusLevel };
}

function buildWindow(flags: Flags, arrTaf: string): {
  best: string; deterioration: string; hasDetermination: boolean;
} {
  if (!flags.hasDetermination) {
    return { best: 'Sem variação significativa prevista', deterioration: '', hasDetermination: false };
  }
  // Extrair horário real do bloco adverso no TAF
  const blocks = arrTaf.match(/(TEMPO|BECMG)\s+(\d{4})\/(\d{4})[^\n]*/g) ?? [];
  let deteriorationTime = '';
  const nowH = new Date().getUTCHours();
  for (const block of blocks) {
    const tm = block.match(/\d{4}\/(\d{2})(\d{2})/);
    if (!tm) continue;
    const diff = ((parseInt(tm[2]) - nowH + 24) % 24);
    if (diff > 6) continue;
    if (/CB|TS|FG|BKN0[0-4]|OVC0[0-4]/i.test(block)) {
      deteriorationTime = `${tm[2]}:${tm[3] ?? '00'}Z`;
      break;
    }
  }
  return {
    best: `Agora → ${deteriorationTime || 'próximas 2h'}`,
    deterioration: deteriorationTime ? `Após ${deteriorationTime} — ver TAF ${arrTaf.slice(0,4)}` : 'Piora prevista — verificar TAF',
    hasDetermination: true,
  };
}

// ─────────────────────────────────────────────────────────
// CAMADA 5 — LLM (linguagem apenas)
// ─────────────────────────────────────────────────────────

function buildPrompt(
  dep: string, arr: string,
  depMetar: string, arrMetar: string,
  depTaf: string, arrTaf: string,
  sigmets: any[],
  flags: Flags,
  threats: ThreatRaw[],
  risk: { riskScore: number; riskLabel: string; statusLevel: string },
  window: { best: string; deterioration: string; hasDetermination: boolean }
): string {
  const sigmetText = sigmets.length === 0
    ? 'Nenhum SIGMET ativo.'
    : sigmets.map(s =>
        `FIR ${s.id_fir} | ${s.fenomeno} | ${s.validade_inicial.slice(11,16)}–${s.validade_final.slice(11,16)}Z`
      ).join('\n');

  const threatsJson = JSON.stringify(threats.map(t => ({
    type: t.type, icon: t.icon, text: t.textKey, impact: t.impact, severity: t.severity
  })), null, 2);

  return `Você é a camada de linguagem do sistema Dumont. Sua única função é redigir textos operacionais concisos em português brasileiro com base nos dados já processados. Você NÃO calcula, NÃO decide, NÃO altera valores numéricos.

ROTA: ${dep} → ${arr}
METAR ${dep}: ${depMetar || 'N/D'}
METAR ${arr}: ${arrMetar || 'N/D'}
TAF ${arr}: ${arrTaf || 'N/D'}
SIGMETs: ${sigmetText}

DECISÕES JÁ TOMADAS PELO BACKEND (não altere):
riskScore: ${risk.riskScore}
riskLabel: ${risk.riskLabel}
statusLevel: ${risk.statusLevel}
threats: ${threatsJson}
window.best: ${window.best}
window.deterioration: ${window.deterioration}
window.hasDetermination: ${window.hasDetermination}

SUA ÚNICA TAREFA:
1. Redigir o campo "status" seguindo EXATAMENTE o template:
   "[ROTA] + [nível operacional] | [ameaça principal]"
   Exemplos válidos:
   "ROTA NORMAL | Sem ameaças significativas"
   "ROTA COM RESTRIÇÕES | Teto baixo na chegada"
   "ROTA COM ATENÇÃO | CBs identificados na rota"
   "ROTA CRÍTICA | SIGMET ativo + teto baixo"

2. Redigir "criticalPoints" — máximo 2, apenas se houver ameaças reais:
   { "point": "FIR ou trecho", "issue": "≤ 10 palavras" }

Responda APENAS com JSON, sem markdown:
{
  "status": "...",
  "statusLevel": "${risk.statusLevel}",
  "riskScore": ${risk.riskScore},
  "riskLabel": "${risk.riskLabel}",
  "threats": ${threatsJson},
  "window": ${JSON.stringify(window)},
  "criticalPoints": []
}`;
}

// ─────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const dep = searchParams.get('dep')?.toUpperCase();
  const arr = searchParams.get('arr')?.toUpperCase();

  if (!dep || !arr) return NextResponse.json({ error: 'dep e arr obrigatórios' }, { status: 400 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: 'ANTHROPIC_KEY não configurada' }, { status: 503 });

  // Camada 1 — Ingestão
  const [depTaf, arrTaf, depMetar, arrMetar, sigmets] = await Promise.all([
    fetchTaf(dep), fetchTaf(arr), fetchMetar(dep), fetchMetar(arr), fetchSigmets(),
  ]);

  // Camada 2 — Normalização
  const normalized = normalize(depMetar, arrMetar, depTaf, arrTaf, sigmets);

  // Camada 3 — Flags
  const flags = computeFlags(normalized, sigmets, arrTaf);

  // Camada 4 — Decisão (sem LLM)
  const threats    = buildThreats(flags);
  const risk       = calculateRisk(flags, threats);
  const windowData = buildWindow(flags, arrTaf);

  // Camada 5 — Claude (linguagem apenas)
  const prompt = buildPrompt(dep, arr, depMetar, arrMetar, depTaf, arrTaf,
    sigmets, flags, threats, risk, windowData);

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512, // só precisa de status + criticalPoints
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return NextResponse.json({ error: `Claude error: ${err}` }, { status: 502 });
    }

    const claudeData = await claudeRes.json();
    const text = claudeData.content?.[0]?.text ?? '';
    const clean = text.replace(/```json|```/g, '').trim();
    const llmOut = JSON.parse(clean);

    // Camada 6 — Output final: dados do backend prevalecem sobre LLM
    const final = {
      status:         llmOut.status         ?? 'ROTA ANALISADA',
      statusLevel:    risk.statusLevel,      // backend
      riskScore:      risk.riskScore,        // backend
      riskLabel:      risk.riskLabel,        // backend
      threats:        threats.map(t => ({    // backend
        icon: t.icon, text: t.textKey, impact: t.impact, severity: t.severity,
      })),
      window:         windowData,            // backend
      criticalPoints: llmOut.criticalPoints ?? [],
    };

    return NextResponse.json(final, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
