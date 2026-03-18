// src/app/api/carta-proxy/route.ts
// Faz proxy do PDF da carta aeronáutica — necessário porque o AISWEB
// bloqueia embedding direto (X-Frame-Options / CSP).

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')?.trim();
  if (!id || !/^[a-f0-9-]{30,}$/i.test(id)) {
    return new NextResponse('ID inválido', { status: 400 });
  }

  const apiKey = process.env.AISWEB_USER;
  if (!apiKey) {
    return new NextResponse('AISWEB_USER não configurado', { status: 503 });
  }

  const url = `https://aisweb.decea.gov.br/download/?arquivo=${id}&apikey=${apiKey}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { 'User-Agent': 'DumontBriefing/1.0' },
    });

    if (!res.ok) {
      return new NextResponse(`AISWEB: ${res.status}`, { status: 502 });
    }

    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        // Permitir embedding na mesma origem
        'X-Frame-Options': 'SAMEORIGIN',
        'Cache-Control': 'public, max-age=86400', // PDF não muda dentro da emenda
      },
    });
  } catch (e) {
    return new NextResponse((e as Error).message, { status: 502 });
  }
}
