// src/app/api/tts/route.ts
// Text-to-Speech via OpenAI — voz onyx (grave, profissional)
// Fallback automático se OPENAI_API_KEY não estiver configurada

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { text, lang } = await req.json() as { text: string; lang?: string };

  if (!text?.trim()) {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 });
  }

  // Voz: onyx = masculina grave (PT e EN)
  // Alternativas: echo (masculina média), nova (feminina), alloy (neutra)
  const voice = 'onyx';
  const model = 'tts-1'; // tts-1-hd para maior qualidade (mais lento)

  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        response_format: 'mp3',
        speed: 0.92, // levemente mais lento — mais claro para briefing
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[TTS] OpenAI error:', err);
      return NextResponse.json({ error: `OpenAI TTS: ${res.status}` }, { status: 502 });
    }

    // Retornar audio MP3 diretamente
    const audioBuffer = await res.arrayBuffer();
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600', // cache 1h — mesmo texto = mesmo audio
      },
    });
  } catch (e) {
    console.error('[TTS] Error:', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
