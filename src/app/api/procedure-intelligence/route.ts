// src/app/api/procedure-intelligence/route.ts
// Analisa SIDs/STARs disponíveis + METAR e recomenda o procedimento ideal

import { NextRequest, NextResponse } from 'next/server';

const AISWEB_BASE   = 'https://api.decea.mil.br/aisweb/';
const REDEMET_KEY   = process.env.REDEMET_KEY ?? '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';

// ── Fetch cartas AISWEB ───────────────────────────────────
async function getCartas(icao: string): Promise<any[]> {
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

    // Parse XML simples
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
      items.push({
        id:    get('id'),
        tipo:  get('tipo'),
        nome:  get('nome'),
        link:  get('link'),
        icp:   get('icp'),
      });
    }
    return items;
  } catch { return []; }
}

// ── Fetch METAR REDEMET ───────────────────────────────────
async function getMetar(icao: string): Promise<string> {
  if (!REDEMET_KEY) return '';
  try {
    const now   = new Date();
    const start = new Date(now.getTime() - 2 * 60 * 60 * 1000);
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

// ── Prompt Claude ─────────────────────────────────────────
function buildPrompt(icao: string, type: 'dep' | 'arr', procedures: any[], metar: string): string {
  const tipoFiltro = type === 'dep' ? ['SID'] : ['STAR', 'IAC', 'ARC'];
  const filtered = procedures.filter(p => tipoFiltro.includes(p.tipo?.toUpperCase()));

  const procList = filtered.map(p => `- ${p.tipo} | ${p.nome} | ICP: ${p.icp || 'N/A'}`).join('\n');

  return `Você é um despachante operacional sênior. Analise os procedimentos disponíveis para ${type === 'dep' ? 'decolagem de' : 'chegada em'} ${icao} e recomende o mais adequado para as condições atuais.

METAR ${icao}: ${metar || 'não disponível'}

PROCEDIMENTOS DISPONÍVEIS (${type === 'dep' ? 'SIDs' : 'STARs/IACs'}):
${procList || 'Nenhum procedimento disponível'}

Responda APENAS com JSON válido, sem markdown:
{
  "activeRwy": "ex: 29 ou 10R — pista ativa inferida do vento no METAR. null se não disponível",
  "windSummary": "ex: Vento 290°/12kt — favorece RWY 29. String curta.",
  "recommended": {
    "nome": "nome exato do procedimento recomendado",
    "tipo": "SID ou STAR ou IAC",
    "rwy": "pista deste procedimento ex: 29",
    "reasons": ["razão 1 curta", "razão 2 curta"],
    "tag": "LOW_WORKLOAD" | "VECTORING_LIKELY" | "COMPLEX" | "STANDARD",
    "tagLabel": "🟢 SIMPLES" | "🟡 VETORAÇÃO PROVÁVEL" | "🔴 COMPLEXA" | "✅ PADRÃO"
  },
  "byRwy": [
    {
      "rwy": "29",
      "active": true,
      "procedures": [
        {
          "nome": "nome do procedimento",
          "tipo": "SID",
          "recommended": true,
          "tag": "LOW_WORKLOAD",
          "tagLabel": "🟢 SIMPLES",
          "note": "nota operacional curta ou null"
        }
      ]
    }
  ],
  "briefing": "3-4 linhas de briefing rápido do procedimento recomendado — curso inicial, restrições, waypoint principal. Estilo cockpit."
}

REGRAS:
- Inferir pista ativa pelo vento: vento 290° → RWY 29 (maior componente de proa)
- Se não tiver METAR, marcar activeRwy como null e recomendar pelo nome mais simples
- Agrupar procedimentos pelo número de pista extraído do nome (ex: "DUBDU 1B RWY 29" → rwy "29")
- Se não conseguir extrair RWY do nome, agrupar em "GERAL"
- tag: LOW_WORKLOAD=procedimento direto sem muitas restrições, VECTORING_LIKELY=termina em vetoração para final, COMPLEX=muitas restrições/altitude, STANDARD=padrão sem info adicional
- Responda em português brasileiro
- Nunca invente procedimentos que não estão na lista`;
}

// ── Handler ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const icao = searchParams.get('icao')?.toUpperCase();
  const type = (searchParams.get('type') ?? 'dep') as 'dep' | 'arr';

  if (!icao) return NextResponse.json({ error: 'icao obrigatório' }, { status: 400 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: 'ANTHROPIC_KEY não configurada' }, { status: 503 });

  const [cartas, metar] = await Promise.all([
    getCartas(icao),
    getMetar(icao),
  ]);

  const prompt = buildPrompt(icao, type, cartas, metar);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Claude: ${err}` }, { status: 502 });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text ?? '';
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    // Anexar lista completa de cartas para o painel de detalhes
    result.allCartas = cartas;

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=60' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
