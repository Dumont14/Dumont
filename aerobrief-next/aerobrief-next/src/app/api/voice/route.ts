// src/app/api/voice/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { parseVoiceIntent, detectLang } from '@/lib/voice/intent';
import { fetchMetar, fetchTaf } from '@/lib/weather';
import { fetchNotams, extractCriticalTexts } from '@/lib/notam';

export async function POST(req: NextRequest) {
  const { text, lang: clientLang } = await req.json() as { text: string; lang?: string };

  if (!text?.trim()) {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  // Detect language — prefer client hint, then auto-detect from content
  const langCode = clientLang?.startsWith('en') ? 'en' : detectLang(text);
  const isEN = langCode === 'en';

  // Parse intent
  const intent = parseVoiceIntent(text);
  if (!intent) {
    return NextResponse.json({
      reply: isEN
        ? "I didn't catch an ICAO code. Try: Dumont, conditions at SBSP."
        : "Não identifiquei um aeródromo. Diga: Dumont, condições de SBSP.",
      icao: null,
      type: 'error',
      lang: langCode,
    });
  }

  const { dep, arr } = intent;

  // Fetch all data in parallel
  const [metarDep, tafDep, notamsDep, metarArr, tafArr, notamsArr] = await Promise.all([
    fetchMetar(dep).catch(() => null),
    fetchTaf(dep).catch(() => null),
    fetchNotams(dep).catch(() => null),
    arr ? fetchMetar(arr).catch(() => null) : Promise.resolve(null),
    arr ? fetchTaf(arr).catch(() => null)   : Promise.resolve(null),
    arr ? fetchNotams(arr).catch(() => null) : Promise.resolve(null),
  ]);

  const critDep = extractCriticalTexts(notamsDep);
  const critArr = arr ? extractCriticalTexts(notamsArr) : [];

  // Build prompt for Claude
  const systemPrompt = buildSystemPrompt(isEN);
  const userContent   = buildUserContent({ dep, arr, metarDep, tafDep, critDep, metarArr, tafArr, critArr });

  // Call Claude
  let reply = '';
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    const aiJson = await aiRes.json();
    reply = aiJson.content?.[0]?.text?.trim() || '';
  } catch {
    reply = isEN
      ? `${dep}, data temporarily unavailable.`
      : `${dep}, dados momentaneamente indisponíveis.`;
  }

  return NextResponse.json({ reply, icao: dep, icao_arr: arr, type: intent.type, lang: langCode });
}

// ── PROMPT BUILDERS ──────────────────────────────────────

function buildSystemPrompt(isEN: boolean): string {
  if (isEN) return `You are Dumont, a voice aeronautical briefing assistant.
RULES:
- CONCISE. Max 4 sentences per aerodrome.
- State: flight category (VMC/MVFR/IFR/LIFR), wind if notable, visibility if restricted, ceiling if low.
- Mention TAF ONLY if significant deterioration expected within 2 hours.
- Mention NOTAMs ONLY if runway closed, ILS/VOR inop, aerodrome closed, or HAZARD.
- If everything is normal: state category and wind only.
- Do NOT mention pressure, temperature, dewpoint, or non-impacting high clouds.
- Speak naturally. No bullet lists.
- End with "Verify with official sources." ONLY if there is a notable condition.`;

  return `Você é Dumont, assistente de briefing aeronáutico por voz.
REGRAS:
- CONCISO. Máximo 4 frases por aeródromo.
- Informe: categoria de voo (VMC/MVFR/IFR/LIFR), vento se relevante, visibilidade se restrita, teto se baixo.
- Cite TAF APENAS se há deterioração significativa prevista nas próximas 2 horas.
- Cite NOTAMs APENAS se há pista fechada, ILS/VOR inoperante, AD fechado ou HAZARD.
- Se tudo normal: diga apenas categoria e vento.
- NÃO cite pressão, temperatura, ponto de orvalho ou nuvens altas sem impacto.
- Fale naturalmente. Sem listas.
- Encerre com "Consulte fontes oficiais." APENAS se houver condição de atenção.`;
}

function buildUserContent(d: {
  dep: string; arr: string | null;
  metarDep: string | null; tafDep: string | null; critDep: string[];
  metarArr: string | null; tafArr: string | null; critArr: string[];
}): string {
  if (d.arr) {
    return `Route ${d.dep}→${d.arr}.
${d.dep}: METAR=${d.metarDep || 'N/A'} | TAF=${d.tafDep?.substring(0, 300) || 'N/A'} | Critical NOTAMs=${d.critDep.join(' / ') || 'none'}
${d.arr}: METAR=${d.metarArr || 'N/A'} | TAF=${d.tafArr?.substring(0, 300) || 'N/A'} | Critical NOTAMs=${d.critArr.join(' / ') || 'none'}`;
  }
  return `${d.dep}: METAR=${d.metarDep || 'N/A'} | TAF=${d.tafDep?.substring(0, 300) || 'N/A'} | Critical NOTAMs=${d.critDep.join(' / ') || 'none'}`;
}
