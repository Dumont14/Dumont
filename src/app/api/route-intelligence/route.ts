// src/app/api/route-intelligence/route.ts
// Agrega SIGMET + TAF DEP/ARR e usa Claude para sintetizar o briefing operacional

import { NextRequest, NextResponse } from 'next/server';

const REDEMET_KEY  = process.env.REDEMET_KEY ?? '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY ?? '';

// ── Helpers REDEMET ───────────────────────────────────────
function redemetWindow(hoursBack = 6) {
  const now   = new Date();
  const start = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);
  const fmt   = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}` +
    `${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}`;
  return { dataIni: fmt(start), dataFim: fmt(now) };
}

async function getTaf(icao: string): Promise<string> {
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

async function getMetar(icao: string): Promise<string> {
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

async function getSigmets(): Promise<any[]> {
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

// ── Prompt para Claude ────────────────────────────────────
function buildPrompt(dep: string, arr: string, depTaf: string, arrTaf: string, depMetar: string, arrMetar: string, sigmets: any[]): string {
  const sigmetText = sigmets.length === 0
    ? 'Nenhum SIGMET ativo no momento.'
    : sigmets.map(s =>
        `FIR ${s.id_fir} | ${s.fenomeno} | Válido ${s.validade_inicial.slice(11,16)}–${s.validade_final.slice(11,16)}Z | ${s.mens}`
      ).join('\n');

  return `Você é um despachante operacional experiente da aviação brasileira. Analise os dados abaixo e produza um briefing operacional conciso para a rota ${dep} → ${arr}.

DADOS:
METAR ${dep}: ${depMetar || 'não disponível'}
TAF ${dep}: ${depTaf || 'não disponível'}
METAR ${arr}: ${arrMetar || 'não disponível'}  
TAF ${arr}: ${arrTaf || 'não disponível'}
SIGMETs ativos Brasil:
${sigmetText}

Responda APENAS com JSON válido, sem markdown, sem texto fora do JSON:
{
  "status": "string de 1 linha — ex: ROTA OPERACIONAL | condições VMC nos dois AD",
  "statusLevel": "ok" | "caution" | "warning" | "critical",
  "threats": [
    { "icon": "emoji", "text": "descrição da ameaça", "severity": "low"|"medium"|"high" }
  ],
  "window": {
    "best": "ex: Agora até +3h",
    "warning": "ex: Piora prevista após 18:00Z",
    "detail": "1-2 frases explicando a janela"
  },
  "criticalPoints": [
    { "point": "nome do ponto/FIR/trecho", "issue": "descrição do problema" }
  ]
}

Regras:
- Seja direto e objetivo como um despachante real
- Não invente dados que não estão nas fontes
- Se não houver ameaças, threats deve ser array vazio
- statusLevel: ok=tudo normal, caution=atenção recomendada, warning=cuidado significativo, critical=não recomendado
- Responda em português brasileiro
- Máximo 2 criticalPoints se não houver problemas reais`;
}

// ── Handler ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const dep = searchParams.get('dep')?.toUpperCase();
  const arr = searchParams.get('arr')?.toUpperCase();

  if (!dep || !arr) {
    return NextResponse.json({ error: 'dep e arr obrigatórios' }, { status: 400 });
  }

  if (!ANTHROPIC_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 503 });
  }

  // Buscar todos os dados em paralelo
  const [depTaf, arrTaf, depMetar, arrMetar, sigmets] = await Promise.all([
    getTaf(dep),
    getTaf(arr),
    getMetar(dep),
    getMetar(arr),
    getSigmets(),
  ]);

  // Chamar Claude
  const prompt = buildPrompt(dep, arr, depTaf, arrTaf, depMetar, arrMetar, sigmets);

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
        max_tokens: 1024,
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

    // Parse JSON da resposta
    const clean = text.replace(/```json|```/g, '').trim();
    const brief = JSON.parse(clean);

    return NextResponse.json(brief, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
