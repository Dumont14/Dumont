// src/app/api/voice/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { parseVoiceIntent, detectLang } from '@/lib/voice/intent';
import { fetchLatestObs, fetchTaf }     from '@/lib/weather';
import { fetchNotams, extractCriticalTexts, extractAtsHours, parseNotams } from '@/lib/notam';

export async function POST(req: NextRequest) {
  const { text, lang: clientLang } = await req.json() as { text: string; lang?: string };

  if (!text?.trim()) {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  // Detectar idioma — preferência do cliente, depois auto-detect
  const langCode = clientLang?.startsWith('en') ? 'en' : detectLang(text);
  const isEN     = langCode === 'en';

  // Parsear intenção
  const intent = parseVoiceIntent(text);
  if (!intent) {
    return NextResponse.json({
      reply: isEN
        ? "I didn't catch an ICAO code. Try: Dumont, conditions at SBSP."
        : "Não identifiquei um aeródromo. Diga: Dumont, condições de SBSP.",
      icao: null, type: 'error', lang: langCode,
    });
  }

  const { dep, arr } = intent;

  // Buscar todos os dados em paralelo
  const [
    obsDep, tafDep, notamsRawDep,
    obsArr, tafArr, notamsRawArr,
  ] = await Promise.all([
    fetchLatestObs(dep).catch(() => null),
    fetchTaf(dep).catch(() => null),
    fetchNotams(dep).catch(() => null),
    arr ? fetchLatestObs(arr).catch(() => null)   : Promise.resolve(null),
    arr ? fetchTaf(arr).catch(() => null)          : Promise.resolve(null),
    arr ? fetchNotams(arr).catch(() => null)       : Promise.resolve(null),
  ]);

  const notamsDep  = parseNotams(notamsRawDep);
  const notamsArr  = parseNotams(notamsRawArr);
  const critDep    = extractCriticalTexts(notamsRawDep);
  const critArr    = extractCriticalTexts(notamsRawArr);
  const atsDep     = extractAtsHours(notamsDep);
  const atsArr     = arr ? extractAtsHours(notamsArr) : null;

  // Construir prompt
  const systemPrompt = buildSystemPrompt(isEN);
  const userContent  = buildUserContent({
    dep, arr,
    metarDep: obsDep?.raw    ?? null,
    obsTypeDep: obsDep?.type ?? 'METAR',
    tafDep,
    critDep,
    atsDep,
    metarArr: obsArr?.raw    ?? null,
    obsTypeArr: obsArr?.type ?? 'METAR',
    tafArr,
    critArr,
    atsArr,
  });

  // Chamar Claude
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
        max_tokens: 400,
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

  return NextResponse.json({
    reply,
    icao:     dep,
    icao_arr: arr ?? null,
    type:     intent.type,
    lang:     langCode,
  });
}

// ── PROMPT BUILDERS ──────────────────────────────────────

function buildSystemPrompt(isEN: boolean): string {
  if (isEN) return `You are Dumont, a voice aeronautical briefing assistant.
LANGUAGE: Always respond in English.
RULES:
- CONCISE. Max 4 sentences per aerodrome.
- State: flight category (VMC/MVFR/IFR/LIFR), wind if notable, visibility if restricted, ceiling if low.
- Mention TAF ONLY if significant deterioration expected within 2 hours.
- Mention NOTAMs ONLY if runway closed, ILS/VOR inop, aerodrome closed, or HAZARD.
- ATS hours: warn clearly if aerodrome is currently closed or closing within 60 minutes. Say "request ATS extension" if closed.
- If everything is normal: state category and wind only.
- Do NOT mention pressure, temperature, dewpoint, or non-impacting clouds.
- Speak naturally. No bullet lists. No markdown.
- End with "Verify with official sources." ONLY if there is a notable condition.`;

  return `Você é Dumont, assistente de briefing aeronáutico por voz.
IDIOMA: Responda SEMPRE em português do Brasil.
REGRAS:
- CONCISO. Máximo 4 frases por aeródromo.
- Informe: categoria de voo (VMC/MVFR/IFR/LIFR), vento se relevante, visibilidade se restrita, teto se baixo.
- Cite TAF APENAS se há deterioração significativa nas próximas 2 horas.
- Cite NOTAMs APENAS se pista fechada, ILS/VOR inoperante, AD fechado ou HAZARD.
- Horário ATS: avise claramente se o AD está fechado agora ou fecha em menos de 60 minutos. Se fechado, diga "solicite extensão ao órgão ATS".
- Se tudo normal: diga apenas categoria e vento.
- NÃO cite QNH, temperatura, ponto de orvalho ou nuvens sem impacto.
- Fale naturalmente. Sem listas. Sem markdown.
- Encerre com "Consulte as fontes oficiais." APENAS se houver condição de atenção.`;
}

function fmtAts(ats: ReturnType<typeof extractAtsHours>): string {
  if (!ats) return 'desconhecido';
  if (ats.isH24) return 'H24';
  const open  = `${String(Math.floor(ats.open  / 60)).padStart(2,'0')}${String(ats.open  % 60).padStart(2,'0')}`;
  const close = `${String(Math.floor(ats.close / 60)).padStart(2,'0')}${String(ats.close % 60).padStart(2,'0')}`;
  const status = !ats.isOpen
    ? `FECHADO AGORA (abre ${open}Z)`
    : ats.closingSoon
    ? `FECHA EM BREVE às ${close}Z`
    : `aberto ${open}Z-${close}Z`;
  return status;
}

function buildUserContent(d: {
  dep: string; arr: string | null;
  metarDep: string | null; obsTypeDep: string; tafDep: string | null;
  critDep: string[]; atsDep: ReturnType<typeof extractAtsHours>;
  metarArr: string | null; obsTypeArr: string; tafArr: string | null;
  critArr: string[]; atsArr: ReturnType<typeof extractAtsHours>;
}): string {
  const depBlock = `${d.dep}:
  ${d.obsTypeDep}: ${d.metarDep || 'N/A'}
  TAF: ${d.tafDep?.substring(0, 300) || 'N/A'}
  NOTAMs críticos: ${d.critDep.join(' / ') || 'nenhum'}
  Serviço ATS: ${fmtAts(d.atsDep)}`;

  if (!d.arr) return depBlock;

  const arrBlock = `${d.arr}:
  ${d.obsTypeArr}: ${d.metarArr || 'N/A'}
  TAF: ${d.tafArr?.substring(0, 300) || 'N/A'}
  NOTAMs críticos: ${d.critArr.join(' / ') || 'nenhum'}
  Serviço ATS: ${fmtAts(d.atsArr)}`;

  return `Rota ${d.dep}→${d.arr}.\n${depBlock}\n\n${arrBlock}`;
}
